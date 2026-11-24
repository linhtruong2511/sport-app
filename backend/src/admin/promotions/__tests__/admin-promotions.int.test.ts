import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closePool, sql } from '../../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../../core/auth/index.js';
import { FakeClock, SystemClock } from '../../../core/clock.js';
import { CoreModule } from '../../../core/core.module.js';
import { DbTransactionService } from '../../../core/db/transaction.js';
import { AppError, AppExceptionsFilter } from '../../../core/errors.js';
import { traceIdMiddleware } from '../../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../../core/logger.js';
import { RealtimeService } from '../../../core/realtime/realtime.service.js';
import { parseVnDateTime, toSqlDateTime } from '../../../core/time.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { IntegrationsModule } from '../../../integrations/integrations.module.js';
import { NotificationsService } from '../../../notifications/notifications.service.js';
import { AdminPromotionsModule } from '../admin-promotions.module.js';
import { AdminPromotionsService } from '../admin-promotions.service.js';

let seededUsers: Record<string, AuthenticatedUser> = {};

const mockTokenVerifier: TokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = seededUsers[token];
    if (!user) {
      throw new AppError('UNAUTHENTICATED');
    }
    return user;
  },
};

interface EmittedEvent {
  rooms: string[];
  event: string;
  payload: unknown;
}

@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useValue: mockTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
class TestAuthModule {}

@Module({
  imports: [CoreModule, IntegrationsModule, DatabaseModule, TestAuthModule, AdminPromotionsModule],
})
class AdminPromotionsTestAppModule {}

