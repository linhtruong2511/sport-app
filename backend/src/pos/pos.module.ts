import { Module } from '@nestjs/common';
import { AffectedBookingsModule } from '../affected-bookings/affected-bookings.module.js';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { PosController } from './pos.controller.js';
import { PosRepository } from './pos.repository.js';
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
  providers: [PosRepository, PosService],
  exports: [PosService],
})
export class PosModule {}
