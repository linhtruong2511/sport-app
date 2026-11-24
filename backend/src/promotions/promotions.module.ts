import { Module } from '@nestjs/common';
import { PromotionsController } from './promotions.controller.js';
import { PromotionsRepository } from './promotions.repository.js';
import { PromotionsService } from './promotions.service.js';

@Module({
  controllers: [PromotionsController],
  providers: [PromotionsRepository, PromotionsService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
