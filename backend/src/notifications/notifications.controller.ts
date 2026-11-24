import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { type AuthenticatedUser, CurrentUser, JwtAuthGuard } from '../core/auth/index.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { ok, okList } from '../core/http/envelope.js';
import { ZodValidationPipe } from '../core/validation/zod-validation.pipe.js';
import {
  type ListNotificationsQuery,
  type MarkNotificationReadBody,
  type NotificationIdParam,
  listNotificationsQuerySchema,
  markNotificationReadSchema,
  notificationIdParamSchema,
} from './notifications.schemas.js';
import { NotificationsService } from './notifications.service.js';

@Controller('me/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // API-05: GET /api/v1/me/notifications/unread-count
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.notificationsService.getUnreadCount(user.userId);
    return ok(data, this.clock);
  }

  // API-21: GET /api/v1/me/notifications
  @Get()
  async listNotifications(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { items, totalItems, unreadCount } = await this.notificationsService.listNotifications(
      user.userId,
      query,
    );
    return okList(
      items,
      { page: query.page, pageSize: query.pageSize, totalItems },
      this.clock,
      { unreadCount },
    );
  }

  // API-22: PATCH /api/v1/me/notifications/:notificationId
  @Patch(':notificationId')
  async markAsRead(
    @Param(new ZodValidationPipe(notificationIdParamSchema)) params: NotificationIdParam,
    @Body(new ZodValidationPipe(markNotificationReadSchema)) _body: MarkNotificationReadBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.notificationsService.markAsRead(
      user.userId,
      params.notificationId,
    );
    return ok(data, this.clock);
  }

  // API-23: POST /api/v1/me/notifications/read-all
  @Post('read-all')
  @HttpCode(200)
  async markAllAsRead(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.notificationsService.markAllAsRead(user.userId);
    return ok(data, this.clock);
  }
}
