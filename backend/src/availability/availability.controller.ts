import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser, OptionalJwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import { type AvailabilityQuery, availabilityQuerySchema } from './availability.schemas.js';
import { AvailabilityService } from './availability.service.js';

@Controller('availability')
export class AvailabilityController {
  constructor(
    private readonly availabilityService: AvailabilityService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async getAvailability(
    @Query(new ZodValidationPipe(availabilityQuerySchema)) query: AvailabilityQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.availabilityService.getAvailability({
      branchId: query.branchId,
      sportId: query.sportId,
      date: query.date,
      callerUserId: user?.userId,
    });
    return ok(data, this.clock);
  }
}
