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
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok, okList } from '../core/http/envelope.js';
import { RequireIdempotency } from '../core/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type BookingCodeParam,
  type CancelBookingDto,
  type CancelPreviewQuery,
  type CreateOnlineBookingDto,
  type MyBookingsQuery,
  bookingCodeParamSchema,
  cancelBookingSchema,
  cancelPreviewQuerySchema,
  createOnlineBookingSchema,
  myBookingsQuerySchema,
} from './bookings.schemas.js';
import { BookingsService } from './bookings.service.js';

@Controller()
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post('bookings')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  @RequireIdempotency()
  async createOnlineBooking(
    @Body(new ZodValidationPipe(createOnlineBookingSchema)) dto: CreateOnlineBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.bookingsService.createOnlineBooking(dto, user);
    return ok(result, this.clock);
  }

  @Get('me/bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('CUSTOMER')
  async listMyBookings(
    @Query(new ZodValidationPipe(myBookingsQuerySchema)) query: MyBookingsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.bookingsService.listMyBookings(query, user);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      { statusCounts: result.statusCounts },
    );
  }

  @Get('bookings/:bookingCode')
  @UseGuards(JwtAuthGuard)
  async getBookingDetail(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.bookingsService.getBookingDetail(params.bookingCode, user);
    return ok(result, this.clock);
  }

  @Get('bookings/:bookingCode/cancel-preview')
  @UseGuards(JwtAuthGuard)
  async getCancelPreview(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Query(new ZodValidationPipe(cancelPreviewQuerySchema)) query: CancelPreviewQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.bookingsService.getCancelPreview(
      params.bookingCode,
      query.cancelType,
      user,
    );
    return ok(result, this.clock);
  }

  @Post('bookings/:bookingCode/cancel')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async cancelBooking(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParam,
    @Body(new ZodValidationPipe(cancelBookingSchema)) dto: CancelBookingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.bookingsService.cancelBooking(params.bookingCode, dto, user);
    return ok(result, this.clock);
  }
}
