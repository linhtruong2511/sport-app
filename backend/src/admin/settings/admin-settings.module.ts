import { Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller.js';
import { AdminSettingsRepository } from './admin-settings.repository.js';
import { AdminSettingsService } from './admin-settings.service.js';

@Module({
  controllers: [AdminSettingsController],
  providers: [AdminSettingsRepository, AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
