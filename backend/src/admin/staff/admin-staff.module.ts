import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { AdminStaffController } from './admin-staff.controller.js';
import { AdminStaffRepository } from './admin-staff.repository.js';
import { AdminStaffService } from './admin-staff.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminStaffController],
  providers: [AdminStaffRepository, AdminStaffService],
  exports: [AdminStaffService],
})
export class AdminStaffModule {}
