/** API-05, 21, 22, 23 — thông báo (UC 026) */
import { http } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import { E } from '../lib/errors';
import { ok, paginate, route } from '../lib/http';
import { ms, nowIso } from '../lib/time';

const A = MOCK_CONFIG.apiBase;

const unread = (userId: number) => db().notifications.filter((n) => n.userId === userId && !n.isRead).length;

export const notificationHandlers = [
  // API-05
  http.get(`${A}/me/notifications/unread-count`, route((ctx) => ok({ unreadCount: unread(ctx.auth('AUTH').userId) }))),

  // API-21
  http.get(`${A}/me/notifications`, route((ctx) => {
    const user = ctx.auth('AUTH');
    const type = ctx.q('type');
    const isRead = ctx.q('isRead');
    const list = db()
      .notifications.filter((n) => n.userId === user.userId)
      .filter((n) => !type || n.type === type)
      .filter((n) => isRead === null || String(n.isRead) === isRead)
      .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
      .map((n) => ({
        notificationId: n.notificationId,
        type: n.type,
        title: n.title,
        body: n.body,
        linkType: n.linkType,
        bookingCode: n.bookingCode,
        promotionCode: n.promotionCode,
        isRead: n.isRead,
        readAt: n.readAt,
        createdAt: n.createdAt,
      }));
    const { items, meta } = paginate(list, ctx.query);
    return ok(items, { meta: { ...meta, unreadCount: unread(user.userId) } });
  })),

  // API-23 (khai báo trước :notificationId cho rõ ràng)
  http.post(`${A}/me/notifications/read-all`, route((ctx) => {
    const user = ctx.auth('AUTH');
    let updated = 0;
    db().notifications.forEach((n) => {
      if (n.userId === user.userId && !n.isRead) {
        n.isRead = true;
        n.readAt = nowIso();
        updated++;
      }
    });
    return ok({ updated, unreadCount: 0 });
  })),

  // API-22
  http.patch(`${A}/me/notifications/:notificationId`, route(async (ctx) => {
    const user = ctx.auth('AUTH');
    const { isRead } = await ctx.body<{ isRead?: boolean }>();
    if (isRead !== true) throw E.field('isRead', 'Chỉ nhận giá trị true.');
    const n = db().notifications.find((x) => x.notificationId === Number(ctx.p('notificationId')) && x.userId === user.userId);
    if (!n) throw E.notFound('Không tìm thấy thông báo.');
    if (!n.isRead) {
      n.isRead = true;
      n.readAt = nowIso();
    }
    return ok({ notificationId: n.notificationId, isRead: true, readAt: n.readAt, unreadCount: unread(user.userId) });
  })),
];
