import { Body, Controller, Get, Inject, Put, Req, UseGuards } from '@nestjs/common';
import { type UpdateSettingsInput, updateSettingsSchema } from '@sporthub/shared/settings';
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
import { AdminSettingsService } from './admin-settings.service.js';

// R-17 — Tham số hệ thống (SystemSettings).
@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER')
export class AdminSettingsController {
  constructor(
    private readonly service: AdminSettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // EXT-05
  @Get()
  async listSettings() {
    return ok(await this.service.listSettings(), this.clock);
  }

  // EXT-06
  @Put()
  async updateSettings(
    @Body(new ZodValidationPipe(updateSettingsSchema)) body: UpdateSettingsInput,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return ok(await this.service.updateSettings(body, user, req.ip ?? null), this.clock);
  }
}
