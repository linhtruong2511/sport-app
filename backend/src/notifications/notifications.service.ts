import { Inject, Injectable } from '@nestjs/common';
import type { NotificationLinkType, NotificationType } from '@sporthub/shared/enums';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService, type TxContext } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { toIsoVn } from '../core/time.js';
import {
  OUTBOUND_NOTIFIER,
  type OutboundNotifier,
} from '../integrations/notifier/outbound-notifier.js';
import { NotificationsRepository } from './notifications.repository.js';
import type { ListNotificationsQuery } from './notifications.schemas.js';

export interface CreateNotificationInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType?: NotificationLinkType | null;
  linkRef?: string | null;
  bookingCode?: string | null;
  promotionCode?: string | null;
}

export interface NotificationItemDto {
  notificationId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType: NotificationLinkType | null;
  bookingCode: string | null;
  promotionCode: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly txService: DbTransactionService,
    @Inject(OUTBOUND_NOTIFIER) private readonly outboundNotifier: OutboundNotifier,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async createNotificationInTx(tx: TxContext, input: CreateNotificationInput): Promise<number> {
    const now = this.clock.now();
    const linkType = input.linkType ?? null;
    const rawLinkRef =
      input.linkRef ??
      (linkType === 'BOOKING'
        ? (input.bookingCode ?? null)
        : linkType === 'PROMOTION'
          ? (input.promotionCode ?? null)
          : null);
    const normalizedLinkType = linkType && rawLinkRef ? linkType : null;
    const normalizedLinkRef = linkType && rawLinkRef ? rawLinkRef : null;

    const notificationId = await this.repo.insertNotification(tx, {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      linkType: normalizedLinkType,
      linkRef: normalizedLinkRef,
      now,
    });

    const unreadCount = await this.repo.countUnread(tx, input.userId);

    // SDD 5.7: notification.created -> room user:{userId}
    tx.events.push({
      rooms: [`user:${input.userId}`],
      event: 'notification.created',
      payload: {
        notificationId,
        type: input.type,
        title: input.title,
        body: input.body,
        bookingCode: input.bookingCode ?? null,
        promotionCode: input.promotionCode ?? null,
        createdAt: toIsoVn(now),
        unreadCount,
      },
    });

    void this.outboundNotifier
      .send({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        bookingCode: input.bookingCode ?? null,
        promotionCode: input.promotionCode ?? null,
      })
      .catch(() => undefined);

    return notificationId;
  }

  async getUnreadCount(userId: number): Promise<{ unreadCount: number }> {
    const exec = await this.txService.executor();
    const unreadCount = await this.repo.countUnread(exec, userId);
    return { unreadCount };
  }

  async listNotifications(
    userId: number,
    query: ListNotificationsQuery,
  ): Promise<{
    items: NotificationItemDto[];
    totalItems: number;
    unreadCount: number;
  }> {
    const exec = await this.txService.executor();
    const { rows, totalItems, unreadCount } = await this.repo.list(exec, {
      userId,
      type: query.type,
      isRead: query.isRead,
      page: query.page,
      pageSize: query.pageSize,
    });

    const items: NotificationItemDto[] = rows.map((row) => ({
      notificationId: row.notificationId,
      type: row.type,
      title: row.title,
      body: row.body,
      linkType: row.linkType,
      bookingCode: row.bookingCode,
      promotionCode: row.promotionCode,
      isRead: row.isRead,
      readAt: row.readAt !== null ? toIsoVn(row.readAt) : null,
      createdAt: toIsoVn(row.createdAt),
    }));

    return {
      items,
      totalItems,
      unreadCount,
    };
  }

  async markAsRead(
    userId: number,
    notificationId: number,
  ): Promise<{
    notificationId: number;
    isRead: true;
    readAt: string;
    unreadCount: number;
  }> {
    return this.txService.withTransaction(async (tx) => {
      const now = this.clock.now();
      const updated = await this.repo.markRead(tx, notificationId, userId, now);
      if (!updated) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy thông báo.' });
      }

      const unreadCount = await this.repo.countUnread(tx, userId);

      return {
        notificationId: updated.notificationId,
        isRead: true,
        readAt: toIsoVn(updated.readAt),
        unreadCount,
      };
    });
  }

  async markAllAsRead(userId: number): Promise<{ updated: number; unreadCount: number }> {
    return this.txService.withTransaction(async (tx) => {
      const now = this.clock.now();
      const updated = await this.repo.markAllRead(tx, userId, now);
      return {
        updated,
        unreadCount: 0,
      };
    });
  }
}
