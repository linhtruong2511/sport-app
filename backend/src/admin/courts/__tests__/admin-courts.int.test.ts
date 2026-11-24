import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { parseVnDateTime, toIsoVn, toSqlDateTime } from '../../../core/time.js';
import { DatabaseModule } from '../../../database/database.module.js';
import { AdminCourtsModule } from '../admin-courts.module.js';

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
  imports: [CoreModule, DatabaseModule, TestAuthModule, AdminCourtsModule],
})
class AdminCourtsTestAppModule {}

describe('admin/courts integration (API 47–58)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());
  let emittedEvents: EmittedEvent[] = [];

  let ids: {
    cs01: number;
    cs02: number;
    pickleballId: number;
    tennisId: number;
    badmintonId: number;
    pb01: number;
    pb02: number;
    cl01: number;
    bd02: number;
    bd03: number;
    tn01: number;
    ownerId: number;
    anId: number;
  };

  let originalCs01Hours: Array<{
    DayOfWeek: number;
    OpenTime: string | null;
    CloseTime: string | null;
    IsClosed: boolean;
  }> = [];

  const createdCourtIds: number[] = [];
  const createdBlockIds: number[] = [];
  const createdHolidayIds: number[] = [];
  const createdBookingIds: number[] = [];
  let restoreCs01Hours = false;

  async function seedFutureBooking(opts: {
    code: string;
    branchId: number;
    courtId: number;
    date: string;
    startTime: string;
    endTime: string;
    status?: 'PENDING_PAYMENT' | 'CONFIRMED';
    priceRuleId?: number;
  }): Promise<number> {
    const exec = await txService.executor();
    const startAt = parseVnDateTime(opts.date, opts.startTime);
    const endAt = parseVnDateTime(opts.date, opts.endTime);
    const now = fakeClock.now();
    const status = opts.status ?? 'CONFIRMED';
    const holdExpireAt = status === 'PENDING_PAYMENT' ? new Date(now.getTime() + 600_000) : null;

    const res = await exec
      .request()
      .input('code', sql.VarChar(20), opts.code)
      .input('branchId', sql.Int, opts.branchId)
      .input('courtId', sql.Int, opts.courtId)
      .input('customerUserId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('status', sql.VarChar(20), status)
      .input('paymentStatus', sql.VarChar(20), status === 'CONFIRMED' ? 'PAID' : 'UNPAID')
      .input('paidAmount', sql.Decimal(18, 0), status === 'CONFIRMED' ? 150000 : 0)
      .input('remainingAmount', sql.Decimal(18, 0), status === 'CONFIRMED' ? 0 : 150000)
      .input('holdExpireAt', sql.DateTime2(0), holdExpireAt ? toSqlDateTime(holdExpireAt) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus,
          HoldExpireAt, CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @customerUserId, @startAt, @endAt,
          150000, 0, 150000, 'FULL', 0,
          150000, @paidAmount, @remainingAmount, @status, @paymentStatus,
          @holdExpireAt, @customerUserId, @now, @now, 'ONLINE'
        )
      `);

    const bookingId = Number(res.recordset[0].BookingId);
    createdBookingIds.push(bookingId);

    await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .input('courtId', sql.Int, opts.courtId)
      .input('slotStart', sql.DateTime2(0), toSqlDateTime(startAt))
      .query(`
        INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
        VALUES (@bookingId, @courtId, @slotStart, 1)
      `);

    if (opts.priceRuleId !== undefined) {
      await exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .input('priceRuleId', sql.BigInt, opts.priceRuleId)
        .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
        .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
        .query(`
          INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
          VALUES (@bookingId, @priceRuleId, @startAt, @endAt, 150000, 150000)
        `);
    }

    return bookingId;
  }

  async function cleanupArtifacts(): Promise<void> {
    const exec = await txService.executor();

    if (createdBookingIds.length > 0) {
      const idList = createdBookingIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef IN (${createdBookingIds.map((id) => `'${id}'`).join(',')});
        DELETE FROM dbo.BookingTransfers WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingStatusHistory WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingPriceLines WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingSlots WHERE BookingId IN (${idList});
        DELETE FROM dbo.Payments WHERE BookingId IN (${idList});
        DELETE FROM dbo.Refunds WHERE BookingId IN (${idList});
        DELETE FROM dbo.PaymentRequest WHERE BookingId IN (${idList});
        DELETE FROM dbo.Bookings WHERE BookingId IN (${idList});
      `);
      createdBookingIds.length = 0;
    }

    if (createdBlockIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.CourtBlocks WHERE BlockId IN (${createdBlockIds.join(',')});
      `);
      createdBlockIds.length = 0;
    }

    if (createdCourtIds.length > 0) {
      const idList = createdCourtIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.CourtBlocks WHERE CourtId IN (${idList});
        DELETE FROM dbo.CourtPriceRules WHERE CourtId IN (${idList});
        DELETE FROM dbo.Courts WHERE CourtId IN (${idList});
      `);
      createdCourtIds.length = 0;
    }

    if (createdHolidayIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.BranchHolidays WHERE HolidayId IN (${createdHolidayIds.join(',')});
      `);
      createdHolidayIds.length = 0;
    }

    if (restoreCs01Hours) {
      await exec
        .request()
        .input('branchId', sql.Int, ids.cs01)
        .query(`DELETE FROM dbo.BranchOpeningHours WHERE BranchId = @branchId`);

      for (const h of originalCs01Hours) {
        await exec
          .request()
          .input('branchId', sql.Int, ids.cs01)
          .input('dayOfWeek', sql.TinyInt, h.DayOfWeek)
          .input('openTime', sql.VarChar(8), h.OpenTime)
          .input('closeTime', sql.VarChar(8), h.CloseTime)
          .input('isClosed', sql.Bit, h.IsClosed ? 1 : 0)
          .query(`
            INSERT INTO dbo.BranchOpeningHours (BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed)
            VALUES (
              @branchId, @dayOfWeek,
              CASE WHEN @openTime IS NULL THEN NULL ELSE CAST(@openTime AS TIME(0)) END,
              CASE WHEN @closeTime IS NULL THEN NULL ELSE CAST(@closeTime AS TIME(0)) END,
              @isClosed
            )
          `);
      }
      restoreCs01Hours = false;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AdminCourtsTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
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
      SELECT SportId, Code FROM dbo.Sports
    `);
    const sportMap = new Map(sportsRes.recordset.map((s) => [s.Code, Number(s.SportId)]));

    const courtsRes = await exec.request().query<{ Code: string; CourtId: number }>(`
      SELECT Code, CourtId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_PB_02','SAN_CL_01','SAN_BD_02','SAN_BD_03','SAN_TN_01')
    `);
    const courtMap = new Map(courtsRes.recordset.map((c) => [c.Code, Number(c.CourtId)]));

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      BranchId: number | null;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, BranchId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0900000001', '0933445577', '0987654321')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));
    const owner = userMap.get('0900000001')!;
    const staff = userMap.get('0933445577')!;
    const cus = userMap.get('0987654321')!;

    ids = {
      cs01: branchMap.get('CS01')!,
      cs02: branchMap.get('CS02')!,
      pickleballId: sportMap.get('PICKLEBALL')!,
      tennisId: sportMap.get('TENNIS')!,
      badmintonId: sportMap.get('BADMINTON')!,
      pb01: courtMap.get('SAN_PB_01')!,
      pb02: courtMap.get('SAN_PB_02')!,
      cl01: courtMap.get('SAN_CL_01')!,
      bd02: courtMap.get('SAN_BD_02')!,
      bd03: courtMap.get('SAN_BD_03')!,
      tn01: courtMap.get('SAN_TN_01')!,
      ownerId: Number(owner.UserId),
      anId: Number(cus.UserId),
    };

    seededUsers = {
      owner: {
        userId: ids.ownerId,
        role: 'OWNER',
        branchId: null,
        tv: owner.TokenVersion,
      },
      staff: {
        userId: Number(staff.UserId),
        role: 'STAFF',
        branchId: Number(staff.BranchId),
        tv: staff.TokenVersion,
      },
      customer: {
        userId: ids.anId,
        role: 'CUSTOMER',
        branchId: null,
        tv: cus.TokenVersion,
      },
    };

    const hoursRes = await exec
      .request()
      .input('branchId', sql.Int, ids.cs01)
      .query<{
        DayOfWeek: number;
        OpenTime: Date | string | null;
        CloseTime: Date | string | null;
        IsClosed: boolean | number;
      }>(`
        SELECT DayOfWeek,
               CONVERT(VARCHAR(8), OpenTime, 108) AS OpenTime,
               CONVERT(VARCHAR(8), CloseTime, 108) AS CloseTime,
               IsClosed
        FROM dbo.BranchOpeningHours
        WHERE BranchId = @branchId
        ORDER BY DayOfWeek ASC
      `);
    originalCs01Hours = hoursRes.recordset.map((r) => ({
      DayOfWeek: Number(r.DayOfWeek),
      OpenTime: r.OpenTime ? String(r.OpenTime) : null,
      CloseTime: r.CloseTime ? String(r.CloseTime) : null,
      IsClosed: Boolean(r.IsClosed),
    }));
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

  it('enforces OWNER RBAC on admin/courts routes', async () => {
    const unauth = await request(app.getHttpServer()).get('/api/v1/admin/courts');
    expect(unauth.status).toBe(401);

    const cusRes = await request(app.getHttpServer())
      .get('/api/v1/admin/courts')
      .set('Authorization', 'Bearer customer');
    expect(cusRes.status).toBe(403);
    expect(cusRes.body.error.code).toBe('FORBIDDEN');

    const staffRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .set('Authorization', 'Bearer staff')
      .send({ startDate: '2027-03-01', days: 1, scope: 'ALL' });
    expect(staffRes.status).toBe(403);
    expect(staffRes.body.error.code).toBe('FORBIDDEN');
  });

  it('API-47 & API-48: lists courts with displayStatus & active rules, and returns detail with hasOpenBookings', async () => {
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.length).toBeGreaterThanOrEqual(11);

    const bd02 = listRes.body.data.find((c: { courtId: number }) => c.courtId === ids.bd02);
    expect(bd02.status).toBe('INACTIVE');
    expect(bd02.displayStatus).toBe('DECOMMISSIONED');
    expect(bd02.activeBlock).not.toBeNull();
    expect(bd02.activeBlock.blockType).toBe('DECOMMISSION');

    const bd03 = listRes.body.data.find((c: { courtId: number }) => c.courtId === ids.bd03);
    const peakRule = bd03.priceRules.find((r: { startTime: string }) => r.startTime === '16:00');
    expect(peakRule.pricePerHour).toBe(650000);

    // Filter by branchId & sportId
    const filteredRes = await request(app.getHttpServer())
      .get('/api/v1/admin/courts')
      .query({ branchId: ids.cs01, sportId: ids.pickleballId, status: 'ACTIVE' })
      .set('Authorization', 'Bearer owner');
    expect(filteredRes.status).toBe(200);
    expect(filteredRes.body.data.length).toBe(3);

    // Advance FakeClock into SAN_PB_02 seeded maintenance window (D+5 08:00 .. D+7 18:00)
    const pb02AtToday = listRes.body.data.find((c: { courtId: number }) => c.courtId === ids.pb02);
    expect(pb02AtToday.displayStatus).toBe('ACTIVE');

    fakeClock.set(new Date(Date.now() + 6 * 86_400_000));
    const maintRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/courts/${ids.pb02}`)
      .set('Authorization', 'Bearer owner');
    expect(maintRes.status).toBe(200);
    expect(maintRes.body.data.displayStatus).toBe('MAINTENANCE');
    expect(maintRes.body.data.activeBlock).not.toBeNull();
    expect(maintRes.body.data.activeBlock.blockType).toBe('MAINTENANCE');

    // Reset clock and verify hasOpenBookings
    fakeClock.set(new Date());
    const detailWithBooking = await request(app.getHttpServer())
      .get(`/api/v1/admin/courts/${ids.bd03}`)
      .set('Authorization', 'Bearer owner');
    expect(detailWithBooking.status).toBe(200);
    expect(detailWithBooking.body.data.hasOpenBookings).toBe(true);

    const detailWithoutBooking = await request(app.getHttpServer())
      .get(`/api/v1/admin/courts/${ids.cl01}`)
      .set('Authorization', 'Bearer owner');
    expect(detailWithoutBooking.status).toBe(200);
    expect(detailWithoutBooking.body.data.hasOpenBookings).toBe(false);

    const missing = await request(app.getHttpServer())
      .get('/api/v1/admin/courts/999999')
      .set('Authorization', 'Bearer owner');
    expect(missing.status).toBe(404);
  });

  it('API-49: creates courts with R-06 codes, writes AuditLogs, and validates business rules', async () => {
    // 1. Create Pickleball court -> SAN_PB_05
    const pbRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Pickleball Test 05',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        courtType: 'Sân tiêu chuẩn',
        description: 'Test create court',
        depositType: 'PERCENT',
        depositValue: 30,
        status: 'ACTIVE',
        priceRules: [
          { label: 'Giờ thường', startTime: '05:00', endTime: '16:00', pricePerHour: 150000 },
          { label: 'Cao điểm', startTime: '16:00', endTime: '22:00', pricePerHour: 250000 },
        ],
      });
    expect(pbRes.status).toBe(201);
    expect(pbRes.body.data.code).toBe('SAN_PB_05');
    createdCourtIds.push(pbRes.body.data.courtId);

    // 2. Create Tennis court -> SAN_TN_02 + AuditLogs check
    const tnRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Tennis Test 02',
        branchId: ids.cs02,
        sportId: ids.tennisId,
        depositType: 'FIXED',
        depositValue: 100000,
        priceRules: [
          {
            label: 'Ngày thường',
            dayOfWeekMask: 31,
            startTime: '06:00',
            endTime: '20:00',
            pricePerHour: 200000,
          },
          {
            label: 'Cuối tuần',
            dayOfWeekMask: 96,
            startTime: '06:00',
            endTime: '20:00',
            pricePerHour: 280000,
          },
        ],
      });
    expect(tnRes.status).toBe(201);
    expect(tnRes.body.data.code).toBe('SAN_TN_02');
    const tnCourtId = tnRes.body.data.courtId;
    createdCourtIds.push(tnCourtId);

    const exec = await txService.executor();
    const auditRes = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(tnCourtId))
      .query<{ Action: string; EntityType: string }>(`
        SELECT Action, EntityType FROM dbo.AuditLogs
        WHERE EntityType = 'Courts' AND EntityId = @entityId AND Action = 'CREATE'
      `);
    expect(auditRes.recordset.length).toBe(1);

    // 3. Duplicate court name in same branch -> 409 COURT_NAME_DUPLICATE
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Pickleball Test 05',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Cả ngày', startTime: '05:00', endTime: '22:00', pricePerHour: 150000 },
        ],
      });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error.code).toBe('COURT_NAME_DUPLICATE');

    // 4. Overlapping price rules -> 422 PRICE_RULE_OVERLAP
    const overlapRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Pickleball Overlap',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'R1', dayOfWeekMask: 127, startTime: '05:00', endTime: '17:00', pricePerHour: 150000 },
          { label: 'R2', dayOfWeekMask: 1, startTime: '16:00', endTime: '22:00', pricePerHour: 250000 },
        ],
      });
    expect(overlapRes.status).toBe(422);
    expect(overlapRes.body.error.code).toBe('PRICE_RULE_OVERLAP');

    // 5. Invalid price rule (endTime <= startTime and pricePerHour <= 0) -> 422 INVALID_PRICE_RULE
    const invalidTimeRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Invalid Time',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Sai giờ', startTime: '18:00', endTime: '16:00', pricePerHour: 150000 },
        ],
      });
    expect(invalidTimeRes.status).toBe(422);
    expect(invalidTimeRes.body.error.code).toBe('INVALID_PRICE_RULE');

    const invalidPriceRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Invalid Price',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Giá 0', startTime: '06:00', endTime: '16:00', pricePerHour: 0 },
        ],
      });
    expect(invalidPriceRes.status).toBe(422);
    expect(invalidPriceRes.body.error.code).toBe('INVALID_PRICE_RULE');

    // 6. Invalid deposit -> 422 INVALID_DEPOSIT
    const invalidPercentRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Invalid Deposit',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 5,
        priceRules: [
          { label: 'Cả ngày', startTime: '06:00', endTime: '22:00', pricePerHour: 150000 },
        ],
      });
    expect(invalidPercentRes.status).toBe(422);
    expect(invalidPercentRes.body.error.code).toBe('INVALID_DEPOSIT');

    const invalidFixedRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Invalid Fixed Deposit',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'FIXED',
        depositValue: 0,
        priceRules: [
          { label: 'Cả ngày', startTime: '06:00', endTime: '22:00', pricePerHour: 150000 },
        ],
      });
    expect(invalidFixedRes.status).toBe(422);
    expect(invalidFixedRes.body.error.code).toBe('INVALID_DEPOSIT');
  });

  it('API-50: preserves historical CourtPriceRules (FR 06), blocks SPORT_IMMUTABLE & COURT_HAS_OPEN_BOOKINGS, reports affectedCount on INACTIVE', async () => {
    const t0 = parseVnDateTime('2026-12-10', '09:00:00');
    fakeClock.set(t0);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/courts')
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Test Update FR06',
        branchId: ids.cs01,
        sportId: ids.pickleballId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Khung cũ', startTime: '05:00', endTime: '22:00', pricePerHour: 150000 },
        ],
      });
    expect(createRes.status).toBe(201);
    const courtId = createRes.body.data.courtId;
    const oldRuleId = createRes.body.data.priceRules[0].priceRuleId;
    createdCourtIds.push(courtId);

    // Seed an open future booking referencing oldRuleId
    await seedFutureBooking({
      code: 'BK2026121091',
      branchId: ids.cs01,
      courtId,
      date: '2026-12-15',
      startTime: '10:00',
      endTime: '11:00',
      priceRuleId: oldRuleId,
    });

    // Advance clock before updating
    fakeClock.advanceMinutes(5);

    // 1. Changing sportId -> 400 SPORT_IMMUTABLE
    const sportChangeRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/courts/${courtId}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Test Update FR06',
        branchId: ids.cs01,
        sportId: ids.badmintonId,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Khung mới', startTime: '05:00', endTime: '22:00', pricePerHour: 180000 },
        ],
      });
    expect(sportChangeRes.status).toBe(400);
    expect(sportChangeRes.body.error.code).toBe('SPORT_IMMUTABLE');

    // 2. Changing branchId when open booking exists -> 409 COURT_HAS_OPEN_BOOKINGS
    const branchChangeRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/courts/${courtId}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Test Update FR06',
        branchId: ids.cs02,
        depositType: 'PERCENT',
        depositValue: 30,
        priceRules: [
          { label: 'Khung mới', startTime: '05:00', endTime: '22:00', pricePerHour: 180000 },
        ],
      });
    expect(branchChangeRes.status).toBe(409);
    expect(branchChangeRes.body.error.code).toBe('COURT_HAS_OPEN_BOOKINGS');

    // 3. Valid update to INACTIVE with new price rule -> closes old rule, creates new rule, returns affectedCount=1, writes AuditLogs
    const updateRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/courts/${courtId}`)
      .set('Authorization', 'Bearer owner')
      .send({
        name: 'Sân Test Update FR06 v2',
        branchId: ids.cs01,
        depositType: 'PERCENT',
        depositValue: 40,
        status: 'INACTIVE',
        priceRules: [
          { label: 'Khung mới', startTime: '05:00', endTime: '22:00', pricePerHour: 200000 },
        ],
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.affectedCount).toBe(1);
    expect(updateRes.body.data.court.status).toBe('INACTIVE');
    expect(updateRes.body.data.court.priceRules).toHaveLength(1);
    expect(updateRes.body.data.court.priceRules[0].priceRuleId).not.toBe(oldRuleId);
    expect(updateRes.body.data.court.priceRules[0].pricePerHour).toBe(200000);

    const exec = await txService.executor();
    const rulesRes = await exec
      .request()
      .input('courtId', sql.Int, courtId)
      .query<{
        PriceRuleId: number | string;
        PricePerHour: number;
        EffectiveTo: Date | null;
      }>(`
        SELECT PriceRuleId, PricePerHour, EffectiveTo
        FROM dbo.CourtPriceRules
        WHERE CourtId = @courtId
        ORDER BY PriceRuleId ASC
      `);
    expect(rulesRes.recordset).toHaveLength(2);
    expect(Number(rulesRes.recordset[0].PriceRuleId)).toBe(oldRuleId);
    expect(Number(rulesRes.recordset[0].PricePerHour)).toBe(150000);
    expect(rulesRes.recordset[0].EffectiveTo).not.toBeNull();
    expect(rulesRes.recordset[1].EffectiveTo).toBeNull();

    const auditRes = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(courtId))
      .query<{ Action: string }>(`
        SELECT Action FROM dbo.AuditLogs
        WHERE EntityType = 'Courts' AND EntityId = @entityId AND Action = 'UPDATE'
      `);
    expect(auditRes.recordset.length).toBe(1);
  });

  it('API-51, API-52, API-53: supports block dryRun, creates block with overlap & socket, and releases preserving row', async () => {
    const now = parseVnDateTime('2026-12-10', '08:00:00');
    fakeClock.set(now);

    await seedFutureBooking({
      code: 'BK2026121092',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-12',
      startTime: '15:00',
      endTime: '16:00',
    });

    // 1. dryRun=true does not persist or emit socket
    const dryRes = await request(app.getHttpServer())
      .post('/api/v1/admin/court-blocks')
      .query({ dryRun: 'true' })
      .set('Authorization', 'Bearer owner')
      .send({
        courtId: ids.pb01,
        blockType: 'MAINTENANCE',
        startAt: '2026-12-12T14:00:00+07:00',
        endAt: '2026-12-12T18:00:00+07:00',
        reason: 'Bảo trì thử nghiệm',
      });
    expect(dryRes.status).toBe(201);
    expect(dryRes.body.data.block).toBeNull();
    expect(dryRes.body.data.affectedCount).toBe(1);
    expect(dryRes.body.data.affectedBookings[0].bookingCode).toBe('BK2026121092');
    expect(emittedEvents).toHaveLength(0);

    const exec = await txService.executor();
    const beforeBlocks = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .query<{ Cnt: number }>(`SELECT COUNT(*) AS Cnt FROM dbo.CourtBlocks WHERE CourtId = @courtId`);
    expect(beforeBlocks.recordset[0].Cnt).toBe(0);

    // 2. Real block creation
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/admin/court-blocks')
      .set('Authorization', 'Bearer owner')
      .send({
        courtId: ids.pb01,
        blockType: 'MAINTENANCE',
        startAt: '2026-12-12T14:00:00+07:00',
        endAt: '2026-12-12T18:00:00+07:00',
        reason: 'Bảo trì mặt sân & thay lưới',
      });
    expect(createRes.status).toBe(201);
    const blockId = createRes.body.data.block.blockId;
    createdBlockIds.push(blockId);
    expect(createRes.body.data.affectedCount).toBe(1);
    expect(createRes.body.data.affectedBookings[0].affectedReasons[0]).toMatchObject({
      type: 'COURT_BLOCK',
      refId: blockId,
    });
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'slot.updated' &&
          (e.payload as { state: string; courtId: number }).state === 'LOCKED' &&
          (e.payload as { courtId: number }).courtId === ids.pb01,
      ),
    ).toBe(true);

    // 3. Overlapping block -> 409 BLOCK_OVERLAP
    const overlapRes = await request(app.getHttpServer())
      .post('/api/v1/admin/court-blocks')
      .set('Authorization', 'Bearer owner')
      .send({
        courtId: ids.pb01,
        blockType: 'MAINTENANCE',
        startAt: '2026-12-12T16:00:00+07:00',
        endAt: '2026-12-12T20:00:00+07:00',
        reason: 'Chồng lịch',
      });
    expect(overlapRes.status).toBe(409);
    expect(overlapRes.body.error.code).toBe('BLOCK_OVERLAP');

    // 4. API-51 list blocks
    const listRes = await request(app.getHttpServer())
      .get('/api/v1/admin/court-blocks')
      .query({ branchId: ids.cs01 })
      .set('Authorization', 'Bearer owner');
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.some((b: { blockId: number }) => b.blockId === blockId)).toBe(true);

    // 5. API-53 release block -> preserves row, writes AuditLogs, emits FREE
    emittedEvents = [];
    fakeClock.advanceMinutes(10);
    const releaseRes = await request(app.getHttpServer())
      .post(`/api/v1/admin/court-blocks/${blockId}/release`)
      .set('Authorization', 'Bearer owner');
    expect(releaseRes.status).toBe(200);
    expect(releaseRes.body.data.blockId).toBe(blockId);
    expect(releaseRes.body.data.releasedAt).toBe(toIsoVn(fakeClock.now()));
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'slot.updated' &&
          (e.payload as { state: string; courtId: number }).state === 'FREE' &&
          (e.payload as { courtId: number }).courtId === ids.pb01,
      ),
    ).toBe(true);

    const dbBlock = await exec
      .request()
      .input('blockId', sql.BigInt, blockId)
      .query<{ ReleasedAt: Date | null }>(`SELECT ReleasedAt FROM dbo.CourtBlocks WHERE BlockId = @blockId`);
    expect(dbBlock.recordset).toHaveLength(1);
    expect(dbBlock.recordset[0].ReleasedAt).not.toBeNull();

    const activeAfterRelease = await request(app.getHttpServer())
      .get('/api/v1/admin/court-blocks')
      .query({ branchId: ids.cs01, active: 'true' })
      .set('Authorization', 'Bearer owner');
    expect(
      activeAfterRelease.body.data.some((b: { blockId: number }) => b.blockId === blockId),
    ).toBe(false);

    const allAfterRelease = await request(app.getHttpServer())
      .get('/api/v1/admin/court-blocks')
      .query({ branchId: ids.cs01, active: 'false' })
      .set('Authorization', 'Bearer owner');
    expect(allAfterRelease.body.data.some((b: { blockId: number }) => b.blockId === blockId)).toBe(
      true,
    );

    const auditBlockRes = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(blockId))
      .query<{ Action: string }>(`
        SELECT Action FROM dbo.AuditLogs
        WHERE EntityType = 'CourtBlocks' AND EntityId = @entityId
      `);
    const actions = auditBlockRes.recordset.map((r) => r.Action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('RELEASE');
  });

  it('API-54 & API-55: reads & updates opening hours, validates INVALID_OPENING_HOURS, supports dryRun & AuditLogs', async () => {
    fakeClock.set(parseVnDateTime('2026-12-10', '08:00:00'));

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/branches/${ids.cs01}/opening-hours`)
      .set('Authorization', 'Bearer owner');
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.days).toHaveLength(7);

    // Invalid opening hours (close <= open) -> 422 INVALID_OPENING_HOURS
    const badDays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dayOfWeek: d,
      openTime: d === 1 ? '18:00' : '05:00',
      closeTime: d === 1 ? '16:00' : '23:00',
      isClosed: false,
    }));
    const badRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/branches/${ids.cs01}/opening-hours`)
      .set('Authorization', 'Bearer owner')
      .send({ days: badDays });
    expect(badRes.status).toBe(422);
    expect(badRes.body.error.code).toBe('INVALID_OPENING_HOURS');

    // Booking on 2026-12-14 (Monday, dayOfWeek=1) at 20:00-21:00
    await seedFutureBooking({
      code: 'BK2026121093',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-14',
      startTime: '20:00',
      endTime: '21:00',
    });

    const newDays = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
      dayOfWeek: d,
      openTime: d === 1 ? '06:00' : '05:00',
      closeTime: d === 1 ? '19:00' : '23:00',
      isClosed: d === 7,
    }));

    // dryRun=true -> sees affected booking, does NOT write DB
    const dryRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/branches/${ids.cs01}/opening-hours`)
      .query({ dryRun: 'true' })
      .set('Authorization', 'Bearer owner')
      .send({ days: newDays });
    expect(dryRes.status).toBe(200);
    expect(dryRes.body.data.affectedCount).toBe(1);
    expect(dryRes.body.data.affectedBookings[0].bookingCode).toBe('BK2026121093');
    expect(dryRes.body.data.affectedBookings[0].affectedReasons[0].type).toBe('OPENING_HOURS');

    const checkNotSaved = await request(app.getHttpServer())
      .get(`/api/v1/admin/branches/${ids.cs01}/opening-hours`)
      .set('Authorization', 'Bearer owner');
    expect(checkNotSaved.body.data.days[0].closeTime).toBe('23:00');

    // Real update
    restoreCs01Hours = true;
    const putRes = await request(app.getHttpServer())
      .put(`/api/v1/admin/branches/${ids.cs01}/opening-hours`)
      .set('Authorization', 'Bearer owner')
      .send({ days: newDays });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.affectedCount).toBe(1);
    expect(putRes.body.data.days[6]).toMatchObject({
      dayOfWeek: 7,
      openTime: null,
      closeTime: null,
      isClosed: true,
    });

    const exec = await txService.executor();
    const auditRes = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(ids.cs01))
      .query<{ Action: string }>(`
        SELECT Action FROM dbo.AuditLogs
        WHERE EntityType = 'BranchOpeningHours' AND EntityId = @entityId AND Action = 'UPDATE'
      `);
    expect(auditRes.recordset.length).toBeGreaterThanOrEqual(1);
  });

  it('API-56, API-57, API-58: validates HOLIDAY_IN_PAST, supports dryRun, creates ALL-scope GroupKey holidays, and deletes single or group', async () => {
    fakeClock.set(parseVnDateTime('2026-12-10', '08:00:00'));

    // 1. Past date -> 422 HOLIDAY_IN_PAST
    const pastRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .set('Authorization', 'Bearer owner')
      .send({
        startDate: '2026-12-09',
        days: 1,
        scope: 'ALL',
      });
    expect(pastRes.status).toBe(422);
    expect(pastRes.body.error.code).toBe('HOLIDAY_IN_PAST');

    // 2. days > 60 -> 400 VALIDATION_ERROR
    const invalidDaysRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .set('Authorization', 'Bearer owner')
      .send({
        startDate: '2027-04-01',
        days: 61,
        scope: 'ALL',
      });
    expect(invalidDaysRes.status).toBe(400);
    expect(invalidDaysRes.body.error.code).toBe('VALIDATION_ERROR');

    // 3. dryRun=true with affected booking
    await seedFutureBooking({
      code: 'BK2026121094',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2027-04-30',
      startTime: '10:00',
      endTime: '11:00',
    });

    const dryRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .query({ dryRun: 'true' })
      .set('Authorization', 'Bearer owner')
      .send({
        startDate: '2027-04-30',
        days: 2,
        scope: 'ALL',
        reason: 'Nghỉ lễ 30/4 - 1/5',
      });
    expect(dryRes.status).toBe(201);
    expect(dryRes.body.data.holidays).toEqual([]);
    expect(dryRes.body.data.affectedCount).toBe(1);
    expect(dryRes.body.data.affectedBookings[0].affectedReasons[0].type).toBe('HOLIDAY');

    // 4. Create ALL-scope holiday -> 2 rows sharing GroupKey H-20270430-1
    const createAllRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .set('Authorization', 'Bearer owner')
      .send({
        startDate: '2027-04-30',
        days: 2,
        scope: 'ALL',
        reason: 'Nghỉ lễ 30/4 - 1/5',
      });
    expect(createAllRes.status).toBe(201);
    expect(createAllRes.body.data.holidays).toHaveLength(2);
    expect(createAllRes.body.data.affectedCount).toBe(1);
    for (const h of createAllRes.body.data.holidays) {
      createdHolidayIds.push(h.holidayId);
    }

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/admin/holidays')
      .query({ from: '2027-04-01' })
      .set('Authorization', 'Bearer owner');
    expect(listRes.status).toBe(200);
    const createdItems = listRes.body.data.filter(
      (h: { startDate: string }) => h.startDate === '2027-04-30',
    );
    expect(createdItems).toHaveLength(2);
    expect(createdItems[0].endDate).toBe('2027-05-01');
    expect(createdItems[0].groupKey).toBe('H-20270430-1');
    expect(createdItems[1].groupKey).toBe('H-20270430-1');

    // Verify AuditLogs CREATE
    const exec = await txService.executor();
    const createAudit = await exec
      .request()
      .input('entityId', sql.VarChar(50), 'H-20270430-1')
      .query<{ Action: string }>(`
        SELECT Action FROM dbo.AuditLogs
        WHERE EntityType = 'BranchHolidays' AND EntityId = @entityId AND Action = 'CREATE'
      `);
    expect(createAudit.recordset).toHaveLength(1);

    // 5. Delete whole group with ?group=true -> 204, removes both rows
    const delGroupRes = await request(app.getHttpServer())
      .delete(`/api/v1/admin/holidays/${createdItems[0].holidayId}`)
      .query({ group: 'true' })
      .set('Authorization', 'Bearer owner');
    expect(delGroupRes.status).toBe(204);

    const afterGroupDel = await request(app.getHttpServer())
      .get('/api/v1/admin/holidays')
      .query({ from: '2027-04-01' })
      .set('Authorization', 'Bearer owner');
    expect(
      afterGroupDel.body.data.some((h: { startDate: string }) => h.startDate === '2027-04-30'),
    ).toBe(false);

    // 6. Create BRANCH-scope holiday & delete single row
    const branchHolRes = await request(app.getHttpServer())
      .post('/api/v1/admin/holidays')
      .set('Authorization', 'Bearer owner')
      .send({
        startDate: '2027-06-01',
        days: 1,
        scope: 'BRANCH',
        branchId: ids.cs01,
      });
    expect(branchHolRes.status).toBe(201);
    const singleId = branchHolRes.body.data.holidays[0].holidayId;
    createdHolidayIds.push(singleId);

    const delSingleRes = await request(app.getHttpServer())
      .delete(`/api/v1/admin/holidays/${singleId}`)
      .set('Authorization', 'Bearer owner');
    expect(delSingleRes.status).toBe(204);
  });
});
