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
  Query,
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
import { ok, okList } from '../../core/http/envelope.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  type CreateStaffDto,
  type ListStaffQuery,
  type StaffPaymentsQuery,
  type UpdateStaffDto,
  type UserIdParam,
  createStaffSchema,
  listStaffQuerySchema,
  staffPaymentsQuerySchema,
  updateStaffSchema,
  userIdParamSchema,
} from './admin-staff.schemas.js';
import { AdminStaffService } from './admin-staff.service.js';

@Controller('admin/staff')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AdminStaffController {
  constructor(
    private readonly service: AdminStaffService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-42
  @Get()
  async listStaff(@Query(new ZodValidationPipe(listStaffQuerySchema)) query: ListStaffQuery) {
    const result = await this.service.listStaff(query);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      {
        total: result.totalItems,
        activeCount: result.activeCount,
        lockedCount: result.lockedCount,
        countByBranch: result.countByBranch,
      },
    );
  }

  // API-43
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Body(new ZodValidationPipe(createStaffSchema)) body: CreateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.createStaff(body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-44
  @Put(':userId')
  async updateStaff(
    @Param(new ZodValidationPipe(userIdParamSchema)) params: UserIdParam,
    @Body(new ZodValidationPipe(updateStaffSchema)) body: UpdateStaffDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.updateStaff(params.userId, body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-45
  @Post(':userId/lock')
  @HttpCode(HttpStatus.OK)
  async lockStaff(
    @Param(new ZodValidationPipe(userIdParamSchema)) params: UserIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.lockStaff(params.userId, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-45
  @Post(':userId/unlock')
  @HttpCode(HttpStatus.OK)
  async unlockStaff(
    @Param(new ZodValidationPipe(userIdParamSchema)) params: UserIdParam,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.unlockStaff(params.userId, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-46
  @Get(':userId/payments')
  async listStaffPayments(
    @Param(new ZodValidationPipe(userIdParamSchema)) params: UserIdParam,
    @Query(new ZodValidationPipe(staffPaymentsQuerySchema)) query: StaffPaymentsQuery,
  ) {
    const result = await this.service.listStaffPayments(params.userId, query);
    return okList(
      result.items,
      {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.totalItems,
      },
      this.clock,
      {
        total: result.totalItems,
        totalAmount: result.totalAmount,
      },
    );
  }
}
