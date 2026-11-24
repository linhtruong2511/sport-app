import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module.js';
import { AdminPromotionsController } from './admin-promotions.controller.js';
import { AdminPromotionsRepository } from './admin-promotions.repository.js';
import { AdminPromotionsService } from './admin-promotions.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminPromotionsController],
  providers: [AdminPromotionsRepository, AdminPromotionsService],
  exports: [AdminPromotionsService],
})
export class AdminPromotionsModule {}
