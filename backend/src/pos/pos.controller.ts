import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  BranchScopeGuard,
  BranchScoped,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  ScopedBranchId,
} from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { ok, okList } from '../core/http/envelope.js';
import { RequireIdempotency } from '../core/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type BookingCodeParam,
  type CreatePosBookingDto,
  type PosAbortDto,
  type PosBookingsListQuery,
  type PosCashPaymentDto,
  type PosCheckInDto,
  type PosCompleteDto,
  type PosCustomerLookupQuery,
  type PosLatestReceiptQuery,
  type PosPromotionsQuery,
  type PosScheduleQuery,
  type PosSettleDto,
  bookingCodeParamSchema,
  createPosBookingSchema,
  posAbortSchema,
  posBookingsListQuerySchema,
  posCashPaymentSchema,
  posCheckInSchema,
  posCompleteSchema,
  posCustomerLookupSchema,
  posLatestReceiptQuerySchema,
  posPromotionsQuerySchema,
  posScheduleQuerySchema,
  posSettleSchema,
} from './pos.schemas.js';
import { PosService } from './pos.service.js';

function resolveRequiredBranchId(
  scopedBranchId: number | null | undefined,
  user: AuthenticatedUser,
): number {
  if (user.role === 'STAFF') {
    if (user.branchId === null) {
      throw new AppError('BRANCH_FORBIDDEN');
    }
    return user.branchId;
  }
  if (scopedBranchId === null || scopedBranchId === undefined) {
    throw new AppError('VALIDATION_ERROR', {
      details: [{ field: 'branchId', message: 'Vui lòng chọn chi nhánh.' }],
    });
  }
  return scopedBranchId;
}

@Controller('pos')
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Roles('STAFF', 'OWNER')
@BranchScoped()
export class PosController {
  constructor(
    private readonly posService: PosService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-25
  @Get('schedule')
  async getSchedule(
    @Query(new ZodValidationPipe(posScheduleQuerySchema)) query: PosScheduleQuery,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branchId = resolveRequiredBranchId(scopedBranchId, user);
    const data = await this.posService.getSchedule(branchId, query);
    return ok(data, this.clock);
  }

  // API-26
  @Get('customers')
  async lookupCustomer(
    @Query(new ZodValidationPipe(posCustomerLookupSchema)) query: PosCustomerLookupQuery,
  ) {
    const data = await this.posService.lookupCustomerByPhone(query.phone);
    return ok(data, this.clock);
  }

  // API-27
  @Get('promotions')
  async listPromotions(
    @Query(new ZodValidationPipe(posPromotionsQuerySchema)) query: PosPromotionsQuery,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branchId = resolveRequiredBranchId(scopedBranchId, user);
    const data = await this.posService.listPromotions(branchId, query);
    return ok(data, this.clock);
  }

  // API-28
  @Post('bookings')
  @HttpCode(HttpStatus.CREATED)
  @RequireIdempotency()
  async createPosBooking(
    @Body(new ZodValidationPipe(createPosBookingSchema)) dto: CreatePosBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.createPosBooking(dto, user);
    return ok(data, this.clock);
  }

  // API-29
  @Post('bookings/:bookingCode/payments')
  @HttpCode(HttpStatus.CREATED)
  @RequireIdempotency()
  async collectCashPayment(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(posCashPaymentSchema)) dto: PosCashPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.collectCashPayment(params.bookingCode, dto, user);
    return ok(data, this.clock);
  }

  // API-30
  @Post('bookings/:bookingCode/abort')
  @HttpCode(HttpStatus.OK)
  async abortCounterBooking(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(posAbortSchema)) dto: PosAbortDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.abortCounterBooking(params.bookingCode, dto, user);
    return ok(data, this.clock);
  }

  // API-31
  @Get('receipts/latest')
  async getLatestReceipt(
    @Query(new ZodValidationPipe(posLatestReceiptQuerySchema)) _query: PosLatestReceiptQuery,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branchId = resolveRequiredBranchId(scopedBranchId, user);
    const data = await this.posService.getLatestReceipt(branchId);
    return ok(data, this.clock);
  }

  // API-32
  @Get('bookings')
  async listBranchBookings(
    @Query(new ZodValidationPipe(posBookingsListQuerySchema)) query: PosBookingsListQuery,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const branchId = resolveRequiredBranchId(scopedBranchId, user);
    const result = await this.posService.listBranchBookings(branchId, query, user);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      { tabCounts: result.tabCounts },
    );
  }

  // API-33
  @Post('bookings/:bookingCode/settle')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotency()
  async settleBooking(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(posSettleSchema)) dto: PosSettleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.settleBooking(params.bookingCode, dto, user);
    return ok(data, this.clock);
  }

  // API-34
  @Post('bookings/:bookingCode/check-in')
  @HttpCode(HttpStatus.OK)
  async checkInBooking(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(posCheckInSchema)) dto: PosCheckInDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.checkInBooking(params.bookingCode, dto, user);
    return ok(data, this.clock);
  }

  // API-35
  @Post('bookings/:bookingCode/complete')
  @HttpCode(HttpStatus.OK)
  async completeBooking(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(posCompleteSchema)) dto: PosCompleteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.posService.completeBooking(params.bookingCode, dto, user);
    return ok(data, this.clock);
  }
}
