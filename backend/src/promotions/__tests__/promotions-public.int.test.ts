import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import { type AuthenticatedUser, TOKEN_VERIFIER, type TokenVerifier } from '../../core/auth/index.js';
import { SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { formatDateVn, parseVnDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PromotionsModule } from '../promotions.module.js';

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
  imports: [TestAuthModule, CoreModule, DatabaseModule, PromotionsModule],
})
class PromotionsTestModule {}

describe('promotions public integration (API-07, API-24)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let systemClock: SystemClock;
  let origNow: () => Date;
  let mockedNow: Date;

  let cs01Id: number;
  let cs02Id: number;
  let pickleballId: number;
  let ownerId: number;
  let cusAnId: number;
  let otherCusId: number | null = null;
  let branchSpecificPromoId: number | null = null;
  let expiredPromoId: number | null = null;

  beforeAll(async () => {
    app = await NestFactory.create(PromotionsTestModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    systemClock = app.get(SystemClock);
    origNow = systemClock.now.bind(systemClock);
    // Use real today so seeded StartDate/EndDate ranges match cleanly
    mockedNow = origNow();
    systemClock.now = () => new Date(mockedNow.getTime());

    const exec = await txService.executor();
    const branches = await exec.request().query<{ BranchId: number; Code: string }>(
      "SELECT BranchId, Code FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')",
    );
    cs01Id = branches.recordset.find((b) => b.Code === 'CS01')!.BranchId;
    cs02Id = branches.recordset.find((b) => b.Code === 'CS02')!.BranchId;

    const sports = await exec.request().query<{ SportId: number; Code: string }>(
      "SELECT SportId, Code FROM dbo.Sports WHERE Code = 'PICKLEBALL'",
    );
    pickleballId = sports.recordset[0].SportId;

    const users = await exec.request().query<{ UserId: number; Phone: string }>(
      "SELECT UserId, Phone FROM dbo.Users WHERE Phone IN ('0900000001', '0987654321')",
    );
    ownerId = Number(users.recordset.find((u) => u.Phone === '0900000001')!.UserId);
    cusAnId = Number(users.recordset.find((u) => u.Phone === '0987654321')!.UserId);

    // Create a non-eligible customer to test SPECIFIC audience check
    const cusRes = await exec.request().query<{ UserId: number }>(`
      INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, Status)
      OUTPUT inserted.UserId
      VALUES ('KH999999', N'Khách Ngoài Danh Sách', '0999888777', 'outsider@test.local', 'hash', 'CUSTOMER', 'ACTIVE')
    `);
    otherCusId = Number(cusRes.recordset[0].UserId);

    testUsers.set('cus-an', { userId: cusAnId, role: 'CUSTOMER', branchId: null, tv: 0 });
    testUsers.set('cus-other', { userId: otherCusId, role: 'CUSTOMER', branchId: null, tv: 0 });

    const todayStr = formatDateVn(origNow());
    // Insert an ACTIVE branch/sport-scoped promo for scopeText & filter verification
    const activeScopedRes = await exec
      .request()
      .input('today', sql.Date, todayStr)
      .input('ownerId', sql.BigInt, ownerId)
      .query<{ PromotionId: number }>(`
        INSERT INTO dbo.Promotions (
          Code, Name, DiscountType, DiscountValue, MaxDiscountAmount,
          AllBranches, AllSports, TimeFrom, TimeTo, StartDate, EndDate,
          AudienceType, MaxUses, UsedCount, Status, NotifyStatus, CreatedBy
        )
        OUTPUT inserted.PromotionId
        VALUES (
          'TESTCS01', N'Ưu đãi test cơ sở 1', 'FIXED', 30000, NULL,
          0, 0, '08:00', '12:00', @today, DATEADD(DAY, 10, @today),
          'ALL', 20, 5, 'ACTIVE', 'NONE', @ownerId
        )
      `);
    branchSpecificPromoId = Number(activeScopedRes.recordset[0].PromotionId);

    await exec
      .request()
      .input('promoId', sql.Int, branchSpecificPromoId)
      .input('branchId', sql.Int, cs01Id)
      .input('sportId', sql.Int, pickleballId)
      .query(`
        INSERT INTO dbo.PromotionBranches (PromotionId, BranchId) VALUES (@promoId, @branchId);
        INSERT INTO dbo.PromotionSports (PromotionId, SportId) VALUES (@promoId, @sportId);
      `);

    // Insert an expired ACTIVE promo to verify API-24 returns usable=false
    const expiredRes = await exec
      .request()
      .input('today', sql.Date, todayStr)
      .input('ownerId', sql.BigInt, ownerId)
      .query<{ PromotionId: number }>(`
        INSERT INTO dbo.Promotions (
          Code, Name, DiscountType, DiscountValue, MaxDiscountAmount,
          AllBranches, AllSports, StartDate, EndDate,
          AudienceType, MaxUses, UsedCount, Status, NotifyStatus, CreatedBy
        )
        OUTPUT inserted.PromotionId
        VALUES (
          'EXPIRED99', N'Ưu đãi đã hết hạn test', 'PERCENT', 10, NULL,
          1, 1, DATEADD(DAY, -10, @today), DATEADD(DAY, -1, @today),
          'ALL', 10, 0, 'ACTIVE', 'NONE', @ownerId
        )
      `);
    expiredPromoId = Number(expiredRes.recordset[0].PromotionId);
  });

  beforeEach(() => {
    mockedNow = origNow();
  });

  afterAll(async () => {
    const exec = await txService.executor();
    if (branchSpecificPromoId !== null) {
      await exec
        .request()
        .input('id', sql.Int, branchSpecificPromoId)
        .query(`
          DELETE FROM dbo.PromotionBranches WHERE PromotionId = @id;
          DELETE FROM dbo.PromotionSports WHERE PromotionId = @id;
          DELETE FROM dbo.Promotions WHERE PromotionId = @id;
        `);
    }
    if (expiredPromoId !== null) {
      await exec
        .request()
        .input('id', sql.Int, expiredPromoId)
        .query('DELETE FROM dbo.Promotions WHERE PromotionId = @id');
    }
    if (otherCusId !== null) {
      await exec
        .request()
        .input('id', sql.BigInt, otherCusId)
        .query('DELETE FROM dbo.Users WHERE UserId = @id');
    }

    if (systemClock && origNow) {
      systemClock.now = origNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-07 GET /promotions/public hides SPECIFIC promos from anonymous callers and shows eligible ones to authenticated customers', async () => {
    const anonRes = await request(app.getHttpServer()).get('/api/v1/promotions/public');
    expect(anonRes.status).toBe(200);
    const anonCodes = anonRes.body.data.map((p: { code: string }) => p.code);
    expect(anonCodes).toContain('SANGVUI20');
    expect(anonCodes).toContain('TESTCS01');
    expect(anonCodes).not.toContain('TRIAN10');
    expect(anonCodes).not.toContain('PICKLECS01'); // PAUSED
    expect(anonCodes).not.toContain('EXPIRED99'); // expired

    const sangvui = anonRes.body.data.find((p: { code: string }) => p.code === 'SANGVUI20');
    expect(sangvui).toMatchObject({
      discountType: 'PERCENT',
      discountValue: 20,
      maxDiscountAmount: 100000,
      timeFrom: '06:00',
      timeTo: '11:00',
      scopeText: 'Tất cả cơ sở',
      branchIds: [],
      sportIds: [],
      audienceType: 'ALL',
    });

    const scoped = anonRes.body.data.find((p: { code: string }) => p.code === 'TESTCS01');
    expect(scoped).toMatchObject({
      branchIds: [cs01Id],
      sportIds: [pickleballId],
      remainingUses: 15,
    });
    expect(scoped.scopeText).toContain('Cơ sở 1 - Cầu Giấy');
    expect(scoped.scopeText).toContain('Pickleball');

    // Filter by CS02 excludes TESTCS01
    const cs02Res = await request(app.getHttpServer())
      .get('/api/v1/promotions/public')
      .query({ branchId: cs02Id });
    expect(cs02Res.status).toBe(200);
    expect(cs02Res.body.data.map((p: { code: string }) => p.code)).not.toContain('TESTCS01');

    // Authenticated Customer An sees TRIAN10
    const cusAnRes = await request(app.getHttpServer())
      .get('/api/v1/promotions/public')
      .set('Authorization', 'Bearer cus-an');
    expect(cusAnRes.status).toBe(200);
    expect(cusAnRes.body.data.map((p: { code: string }) => p.code)).toContain('TRIAN10');

    // Non-eligible customer does not see TRIAN10
    const otherRes = await request(app.getHttpServer())
      .get('/api/v1/promotions/public')
      .set('Authorization', 'Bearer cus-other');
    expect(otherRes.status).toBe(200);
    expect(otherRes.body.data.map((p: { code: string }) => p.code)).not.toContain('TRIAN10');
  });

  it('API-24 GET /promotions/public/:code checks usability, paused/expired status, audience eligibility, and 404', async () => {
    const validRes = await request(app.getHttpServer()).get('/api/v1/promotions/public/sangvui20');
    expect(validRes.status).toBe(200);
    expect(validRes.body.data).toMatchObject({
      code: 'SANGVUI20',
      status: 'ACTIVE',
      usable: true,
      message: null,
    });

    const pausedRes = await request(app.getHttpServer()).get('/api/v1/promotions/public/PICKLECS01');
    expect(pausedRes.status).toBe(200);
    expect(pausedRes.body.data).toMatchObject({
      code: 'PICKLECS01',
      status: 'PAUSED',
      usable: false,
      message: 'Chương trình ưu đãi đã kết thúc.',
    });

    const expiredRes = await request(app.getHttpServer()).get('/api/v1/promotions/public/EXPIRED99');
    expect(expiredRes.status).toBe(200);
    expect(expiredRes.body.data).toMatchObject({
      code: 'EXPIRED99',
      usable: false,
      message: 'Chương trình ưu đãi đã kết thúc.',
    });

    const specificAnon = await request(app.getHttpServer()).get('/api/v1/promotions/public/TRIAN10');
    expect(specificAnon.status).toBe(200);
    expect(specificAnon.body.data).toMatchObject({
      code: 'TRIAN10',
      usable: false,
      message: 'Mã chỉ dành cho khách hàng được chỉ định.',
    });

    const specificCusAn = await request(app.getHttpServer())
      .get('/api/v1/promotions/public/TRIAN10')
      .set('Authorization', 'Bearer cus-an');
    expect(specificCusAn.status).toBe(200);
    expect(specificCusAn.body.data).toMatchObject({
      code: 'TRIAN10',
      usable: true,
      message: null,
    });

    const notFound = await request(app.getHttpServer()).get('/api/v1/promotions/public/NOPE999');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error.code).toBe('PROMO_NOT_FOUND');

    // Verify mocked clock can drive date boundary checks
    mockedNow = parseVnDateTime('2030-01-01', '10:00:00');
    const futureExpired = await request(app.getHttpServer()).get(
      '/api/v1/promotions/public/SANGVUI20',
    );
    expect(futureExpired.status).toBe(200);
    expect(futureExpired.body.data.usable).toBe(false);
    expect(futureExpired.body.data.message).toBe('Chương trình ưu đãi đã kết thúc.');
  });
});
