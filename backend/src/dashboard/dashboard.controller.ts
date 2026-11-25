import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import {
  type AuthenticatedUser,
  BranchScopeGuard,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type DailyBookingsQuery,
  type DailyDashboardQuery,
  dailyBookingsQuerySchema,
  dailyDashboardQuerySchema,
} from './dashboard.schemas.js';
import { DashboardService } from './dashboard.service.js';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
@Roles('STAFF', 'OWNER')
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-40
  @Get('daily')
  async getDailyDashboard(
    @Query(new ZodValidationPipe(dailyDashboardQuerySchema)) query: DailyDashboardQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.dashboardService.getDailyDashboard(query, user);
    return ok(data, this.clock);
  }

  // API-41
  @Get('daily/bookings')
  async getDailyBookings(
    @Query(new ZodValidationPipe(dailyBookingsQuerySchema)) query: DailyBookingsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.dashboardService.getDailyBookings(query, user);
    return ok(data, this.clock);
  }
}
