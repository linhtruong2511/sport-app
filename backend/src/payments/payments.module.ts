import { Module } from '@nestjs/common';
import { BookingStateModule } from '../bookings/booking-state.module.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';
import { SepayWebhookAuthGuard } from './sepay-webhook-auth.guard.js';
import { WebhooksController } from './webhooks.controller.js';

@Module({
  imports: [BookingStateModule, NotificationsModule, IntegrationsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [PaymentsRepository, PaymentsService, SepayWebhookAuthGuard],
  exports: [PaymentsService, PaymentsRepository],
})
export class PaymentsModule {}
