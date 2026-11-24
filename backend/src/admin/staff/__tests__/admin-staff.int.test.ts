import { type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthModule } from '../../../auth/auth.module.js';
import { AuthService } from '../../../auth/auth.service.js';
import { TokenVersionCacheService } from '../../../auth/token-version-cache.service.js';
import { closePool, sql } from '../../../config/database.js';
import { FakeClock, SystemClock } from '../../../core/clock.js';
import { CoreModule } from '../../../core/core.module.js';
import { DbTransactionService } from '../../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../../core/errors.js';
import { traceIdMiddleware } from '../../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../../core/logger.js';
import { RealtimeService } from '../../../core/realtime/realtime.service.js';
import { parseVnDateTime, toSqlDateTime } from '../../../core/time.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { AdminStaffModule } from '../admin-staff.module.js';

interface EmittedEvent {
  rooms: string[];
  event: string;
  payload: unknown;
}

@Module({
  imports: [CoreModule, DatabaseModule, AuthModule, AdminStaffModule],
})
class AdminStaffTestAppModule {}

describe('admin/staff integration (API 42–46)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let authService: AuthService;
  let tokenVersionCache: TokenVersionCacheService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());
  let emittedEvents: EmittedEvent[] = [];

  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    ownerId: number;
    staffTrangId: number;
    cusAnId: number;
  };

  let tokens: {
    owner: string;
    staff: string;
    customer: string;
  };

  const createdUserIds: number[] = [];
  const createdBookingIds: number[] = [];

  async function seedStaffPayment(opts: {
    staffId: number;
    branchId: number;
    bookingCode: string;
    paymentCode: string;
    amount: number;
    paidAt: Date;
  }): Promise<void> {
    const exec = await txService.executor();
    const startAt = parseVnDateTime('2026-12-20', '10:00:00');
    const endAt = parseVnDateTime('2026-12-20', '11:00:00');

    const bRes = await exec
      .request()
      .input('code', sql.VarChar(20), opts.bookingCode)
      .input('branchId', sql.Int, opts.branchId)
      .input('courtId', sql.Int, ids.pb01)
      .input('staffId', sql.BigInt, opts.staffId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('amount', sql.Decimal(18, 0), opts.amount)
      .input('now', sql.DateTime2(0), toSqlDateTime(opts.paidAt))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, GuestName, GuestPhone, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus,
          CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, N'Khách Test', '0909888777', @startAt, @endAt,
          @amount, 0, @amount, 'FULL', 0,
          @amount, @amount, 0, 'CONFIRMED', 'PAID',
          @staffId, @now, @now, 'COUNTER'
        )
      `);
    const bookingId = Number(bRes.recordset[0].BookingId);
    createdBookingIds.push(bookingId);

    await exec
      .request()
      .input('paymentCode', sql.VarChar(20), opts.paymentCode)
      .input('bookingId', sql.BigInt, bookingId)
      .input('amount', sql.Decimal(18, 0), opts.amount)
      .input('staffId', sql.BigInt, opts.staffId)
      .input('paidAt', sql.DateTime2(0), toSqlDateTime(opts.paidAt))
      .query(`
        INSERT INTO dbo.Payments (
          PaymentCode, BookingId, Purpose, Method, Channel, Amount,
          RequestId, BankTxnId, CollectedBy, PaidAt
        )
        VALUES (
          @paymentCode, @bookingId, 'FULL', 'CASH', 'COUNTER', @amount,
          NULL, NULL, @staffId, @paidAt
        )
      `);
  }

  async function cleanupArtifacts(): Promise<void> {
    const exec = await txService.executor();

    if (createdBookingIds.length > 0) {
      const idList = createdBookingIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.BookingStatusHistory WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingPriceLines WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingSlots WHERE BookingId IN (${idList});
        DELETE FROM dbo.Payments WHERE BookingId IN (${idList});
        DELETE FROM dbo.Bookings WHERE BookingId IN (${idList});
      `);
      createdBookingIds.length = 0;
    }

    if (createdUserIds.length > 0) {
      const idList = createdUserIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.AuditLogs WHERE EntityType = 'Users' AND EntityId IN (${createdUserIds.map((id) => `'${id}'`).join(',')});
        DELETE FROM dbo.RefreshTokens WHERE UserId IN (${idList});
        DELETE FROM dbo.Users WHERE UserId IN (${idList});
      `);
      for (const id of createdUserIds) {
        tokenVersionCache.invalidate(id);
      }
      createdUserIds.length = 0;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AdminStaffTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    authService = app.get(AuthService);
    tokenVersionCache = app.get(TokenVersionCacheService);
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

    const courtRes = await exec.request().query<{ CourtId: number }>(`
      SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_PB_01'
    `);

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
    }>(`
      SELECT Phone, UserId FROM dbo.Users WHERE Phone IN ('0900000001', '0933445577', '0987654321')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, Number(u.UserId)]));

    ids = {
      cs01: branchMap.get('CS01')!,
      cs02: branchMap.get('CS02')!,
      pb01: Number(courtRes.recordset[0].CourtId),
      ownerId: userMap.get('0900000001')!,
      staffTrangId: userMap.get('0933445577')!,
      cusAnId: userMap.get('0987654321')!,
    };

    const meta = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
    const [ownerLogin, staffLogin, cusLogin] = await Promise.all([
      authService.login({ identity: '0900000001', password: 'Owner@123' }, meta),
      authService.login({ identity: '0933445577', password: 'Nv123456' }, meta),
      authService.login({ identity: '0987654321', password: 'An123456' }, meta),
    ]);
    tokens = {
      owner: ownerLogin.accessToken,
      staff: staffLogin.accessToken,
      customer: cusLogin.accessToken,
    };
  });

  beforeEach(() => {
    fakeClock.set(new Date());
    emittedEvents = [];
  });

  afterEach(async () => {
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

  it('enforces OWNER RBAC on admin/staff routes', async () => {
    const unauth = await request(app.getHttpServer()).get('/api/v1/admin/staff');
    expect(unauth.status).toBe(401);

    const cusRes = await request(app.getHttpServer())
      .get('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.customer}`);
    expect(cusRes.status).toBe(403);
    expect(cusRes.body.error.code).toBe('FORBIDDEN');

    const staffRes = await request(app.getHttpServer())
      .get('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.staff}`);
    expect(staffRes.status).toBe(403);
    expect(staffRes.body.error.code).toBe('FORBIDDEN');
  });

  it('API-42: lists staff with filters, search, metrics, and meta counts', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      activeCount: expect.any(Number),
      lockedCount: expect.any(Number),
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(res.body.meta.countByBranch[String(ids.cs01)]).toBeGreaterThanOrEqual(2);

    const trang = res.body.data.find((s: { userId: number }) => s.userId === ids.staffTrangId);
    expect(trang).toBeDefined();
    expect(trang.passwordHash).toBeUndefined();
    expect(trang.counterBookingCount).toBeGreaterThanOrEqual(1);
    expect(trang.collectedAmount).toBeGreaterThanOrEqual(240000);

    const filteredRes = await request(app.getHttpServer())
      .get('/api/v1/admin/staff')
      .query({ branchId: ids.cs01, status: 'LOCKED', q: 'Tuấn' })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data).toHaveLength(1);
    expect(filteredRes.body.data[0].phone).toBe('0933445588');
  });

  it('API-43: creates staff with NV code & AuditLogs, validates fields and PHONE_TAKEN/EMAIL_TAKEN with takenByRole', async () => {
    // 1. Invalid password (missing digit / too short) -> 400 VALIDATION_ERROR
    const badPwRes = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Nguyễn Thị Lan',
        phone: '0977000111',
        branchId: ids.cs01,
        password: 'onlyletters',
      });
    expect(badPwRes.status).toBe(400);
    expect(badPwRes.body.error.code).toBe('VALIDATION_ERROR');

    // 2. Missing branch -> 404 NOT_FOUND
    const badBranchRes = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Nguyễn Thị Lan',
        phone: '0977000111',
        branchId: 999999,
        password: 'Staff1234',
      });
    expect(badBranchRes.status).toBe(404);

    // 3. Phone taken by CUSTOMER -> 409 PHONE_TAKEN with details.takenByRole = 'CUSTOMER'
    const phoneTakenCus = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Nguyễn Thị Lan',
        phone: '0987654321',
        branchId: ids.cs01,
        password: 'Staff1234',
      });
    expect(phoneTakenCus.status).toBe(409);
    expect(phoneTakenCus.body.error.code).toBe('PHONE_TAKEN');
    expect(phoneTakenCus.body.error.details).toEqual({ takenByRole: 'CUSTOMER' });

    // 4. Email taken by OWNER -> 409 EMAIL_TAKEN with details.takenByRole = 'OWNER'
    const emailTakenOwner = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Nguyễn Thị Lan',
        phone: '0977000111',
        email: 'OWNER@sporthub.vn',
        branchId: ids.cs01,
        password: 'Staff1234',
      });
    expect(emailTakenOwner.status).toBe(409);
    expect(emailTakenOwner.body.error.code).toBe('EMAIL_TAKEN');
    expect(emailTakenOwner.body.error.details).toEqual({ takenByRole: 'OWNER' });

    // 5. Successful creation
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Nguyễn Thị Lan',
        phone: '0977000111',
        email: 'lannt@sporthub.vn',
        branchId: ids.cs02,
        password: 'Staff1234',
      });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.code).toMatch(/^NV\d{6}$/);
    expect(createRes.body.data.branch.branchId).toBe(ids.cs02);
    expect(createRes.body.data.passwordHash).toBeUndefined();
    const staffId = createRes.body.data.userId;
    createdUserIds.push(staffId);

    const exec = await txService.executor();
    const auditRes = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(staffId))
      .query<{ Action: string }>(`
        SELECT Action FROM dbo.AuditLogs
        WHERE EntityType = 'Users' AND EntityId = @entityId AND Action = 'CREATE_STAFF'
      `);
    expect(auditRes.recordset).toHaveLength(1);
  });

  it('API-44 & API-45: revokes tokens & emits auth.revoked on branch change, password change, and lock; unlock restores access', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Trần Văn Nam',
        phone: '0977000222',
        email: 'namtv@sporthub.vn',
        branchId: ids.cs01,
        password: 'Staff1234',
      });
    expect(createRes.status).toBe(201);
    const staffId = createRes.body.data.userId as number;
    createdUserIds.push(staffId);

    // Log in as new staff
    const login1 = await authService.login(
      { identity: '0977000222', password: 'Staff1234' },
      { userAgent: 'vitest', ipAddress: '127.0.0.1' },
    );
    const verified1 = await authService.verifyAccessToken(login1.accessToken);
    expect(verified1.userId).toBe(staffId);

    // 1. Change branch -> revokes tokens + emits auth.revoked (BRANCH_CHANGED)
    emittedEvents = [];
    const branchUpdateRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/staff/${staffId}`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Trần Văn Nam',
        phone: '0977000222',
        email: 'namtv@sporthub.vn',
        branchId: ids.cs02,
      });
    expect(branchUpdateRes.status).toBe(200);
    expect(branchUpdateRes.body.data.branch.branchId).toBe(ids.cs02);
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'auth.revoked' &&
          e.rooms.includes(`user:${staffId}`) &&
          (e.payload as { reason: string }).reason === 'BRANCH_CHANGED',
      ),
    ).toBe(true);
    await expect(authService.verifyAccessToken(login1.accessToken)).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
    });
    await expect(
      authService.refresh(login1.rawRefreshToken, { userAgent: 'vitest', ipAddress: '127.0.0.1' }),
    ).rejects.toMatchObject({ code: 'REFRESH_INVALID' });

    // 2. Re-login, then change password -> revokes tokens + emits PASSWORD_CHANGED
    const login2 = await authService.login(
      { identity: '0977000222', password: 'Staff1234' },
      { userAgent: 'vitest', ipAddress: '127.0.0.1' },
    );
    emittedEvents = [];
    const pwUpdateRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/staff/${staffId}`)
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Trần Văn Nam',
        phone: '0977000222',
        email: 'namtv@sporthub.vn',
        branchId: ids.cs02,
        password: 'NewPass5678',
      });
    expect(pwUpdateRes.status).toBe(200);
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'auth.revoked' &&
          (e.payload as { reason: string }).reason === 'PASSWORD_CHANGED',
      ),
    ).toBe(true);
    await expect(authService.verifyAccessToken(login2.accessToken)).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
    });

    // 3. Re-login with new password, seed a payment, then LOCK -> revokes tokens + emits ACCOUNT_LOCKED
    const login3 = await authService.login(
      { identity: '0977000222', password: 'NewPass5678' },
      { userAgent: 'vitest', ipAddress: '127.0.0.1' },
    );
    await seedStaffPayment({
      staffId,
      branchId: ids.cs02,
      bookingCode: 'BK2026122001',
      paymentCode: 'PT2026122001',
      amount: 180000,
      paidAt: parseVnDateTime('2026-12-20', '10:05:00'),
    });

    emittedEvents = [];
    const lockRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/staff/${staffId}/lock`)
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(lockRes.status).toBe(200);
    expect(lockRes.body.data.status).toBe('LOCKED');
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'auth.revoked' &&
          e.rooms.includes(`user:${staffId}`) &&
          (e.payload as { reason: string }).reason === 'ACCOUNT_LOCKED',
      ),
    ).toBe(true);
    await expect(authService.verifyAccessToken(login3.accessToken)).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });

    // Payments history preserved after lock!
    const paymentsAfterLockRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/staff/${staffId}/payments`)
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(paymentsAfterLockRes.status).toBe(200);
    expect(paymentsAfterLockRes.body.data).toHaveLength(1);
    expect(paymentsAfterLockRes.body.data[0].paymentCode).toBe('PT2026122001');
    expect(paymentsAfterLockRes.body.meta.totalAmount).toBe(180000);

    // 4. Unlock resets FailedLoginCount, LockedUntil and allows login
    const exec = await txService.executor();
    await exec
      .request()
      .input('userId', sql.BigInt, staffId)
      .input('lockedUntil', sql.DateTime2(0), toSqlDateTime(new Date(Date.now() + 300_000)))
      .query(`
        UPDATE dbo.Users
        SET FailedLoginCount = 3, LockedUntil = @lockedUntil
        WHERE UserId = @userId
      `);

    const unlockRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/staff/${staffId}/unlock`)
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(unlockRes.status).toBe(200);
    expect(unlockRes.body.data.status).toBe('ACTIVE');

    const dbUser = await exec
      .request()
      .input('userId', sql.BigInt, staffId)
      .query<{ FailedLoginCount: number; LockedUntil: Date | null }>(`
        SELECT FailedLoginCount, LockedUntil FROM dbo.Users WHERE UserId = @userId
      `);
    expect(dbUser.recordset[0].FailedLoginCount).toBe(0);
    expect(dbUser.recordset[0].LockedUntil).toBeNull();

    const login4 = await authService.login(
      { identity: '0977000222', password: 'NewPass5678' },
      { userAgent: 'vitest', ipAddress: '127.0.0.1' },
    );
    expect(login4.accessToken).toBeTruthy();
  });

  it('API-46: filters staff payments by date range and rejects invalid date range', async () => {
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/staff')
      .set('Authorization', `Bearer ${tokens.owner}`)
      .send({
        fullName: 'Lê Minh Hải',
        phone: '0977000333',
        branchId: ids.cs01,
        password: 'Staff1234',
      });
    const staffId = createRes.body.data.userId as number;
    createdUserIds.push(staffId);

    await seedStaffPayment({
      staffId,
      branchId: ids.cs01,
      bookingCode: 'BK2026122101',
      paymentCode: 'PT2026122101',
      amount: 100000,
      paidAt: parseVnDateTime('2026-12-10', '09:00:00'),
    });
    await seedStaffPayment({
      staffId,
      branchId: ids.cs01,
      bookingCode: 'BK2026122102',
      paymentCode: 'PT2026122102',
      amount: 250000,
      paidAt: parseVnDateTime('2026-12-15', '18:00:00'),
    });

    const invalidRangeRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/staff/${staffId}/payments`)
      .query({ from: '2026-12-20', to: '2026-12-10' })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(invalidRangeRes.status).toBe(400);
    expect(invalidRangeRes.body.error.code).toBe('INVALID_DATE_RANGE');

    const filteredRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/staff/${staffId}/payments`)
      .query({ from: '2026-12-15', to: '2026-12-15' })
      .set('Authorization', `Bearer ${tokens.owner}`);
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data).toHaveLength(1);
    expect(filteredRes.body.data[0].paymentCode).toBe('PT2026122102');
    expect(filteredRes.body.meta.totalAmount).toBe(250000);
    expect(filteredRes.body.meta.totalItems).toBe(1);
  });
});
