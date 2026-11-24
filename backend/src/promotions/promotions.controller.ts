import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser, OptionalJwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type PublicPromoCodeParam,
  type PublicPromotionsQuery,
  publicPromoCodeParamSchema,
  publicPromotionsQuerySchema,
} from './promotions.schemas.js';
import { PromotionsService } from './promotions.service.js';

@Controller('promotions/public')
export class PromotionsController {
  constructor(
    private readonly promotionsService: PromotionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async listPublicPromotions(
    @Query(new ZodValidationPipe(publicPromotionsQuerySchema)) query: PublicPromotionsQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.promotionsService.listPublicPromotions({
      branchId: query.branchId,
      sportId: query.sportId,
      limit: query.limit,
      callerUserId: user?.userId,
    });
    return ok(data, this.clock);
  }

  @Get(':code')
  @UseGuards(OptionalJwtAuthGuard)
  async getPublicPromotionByCode(
    @Param(new ZodValidationPipe(publicPromoCodeParamSchema)) params: PublicPromoCodeParam,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.promotionsService.getPublicPromotionByCode(
      params.code,
      user?.userId,
    );
    return ok(data, this.clock);
  }
}
