import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../core/auth/index.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { ok, okList } from '../../core/http/envelope.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  type CreatePromotionDto,
  type ListPromotionsQuery,
  type PromotionIdParam,
  type UpdatePromotionDto,
  createPromotionSchema,
  listPromotionsQuerySchema,
  promotionIdParamSchema,
  updatePromotionSchema,
} from './admin-promotions.schemas.js';
import { AdminPromotionsService } from './admin-promotions.service.js';

@Controller('admin/promotions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AdminPromotionsController {
  constructor(
    private readonly service: AdminPromotionsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-59
  @Get()
  async listPromotions(
    @Query(new ZodValidationPipe(listPromotionsQuerySchema)) query: ListPromotionsQuery,
  ) {
    const result = await this.service.listPromotions(query);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      { total: result.totalItems },
    );
  }

  // API-60
  @Get(':promotionId')
  async getPromotionDetail(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
  ) {
    const data = await this.service.getPromotionDetail(params.promotionId);
    return ok(data, this.clock);
  }

  // API-61
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createPromotion(
    @Body(new ZodValidationPipe(createPromotionSchema)) body: CreatePromotionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.createPromotion(body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-62
  @Put(':promotionId')
  async updatePromotion(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
    @Body(new ZodValidationPipe(updatePromotionSchema)) body: UpdatePromotionDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.updatePromotion(params.promotionId, body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-63
  @Post(':promotionId/pause')
  @HttpCode(HttpStatus.OK)
  async pausePromotion(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.pausePromotion(params.promotionId, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-63
  @Post(':promotionId/resume')
  @HttpCode(HttpStatus.OK)
  async resumePromotion(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.resumePromotion(params.promotionId, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-64
  @Delete(':promotionId')
  async deletePromotion(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.service.deletePromotion(params.promotionId, user, req.ip ?? null);
    if (result.deleted) {
      res.status(HttpStatus.NO_CONTENT);
      return;
    }
    res.status(HttpStatus.OK);
    return ok(result, this.clock);
  }

  // API-65
  @Post(':promotionId/notify')
  @HttpCode(HttpStatus.ACCEPTED)
  async notifyPromotion(
    @Param(new ZodValidationPipe(promotionIdParamSchema)) params: PromotionIdParam,
  ) {
    const data = await this.service.notifyPromotion(params.promotionId);
    return ok(data, this.clock);
  }
}
