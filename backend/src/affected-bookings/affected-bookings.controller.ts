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
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type AffectedListQuery,
  type CloseAffectedBookingDto,
  type ReassignBookingDto,
  type ReassignOptionsQuery,
  affectedListQuerySchema,
  bookingCodeParamSchema,
  closeAffectedBookingSchema,
  reassignBookingSchema,
  reassignOptionsQuerySchema,
} from './affected-bookings.schemas.js';
import { AffectedBookingsService } from './affected-bookings.service.js';

@Controller('affected-bookings')
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Roles('STAFF', 'OWNER')
@BranchScoped()
export class AffectedBookingsController {
  constructor(
    private readonly affectedService: AffectedBookingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-36
  @Get()
  async listAffected(
    @Query(new ZodValidationPipe(affectedListQuerySchema)) _query: AffectedListQuery,
    @ScopedBranchId() branchId: number | null,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const items = await this.affectedService.listAffectedBookings({
      branchId: branchId ?? null,
      caller: user,
    });
    return ok(items, this.clock);
  }

  // API-37
  @Get(':bookingCode/reassign-options')
  async getReassignOptions(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: { bookingCode: string },
    @Query(new ZodValidationPipe(reassignOptionsQuerySchema)) query: ReassignOptionsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.affectedService.getReassignOptions(params.bookingCode, query, user);
    return ok(data, this.clock);
  }

  // API-38
  @Post(':bookingCode/reassign')
  @HttpCode(HttpStatus.OK)
  async reassign(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: { bookingCode: string },
    @Body(new ZodValidationPipe(reassignBookingSchema)) body: ReassignBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.affectedService.reassignBooking(params.bookingCode, body, user);
    return ok(data, this.clock);
  }

  // API-39
  @Post(':bookingCode/close')
  @HttpCode(HttpStatus.OK)
  async close(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: { bookingCode: string },
    @Body(new ZodValidationPipe(closeAffectedBookingSchema)) body: CloseAffectedBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.affectedService.closeAffectedBooking(params.bookingCode, body, user);
    return ok(data, this.clock);
  }
}
