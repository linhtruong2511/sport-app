import { Injectable } from '@nestjs/common';
import type { NotificationLinkType, NotificationType } from '@sporthub/shared/enums';
import { sql } from '../config/database.js';
import type { DbExecutor, TxContext } from '../core/db/transaction.js';
import { fromSqlDateTime, toSqlDateTime } from '../core/time.js';

export interface NotificationRow {
  notificationId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType: NotificationLinkType | null;
  bookingCode: string | null;
  promotionCode: string | null;
  isRead: boolean;
  readAt: Date | null;
  createdAt: Date;
}

export interface ListNotificationsFilter {
  userId: number;
  type?: NotificationType;
  isRead?: boolean;
  page: number;
  pageSize: number;
}

export interface InsertNotificationRowInput {
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType: NotificationLinkType | null;
  linkRef: string | null;
  now: Date;
}

@Injectable()
export class NotificationsRepository {
  async countUnread(exec: DbExecutor, userId: number): Promise<number> {
    const res = await exec
      .request()
      .input('userId', sql.BigInt, userId)
      .query<{ Total: number }>(`
        SELECT COUNT(*) AS Total
        FROM dbo.Notifications
        WHERE UserId = @userId
          AND IsRead = 0
      `);

    return Number(res.recordset[0]?.Total ?? 0);
  }

  async list(
    exec: DbExecutor,
    filter: ListNotificationsFilter,
  ): Promise<{
    rows: NotificationRow[];
    totalItems: number;
    unreadCount: number;
  }> {
    const conditions = ['n.UserId = @userId'];

    const bindFilters = (req: ReturnType<DbExecutor['request']>) => {
      req.input('userId', sql.BigInt, filter.userId);
      if (filter.type !== undefined) {
        req.input('type', sql.VarChar(20), filter.type);
      }
      if (filter.isRead !== undefined) {
        req.input('isRead', sql.Bit, filter.isRead ? 1 : 0);
      }
      return req;
    };

    if (filter.type !== undefined) {
      conditions.push('n.Type = @type');
    }
    if (filter.isRead !== undefined) {
      conditions.push('n.IsRead = @isRead');
    }

    const whereClause = conditions.join('\n        AND ');
    const offset = (filter.page - 1) * filter.pageSize;

    const countReq = bindFilters(exec.request());
    const countRes = await countReq.query<{ Total: number }>(`
      SELECT COUNT(*) AS Total
      FROM dbo.Notifications n
      WHERE ${whereClause}
    `);
    const totalItems = Number(countRes.recordset[0]?.Total ?? 0);

    const rowsReq = bindFilters(exec.request())
      .input('offset', sql.Int, offset)
      .input('pageSize', sql.Int, filter.pageSize);

    const rowsRes = await rowsReq.query<{
      NotificationId: number | string;
      Type: NotificationType;
      Title: string;
      Body: string;
      LinkType: NotificationLinkType | null;
      BookingCode: string | null;
      PromotionCode: string | null;
      IsRead: boolean | number;
      ReadAt: Date | string | null;
      CreatedAt: Date | string;
    }>(`
      SELECT
        n.NotificationId,
        n.Type,
        n.Title,
        n.Body,
        n.LinkType,
        b.BookingCode,
        p.Code AS PromotionCode,
        n.IsRead,
        n.ReadAt,
        n.CreatedAt
      FROM dbo.Notifications n
      LEFT JOIN dbo.Bookings b
        ON n.LinkType = 'BOOKING'
       AND (CAST(b.BookingId AS VARCHAR(50)) = n.LinkRef OR b.BookingCode = n.LinkRef)
      LEFT JOIN dbo.Promotions p
        ON n.LinkType = 'PROMOTION'
       AND (CAST(p.PromotionId AS VARCHAR(50)) = n.LinkRef OR p.Code = n.LinkRef)
      WHERE ${whereClause}
      ORDER BY n.CreatedAt DESC, n.NotificationId DESC
      OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY
    `);

    const unreadCount = await this.countUnread(exec, filter.userId);

    const rows: NotificationRow[] = rowsRes.recordset.map((r) => ({
      notificationId: Number(r.NotificationId),
      type: r.Type,
      title: r.Title,
      body: r.Body,
      linkType: r.LinkType,
      bookingCode: r.BookingCode ?? null,
      promotionCode: r.PromotionCode ?? null,
      isRead: Boolean(r.IsRead),
      readAt: r.ReadAt !== null ? fromSqlDateTime(r.ReadAt) : null,
      createdAt: fromSqlDateTime(r.CreatedAt),
    }));

    return {
      rows,
      totalItems,
      unreadCount,
    };
  }

  async insertNotification(tx: TxContext, input: InsertNotificationRowInput): Promise<number> {
    const linkType = input.linkType && input.linkRef ? input.linkType : null;
    const linkRef = input.linkType && input.linkRef ? input.linkRef : null;

    const res = await tx
      .request()
      .input('userId', sql.BigInt, input.userId)
      .input('type', sql.VarChar(20), input.type)
      .input('title', sql.NVarChar(150), input.title)
      .input('body', sql.NVarChar(1000), input.body)
      .input('linkType', sql.VarChar(20), linkType)
      .input('linkRef', sql.VarChar(50), linkRef)
      .input('createdAt', sql.DateTime2(0), toSqlDateTime(input.now))
      .query<{ NotificationId: number | string }>(`
        INSERT INTO dbo.Notifications (
          UserId, Type, Title, Body, LinkType, LinkRef, IsRead, ReadAt, CreatedAt
        )
        OUTPUT inserted.NotificationId
        VALUES (
          @userId, @type, @title, @body, @linkType, @linkRef, 0, NULL, @createdAt
        )
      `);

    return Number(res.recordset[0].NotificationId);
  }

  async markRead(
    tx: TxContext,
    notificationId: number,
    userId: number,
    now: Date,
  ): Promise<{ notificationId: number; readAt: Date } | null> {
    const res = await tx
      .request()
      .input('id', sql.BigInt, notificationId)
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<{ NotificationId: number | string; ReadAt: Date | string }>(`
        UPDATE dbo.Notifications
        SET IsRead = 1,
            ReadAt = ISNULL(ReadAt, @now)
        OUTPUT inserted.NotificationId, inserted.ReadAt
        WHERE NotificationId = @id
          AND UserId = @userId
      `);

    const row = res.recordset[0];
    if (!row) {
      return null;
    }

    return {
      notificationId: Number(row.NotificationId),
      readAt: fromSqlDateTime(row.ReadAt),
    };
  }

  async markAllRead(tx: TxContext, userId: number, now: Date): Promise<number> {
    const res = await tx
      .request()
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query(`
        UPDATE dbo.Notifications
        SET IsRead = 1,
            ReadAt = @now
        WHERE UserId = @userId
          AND IsRead = 0
      `);

    return res.rowsAffected[0] ?? 0;
  }
}
