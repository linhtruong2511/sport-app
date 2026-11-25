import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser, OptionalJwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type BranchIdParam,
  type BranchesQuery,
  type SportSummaryQuery,
  type SportsQuery,
  branchIdParamSchema,
  branchesQuerySchema,
  sportSummaryQuerySchema,
  sportsQuerySchema,
} from './catalog.schemas.js';
import { CatalogService } from './catalog.service.js';

@Controller()
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('branches')
  @UseGuards(OptionalJwtAuthGuard)
  async listBranches(
    @Query(new ZodValidationPipe(branchesQuerySchema)) query: BranchesQuery,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    const data = await this.catalogService.listBranches(query.status, user?.role);
    const totalCourts = data.reduce((sum, b) => sum + b.courtCount, 0);
    return ok(data, this.clock, { totalCourts });
  }

  @Get('sports')
  async listSports(@Query(new ZodValidationPipe(sportsQuerySchema)) query: SportsQuery) {
    const data = await this.catalogService.listSports(query.branchId);
    return ok(data, this.clock);
  }

  @Get('branches/:branchId/sport-summary')
  async getBranchSportSummary(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: BranchIdParam,
    @Query(new ZodValidationPipe(sportSummaryQuerySchema)) query: SportSummaryQuery,
  ) {
    const data = await this.catalogService.getBranchSportSummary(params.branchId, query.date);
    return ok(data, this.clock);
  }
}
