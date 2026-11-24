import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller.js';
import { AvailabilityRepository } from './availability.repository.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityRepository, AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
