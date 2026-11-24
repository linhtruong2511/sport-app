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
import { parseVnDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { CatalogModule } from '../catalog.module.js';

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
  imports: [TestAuthModule, CoreModule, DatabaseModule, CatalogModule],
})
class CatalogTestModule {}

describe('catalog integration (API-03, API-04, API-08)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let systemClock: SystemClock;
  let origNow: () => Date;
  let mockedNow: Date;

  let cs01Id: number;
  let cs02Id: number;
  let inactiveBranchId: number | null = null;

  beforeAll(async () => {
    app = await NestFactory.create(CatalogTestModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    systemClock = app.get(SystemClock);
    origNow = systemClock.now.bind(systemClock);
    mockedNow = parseVnDateTime('2026-12-01', '09:00:00');
    systemClock.now = () => new Date(mockedNow.getTime());

    const exec = await txService.executor();
    const branches = await exec.request().query<{ BranchId: number; Code: string }>(
      "SELECT BranchId, Code FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')",
    );
    cs01Id = branches.recordset.find((b) => b.Code === 'CS01')!.BranchId;
    cs02Id = branches.recordset.find((b) => b.Code === 'CS02')!.BranchId;

    const users = await exec.request().query<{ UserId: number; Phone: string; BranchId: number | null }>(
      "SELECT UserId, Phone, BranchId FROM dbo.Users WHERE Phone IN ('0900000001', '0987654321')",
    );
    const ownerId = Number(users.recordset.find((u) => u.Phone === '0900000001')!.UserId);
    const cusId = Number(users.recordset.find((u) => u.Phone === '0987654321')!.UserId);

    testUsers.set('owner', { userId: ownerId, role: 'OWNER', branchId: null, tv: 0 });
    testUsers.set('customer', { userId: cusId, role: 'CUSTOMER', branchId: null, tv: 0 });

    const inactiveRes = await exec
      .request()
      .input('code', sql.VarChar(20), 'CS99')
      .input('name', sql.NVarChar(150), 'Cơ sở tạm đóng test')
      .input('address', sql.NVarChar(255), '99 Test Street')
      .query<{ BranchId: number }>(`
        INSERT INTO dbo.Branches (Code, Name, Address, Status)
        OUTPUT inserted.BranchId
        VALUES (@code, @name, @address, 'INACTIVE')
      `);
    inactiveBranchId = Number(inactiveRes.recordset[0].BranchId);
  });

  beforeEach(() => {
    mockedNow = parseVnDateTime('2026-12-01', '09:00:00');
  });

  afterAll(async () => {
    if (inactiveBranchId !== null) {
      const exec = await txService.executor();
      await exec
        .request()
        .input('id', sql.Int, inactiveBranchId)
        .query('DELETE FROM dbo.Branches WHERE BranchId = @id');
    }
    if (systemClock && origNow) {
      systemClock.now = origNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-03 GET /branches returns ACTIVE branches without bank fields and restricts status=ALL to OWNER', async () => {
    const publicRes = await request(app.getHttpServer()).get('/api/v1/branches');
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.meta.serverTime).toBe('2026-12-01T09:00:00+07:00');

    const branches = publicRes.body.data;
    expect(branches.every((b: { status: string }) => b.status === 'ACTIVE')).toBe(true);
    expect(branches.some((b: { code: string }) => b.code === 'CS99')).toBe(false);

    const cs01 = branches.find((b: { branchId: number }) => b.branchId === cs01Id);
    expect(cs01.courtCount).toBe(6);
    expect(cs01.openingHours).toHaveLength(7);
    expect(cs01).not.toHaveProperty('bankBin');
    expect(cs01).not.toHaveProperty('bankName');
    expect(cs01).not.toHaveProperty('bankAccountNo');
    expect(cs01).not.toHaveProperty('bankAccountName');

    const anonAll = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .query({ status: 'ALL' });
    expect(anonAll.status).toBe(403);
    expect(anonAll.body.error.code).toBe('FORBIDDEN');

    const cusAll = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', 'Bearer customer')
      .query({ status: 'ALL' });
    expect(cusAll.status).toBe(403);

    const ownerAll = await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', 'Bearer owner')
      .query({ status: 'ALL' });
    expect(ownerAll.status).toBe(200);
    expect(ownerAll.body.data.some((b: { code: string }) => b.code === 'CS99')).toBe(true);
  });

  it('API-04 GET /sports returns all sports globally and filters activeCourtCount by branchId', async () => {
    const allRes = await request(app.getHttpServer()).get('/api/v1/sports');
    expect(allRes.status).toBe(200);
    expect(allRes.body.data).toHaveLength(5);

    const pickleAll = allRes.body.data.find((s: { code: string }) => s.code === 'PICKLEBALL');
    expect(pickleAll.gridBlockMinutes).toBe(60);
    expect(pickleAll.displayBlockMinutes).toBe(120);
    expect(pickleAll.activeCourtCount).toBe(4); // 3 at CS01 + 1 at CS02

    const cs01Res = await request(app.getHttpServer())
      .get('/api/v1/sports')
      .query({ branchId: cs01Id });
    expect(cs01Res.status).toBe(200);
    const pickleCs01 = cs01Res.body.data.find((s: { code: string }) => s.code === 'PICKLEBALL');
    const footballCs01 = cs01Res.body.data.find((s: { code: string }) => s.code === 'FOOTBALL');
    expect(pickleCs01.activeCourtCount).toBe(3);
    expect(footballCs01.activeCourtCount).toBe(0);

    const cs02Res = await request(app.getHttpServer())
      .get('/api/v1/sports')
      .query({ branchId: cs02Id });
    expect(cs02Res.status).toBe(200);
    const footballCs02 = cs02Res.body.data.find((s: { code: string }) => s.code === 'FOOTBALL');
    // SAN_BD_02 is INACTIVE, so only SAN_BD_01 and SAN_BD_03 count
    expect(footballCs02.activeCourtCount).toBe(2);
  });

  it('API-08 GET /branches/:branchId/sport-summary matches API-11 freeSlotCount and returns min/max prices & deposit', async () => {
    // 2026-12-01 falls inside seeded PB02 maintenance block (D+5..D+7 from 2026-11-25) -> 2 courts * 6 = 12
    const maintDate = '2026-12-01';
    const maintSummary = await request(app.getHttpServer())
      .get(`/api/v1/branches/${cs01Id}/sport-summary`)
      .query({ date: maintDate });
    expect(maintSummary.status).toBe(200);
    const maintPickle = maintSummary.body.data.sports.find(
      (s: { code: string }) => s.code === 'PICKLEBALL',
    );
    expect(maintPickle.freeSlotCount).toBe(12);

    // 2026-12-15 has no blocks/bookings; at 09:00 slots 05:00, 07:00, 09:00 are PAST -> 6 FREE slots * 3 courts = 18
    const testDate = '2026-12-15';
    mockedNow = parseVnDateTime(testDate, '09:00:00');
    const summaryRes = await request(app.getHttpServer())
      .get(`/api/v1/branches/${cs01Id}/sport-summary`)
      .query({ date: testDate });

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.data.branch).toMatchObject({
      branchId: cs01Id,
      openTime: '05:00',
      closeTime: '23:00',
      isClosed: false,
      holiday: null,
    });

    const pickleSummary = summaryRes.body.data.sports.find(
      (s: { code: string }) => s.code === 'PICKLEBALL',
    );
    expect(pickleSummary).toMatchObject({
      code: 'PICKLEBALL',
      courtCount: 3,
      minPricePerHour: 150000,
      maxPricePerHour: 250000,
      deposit: { type: 'PERCENT', value: 30 },
    });
    expect(pickleSummary.freeSlotCount).toBe(18);

    // Holiday => freeSlotCount = 0
    const holidayRes = await request(app.getHttpServer())
      .get(`/api/v1/branches/${cs01Id}/sport-summary`)
      .query({ date: '2027-01-01' });
    expect(holidayRes.status).toBe(200);
    expect(holidayRes.body.data.branch.holiday).toMatchObject({ reason: 'Nghỉ Tết Dương lịch' });
    expect(
      holidayRes.body.data.sports.every((s: { freeSlotCount: number }) => s.freeSlotCount === 0),
    ).toBe(true);

    // Inactive or missing branch => 404
    const missingRes = await request(app.getHttpServer()).get(
      `/api/v1/branches/${inactiveBranchId}/sport-summary`,
    );
    expect(missingRes.status).toBe(404);
    expect(missingRes.body.error.code).toBe('NOT_FOUND');
  });
});
