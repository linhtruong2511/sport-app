import { Module } from '@nestjs/common';
import { AffectedBookingsModule } from '../affected-bookings/affected-bookings.module.js';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { PosBookingService } from './pos-booking.service.js';
import { PosController } from './pos.controller.js';
import { PosLifecycleService } from './pos-lifecycle.service.js';
import { PosRepository } from './pos.repository.js';
import { PosScheduleService } from './pos-schedule.service.js';
import { PosService } from './pos.service.js';

@Module({
  imports: [
    BookingStateModule,
    PricingModule,
    PaymentsModule,
    NotificationsModule,
    AffectedBookingsModule,
  ],
  controllers: [PosController],
  providers: [
    PosRepository,
    PosScheduleService,
    PosBookingService,
    PosLifecycleService,
    PosService,
  ],
  exports: [PosService],
})
export class PosModule {}
