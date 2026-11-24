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
import {
  addDays,
  formatDateVn,
  parseVnDateTime,
  toSqlDateTime,
} from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AvailabilityModule } from '../availability.module.js';

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
  imports: [TestAuthModule, CoreModule, DatabaseModule, AvailabilityModule],
})
class AvailabilityTestModule {}

describe('availability integration (API-11)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let systemClock: SystemClock;
  let origNow: () => Date;
  let mockedNow: Date;

  let cs01Id: number;
  let cs02Id: number;
  let pickleballId: number;
  let badmintonId: number;
  let cusAnId: number;
  let ownerId: number;
  let pb01Id: number;
  let pb02Id: number;
  let pb03Id: number;

  const createdBookingIds: number[] = [];
  const createdBlockIds: number[] = [];

  beforeAll(async () => {
    app = await NestFactory.create(AvailabilityTestModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    systemClock = app.get(SystemClock);
    origNow = systemClock.now.bind(systemClock);
    mockedNow = origNow();
    systemClock.now = () => new Date(mockedNow.getTime());

    const exec = await txService.executor();
    const branches = await exec.request().query<{ BranchId: number; Code: string }>(
      "SELECT BranchId, Code FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')",
    );
    cs01Id = branches.recordset.find((b) => b.Code === 'CS01')!.BranchId;
    cs02Id = branches.recordset.find((b) => b.Code === 'CS02')!.BranchId;

    const sports = await exec.request().query<{ SportId: number; Code: string }>(
      "SELECT SportId, Code FROM dbo.Sports WHERE Code IN ('PICKLEBALL', 'BADMINTON')",
    );
    pickleballId = sports.recordset.find((s) => s.Code === 'PICKLEBALL')!.SportId;
    badmintonId = sports.recordset.find((s) => s.Code === 'BADMINTON')!.SportId;

    const users = await exec.request().query<{ UserId: number; Phone: string; Role: string }>(
      "SELECT UserId, Phone, Role FROM dbo.Users WHERE Phone IN ('0987654321', '0900000001')",
    );
    cusAnId = Number(users.recordset.find((u) => u.Phone === '0987654321')!.UserId);
    ownerId = Number(users.recordset.find((u) => u.Phone === '0900000001')!.UserId);

    testUsers.set('cus-an', { userId: cusAnId, role: 'CUSTOMER', branchId: null, tv: 0 });

    const courts = await exec.request().query<{ CourtId: number; Code: string }>(
      "SELECT CourtId, Code FROM dbo.Courts WHERE Code IN ('SAN_PB_01', 'SAN_PB_02', 'SAN_PB_03')",
    );
    pb01Id = courts.recordset.find((c) => c.Code === 'SAN_PB_01')!.CourtId;
    pb02Id = courts.recordset.find((c) => c.Code === 'SAN_PB_02')!.CourtId;
    pb03Id = courts.recordset.find((c) => c.Code === 'SAN_PB_03')!.CourtId;
  });

  beforeEach(() => {
    // Default test clock: 2026-12-01 09:30:00+07:00
    mockedNow = parseVnDateTime('2026-12-01', '09:30:00');
  });

  afterAll(async () => {
    const exec = await txService.executor();
    if (createdBookingIds.length > 0) {
      const ids = createdBookingIds.join(',');
      await exec.request().query(`DELETE FROM dbo.BookingSlots WHERE BookingId IN (${ids})`);
      await exec.request().query(`DELETE FROM dbo.Bookings WHERE BookingId IN (${ids})`);
    }
    if (createdBlockIds.length > 0) {
      const ids = createdBlockIds.join(',');
      await exec.request().query(`DELETE FROM dbo.CourtBlocks WHERE BlockId IN (${ids})`);
    }

    if (systemClock && origNow) {
      systemClock.now = origNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('builds slots using DisplayBlockMinutes, computes FREE prices, marks PAST slots, and builds priceHint', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: cs01Id, sportId: pickleballId, date: '2026-12-01' });

    expect(res.status).toBe(200);
    expect(res.body.meta.serverTime).toBe('2026-12-01T09:30:00+07:00');

    const data = res.body.data;
    expect(data.date).toBe('2026-12-01');
    expect(data.slotMinutes).toBe(120); // Pickleball DisplayBlockMinutes = 120
    expect(data.holiday).toBeNull();
    expect(data.branch).toMatchObject({
      branchId: cs01Id,
      openTime: '05:00',
      closeTime: '23:00',
      isClosed: false,
    });

    // 05:00 to 23:00 by 120m => 9 slots (05:00-07:00 ... 21:00-23:00)
    expect(data.slots).toHaveLength(9);
    expect(data.slots[0]).toEqual({ start: '05:00', end: '07:00', priceLabel: 'Giờ thường' });
    expect(data.slots[5]).toEqual({
      start: '15:00',
      end: '17:00',
      priceLabel: 'Giờ thường / Giờ cao điểm',
    });
    expect(data.priceHint).toContain('Giờ thường 05h–16h: 150k/h');
    expect(data.priceHint).toContain('Giờ cao điểm 16h–23h: 250k/h');

    expect(data.courts).toHaveLength(3);
    const pb01 = data.courts.find((c: { courtId: number }) => c.courtId === pb01Id);
    expect(pb01.state).toBe('READY');
    // At 09:30, 05:00-07:00, 07:00-09:00, 09:00-11:00 have slotStart <= 09:30 => PAST
    expect(pb01.cells[0]).toEqual({ start: '05:00', end: '07:00', state: 'PAST' });
    expect(pb01.cells[2]).toEqual({ start: '09:00', end: '11:00', state: 'PAST' });
    // 11:00-13:00 => FREE, 2h * 150k = 300000
    expect(pb01.cells[3]).toEqual({ start: '11:00', end: '13:00', state: 'FREE', price: 300000 });
    // 15:00-17:00 crosses 16:00 => 1h*150k + 1h*250k = 400000
    expect(pb01.cells[5]).toEqual({ start: '15:00', end: '17:00', state: 'FREE', price: 400000 });
  });

  it('returns empty slots and holiday info on branch holiday dates (e.g. 2027-01-01)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: cs02Id, sportId: badmintonId, date: '2027-01-01' });

    expect(res.status).toBe(200);
    expect(res.body.data.holiday).toMatchObject({
      startDate: '2027-01-01',
      endDate: '2027-01-01',
      reason: 'Nghỉ Tết Dương lịch',
    });
    expect(res.body.data.slots).toEqual([]);
  });

  it('enforces cell priority LOCKED > MINE > HELD > BOOKED > PAST > FREE without leaking customer PII', async () => {
    const testDate = '2026-12-15';
    mockedNow = parseVnDateTime(testDate, '06:00:00');
    const exec = await txService.executor();

    // Create a MAINTENANCE block on PB02 from 11:00 to 15:00
    const blockRes = await exec
      .request()
      .input('courtId', sql.Int, pb02Id)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '11:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '15:00')))
      .input('reason', sql.NVarChar(255), 'Bảo trì test')
      .input('createdBy', sql.BigInt, ownerId)
      .query<{ BlockId: number }>(`
        INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy)
        OUTPUT inserted.BlockId
        VALUES (@courtId, 'MAINTENANCE', @startAt, @endAt, @reason, @createdBy)
      `);
    const blockId = Number(blockRes.recordset[0].BlockId);
    createdBlockIds.push(blockId);

    // Insert a PENDING_PAYMENT booking for Customer An on PB01 11:00-13:00
    const holdCode = `BKTEST${Date.now().toString().slice(-6)}A`;
    const bMineRes = await exec
      .request()
      .input('code', sql.VarChar(20), holdCode)
      .input('branchId', sql.Int, cs01Id)
      .input('courtId', sql.Int, pb01Id)
      .input('cusId', sql.BigInt, cusAnId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '11:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '13:00')))
      .input('holdExpireAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '06:10')))
      .query<{ BookingId: number }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @cusId, @startAt, @endAt,
          300000, 0, 300000, 'FULL', 0, 300000, 0, 300000,
          'PENDING_PAYMENT', 'UNPAID', @holdExpireAt, 'ONLINE'
        )
      `);
    const bMineId = Number(bMineRes.recordset[0].BookingId);
    createdBookingIds.push(bMineId);

    await exec
      .request()
      .input('bookingId', sql.BigInt, bMineId)
      .input('courtId', sql.Int, pb01Id)
      .input('s1', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '11:00')))
      .input('s2', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '12:00')))
      .query(`
        INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
        VALUES (@bookingId, @courtId, @s1, 1), (@bookingId, @courtId, @s2, 1)
      `);

    // Insert a CONFIRMED guest booking on PB03 13:00-15:00
    const bookedCode = `BKTEST${Date.now().toString().slice(-6)}B`;
    const bBookedRes = await exec
      .request()
      .input('code', sql.VarChar(20), bookedCode)
      .input('branchId', sql.Int, cs01Id)
      .input('courtId', sql.Int, pb03Id)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '13:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '15:00')))
      .query<{ BookingId: number }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, NULL, N'Khách Bí Mật', '0909998877', @startAt, @endAt,
          300000, 0, 300000, 'FULL', 0, 300000, 300000, 0,
          'CONFIRMED', 'PAID', NULL, 'COUNTER'
        )
      `);
    const bBookedId = Number(bBookedRes.recordset[0].BookingId);
    createdBookingIds.push(bBookedId);

    await exec
      .request()
      .input('bookingId', sql.BigInt, bBookedId)
      .input('courtId', sql.Int, pb03Id)
      .input('s1', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '13:00')))
      .input('s2', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(testDate, '14:00')))
      .query(`
        INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
        VALUES (@bookingId, @courtId, @s1, 1), (@bookingId, @courtId, @s2, 1)
      `);

    // Anonymous caller sees HELD for PB01 11:00-13:00, BOOKED for PB03 13:00-15:00, LOCKED for PB02
    const anonRes = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: cs01Id, sportId: pickleballId, date: testDate });

    expect(anonRes.status).toBe(200);
    const bodyStr = JSON.stringify(anonRes.body);
    expect(bodyStr).not.toContain('Khách Bí Mật');
    expect(bodyStr).not.toContain('0909998877');

    const anonPb01 = anonRes.body.data.courts.find((c: { courtId: number }) => c.courtId === pb01Id);
    const anonPb02 = anonRes.body.data.courts.find((c: { courtId: number }) => c.courtId === pb02Id);
    const anonPb03 = anonRes.body.data.courts.find((c: { courtId: number }) => c.courtId === pb03Id);

    expect(anonPb01.cells.find((c: { start: string }) => c.start === '11:00')).toEqual({
      start: '11:00',
      end: '13:00',
      state: 'HELD',
      label: 'Đang giữ chỗ',
    });
    expect(anonPb02.state).toBe('MAINTENANCE');
    expect(anonPb02.cells.find((c: { start: string }) => c.start === '11:00')).toEqual({
      start: '11:00',
      end: '13:00',
      state: 'LOCKED',
      blockId,
      blockType: 'MAINTENANCE',
      reason: 'Bảo trì test',
    });
    expect(anonPb03.cells.find((c: { start: string }) => c.start === '13:00')).toEqual({
      start: '13:00',
      end: '15:00',
      state: 'BOOKED',
      label: 'Kín lịch',
    });

    // Authenticated Customer An sees MINE for their own PENDING_PAYMENT slot
    const authRes = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .set('Authorization', 'Bearer cus-an')
      .query({ branchId: cs01Id, sportId: pickleballId, date: testDate });

    expect(authRes.status).toBe(200);
    const authPb01 = authRes.body.data.courts.find((c: { courtId: number }) => c.courtId === pb01Id);
    expect(authPb01.cells.find((c: { start: string }) => c.start === '11:00')).toEqual({
      start: '11:00',
      end: '13:00',
      state: 'MINE',
      label: 'Lịch của bạn',
    });

    // Check slot that crosses into tomorrow/past boundary
    mockedNow = addDays(parseVnDateTime(testDate, '06:00:00'), 1);
    const pastRes = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: cs01Id, sportId: pickleballId, date: testDate });
    expect(pastRes.status).toBe(200);
    const pastPb01 = pastRes.body.data.courts.find((c: { courtId: number }) => c.courtId === pb01Id);
    // FREE slots are now PAST, while booked/locked slots retain their booking/block state
    expect(pastPb01.cells.find((c: { start: string }) => c.start === '13:00').state).toBe('PAST');
  });

  it('validates query params and returns 404 for unknown branch or sport', async () => {
    const badDate = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: cs01Id, sportId: pickleballId, date: '2026-02-30' });
    expect(badDate.status).toBe(400);
    expect(badDate.body.error.code).toBe('VALIDATION_ERROR');

    const missingBranch = await request(app.getHttpServer())
      .get('/api/v1/availability')
      .query({ branchId: 999999, sportId: pickleballId, date: formatDateVn(mockedNow) });
    expect(missingBranch.status).toBe(404);
    expect(missingBranch.body.error.code).toBe('NOT_FOUND');
  });
});
