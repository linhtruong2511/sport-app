import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser, OptionalJwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import { type QuoteRequestDto, quoteRequestSchema } from './pricing.schemas.js';
import { PricingService } from './pricing.service.js';

@Controller('bookings')
export class PricingController {
  constructor(
    private readonly pricingService: PricingService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OptionalJwtAuthGuard)
  async quote(
    @Body(new ZodValidationPipe(quoteRequestSchema)) dto: QuoteRequestDto,
    @CurrentUser() caller?: AuthenticatedUser,
  ) {
    const result = await this.pricingService.quote(dto, caller);
    return ok(result, this.clock);
  }
}
