import { Module } from '@nestjs/common';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ReconciliationController, RefundsController } from './reconciliation.controller.js';
import { ReconciliationRepository } from './reconciliation.repository.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  imports: [BookingStateModule, NotificationsModule],
  controllers: [ReconciliationController, RefundsController],
  providers: [ReconciliationRepository, ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
