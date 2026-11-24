import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import { type AuthenticatedUser, TOKEN_VERIFIER, type TokenVerifier } from '../../core/auth/index.js';
import { SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { RealtimeService } from '../../core/realtime/realtime.service.js';
import { parseVnDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import {
  OUTBOUND_NOTIFIER,
  type OutboundNotifier,
} from '../../integrations/notifier/outbound-notifier.js';
import { NotificationsModule } from '../notifications.module.js';
import { NotificationsService } from '../notifications.service.js';

const testUsers = new Map<string, AuthenticatedUser>();

const testTokenVerifier: TokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = testUsers.get(token);
    if (!user) {
      throw new Error(`Unexpected test token: ${token}`);
    }
    return user;
  },
};

@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useValue: testTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
class TestAuthModule {}

@Module({
  imports: [TestAuthModule, CoreModule, IntegrationsModule, DatabaseModule, NotificationsModule],
})
class NotificationsTestModule {}

describe('notifications integration (API-05, API-21, API-22, API-23)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let notificationsService: NotificationsService;
  let realtimeService: RealtimeService;
  let outboundNotifier: OutboundNotifier;
  let systemClock: SystemClock;
  let origNow: () => Date;
  let mockedNow: Date;

  let cusAnId: number;
  let cusAnNotificationId: number;
  let seededBookingId: number;
  let seededBookingCode: string;
  let seededPromoId: number;
  let testCusId: number | null = null;

  beforeAll(async () => {
    app = await NestFactory.create(NotificationsTestModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    notificationsService = app.get(NotificationsService);
    realtimeService = app.get(RealtimeService);
    outboundNotifier = app.get(OUTBOUND_NOTIFIER);
    systemClock = app.get(SystemClock);
    origNow = systemClock.now.bind(systemClock);
    mockedNow = parseVnDateTime('2026-11-20', '10:00:00');
    systemClock.now = () => new Date(mockedNow.getTime());

    const exec = await txService.executor();
    const cusAnRes = await exec
      .request()
      .query<{ UserId: number }>("SELECT UserId FROM dbo.Users WHERE Phone = '0987654321'");
    cusAnId = Number(cusAnRes.recordset[0].UserId);

    const cusAnNotifRes = await exec
      .request()
      .input('userId', sql.BigInt, cusAnId)
      .query<{ NotificationId: number }>(
        'SELECT TOP 1 NotificationId FROM dbo.Notifications WHERE UserId = @userId ORDER BY NotificationId ASC',
      );
    cusAnNotificationId = Number(cusAnNotifRes.recordset[0].NotificationId);

    const bookingRes = await exec
      .request()
      .input('userId', sql.BigInt, cusAnId)
      .query<{ BookingId: number; BookingCode: string }>(
        'SELECT TOP 1 BookingId, BookingCode FROM dbo.Bookings WHERE CustomerUserId = @userId ORDER BY BookingId ASC',
      );
    seededBookingId = Number(bookingRes.recordset[0].BookingId);
    seededBookingCode = bookingRes.recordset[0].BookingCode;

    const promoRes = await exec
      .request()
      .query<{ PromotionId: number }>(
        "SELECT PromotionId FROM dbo.Promotions WHERE Code = 'SANGVUI20'",
      );
    seededPromoId = Number(promoRes.recordset[0].PromotionId);

    // Create dedicated test customer so mutating tests never modify seeded notifications
    const testUserRes = await exec.request().query<{ UserId: number }>(`
      INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, Status)
      OUTPUT inserted.UserId
      VALUES ('KH999888', N'Khách Test Thông Báo', '0999777666', 'notif-test@test.local', 'hash', 'CUSTOMER', 'ACTIVE')
    `);
    testCusId = Number(testUserRes.recordset[0].UserId);

    testUsers.set('cus-an', { userId: cusAnId, role: 'CUSTOMER', branchId: null, tv: 0 });
    testUsers.set('cus-test', { userId: testCusId, role: 'CUSTOMER', branchId: null, tv: 0 });
  });

  beforeEach(() => {
    mockedNow = parseVnDateTime('2026-11-20', '10:00:00');
  });

  afterAll(async () => {
    if (testCusId !== null && txService) {
      const exec = await txService.executor();
      await exec
        .request()
        .input('userId', sql.BigInt, testCusId)
        .query(`
          DELETE FROM dbo.Notifications WHERE UserId = @userId;
          DELETE FROM dbo.Users WHERE UserId = @userId;
        `);
    }

    if (systemClock && origNow) {
      systemClock.now = origNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-05 GET /me/notifications/unread-count requires auth and returns unread count', async () => {
    const unauth = await request(app.getHttpServer()).get('/api/v1/me/notifications/unread-count');
    expect(unauth.status).toBe(401);

    const res = await request(app.getHttpServer())
      .get('/api/v1/me/notifications/unread-count')
      .set('Authorization', 'Bearer cus-an');
    expect(res.status).toBe(200);
    expect(res.body.data.unreadCount).toBe(3); // B2 payment, SANGVUI20, TRIAN10
    expect(res.body.meta.serverTime).toMatch(/\+07:00$/);
  });

  it('API-21 GET /me/notifications lists notifications with filters, pagination, and booking/promotion links', async () => {
    const allRes = await request(app.getHttpServer())
      .get('/api/v1/me/notifications')
      .set('Authorization', 'Bearer cus-an');
    expect(allRes.status).toBe(200);
    expect(allRes.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      totalItems: 4,
      totalPages: 1,
      unreadCount: 3,
    });
    expect(allRes.body.data).toHaveLength(4);

    // Check resolved bookingCode & promotionCode from seed LinkRef
    const paymentNotifs = allRes.body.data.filter(
      (n: { type: string }) => n.type === 'PAYMENT_RESULT',
    );
    expect(paymentNotifs.length).toBe(2);
    expect(paymentNotifs[0].linkType).toBe('BOOKING');
    expect(paymentNotifs[0].bookingCode).toBeTruthy();
    expect(paymentNotifs[0].promotionCode).toBeNull();
    expect(paymentNotifs[0].createdAt).toMatch(/\+07:00$/);

    const promoNotifs = allRes.body.data.filter((n: { type: string }) => n.type === 'PROMOTION');
    expect(promoNotifs.map((n: { promotionCode: string | null }) => n.promotionCode)).toEqual(
      expect.arrayContaining(['SANGVUI20', 'TRIAN10']),
    );

    // Filter by type=PROMOTION & isRead=false
    const filteredRes = await request(app.getHttpServer())
      .get('/api/v1/me/notifications')
      .query({ type: 'PROMOTION', isRead: 'false', page: 1, pageSize: 1 })
      .set('Authorization', 'Bearer cus-an');
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data).toHaveLength(1);
    expect(filteredRes.body.meta).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
      unreadCount: 3,
    });

    // Filter by isRead=true
    const readRes = await request(app.getHttpServer())
      .get('/api/v1/me/notifications')
      .query({ isRead: 'true' })
      .set('Authorization', 'Bearer cus-an');
    expect(readRes.status).toBe(200);
    expect(readRes.body.data).toHaveLength(1);
    expect(readRes.body.data[0].isRead).toBe(true);
    expect(readRes.body.data[0].readAt).toMatch(/\+07:00$/);
  });

  it('createNotificationInTx inserts notification, pushes notification.created event, and supports API-22 & API-23', async () => {
    const flushSpy = vi.spyOn(realtimeService, 'flush');
    const sendSpy = vi.spyOn(outboundNotifier, 'send');

    // 1. Create booking-linked notification (by BookingId)
    mockedNow = parseVnDateTime('2026-11-20', '10:05:00');
    const id1 = await txService.withTransaction(async (tx) => {
      return notificationsService.createNotificationInTx(tx, {
        userId: testCusId!,
        type: 'REMINDER',
        title: 'Nhắc lịch chơi',
        body: 'Sắp tới giờ chơi.',
        linkType: 'BOOKING',
        linkRef: String(seededBookingId),
        bookingCode: seededBookingCode,
      });
    });

    expect(id1).toBeGreaterThan(0);
    expect(flushSpy).toHaveBeenCalledTimes(1);
    expect(flushSpy).toHaveBeenCalledWith([
      {
        rooms: [`user:${testCusId}`],
        event: 'notification.created',
        payload: {
          notificationId: id1,
          type: 'REMINDER',
          title: 'Nhắc lịch chơi',
          body: 'Sắp tới giờ chơi.',
          bookingCode: seededBookingCode,
          promotionCode: null,
          createdAt: '2026-11-20T10:05:00+07:00',
          unreadCount: 1,
        },
      },
    ]);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // 2. Create promotion-linked notification (by PromotionId) & another booking-linked (by BookingCode)
    mockedNow = parseVnDateTime('2026-11-20', '10:06:00');
    const id2 = await txService.withTransaction(async (tx) => {
      return notificationsService.createNotificationInTx(tx, {
        userId: testCusId!,
        type: 'PROMOTION',
        title: 'Ưu đãi mới',
        body: 'Dùng mã SANGVUI20.',
        linkType: 'PROMOTION',
        linkRef: String(seededPromoId),
        promotionCode: 'SANGVUI20',
      });
    });

    mockedNow = parseVnDateTime('2026-11-20', '10:07:00');
    const id3 = await txService.withTransaction(async (tx) => {
      return notificationsService.createNotificationInTx(tx, {
        userId: testCusId!,
        type: 'SCHEDULE_CHANGE',
        title: 'Đổi sân',
        body: 'Đơn của bạn được chuyển sân.',
        linkType: 'BOOKING',
        linkRef: seededBookingCode,
        bookingCode: seededBookingCode,
      });
    });

    expect(flushSpy).toHaveBeenLastCalledWith([
      {
        rooms: [`user:${testCusId}`],
        event: 'notification.created',
        payload: expect.objectContaining({
          notificationId: id3,
          unreadCount: 3,
          bookingCode: seededBookingCode,
        }),
      },
    ]);

    // Verify list order (newest first) and resolved codes
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/me/notifications')
      .set('Authorization', 'Bearer cus-test');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.map((n: { notificationId: number }) => n.notificationId)).toEqual([
      id3,
      id2,
      id1,
    ]);
    expect(listRes.body.data[0].bookingCode).toBe(seededBookingCode);
    expect(listRes.body.data[1].promotionCode).toBe('SANGVUI20');
    expect(listRes.body.data[2].bookingCode).toBe(seededBookingCode);

    // API-22: validation error when isRead !== true
    const badPatch = await request(app.getHttpServer())
      .patch(`/api/v1/me/notifications/${id1}`)
      .set('Authorization', 'Bearer cus-test')
      .send({ isRead: false });
    expect(badPatch.status).toBe(400);
    expect(badPatch.body.error.code).toBe('VALIDATION_ERROR');

    // API-22: 404 when trying to mark another user's notification
    const otherUserPatch = await request(app.getHttpServer())
      .patch(`/api/v1/me/notifications/${cusAnNotificationId}`)
      .set('Authorization', 'Bearer cus-test')
      .send({ isRead: true });
    expect(otherUserPatch.status).toBe(404);
    expect(otherUserPatch.body.error.code).toBe('NOT_FOUND');

    // API-22: mark one as read
    mockedNow = parseVnDateTime('2026-11-20', '10:10:00');
    const markRes = await request(app.getHttpServer())
      .patch(`/api/v1/me/notifications/${id1}`)
      .set('Authorization', 'Bearer cus-test')
      .send({ isRead: true });
    expect(markRes.status).toBe(200);
    expect(markRes.body.data).toEqual({
      notificationId: id1,
      isRead: true,
      readAt: '2026-11-20T10:10:00+07:00',
      unreadCount: 2,
    });

    // Re-marking id1 preserves original readAt
    mockedNow = parseVnDateTime('2026-11-20', '10:15:00');
    const remarkRes = await request(app.getHttpServer())
      .patch(`/api/v1/me/notifications/${id1}`)
      .set('Authorization', 'Bearer cus-test')
      .send({ isRead: true });
    expect(remarkRes.status).toBe(200);
    expect(remarkRes.body.data.readAt).toBe('2026-11-20T10:10:00+07:00');
    expect(remarkRes.body.data.unreadCount).toBe(2);

    // API-23: mark all as read
    const readAllRes = await request(app.getHttpServer())
      .post('/api/v1/me/notifications/read-all')
      .set('Authorization', 'Bearer cus-test');
    expect(readAllRes.status).toBe(200);
    expect(readAllRes.body.data).toEqual({
      updated: 2,
      unreadCount: 0,
    });

    const unreadAfter = await request(app.getHttpServer())
      .get('/api/v1/me/notifications/unread-count')
      .set('Authorization', 'Bearer cus-test');
    expect(unreadAfter.status).toBe(200);
    expect(unreadAfter.body.data).toEqual({ unreadCount: 0 });

    flushSpy.mockRestore();
    sendSpy.mockRestore();
  });
});