describe('admin/promotions integration (API 59–65 + retryFailedPromoNotifications)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let adminPromotionsService: AdminPromotionsService;
  let notificationsService: NotificationsService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());
  let emittedEvents: EmittedEvent[] = [];

  let ids: {
    cs01: number;
    cs02: number;
    pickleballId: number;
    badmintonId: number;
    ownerId: number;
    staffId: number;
    cusAnId: number;
    cusBinhId: number;
  };

  const createdPromotionIds: number[] = [];
  const createdPromoCodes: string[] = [];

  async function cleanupArtifacts(): Promise<void> {
    const exec = await txService.executor();

    if (createdPromoCodes.length > 0) {
      const codeIn = createdPromoCodes.map((c) => `'${c}'`).join(',');
      await exec.request().query(`
        DELETE FROM dbo.Notifications
        WHERE Type = 'PROMOTION' AND LinkType = 'PROMOTION' AND LinkRef IN (${codeIn});
      `);
      createdPromoCodes.length = 0;
    }

    if (createdPromotionIds.length > 0) {
      const idList = createdPromotionIds.join(',');
      const idStrList = createdPromotionIds.map((id) => `'${id}'`).join(',');
      await exec.request().query(`
        DELETE FROM dbo.AuditLogs WHERE EntityType = 'Promotions' AND EntityId IN (${idStrList});
        DELETE FROM dbo.Notifications WHERE Type = 'PROMOTION' AND LinkType = 'PROMOTION' AND LinkRef IN (${idStrList});
        DELETE FROM dbo.PromotionCustomers WHERE PromotionId IN (${idList});
        DELETE FROM dbo.PromotionBranches WHERE PromotionId IN (${idList});
        DELETE FROM dbo.PromotionSports WHERE PromotionId IN (${idList});
        DELETE FROM dbo.Promotions WHERE PromotionId IN (${idList});
      `);
      createdPromotionIds.length = 0;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AdminPromotionsTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    adminPromotionsService = app.get(AdminPromotionsService);
    notificationsService = app.get(NotificationsService);
    realtimeService = app.get(RealtimeService);
    realtimeService.attachServer({
      to(rooms: string | string[]) {
        const roomList = Array.isArray(rooms) ? rooms : [rooms];
        return {
          emit(event: string, payload: unknown) {
            emittedEvents.push({ rooms: roomList, event, payload });
          },
        };
      },
    } as unknown as Server);

    systemClock = app.get(SystemClock);
    origClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    const exec = await txService.executor();
    const branchesRes = await exec.request().query<{ BranchId: number; Code: string }>(`
      SELECT BranchId, Code FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')
    `);
    const branchMap = new Map(branchesRes.recordset.map((b) => [b.Code, Number(b.BranchId)]));

    const sportsRes = await exec.request().query<{ SportId: number; Code: string }>(`
      SELECT SportId, Code FROM dbo.Sports WHERE Code IN ('PICKLEBALL', 'BADMINTON')
    `);
    const sportMap = new Map(sportsRes.recordset.map((s) => [s.Code, Number(s.SportId)]));

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      BranchId: number | null;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, BranchId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0900000001', '0933445577', '0987654321', '0912345678')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));

    const owner = userMap.get('0900000001')!;
    const staff = userMap.get('0933445577')!;
    const cusAn = userMap.get('0987654321')!;
    const cusBinh = userMap.get('0912345678')!;

    ids = {
      cs01: branchMap.get('CS01')!,
      cs02: branchMap.get('CS02')!,
      pickleballId: sportMap.get('PICKLEBALL')!,
      badmintonId: sportMap.get('BADMINTON')!,
      ownerId: Number(owner.UserId),
      staffId: Number(staff.UserId),
      cusAnId: Number(cusAn.UserId),
      cusBinhId: Number(cusBinh.UserId),
    };

    seededUsers = {
      owner: {
        userId: ids.ownerId,
        role: 'OWNER',
        branchId: null,
        tv: owner.TokenVersion,
      },
      staff: {
        userId: ids.staffId,
        role: 'STAFF',
        branchId: Number(staff.BranchId),
        tv: staff.TokenVersion,
      },
      customer: {
        userId: ids.cusAnId,
        role: 'CUSTOMER',
        branchId: null,
        tv: cusAn.TokenVersion,
      },
    };
  });

  beforeEach(() => {
    fakeClock.set(parseVnDateTime('2026-11-15', '10:00:00'));
    emittedEvents = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupArtifacts();
  });

  afterAll(async () => {
    await cleanupArtifacts();
    if (systemClock && origClockNow) {
      systemClock.now = origClockNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('enforces OWNER RBAC on admin/promotions routes', async () => {
    const unauth = await request(app.getHttpServer()).get('/api/v1/admin/promotions');
    expect(unauth.status).toBe(401);

    const cusRes = await request(app.getHttpServer())
      .get('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer customer');
    expect(cusRes.status).toBe(403);
    expect(cusRes.body.error.code).toBe('FORBIDDEN');

    const staffRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer staff')
      .send({});
    expect(staffRes.status).toBe(403);
    expect(staffRes.body.error.code).toBe('FORBIDDEN');
  });

  it('API-59 & API-60: lists promotions with branchIds/sportIds/customerCount/isExpired and gets detail with customers', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(3);

    const picklePromo = listRes.body.data.find(
      (p: { code: string }) => p.code === 'PICKLECS01',
    );
    expect(picklePromo).toBeDefined();
    expect(picklePromo.branchIds).toEqual([ids.cs01]);
    expect(picklePromo.sportIds).toEqual([ids.pickleballId]);
    expect(picklePromo.isExpired).toBe(false);

    const specificList = await request(app.getHttpServer())
      .get('/api/v1/admin/promotions')
      .query({ audienceType: 'SPECIFIC', q: 'TRIAN' })
      .set('Authorization', 'Bearer owner');
    expect(specificList.status).toBe(200);
    expect(specificList.body.data).toHaveLength(1);
    const triAn = specificList.body.data[0];
    expect(triAn.code).toBe('TRIAN10');
    expect(triAn.customerCount).toBe(2);

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/promotions/${triAn.promotionId}`)
      .set('Authorization', 'Bearer owner');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.customers).toHaveLength(2);
    expect(detailRes.body.data.customers[0]).toMatchObject({
      userId: expect.any(Number),
      userCode: expect.stringMatching(/^KH\d{6}$/),
      fullName: expect.any(String),
      phone: expect.any(String),
    });
  });

  it('API-61: validates CUSTOMER_NOT_FOUND with details.phones, PROMO_CODE_DUPLICATE, creates promo with join tables & dispatches notifications', async () => {
    // 1. Missing customer phone -> 422 CUSTOMER_NOT_FOUND with details.phones
    const missingPhoneRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Ưu đãi khách hàng riêng',
        code: 'rieng01',
        discountType: 'FIXED',
        discountValue: 30000,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 10,
        audienceType: 'SPECIFIC',
        customerPhones: ['0987654321', '0999888777', '0933445577'], // 0933445577 is STAFF, not CUSTOMER
      });
    expect(missingPhoneRes.status).toBe(422);
    expect(missingPhoneRes.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect(missingPhoneRes.body.error.details.phones).toEqual(['0999888777', '0933445577']);

    // 2. Duplicate code -> 409 PROMO_CODE_DUPLICATE
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Trùng mã SANGVUI20',
        code: 'sangvui20',
        discountType: 'PERCENT',
        discountValue: 10,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 20,
        audienceType: 'ALL',
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('PROMO_CODE_DUPLICATE');

    // 3. Valid SPECIFIC promotion with notifyCustomers=true -> 201 + uppercase code + SENT notifications + AuditLogs
    createdPromoCodes.push('VIPTEST2026');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Ưu đãi VIP tháng 11',
        code: ' viptest2026 ',
        description: 'Giảm 25% tối đa 80k cho khách VIP',
        discountType: 'PERCENT',
        discountValue: 25,
        maxDiscountAmount: 80000,
        allBranches: false,
        branchIds: [ids.cs01, ids.cs02],
        allSports: false,
        sportIds: [ids.pickleballId],
        timeFrom: '08:00',
        timeTo: '12:00',
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 50,
        audienceType: 'SPECIFIC',
        customerPhones: ['0987654321', '0912345678'],
        notifyCustomers: true,
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.promotionId as number;
    createdPromotionIds.push(promoId);
    expect(createRes.body.data.code).toBe('VIPTEST2026');
    expect(createRes.body.data.branchIds).toEqual([ids.cs01, ids.cs02]);
    expect(createRes.body.data.sportIds).toEqual([ids.pickleballId]);
    expect(createRes.body.data.customerCount).toBe(2);

    const exec = await txService.executor();
    const notifRes = await exec
      .request()
      .input('code', sql.VarChar(50), 'VIPTEST2026')
      .query<{ UserId: number | string; Type: string; LinkType: string; LinkRef: string }>(`
        SELECT UserId, Type, LinkType, LinkRef
        FROM dbo.Notifications
        WHERE Type = 'PROMOTION' AND LinkType = 'PROMOTION' AND LinkRef = @code
      `);
    expect(notifRes.recordset).toHaveLength(2);
    expect(
      emittedEvents.filter((e) => e.event === 'notification.created'),
    ).toHaveLength(2);

    const dbPromo = await exec
      .request()
      .input('id', sql.Int, promoId)
      .query<{ NotifyStatus: string }>(`SELECT NotifyStatus FROM dbo.Promotions WHERE PromotionId = @id`);
    expect(dbPromo.recordset[0].NotifyStatus).toBe('SENT');

    // 4. If dispatch fails post-commit, 201 creation still succeeds and NotifyStatus = 'FAILED'
    vi.spyOn(notificationsService, 'createNotificationInTx').mockRejectedValueOnce(
      new Error('Simulated notification failure'),
    );
    createdPromoCodes.push('FAILNOTIF01');
    const createWithFailRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Ưu đãi lỗi thông báo',
        code: 'FAILNOTIF01',
        discountType: 'FIXED',
        discountValue: 20000,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 10,
        audienceType: 'SPECIFIC',
        customerPhones: ['0987654321'],
        notifyCustomers: true,
      });
    expect(createWithFailRes.status).toBe(201);
    const failPromoId = createWithFailRes.body.data.promotionId as number;
    createdPromotionIds.push(failPromoId);

    const dbFailPromo = await exec
      .request()
      .input('id', sql.Int, failPromoId)
      .query<{ NotifyStatus: string }>(`SELECT NotifyStatus FROM dbo.Promotions WHERE PromotionId = @id`);
    expect(dbFailPromo.recordset[0].NotifyStatus).toBe('FAILED');
  });

  it('API-62, API-63, API-64: updates promo with locks, toggles pause/resume, deletes unused (204) & discontinues used (200)', async () => {
    // 1. Create promo A (unused -> delete 204)
    const createA = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Khuyến mãi xóa cứng',
        code: 'DELUNUSED01',
        discountType: 'FIXED',
        discountValue: 20000,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 10,
        audienceType: 'ALL',
      });
    expect(createA.status).toBe(201);
    const idA = createA.body.data.promotionId as number;
    createdPromotionIds.push(idA);

    // Pause & resume A
    const pauseRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/promotions/${idA}/pause`)
      .set('Authorization', 'Bearer owner');
    expect(pauseRes.status).toBe(200);
    expect(pauseRes.body.data).toEqual({ promotionId: idA, status: 'PAUSED' });

    const resumeRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/promotions/${idA}/resume`)
      .set('Authorization', 'Bearer owner');
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.data).toEqual({ promotionId: idA, status: 'ACTIVE' });

    // Delete A -> 204
    const delARes = await request(app.getHttpServer())
      .delete(`/api/v1/admin/promotions/${idA}`)
      .set('Authorization', 'Bearer owner');
    expect(delARes.status).toBe(204);

    // 2. Create promo B, simulate UsedCount = 3
    const createB = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Khuyến mãi đang dùng',
        code: 'USEDTEST01',
        discountType: 'PERCENT',
        discountValue: 10,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 20,
        audienceType: 'ALL',
      });
    expect(createB.status).toBe(201);
    const idB = createB.body.data.promotionId as number;
    createdPromotionIds.push(idB);

    const exec = await txService.executor();
    await exec
      .request()
      .input('id', sql.Int, idB)
      .query(`UPDATE dbo.Promotions SET UsedCount = 3 WHERE PromotionId = @id`);

    // Reject changing code when UsedCount > 0 -> 422 PROMO_CODE_LOCKED
    const changeCodeRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/promotions/${idB}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Khuyến mãi đang dùng',
        code: 'NEWCODE99',
        discountType: 'PERCENT',
        discountValue: 10,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 20,
        audienceType: 'ALL',
      });
    expect(changeCodeRes.status).toBe(422);
    expect(changeCodeRes.body.error.code).toBe('PROMO_CODE_LOCKED');

    // Reject maxUses < UsedCount -> 422 MAX_USES_TOO_LOW
    const lowMaxRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/promotions/${idB}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Khuyến mãi đang dùng',
        code: 'USEDTEST01',
        discountType: 'PERCENT',
        discountValue: 10,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 2,
        audienceType: 'ALL',
      });
    expect(lowMaxRes.status).toBe(422);
    expect(lowMaxRes.body.error.code).toBe('MAX_USES_TOO_LOW');

    // Valid update keeping code and replacing scope -> 200
    const validUpdateRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/promotions/${idB}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Khuyến mãi đã cập nhật',
        code: 'USEDTEST01',
        discountType: 'PERCENT',
        discountValue: 15,
        allBranches: false,
        branchIds: [ids.cs01],
        allSports: false,
        sportIds: [ids.badmintonId],
        startDate: '2026-11-15',
        endDate: '2026-12-15',
        maxUses: 30,
        audienceType: 'SPECIFIC',
        customerPhones: ['0987654321'],
      });
    expect(validUpdateRes.status).toBe(200);
    expect(validUpdateRes.body.data.branchIds).toEqual([ids.cs01]);
    expect(validUpdateRes.body.data.sportIds).toEqual([ids.badmintonId]);
    expect(validUpdateRes.body.data.customerCount).toBe(1);

    // Delete used promo B -> 200 DISCONTINUED
    const delBRes = await request(app.getHttpServer())
      .delete(`/api/v1/admin/promotions/${idB}`)
      .set('Authorization', 'Bearer owner');
    expect(delBRes.status).toBe(200);
    expect(delBRes.body.data).toMatchObject({
      promotionId: idB,
      deleted: false,
      status: 'DISCONTINUED',
    });

    // Reject PUT, pause, resume, notify on DISCONTINUED -> 422 PROMO_DISCONTINUED
    const editDiscRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/promotions/${idB}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Không thể sửa',
        code: 'USEDTEST01',
        discountType: 'PERCENT',
        discountValue: 15,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-12-15',
        maxUses: 30,
        audienceType: 'ALL',
      });
    expect(editDiscRes.status).toBe(422);
    expect(editDiscRes.body.error.code).toBe('PROMO_DISCONTINUED');

    const pauseDiscRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/promotions/${idB}/pause`)
      .set('Authorization', 'Bearer owner');
    expect(pauseDiscRes.status).toBe(422);
    expect(pauseDiscRes.body.error.code).toBe('PROMO_DISCONTINUED');

    const notifyDiscRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/promotions/${idB}/notify`)
      .set('Authorization', 'Bearer owner');
    expect(notifyDiscRes.status).toBe(422);
    expect(notifyDiscRes.body.error.code).toBe('PROMO_DISCONTINUED');
  });

  it('API-65 & retryFailedPromoNotifications: retries FAILED promos idempotently without duplicate notifications', async () => {
    createdPromoCodes.push('RETRYIDEM01');
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/promotions')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Ưu đãi thử lại idempotent',
        code: 'RETRYIDEM01',
        discountType: 'FIXED',
        discountValue: 25000,
        allBranches: true,
        allSports: true,
        startDate: '2026-11-15',
        endDate: '2026-11-30',
        maxUses: 20,
        audienceType: 'SPECIFIC',
        customerPhones: ['0987654321', '0912345678'],
        notifyCustomers: false,
      });
    expect(createRes.status).toBe(201);
    const promoId = createRes.body.data.promotionId as number;
    createdPromotionIds.push(promoId);

    // Pre-insert notification for cusAnId and mark promo NotifyStatus = 'FAILED'
    const exec = await txService.executor();
    await exec
      .request()
      .input('userId', sql.BigInt, ids.cusAnId)
      .input('code', sql.VarChar(50), 'RETRYIDEM01')
      .input('now', sql.DateTime2(0), toSqlDateTime(fakeClock.now()))
      .query(`
        INSERT INTO dbo.Notifications (UserId, Type, Title, Body, LinkType, LinkRef, IsRead, ReadAt, CreatedAt)
        VALUES (@userId, 'PROMOTION', N'Old', N'Old', 'PROMOTION', @code, 0, NULL, @now)
      `);
    await exec
      .request()
      .input('id', sql.Int, promoId)
      .query(`UPDATE dbo.Promotions SET NotifyStatus = 'FAILED' WHERE PromotionId = @id`);

    // 1. retryFailedPromoNotifications should notify ONLY cusBinhId (1 new notification) and set SENT
    const retriedCount = await adminPromotionsService.retryFailedPromoNotifications(20);
    expect(retriedCount).toBe(1);

    const notifsAfterRetry = await exec
      .request()
      .input('code', sql.VarChar(50), 'RETRYIDEM01')
      .query<{ UserId: number | string }>(`
        SELECT UserId FROM dbo.Notifications
        WHERE Type = 'PROMOTION' AND LinkType = 'PROMOTION' AND LinkRef = @code
      `);
    expect(notifsAfterRetry.recordset).toHaveLength(2);
    expect(notifsAfterRetry.recordset.map((r) => Number(r.UserId)).sort()).toEqual(
      [ids.cusAnId, ids.cusBinhId].sort(),
    );

    // 2. API-65 POST /notify again -> HTTP 202, SENT, sentCount = 0 (no duplicate spam!)
    const notifyAgainRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/promotions/${promoId}/notify`)
      .set('Authorization', 'Bearer owner');
    expect(notifyAgainRes.status).toBe(202);
    expect(notifyAgainRes.body.data).toEqual({
      promotionId: promoId,
      notifyStatus: 'SENT',
      sentCount: 0,
    });

    const notifsFinal = await exec
      .request()
      .input('code', sql.VarChar(50), 'RETRYIDEM01')
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt FROM dbo.Notifications
        WHERE Type = 'PROMOTION' AND LinkType = 'PROMOTION' AND LinkRef = @code
      `);
    expect(notifsFinal.recordset[0].Cnt).toBe(2);
  });
});
