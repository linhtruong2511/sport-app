import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller.js';
import { PricingRepository } from './pricing.repository.js';
import { PricingService } from './pricing.service.js';

@Module({
  controllers: [PricingController],
  providers: [PricingRepository, PricingService],
  exports: [PricingService, PricingRepository],
})
export class PricingModule {}
