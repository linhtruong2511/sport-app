import { Module } from '@nestjs/common';
import { BookingStateService } from './booking-state.service.js';
import { BookingsRepository } from './bookings.repository.js';

@Module({
  providers: [BookingsRepository, BookingStateService],
  exports: [BookingsRepository, BookingStateService],
})
export class BookingStateModule {}
