import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  type AuthenticatedUser,
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
} from '../../core/auth/index.js';
import { CLOCK, type Clock } from '../../core/clock.js';
import { ok } from '../../core/http/envelope.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  type BranchIdParam,
  type CreateBranchDto,
  type UpdateBranchDto,
  branchIdParamSchema,
  createBranchSchema,
  updateBranchSchema,
} from './admin-branches.schemas.js';
import { AdminBranchesService } from './admin-branches.service.js';

// R-17 — Quản lý cơ sở. Route con `/:branchId/opening-hours` (API-54/55) nằm ở AdminCourtsController.
@Controller('admin/branches')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AdminBranchesController {
  constructor(
    private readonly service: AdminBranchesService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // EXT-01
  @Get()
  async listBranches() {
    return ok(await this.service.listBranches(), this.clock);
  }

  // EXT-02
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @Body(new ZodValidationPipe(createBranchSchema)) body: CreateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return ok(await this.service.createBranch(body, user, req.ip ?? null), this.clock);
  }

  // EXT-03
  @Put(':branchId')
  async updateBranch(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: BranchIdParam,
    @Body(new ZodValidationPipe(updateBranchSchema)) body: UpdateBranchDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return ok(
      await this.service.updateBranch(params.branchId, body, user, req.ip ?? null),
      this.clock,
    );
  }

  // EXT-04
  @Post(':branchId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivateBranch(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: BranchIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return ok(
      await this.service.deactivateBranch(params.branchId, user, req.ip ?? null),
      this.clock,
    );
  }

  // EXT-04
  @Post(':branchId/activate')
  @HttpCode(HttpStatus.OK)
  async activateBranch(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: BranchIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return ok(
      await this.service.activateBranch(params.branchId, user, req.ip ?? null),
      this.clock,
    );
  }
}
