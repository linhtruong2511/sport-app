import { Module } from '@nestjs/common';
import { AffectedBookingsModule } from '../affected-bookings/affected-bookings.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardRepository } from './dashboard.repository.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [AffectedBookingsModule],
  controllers: [DashboardController],
  providers: [DashboardRepository, DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
