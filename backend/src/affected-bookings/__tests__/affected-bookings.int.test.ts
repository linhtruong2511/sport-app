import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../core/auth/index.js';
import { FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppError, AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { RealtimeService } from '../../core/realtime/realtime.service.js';
import { parseVnDateTime, toSqlDate, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AffectedBookingsModule } from '../affected-bookings.module.js';

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
  imports: [CoreModule, DatabaseModule, TestAuthModule, AffectedBookingsModule],
})
class AffectedBookingsTestAppModule {}

describe('affected-bookings integration (API 36–39)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(parseVnDateTime('2026-12-10', '08:00:00'));
  let emittedEvents: EmittedEvent[] = [];

  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    pb02: number;
    pb03: number;
    pb04: number;
    cl01: number;
    bd02: number;
    bd03: number;
    ownerId: number;
    anId: number;
  };

  let originalCs01Day1: { OpenTime: string | null; CloseTime: string | null; IsClosed: boolean };
  let restoreOpeningHours = false;
  let restoreCourtInactive: number | null = null;

  const createdBookingIds: number[] = [];
  const createdBlockIds: number[] = [];
  const createdHolidayIds: number[] = [];
  const createdPromoIds: number[] = [];

  async function seedBooking(opts: {
    code: string;
    branchId: number;
    courtId: number;
    date: string;
    startTime: string;
    endTime: string;
    status?: 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_USE' | 'CANCELED';
    paymentOption?: 'FULL' | 'DEPOSIT';
    totalAmount?: number;
    depositAmount?: number;
    paidAmount?: number;
    promotionCode?: string | null;
    customerUserId?: number | null;
    withPendingPaymentRequest?: boolean;
  }): Promise<{ bookingId: number; version: string }> {
    const exec = await txService.executor();
    const startAt = parseVnDateTime(opts.date, opts.startTime);
    const endAt = parseVnDateTime(opts.date, opts.endTime);
    const now = fakeClock.now();
    const status = opts.status ?? 'CONFIRMED';
    const paymentOption = opts.paymentOption ?? 'FULL';
    const totalAmount = opts.totalAmount ?? 300000;
    const depositAmount = opts.depositAmount ?? (paymentOption === 'DEPOSIT' ? 90000 : 0);
    const paidAmount = opts.paidAmount ?? (status === 'CONFIRMED' ? totalAmount : 0);
    const remainingAmount = totalAmount - paidAmount;
    const paymentStatus =
      paidAmount === 0 ? 'UNPAID' : remainingAmount === 0 ? 'PAID' : 'DEPOSITED';
    const amountDueNow = paymentOption === 'DEPOSIT' ? depositAmount : totalAmount;
    const holdExpireAt = status === 'PENDING_PAYMENT' ? new Date(now.getTime() + 600_000) : null;
    const customerUserId = opts.customerUserId === undefined ? ids.anId : opts.customerUserId;

    const res = await exec
      .request()
      .input('code', sql.VarChar(20), opts.code)
      .input('branchId', sql.Int, opts.branchId)
      .input('courtId', sql.Int, opts.courtId)
      .input('customerUserId', sql.BigInt, customerUserId)
      .input('guestName', sql.NVarChar(100), customerUserId === null ? 'Khách Vãng Lai' : null)
      .input('guestPhone', sql.VarChar(10), customerUserId === null ? '0901112233' : null)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('baseAmount', sql.Decimal(18, 0), totalAmount)
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .input('paymentOption', sql.VarChar(10), paymentOption)
      .input('depositType', sql.VarChar(10), 'PERCENT')
      .input('depositValue', sql.Decimal(18, 2), 30)
      .input('depositAmount', sql.Decimal(18, 0), depositAmount)
      .input('amountDueNow', sql.Decimal(18, 0), amountDueNow)
      .input('paidAmount', sql.Decimal(18, 0), paidAmount)
      .input('remainingAmount', sql.Decimal(18, 0), remainingAmount)
      .input('status', sql.VarChar(20), status)
      .input('paymentStatus', sql.VarChar(20), paymentStatus)
      .input('holdExpireAt', sql.DateTime2(0), holdExpireAt ? toSqlDateTime(holdExpireAt) : null)
      .input('promoCode', sql.VarChar(20), opts.promotionCode ?? null)
      .input('cancelType', sql.VarChar(20), status === 'CANCELED' ? 'CUSTOMER_REQUEST' : null)
      .input('cancelReason', sql.NVarChar(255), status === 'CANCELED' ? 'Đã hủy' : null)
      .input('canceledAt', sql.DateTime2(0), status === 'CANCELED' ? toSqlDateTime(now) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .query<{ BookingId: number | string; RowVer: Buffer }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone,
          StartAt, EndAt, BaseAmount, DiscountAmount, TotalAmount,
          PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, PromotionCode,
          CancelType, CancelReason, CanceledAt, ReminderSentAt,
          CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId, inserted.RowVer
        VALUES (
          @code, @branchId, @courtId, @customerUserId, @guestName, @guestPhone,
          @startAt, @endAt, @baseAmount, 0, @totalAmount,
          @paymentOption, @depositType, @depositValue, @depositAmount,
          @amountDueNow, @paidAmount, @remainingAmount,
          @status, @paymentStatus, @holdExpireAt, @promoCode,
          @cancelType, @cancelReason, @canceledAt, @now,
          @customerUserId, @now, @now, 'ONLINE'
        )
      `);

    const bookingId = Number(res.recordset[0].BookingId);
    const version = res.recordset[0].RowVer.toString('base64');
    createdBookingIds.push(bookingId);

    if (status !== 'CANCELED') {
      // 1-hour slots for pickleball/tennis or 30-min for badminton/football
      for (let ms = startAt.getTime(); ms < endAt.getTime(); ms += 3_600_000) {
        await exec
          .request()
          .input('bookingId', sql.BigInt, bookingId)
          .input('courtId', sql.Int, opts.courtId)
          .input('slotStart', sql.DateTime2(0), toSqlDateTime(new Date(ms)))
          .query(`
            INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
            VALUES (@bookingId, @courtId, @slotStart, 1)
          `);
      }
    }

    if (opts.withPendingPaymentRequest) {
      await exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .input('purpose', sql.VarChar(20), paymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL')
        .input('amount', sql.Decimal(18, 0), amountDueNow)
        .input('content', sql.VarChar(50), `THANHTOAN ${opts.code}`)
        .input('expiresAt', sql.DateTime2(0), toSqlDateTime(new Date(now.getTime() + 600_000)))
        .input('now', sql.DateTime2(0), toSqlDateTime(now))
        .query(`
          INSERT INTO dbo.PaymentRequest (
            BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedAt
          )
          VALUES (
            @bookingId, @purpose, @amount, @content, 'DEMO_QR', @expiresAt, 'PENDING', @now
          )
        `);
    }

    return { bookingId, version };
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

    if (createdHolidayIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.BranchHolidays WHERE HolidayId IN (${createdHolidayIds.join(',')});
      `);
      createdHolidayIds.length = 0;
    }

    if (createdPromoIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.Promotions WHERE PromotionId IN (${createdPromoIds.join(',')});
      `);
      createdPromoIds.length = 0;
    }

    if (restoreOpeningHours) {
      await exec
        .request()
        .input('branchId', sql.Int, ids.cs01)
        .input('openTime', sql.VarChar(8), originalCs01Day1.OpenTime)
        .input('closeTime', sql.VarChar(8), originalCs01Day1.CloseTime)
        .input('isClosed', sql.Bit, originalCs01Day1.IsClosed ? 1 : 0)
        .query(`
          UPDATE dbo.BranchOpeningHours
          SET OpenTime = CASE WHEN @openTime IS NULL THEN NULL ELSE CAST(@openTime AS TIME(0)) END,
              CloseTime = CASE WHEN @closeTime IS NULL THEN NULL ELSE CAST(@closeTime AS TIME(0)) END,
              IsClosed = @isClosed
          WHERE BranchId = @branchId AND DayOfWeek = 1
        `);
      restoreOpeningHours = false;
    }

    if (restoreCourtInactive !== null) {
      await exec
        .request()
        .input('courtId', sql.Int, restoreCourtInactive)
        .query(`UPDATE dbo.Courts SET Status = 'ACTIVE' WHERE CourtId = @courtId`);
      restoreCourtInactive = null;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(AffectedBookingsTestAppModule, new ExpressAdapter(), {
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

    const courtsRes = await exec.request().query<{ Code: string; CourtId: number }>(`
      SELECT Code, CourtId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_PB_02','SAN_PB_03','SAN_PB_04','SAN_CL_01','SAN_BD_02','SAN_BD_03')
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
      WHERE Phone IN ('0900000001', '0933445577', '0933445566', '0987654321')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));
    const owner = userMap.get('0900000001')!;
    const staffCs01 = userMap.get('0933445577')!;
    const staffCs02 = userMap.get('0933445566')!;
    const cus = userMap.get('0987654321')!;

    ids = {
      cs01: branchMap.get('CS01')!,
      cs02: branchMap.get('CS02')!,
      pb01: courtMap.get('SAN_PB_01')!,
      pb02: courtMap.get('SAN_PB_02')!,
      pb03: courtMap.get('SAN_PB_03')!,
      pb04: courtMap.get('SAN_PB_04')!,
      cl01: courtMap.get('SAN_CL_01')!,
      bd02: courtMap.get('SAN_BD_02')!,
      bd03: courtMap.get('SAN_BD_03')!,
      ownerId: Number(owner.UserId),
      anId: Number(cus.UserId),
    };

    seededUsers = {
      owner: { userId: ids.ownerId, role: 'OWNER', branchId: null, tv: owner.TokenVersion },
      staffCs01: {
        userId: Number(staffCs01.UserId),
        role: 'STAFF',
        branchId: Number(staffCs01.BranchId),
        tv: staffCs01.TokenVersion,
      },
      staffCs02: {
        userId: Number(staffCs02.UserId),
        role: 'STAFF',
        branchId: Number(staffCs02.BranchId),
        tv: staffCs02.TokenVersion,
      },
      customer: { userId: ids.anId, role: 'CUSTOMER', branchId: null, tv: cus.TokenVersion },
    };

    const ohRes = await exec
      .request()
      .input('branchId', sql.Int, ids.cs01)
      .query<{
        OpenTime: string | null;
        CloseTime: string | null;
        IsClosed: boolean | number;
      }>(`
        SELECT CONVERT(VARCHAR(8), OpenTime, 108) AS OpenTime,
               CONVERT(VARCHAR(8), CloseTime, 108) AS CloseTime,
               IsClosed
        FROM dbo.BranchOpeningHours
        WHERE BranchId = @branchId AND DayOfWeek = 1
      `);
    originalCs01Day1 = {
      OpenTime: ohRes.recordset[0].OpenTime ? String(ohRes.recordset[0].OpenTime) : null,
      CloseTime: ohRes.recordset[0].CloseTime ? String(ohRes.recordset[0].CloseTime) : null,
      IsClosed: Boolean(ohRes.recordset[0].IsClosed),
    };
  });

  beforeEach(() => {
    fakeClock.set(parseVnDateTime('2026-12-10', '08:00:00'));
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

  it('API-36: detects all 4 affectedReasons and enforces branchScope + RBAC', async () => {
    const unauth = await request(app.getHttpServer()).get('/api/v1/affected-bookings');
    expect(unauth.status).toBe(401);

    const cusRes = await request(app.getHttpServer())
      .get('/api/v1/affected-bookings')
      .set('Authorization', 'Bearer customer');
    expect(cusRes.status).toBe(403);

    const exec = await txService.executor();

    // 1. COURT_BLOCK on PB01 (2026-12-15 10:00-12:00)
    await seedBooking({
      code: 'BK2026121001',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-15',
      startTime: '10:00',
      endTime: '12:00',
    });
    const blkRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-15', '09:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-15', '13:00')))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ BlockId: number | string }>(`
        INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy)
        OUTPUT inserted.BlockId
        VALUES (@courtId, 'MAINTENANCE', @startAt, @endAt, N'Sửa đèn sân', @createdBy)
      `);
    createdBlockIds.push(Number(blkRes.recordset[0].BlockId));

    // 2. HOLIDAY on CS01 (2026-12-20)
    await seedBooking({
      code: 'BK2026121002',
      branchId: ids.cs01,
      courtId: ids.pb03,
      date: '2026-12-20',
      startTime: '09:00',
      endTime: '10:00',
    });
    const holRes = await exec
      .request()
      .input('branchId', sql.Int, ids.cs01)
      .input('date', sql.Date, toSqlDate('2026-12-20'))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ HolidayId: number }>(`
        INSERT INTO dbo.BranchHolidays (BranchId, StartDate, EndDate, Reason, CreatedBy)
        OUTPUT inserted.HolidayId
        VALUES (@branchId, @date, @date, N'Bảo trì toàn cơ sở', @createdBy)
      `);
    createdHolidayIds.push(Number(holRes.recordset[0].HolidayId));

    // 3. OPENING_HOURS on CS01 Monday (2026-12-14 is Monday)
    await seedBooking({
      code: 'BK2026121003',
      branchId: ids.cs01,
      courtId: ids.pb03,
      date: '2026-12-14',
      startTime: '21:00',
      endTime: '22:00',
    });
    restoreOpeningHours = true;
    await exec
      .request()
      .input('branchId', sql.Int, ids.cs01)
      .query(`
        UPDATE dbo.BranchOpeningHours
        SET CloseTime = CAST('20:00:00' AS TIME(0))
        WHERE BranchId = @branchId AND DayOfWeek = 1
      `);

    // 4. COURT_INACTIVE on CS02 (PB04 set INACTIVE)
    await seedBooking({
      code: 'BK2026121004',
      branchId: ids.cs02,
      courtId: ids.pb04,
      date: '2026-12-16',
      startTime: '10:00',
      endTime: '11:00',
    });
    restoreCourtInactive = ids.pb04;
    await exec
      .request()
      .input('courtId', sql.Int, ids.pb04)
      .query(`UPDATE dbo.Courts SET Status = 'INACTIVE' WHERE CourtId = @courtId`);

    // 5. Past booking & CANCELED booking should NOT appear
    await seedBooking({
      code: 'BK2026121005',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-09',
      startTime: '10:00',
      endTime: '11:00',
    });
    await seedBooking({
      code: 'BK2026121006',
      branchId: ids.cs01,
      courtId: ids.pb03,
      date: '2026-12-20',
      startTime: '15:00',
      endTime: '16:00',
      status: 'CANCELED',
    });

    // OWNER sees all 4
    const ownerRes = await request(app.getHttpServer())
      .get('/api/v1/affected-bookings')
      .set('Authorization', 'Bearer owner');
    expect(ownerRes.status).toBe(200);
    const byCode = new Map<string, { affectedReasons: Array<{ type: string }>; allowedActions: string[] }>(
      ownerRes.body.data.map((b: { bookingCode: string; affectedReasons: Array<{ type: string }>; allowedActions: string[] }) => [
        b.bookingCode,
        b,
      ]),
    );
    expect(byCode.get('BK2026121001')?.affectedReasons.map((r) => r.type)).toContain('COURT_BLOCK');
    expect(byCode.get('BK2026121002')?.affectedReasons.map((r) => r.type)).toContain('HOLIDAY');
    expect(byCode.get('BK2026121003')?.affectedReasons.map((r) => r.type)).toContain('OPENING_HOURS');
    expect(byCode.get('BK2026121004')?.affectedReasons.map((r) => r.type)).toContain('COURT_INACTIVE');
    expect(byCode.get('BK2026121001')?.allowedActions).toEqual(
      expect.arrayContaining(['REASSIGN', 'CLOSE_BY_FACILITY']),
    );
    expect(byCode.has('BK2026121005')).toBe(false);
    expect(byCode.has('BK2026121006')).toBe(false);

    // STAFF CS01 querying ?branchId=CS02 is forced to CS01 and never sees CS02 booking
    const staffCs01Res = await request(app.getHttpServer())
      .get('/api/v1/affected-bookings')
      .query({ branchId: ids.cs02 })
      .set('Authorization', 'Bearer staffCs01');
    expect(staffCs01Res.status).toBe(200);
    const staffCodes = staffCs01Res.body.data.map((b: { bookingCode: string }) => b.bookingCode);
    expect(staffCodes).toContain('BK2026121001');
    expect(staffCodes).not.toContain('BK2026121004');

    // STAFF CS01 accessing CS02 booking -> 403 BRANCH_FORBIDDEN
    const forbiddenOpt = await request(app.getHttpServer())
      .get('/api/v1/affected-bookings/BK2026121004/reassign-options')
      .set('Authorization', 'Bearer staffCs01');
    expect(forbiddenOpt.status).toBe(403);
    expect(forbiddenOpt.body.error.code).toBe('BRANCH_FORBIDDEN');
  });

  it('API-37 & API-38: lists reassign options and reassigns booking preserving money, creating transfer/notification/sockets, and enforcing SLOT_TAKEN / DURATION_MISMATCH / INVALID_TARGET_COURT', async () => {
    const exec = await txService.executor();

    // Booking to reassign: PB01 2026-12-16 14:00-16:00 (2h, DEPOSITED 90k of 300k)
    const { bookingId, version } = await seedBooking({
      code: 'BK2026121010',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-16',
      startTime: '14:00',
      endTime: '16:00',
      status: 'CONFIRMED',
      paymentOption: 'DEPOSIT',
      totalAmount: 300000,
      depositAmount: 90000,
      paidAmount: 90000,
    });

    // Block PB01 so BK2026121010 is affected
    const blkRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-16', '13:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-16', '17:00')))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ BlockId: number | string }>(`
        INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy)
        OUTPUT inserted.BlockId
        VALUES (@courtId, 'MAINTENANCE', @startAt, @endAt, N'Bảo trì PB01', @createdBy)
      `);
    createdBlockIds.push(Number(blkRes.recordset[0].BlockId));

    // Occupy PB02 in 14:00-16:00 so only PB03 is free at 14:00-16:00
    await seedBooking({
      code: 'BK2026121011',
      branchId: ids.cs01,
      courtId: ids.pb02,
      date: '2026-12-16',
      startTime: '14:00',
      endTime: '16:00',
    });

    // 1. API-37 reassign-options
    const optRes = await request(app.getHttpServer())
      .get('/api/v1/affected-bookings/BK2026121010/reassign-options')
      .set('Authorization', 'Bearer staffCs01');
    expect(optRes.status).toBe(200);
    expect(optRes.body.data.durationMinutes).toBe(120);
    expect(optRes.body.data.timeOptions.length).toBeGreaterThan(0);
    expect(optRes.body.data.courts.map((c: { courtId: number }) => c.courtId)).toEqual([ids.pb03]);

    // 2. DURATION_MISMATCH (1h instead of 2h)
    const durErr = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.pb03,
        date: '2026-12-16',
        startTime: '14:00',
        endTime: '15:00',
        version,
      });
    expect(durErr.status).toBe(422);
    expect(durErr.body.error.code).toBe('DURATION_MISMATCH');

    // 3. INVALID_TARGET_COURT (different sport CL01, or different branch PB04)
    const wrongSport = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.cl01,
        date: '2026-12-16',
        startTime: '14:00',
        endTime: '16:00',
        version,
      });
    expect(wrongSport.status).toBe(422);
    expect(wrongSport.body.error.code).toBe('INVALID_TARGET_COURT');

    const wrongBranch = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.pb04,
        date: '2026-12-16',
        startTime: '14:00',
        endTime: '16:00',
        version,
      });
    expect(wrongBranch.status).toBe(422);
    expect(wrongBranch.body.error.code).toBe('INVALID_TARGET_COURT');

    // 4. SLOT_TAKEN (PB02 already occupied 14:00-16:00)
    const slotTaken = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.pb02,
        date: '2026-12-16',
        startTime: '14:00',
        endTime: '16:00',
        version,
      });
    expect(slotTaken.status).toBe(409);
    expect(slotTaken.body.error.code).toBe('SLOT_TAKEN');

    // 5. Valid reassign to PB03 16:00-18:00 (2h, different price band in rules, money must remain untouched!)
    const okRes = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.pb03,
        date: '2026-12-16',
        startTime: '16:00',
        endTime: '18:00',
        note: 'Chuyển sang sân 03 do bảo trì',
        version,
      });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.booking.bookingCode).toBe('BK2026121010');
    expect(okRes.body.data.booking.courtId).toBe(ids.pb03);
    expect(okRes.body.data.booking.startTime).toBe('16:00');
    expect(okRes.body.data.booking.endTime).toBe('18:00');
    expect(okRes.body.data.booking.totalAmount).toBe(300000);
    expect(okRes.body.data.booking.deposit.amount).toBe(90000);
    expect(okRes.body.data.booking.paidAmount).toBe(90000);
    expect(okRes.body.data.booking.remainingAmount).toBe(210000);
    expect(okRes.body.data.transfer.oldCourtName).toBe('Sân Pickleball 01');
    expect(okRes.body.data.transfer.newCourtName).toBe('Sân Pickleball 03');

    // Verify DB: BookingTransfers, BookingSlots, ReminderSentAt=NULL, Notifications(SCHEDULE_CHANGE)
    const dbCheck = await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<{ ReminderSentAt: Date | null }>(`
        SELECT ReminderSentAt FROM dbo.Bookings WHERE BookingId = @bookingId
      `);
    expect(dbCheck.recordset[0].ReminderSentAt).toBeNull();

    const transfersRes = await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<{ OldCourtId: number; NewCourtId: number; Note: string | null }>(`
        SELECT OldCourtId, NewCourtId, Note FROM dbo.BookingTransfers WHERE BookingId = @bookingId
      `);
    expect(transfersRes.recordset).toHaveLength(1);
    expect(transfersRes.recordset[0].OldCourtId).toBe(ids.pb01);
    expect(transfersRes.recordset[0].NewCourtId).toBe(ids.pb03);

    const slotsRes = await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<{ CourtId: number; IsActive: boolean | number }>(`
        SELECT CourtId, IsActive FROM dbo.BookingSlots WHERE BookingId = @bookingId
      `);
    expect(slotsRes.recordset.filter((s) => Boolean(s.IsActive))).toHaveLength(2);
    expect(
      slotsRes.recordset.filter((s) => Boolean(s.IsActive)).every((s) => s.CourtId === ids.pb03),
    ).toBe(true);
    expect(
      slotsRes.recordset.filter((s) => !s.IsActive).every((s) => s.CourtId === ids.pb01),
    ).toBe(true);

    const notifRes = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(bookingId))
      .query<{ Type: string }>(`
        SELECT Type FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef
      `);
    expect(notifRes.recordset.some((n) => n.Type === 'SCHEDULE_CHANGE')).toBe(true);

    // Verify socket events for old FREE + new BOOKED + booking.updated
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'slot.updated' &&
          (e.payload as { courtId: number; state: string }).courtId === ids.pb01 &&
          (e.payload as { state: string }).state === 'FREE',
      ),
    ).toBe(true);
    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'slot.updated' &&
          (e.payload as { courtId: number; state: string }).courtId === ids.pb03 &&
          (e.payload as { state: string }).state === 'BOOKED',
      ),
    ).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'booking.updated')).toBe(true);

    // 6. Stale version on second reassign -> 409 BOOKING_STATE_CHANGED
    const staleRes = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121010/reassign')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        newCourtId: ids.pb02,
        date: '2026-12-16',
        startTime: '18:00',
        endTime: '20:00',
        version,
      });
    expect(staleRes.status).toBe(409);
    expect(staleRes.body.error.code).toBe('BOOKING_STATE_CHANGED');
  });

  it('API-39: closes BY_FACILITY refunding 100% incl. deposit, and decrements promo UsedCount only when unpaid', async () => {
    const exec = await txService.executor();

    // Seed promo with UsedCount = 2
    const promoRes = await exec
      .request()
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ PromotionId: number }>(`
        INSERT INTO dbo.Promotions (
          Code, Name, DiscountType, DiscountValue, AllBranches, AllSports,
          StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, NotifyStatus, CreatedBy
        )
        OUTPUT inserted.PromotionId
        VALUES (
          'AFFTEST20', N'Khuyến mãi test đóng đơn', 'FIXED', 20000, 1, 1,
          '2026-01-01', '2027-12-31', 'ALL', 100, 2, 'ACTIVE', 'NONE', @createdBy
        )
      `);
    const promoId = Number(promoRes.recordset[0].PromotionId);
    createdPromoIds.push(promoId);

    // Block PB01 on 2026-12-17
    const blkRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-17', '08:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime('2026-12-17', '20:00')))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ BlockId: number | string }>(`
        INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy)
        OUTPUT inserted.BlockId
        VALUES (@courtId, 'MAINTENANCE', @startAt, @endAt, N'Sửa chữa khẩn cấp', @createdBy)
      `);
    createdBlockIds.push(Number(blkRes.recordset[0].BlockId));

    // Booking 1: CONFIRMED + DEPOSITED (90k paid of 300k, promo AFFTEST20)
    const bDep = await seedBooking({
      code: 'BK2026121020',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-17',
      startTime: '09:00',
      endTime: '11:00',
      status: 'CONFIRMED',
      paymentOption: 'DEPOSIT',
      totalAmount: 300000,
      depositAmount: 90000,
      paidAmount: 90000,
      promotionCode: 'AFFTEST20',
    });

    // Booking 2: PENDING_PAYMENT (PaidAmount = 0, promo AFFTEST20, with PENDING QR)
    const bUnpaid = await seedBooking({
      code: 'BK2026121021',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2026-12-17',
      startTime: '14:00',
      endTime: '16:00',
      status: 'PENDING_PAYMENT',
      paymentOption: 'FULL',
      totalAmount: 300000,
      depositAmount: 0,
      paidAmount: 0,
      promotionCode: 'AFFTEST20',
      withPendingPaymentRequest: true,
    });

    // 1. Stale version -> 409
    const staleClose = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121020/close')
      .set('Authorization', 'Bearer staffCs01')
      .send({ version: 'AAAAAAAAAQE=' });
    expect(staleClose.status).toBe(409);
    expect(staleClose.body.error.code).toBe('BOOKING_STATE_CHANGED');

    // 2. Close DEPOSITED booking -> 100% refund of deposit (90,000), promo UsedCount stays 2
    const closeDepRes = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121020/close')
      .set('Authorization', 'Bearer staffCs01')
      .send({
        note: 'Khách đồng ý hoàn tiền',
        version: bDep.version,
      });
    expect(closeDepRes.status).toBe(200);
    expect(closeDepRes.body.data.status).toBe('CANCELED');
    expect(closeDepRes.body.data.cancelType).toBe('BY_FACILITY');
    expect(closeDepRes.body.data.refund).toMatchObject({
      amount: 90000,
      rate: 100,
      status: 'PENDING',
    });

    const promoAfterPaidClose = await exec
      .request()
      .input('promoId', sql.Int, promoId)
      .query<{ UsedCount: number }>(`SELECT UsedCount FROM dbo.Promotions WHERE PromotionId = @promoId`);
    expect(promoAfterPaidClose.recordset[0].UsedCount).toBe(2);

    const dbDep = await exec
      .request()
      .input('bookingId', sql.BigInt, bDep.bookingId)
      .query<{ CancelType: string; RefundRate: number; RefundAmount: number }>(`
        SELECT CancelType, RefundRate, RefundAmount FROM dbo.Bookings WHERE BookingId = @bookingId
      `);
    expect(dbDep.recordset[0]).toMatchObject({
      CancelType: 'BY_FACILITY',
      RefundRate: 100,
      RefundAmount: 90000,
    });

    // 3. Close UNPAID booking -> no Refund row, QR CANCELED, promo UsedCount decremented from 2 -> 1
    const closeUnpaidRes = await request(app.getHttpServer())
      .post('/api/v1/affected-bookings/BK2026121021/close')
      .set('Authorization', 'Bearer owner')
      .send({
        version: bUnpaid.version,
      });
    expect(closeUnpaidRes.status).toBe(200);
    expect(closeUnpaidRes.body.data.status).toBe('CANCELED');
    expect(closeUnpaidRes.body.data.cancelType).toBe('BY_FACILITY');
    expect(closeUnpaidRes.body.data.refund).toBeNull();

    const promoAfterUnpaidClose = await exec
      .request()
      .input('promoId', sql.Int, promoId)
      .query<{ UsedCount: number }>(`SELECT UsedCount FROM dbo.Promotions WHERE PromotionId = @promoId`);
    expect(promoAfterUnpaidClose.recordset[0].UsedCount).toBe(1);

    const qrRes = await exec
      .request()
      .input('bookingId', sql.BigInt, bUnpaid.bookingId)
      .query<{ Status: string }>(`SELECT Status FROM dbo.PaymentRequest WHERE BookingId = @bookingId`);
    expect(qrRes.recordset[0].Status).toBe('CANCELED');

    const slotsRes = await exec
      .request()
      .input('bookingId', sql.BigInt, bUnpaid.bookingId)
      .query<{ IsActive: boolean | number }>(`SELECT IsActive FROM dbo.BookingSlots WHERE BookingId = @bookingId`);
    expect(slotsRes.recordset.every((s) => !s.IsActive)).toBe(true);

    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'slot.updated' &&
          (e.payload as { state: string }).state === 'FREE',
      ),
    ).toBe(true);
  });
});
