import { Module } from '@nestjs/common';
import { AdminBranchesController } from './admin-branches.controller.js';
import { AdminBranchesRepository } from './admin-branches.repository.js';
import { AdminBranchesService } from './admin-branches.service.js';

@Module({
  controllers: [AdminBranchesController],
  providers: [AdminBranchesRepository, AdminBranchesService],
  exports: [AdminBranchesService],
})
export class AdminBranchesModule {}
