import { Global, Module } from '@nestjs/common';
import { BOOKING_ACCESS_CHECKER } from '../core/realtime/realtime.types.js';
import { BookingStateService } from './booking-state.service.js';
import { BookingsRepository } from './bookings.repository.js';

@Global()
@Module({
  providers: [
    BookingsRepository,
    BookingStateService,
    { provide: BOOKING_ACCESS_CHECKER, useExisting: BookingStateService },
  ],
  exports: [BookingsRepository, BookingStateService, BOOKING_ACCESS_CHECKER],
})
export class BookingStateModule {}
