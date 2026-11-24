import { Module } from '@nestjs/common';
import { AffectedBookingsModule } from '../../affected-bookings/affected-bookings.module.js';
import { BookingStateModule } from '../../bookings/booking-state.module.js';
import { AdminCourtsController } from './admin-courts.controller.js';
import { AdminCourtsRepository } from './admin-courts.repository.js';
import { AdminCourtsService } from './admin-courts.service.js';

@Module({
  imports: [AffectedBookingsModule, BookingStateModule],
  controllers: [AdminCourtsController],
  providers: [AdminCourtsRepository, AdminCourtsService],
  exports: [AdminCourtsService],
})
export class AdminCourtsModule {}
