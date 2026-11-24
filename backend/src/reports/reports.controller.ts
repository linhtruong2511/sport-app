import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard, Roles, RolesGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import { type RevenueReportQuery, revenueReportQuerySchema } from './reports.schemas.js';
import { ReportsService } from './reports.service.js';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-66
  @Get('revenue')
  async getRevenueReport(
    @Query(new ZodValidationPipe(revenueReportQuerySchema)) query: RevenueReportQuery,
  ) {
    const data = await this.reportsService.getRevenueReport(query);
    return ok(data, this.clock);
  }
}
