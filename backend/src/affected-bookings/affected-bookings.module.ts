import { Module } from '@nestjs/common';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AffectedBookingsController } from './affected-bookings.controller.js';
import { AffectedBookingsRepository } from './affected-bookings.repository.js';
import { AffectedBookingsService } from './affected-bookings.service.js';

@Module({
  imports: [BookingStateModule, PaymentsModule, NotificationsModule],
  controllers: [AffectedBookingsController],
  providers: [AffectedBookingsRepository, AffectedBookingsService],
  exports: [AffectedBookingsService],
})
export class AffectedBookingsModule {}
