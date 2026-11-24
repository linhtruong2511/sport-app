import {
  Body,
  Controller,
  Delete,
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
import { ok } from '../../core/http/envelope.js';
import { ZodValidationPipe } from '../../core/validation/zod-validation.pipe.js';
import {
  type CreateCourtBlockDto,
  type CreateCourtDto,
  type CreateHolidayDto,
  type DeleteHolidayQuery,
  type DryRunQuery,
  type ListBlocksQuery,
  type ListCourtsQuery,
  type ListHolidaysQuery,
  type UpdateCourtDto,
  type UpdateOpeningHoursDto,
  blockIdParamSchema,
  branchIdParamSchema,
  courtIdParamSchema,
  createCourtBlockSchema,
  createCourtSchema,
  createHolidaySchema,
  deleteHolidayQuerySchema,
  dryRunQuerySchema,
  holidayIdParamSchema,
  listBlocksQuerySchema,
  listCourtsQuerySchema,
  listHolidaysQuerySchema,
  updateCourtSchema,
  updateOpeningHoursSchema,
} from './admin-courts.schemas.js';
import { AdminCourtsService } from './admin-courts.service.js';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AdminCourtsController {
  constructor(
    private readonly service: AdminCourtsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-47
  @Get('courts')
  async listCourts(
    @Query(new ZodValidationPipe(listCourtsQuerySchema)) query: ListCourtsQuery,
  ) {
    const data = await this.service.listCourts(query);
    return ok(data, this.clock);
  }

  // API-48
  @Get('courts/:courtId')
  async getCourtDetail(
    @Param(new ZodValidationPipe(courtIdParamSchema)) params: { courtId: number },
  ) {
    const data = await this.service.getCourtDetail(params.courtId);
    return ok(data, this.clock);
  }

  // API-49
  @Post('courts')
  async createCourt(
    @Body(new ZodValidationPipe(createCourtSchema)) body: CreateCourtDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.createCourt(body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-50
  @Put('courts/:courtId')
  async updateCourt(
    @Param(new ZodValidationPipe(courtIdParamSchema)) params: { courtId: number },
    @Body(new ZodValidationPipe(updateCourtSchema)) body: UpdateCourtDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.updateCourt(params.courtId, body, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-51
  @Get('court-blocks')
  async listCourtBlocks(
    @Query(new ZodValidationPipe(listBlocksQuerySchema)) query: ListBlocksQuery,
  ) {
    const data = await this.service.listCourtBlocks(query);
    return ok(data, this.clock);
  }

  // API-52
  @Post('court-blocks')
  async createCourtBlock(
    @Query(new ZodValidationPipe(dryRunQuerySchema)) query: DryRunQuery,
    @Body(new ZodValidationPipe(createCourtBlockSchema)) body: CreateCourtBlockDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.createCourtBlock(
      body,
      query.dryRun ?? false,
      user,
      req.ip ?? null,
    );
    return ok(data, this.clock);
  }

  // API-53
  @Post('court-blocks/:blockId/release')
  @HttpCode(HttpStatus.OK)
  async releaseCourtBlock(
    @Param(new ZodValidationPipe(blockIdParamSchema)) params: { blockId: number },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.releaseCourtBlock(params.blockId, user, req.ip ?? null);
    return ok(data, this.clock);
  }

  // API-54
  @Get('branches/:branchId/opening-hours')
  async getOpeningHours(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: { branchId: number },
  ) {
    const data = await this.service.getOpeningHours(params.branchId);
    return ok(data, this.clock);
  }

  // API-55
  @Put('branches/:branchId/opening-hours')
  async updateOpeningHours(
    @Param(new ZodValidationPipe(branchIdParamSchema)) params: { branchId: number },
    @Query(new ZodValidationPipe(dryRunQuerySchema)) query: DryRunQuery,
    @Body(new ZodValidationPipe(updateOpeningHoursSchema)) body: UpdateOpeningHoursDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.updateOpeningHours(
      params.branchId,
      body,
      query.dryRun ?? false,
      user,
      req.ip ?? null,
    );
    return ok(data, this.clock);
  }

  // API-56
  @Get('holidays')
  async listHolidays(
    @Query(new ZodValidationPipe(listHolidaysQuerySchema)) query: ListHolidaysQuery,
  ) {
    const data = await this.service.listHolidays(query);
    return ok(data, this.clock);
  }

  // API-57
  @Post('holidays')
  async createHolidays(
    @Query(new ZodValidationPipe(dryRunQuerySchema)) query: DryRunQuery,
    @Body(new ZodValidationPipe(createHolidaySchema)) body: CreateHolidayDto,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    const data = await this.service.createHolidays(
      body,
      query.dryRun ?? false,
      user,
      req.ip ?? null,
    );
    return ok(data, this.clock);
  }

  // API-58
  @Delete('holidays/:holidayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteHoliday(
    @Param(new ZodValidationPipe(holidayIdParamSchema)) params: { holidayId: number },
    @Query(new ZodValidationPipe(deleteHolidayQuerySchema)) query: DeleteHolidayQuery,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.service.deleteHoliday(
      params.holidayId,
      query.group ?? false,
      user,
      req.ip ?? null,
    );
  }
}
