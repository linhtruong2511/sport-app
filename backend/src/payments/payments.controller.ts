import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { type AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { AppError } from '../core/errors.js';
import { ok } from '../core/http/envelope.js';
import { RequireIdempotency } from '../core/idempotency/idempotency.interceptor.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type BookingCodeParamDto,
  type CreatePaymentRequestDto,
  type RequestIdParamDto,
  bookingCodeParamSchema,
  createPaymentRequestSchema,
  requestIdParamSchema,
} from './payments.schemas.js';
import { PaymentsService } from './payments.service.js';

@Controller()
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('bookings/:bookingCode/payment-request')
  @UseGuards(JwtAuthGuard)
  async getActivePaymentRequest(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParamDto,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const result = await this.paymentsService.getActivePaymentRequest(params.bookingCode, caller);
    return ok(result, this.clock);
  }

  @Post('bookings/:bookingCode/payment-requests')
  @UseGuards(JwtAuthGuard)
  @RequireIdempotency()
  @HttpCode(HttpStatus.CREATED)
  async createPaymentRequest(
    @Param(new ZodValidationPipe(bookingCodeParamSchema)) params: BookingCodeParamDto,
    @Body(new ZodValidationPipe(createPaymentRequestSchema)) dto: CreatePaymentRequestDto,
    @CurrentUser() caller: AuthenticatedUser,
  ) {
    const result = await this.paymentsService.createOrRegeneratePaymentRequest(
      params.bookingCode,
      dto,
      caller,
    );
    return ok(result, this.clock);
  }

  @Post('payment-requests/:requestId/recheck')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async recheckPaymentRequest(
    @Param(new ZodValidationPipe(requestIdParamSchema)) params: RequestIdParamDto,
    @CurrentUser() caller: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const result = await this.paymentsService.recheckPaymentRequest(params.requestId, caller);
      return ok(result, this.clock);
    } catch (err) {
      if (err instanceof AppError && err.code === 'TOO_MANY_REQUESTS') {
        const details = err.details as { retryAfterSeconds?: number } | undefined;
        res.setHeader('Retry-After', String(details?.retryAfterSeconds ?? 5));
      }
      throw err;
    }
  }
}
