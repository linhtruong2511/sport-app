import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import { type AuthenticatedUser, TOKEN_VERIFIER, type TokenVerifier } from '../../core/auth/index.js';
import { CLOCK, FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { SettingsService } from '../../core/settings.service.js';
import { addMinutes, parseVnDateTime, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { JobsModule } from '../jobs.module.js';
import { JobsService } from '../jobs.service.js';

const mockTokenVerifier: TokenVerifier = {
  async verifyAccessToken(): Promise<AuthenticatedUser> {
    throw new Error('Not used in jobs integration test');
  },
};

@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useValue: mockTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
class TestAuthModule {}

@Module({
  imports: [CoreModule, DatabaseModule, IntegrationsModule, TestAuthModule, JobsModule],
})
class JobsTestAppModule {}

describe('jobs lifecycle integration (cancelNoShows, closePaidNoShows, autoComplete, sendReminders)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let jobsService: JobsService;
  let settingsService: SettingsService;
  let systemClock: SystemClock;
  let originalClockNow: () => Date;

  // Anchor FakeClock in 2025 so seeded bookings around current date are never touched by lifecycle jobs
  const baseDate = '2025-06-15';
  const fakeClock = new FakeClock(parseVnDateTime(baseDate, '07:00'));

  let ids: {
    cs01: number;
    pb01: number;
    pb02: number;
    pb03: number;
    anId: number;
  };

  const createdBookingCodes: string[] = [];

  async function cleanupTestArtifacts(): Promise<void> {
    if (createdBookingCodes.length === 0) {
      return;
    }
    const exec = await txService.executor();
    const quoted = createdBookingCodes.map((c) => `'${c}'`).join(',');
    await exec.request().query(`
      DELETE FROM dbo.Notifications
      WHERE LinkType = 'BOOKING'
        AND LinkRef IN (SELECT CAST(BookingId AS VARCHAR(50)) FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.Payments WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.Refunds WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.PaymentRequest WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.BookingStatusHistory WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.BookingPriceLines WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.BookingSlots WHERE BookingId IN (SELECT BookingId FROM dbo.Bookings WHERE BookingCode IN (${quoted}));
      DELETE FROM dbo.Bookings WHERE BookingCode IN (${quoted});
    `);
    createdBookingCodes.length = 0;
  }

  beforeAll(async () => {
    app = await NestFactory.create(JobsTestAppModule, new ExpressAdapter(), { logger: false });
    await app.init();

    txService = app.get(DbTransactionService);
    jobsService = app.get(JobsService);
    settingsService = app.get(SettingsService);
    systemClock = app.get(CLOCK);
    originalClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    settingsService.setOverrides({
      NO_SHOW_GRACE_MINUTES: 30,
      REMINDER_BEFORE_MINUTES: 60,
    });

    const exec = await txService.executor();
    const courtsRes = await exec.request().query<{ Code: string; CourtId: number; BranchId: number }>(`
      SELECT Code, CourtId, BranchId
      FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01', 'SAN_PB_02', 'SAN_PB_03')
    `);
    const courtMap = new Map(courtsRes.recordset.map((c) => [c.Code, c]));

    const userRes = await exec.request().query<{ UserId: number | string }>(`
      SELECT UserId FROM dbo.Users WHERE Phone = '0987654321'
    `);

    ids = {
      cs01: Number(courtMap.get('SAN_PB_01')!.BranchId),
      pb01: Number(courtMap.get('SAN_PB_01')!.CourtId),
      pb02: Number(courtMap.get('SAN_PB_02')!.CourtId),
      pb03: Number(courtMap.get('SAN_PB_03')!.CourtId),
      anId: Number(userRes.recordset[0].UserId),
    };
  });

  beforeEach(() => {
    fakeClock.set(parseVnDateTime(baseDate, '07:00'));
  });

  afterAll(async () => {
    await cleanupTestArtifacts();
    settingsService.setOverrides(null);
    if (systemClock && originalClockNow) {
      systemClock.now = originalClockNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('R-04 two-branch no-show: StartAt + 30m cancels DEPOSITED only; EndAt closes PAID no-show', async () => {
    const exec = await txService.executor();
    const slotStart = parseVnDateTime(baseDate, '08:00');
    const slotEnd = parseVnDateTime(baseDate, '10:00');
    const createdAt = parseVnDateTime(baseDate, '07:00');

    const depCode = `BK20250615${Date.now().toString().slice(-4)}01`;
    const paidCode = `BK20250615${Date.now().toString().slice(-4)}02`;
    createdBookingCodes.push(depCode, paidCode);

    const depInsert = await exec
      .request()
      .input('code', sql.VarChar(20), depCode)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb01)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(createdAt))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus, CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @userId, @startAt, @endAt,
          300000, 0, 300000, 'DEPOSIT', 'PERCENT', 30, 90000,
          90000, 90000, 210000, 'CONFIRMED', 'DEPOSITED', @userId, @now, @now, 'ONLINE'
        )
      `);
    const depBookingId = Number(depInsert.recordset[0].BookingId);

    const paidInsert = await exec
      .request()
      .input('code', sql.VarChar(20), paidCode)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb02)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(createdAt))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus, CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @userId, @startAt, @endAt,
          300000, 0, 300000, 'FULL', 0,
          300000, 300000, 0, 'CONFIRMED', 'PAID', @userId, @now, @now, 'ONLINE'
        )
      `);
    const paidBookingId = Number(paidInsert.recordset[0].BookingId);

    // Insert active slots for both bookings + a PENDING REMAINING QR request on DEPOSITED booking
    await exec
      .request()
      .input('depId', sql.BigInt, depBookingId)
      .input('paidId', sql.BigInt, paidBookingId)
      .input('pb01', sql.Int, ids.pb01)
      .input('pb02', sql.Int, ids.pb02)
      .input('slot1', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('slot2', sql.DateTime2(0), toSqlDateTime(addMinutes(slotStart, 60)))
      .input('qrExp', sql.DateTime2(0), toSqlDateTime(addMinutes(slotStart, 90)))
      .input('now', sql.DateTime2(0), toSqlDateTime(createdAt))
      .input('depCode', sql.VarChar(50), `THANHTOAN ${depCode}`)
      .query(`
        INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
        VALUES
          (@depId, @pb01, @slot1, 1),
          (@depId, @pb01, @slot2, 1),
          (@paidId, @pb02, @slot1, 1),
          (@paidId, @pb02, @slot2, 1);

        INSERT INTO dbo.PaymentRequest (BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedBy, CreatedAt)
        VALUES (@depId, 'REMAINING', 210000, @depCode, 'QR_TEST', @qrExp, 'PENDING', NULL, @now);
      `);

    // At StartAt + 30': cancelNoShows cancels DEPOSITED, while PAID stays CONFIRMED
    fakeClock.set(addMinutes(slotStart, 30));

    const canceledDep = await jobsService.runCancelNoShows();
    const closedPaidEarly = await jobsService.runClosePaidNoShows();
    expect(canceledDep).toBe(1);
    expect(closedPaidEarly).toBe(0);

    const depCheck = await exec
      .request()
      .input('id', sql.BigInt, depBookingId)
      .query<{
        Status: string;
        CancelType: string | null;
        CanceledBy: number | null;
        RefundRate: number | null;
        RefundAmount: number | null;
      }>(`
        SELECT Status, CancelType, CanceledBy, RefundRate, RefundAmount
        FROM dbo.Bookings WHERE BookingId = @id
      `);
    expect(depCheck.recordset[0]).toMatchObject({
      Status: 'CANCELED',
      CancelType: 'NO_SHOW',
      CanceledBy: null,
      RefundRate: 0,
      RefundAmount: 0,
    });

    const depSlotsCheck = await exec
      .request()
      .input('id', sql.BigInt, depBookingId)
      .query<{ ActiveCount: number }>(
        'SELECT COUNT(*) AS ActiveCount FROM dbo.BookingSlots WHERE BookingId = @id AND IsActive = 1',
      );
    expect(depSlotsCheck.recordset[0].ActiveCount).toBe(0);

    const depQrCheck = await exec
      .request()
      .input('id', sql.BigInt, depBookingId)
      .query<{ Status: string }>('SELECT Status FROM dbo.PaymentRequest WHERE BookingId = @id');
    expect(depQrCheck.recordset[0].Status).toBe('CANCELED');

    const depHistCheck = await exec
      .request()
      .input('id', sql.BigInt, depBookingId)
      .query<{ ToStatus: string; ChangedBy: number | null }>(
        'SELECT ToStatus, ChangedBy FROM dbo.BookingStatusHistory WHERE BookingId = @id',
      );
    expect(depHistCheck.recordset[0]).toMatchObject({ ToStatus: 'CANCELED', ChangedBy: null });

    // PAID booking must STILL be CONFIRMED with active slots at StartAt + 30'
    const paidMidCheck = await exec
      .request()
      .input('id', sql.BigInt, paidBookingId)
      .query<{ Status: string }>('SELECT Status FROM dbo.Bookings WHERE BookingId = @id');
    expect(paidMidCheck.recordset[0].Status).toBe('CONFIRMED');

    const paidMidSlots = await exec
      .request()
      .input('id', sql.BigInt, paidBookingId)
      .query<{ ActiveCount: number }>(
        'SELECT COUNT(*) AS ActiveCount FROM dbo.BookingSlots WHERE BookingId = @id AND IsActive = 1',
      );
    expect(paidMidSlots.recordset[0].ActiveCount).toBe(2);

    // At EndAt: closePaidNoShows cancels PAID booking with NO_SHOW, RefundRate = 0
    fakeClock.set(slotEnd);
    const closedPaidAtEnd = await jobsService.runClosePaidNoShows();
    expect(closedPaidAtEnd).toBe(1);

    const paidEndCheck = await exec
      .request()
      .input('id', sql.BigInt, paidBookingId)
      .query<{
        Status: string;
        CancelType: string | null;
        CancelReason: string | null;
        CanceledBy: number | null;
        RefundRate: number | null;
        RefundAmount: number | null;
      }>(`
        SELECT Status, CancelType, CancelReason, CanceledBy, RefundRate, RefundAmount
        FROM dbo.Bookings WHERE BookingId = @id
      `);
    expect(paidEndCheck.recordset[0]).toMatchObject({
      Status: 'CANCELED',
      CancelType: 'NO_SHOW',
      CancelReason: 'Khách không tới nhận sân',
      CanceledBy: null,
      RefundRate: 0,
      RefundAmount: 0,
    });

    const paidEndSlots = await exec
      .request()
      .input('id', sql.BigInt, paidBookingId)
      .query<{ ActiveCount: number }>(
        'SELECT COUNT(*) AS ActiveCount FROM dbo.BookingSlots WHERE BookingId = @id AND IsActive = 1',
      );
    expect(paidEndSlots.recordset[0].ActiveCount).toBe(0);

    // Idempotent second run
    expect(await jobsService.runCancelNoShows()).toBe(0);
    expect(await jobsService.runClosePaidNoShows()).toBe(0);
  });

  it('autoComplete: completes IN_USE booking at EndAt and sets CheckedOutAt', async () => {
    const exec = await txService.executor();
    const slotStart = parseVnDateTime(baseDate, '11:00');
    const slotEnd = parseVnDateTime(baseDate, '12:00');
    const code = `BK20250615${Date.now().toString().slice(-4)}03`;
    createdBookingCodes.push(code);

    const insertRes = await exec
      .request()
      .input('code', sql.VarChar(20), code)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb03)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('checkedInAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('now', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(baseDate, '07:00')))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus,
          CheckedInAt, CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @userId, @startAt, @endAt,
          150000, 0, 150000, 'FULL', 0,
          150000, 150000, 0, 'IN_USE', 'PAID',
          @checkedInAt, @userId, @now, @now, 'ONLINE'
        )
      `);
    const bookingId = Number(insertRes.recordset[0].BookingId);

    // Before EndAt -> nothing completed
    fakeClock.set(addMinutes(slotEnd, -5));
    expect(await jobsService.runAutoComplete()).toBe(0);

    // At EndAt -> COMPLETED + CheckedOutAt set
    fakeClock.set(slotEnd);
    expect(await jobsService.runAutoComplete()).toBe(1);

    const checkRes = await exec
      .request()
      .input('id', sql.BigInt, bookingId)
      .query<{ Status: string; CheckedOutAt: Date | null }>(
        'SELECT Status, CheckedOutAt FROM dbo.Bookings WHERE BookingId = @id',
      );
    expect(checkRes.recordset[0].Status).toBe('COMPLETED');
    expect(checkRes.recordset[0].CheckedOutAt).not.toBeNull();

    const histRes = await exec
      .request()
      .input('id', sql.BigInt, bookingId)
      .query<{ FromStatus: string; ToStatus: string; ChangedBy: number | null }>(
        'SELECT FromStatus, ToStatus, ChangedBy FROM dbo.BookingStatusHistory WHERE BookingId = @id',
      );
    expect(histRes.recordset[0]).toMatchObject({
      FromStatus: 'IN_USE',
      ToStatus: 'COMPLETED',
      ChangedBy: null,
    });

    // Idempotent second run
    expect(await jobsService.runAutoComplete()).toBe(0);
  });

  it('sendReminders: creates REMINDER notification with court, branch address, time, remaining amount and is idempotent', async () => {
    const exec = await txService.executor();
    const slotStart = parseVnDateTime(baseDate, '14:00');
    const slotEnd = parseVnDateTime(baseDate, '16:00');
    const code = `BK20250615${Date.now().toString().slice(-4)}04`;
    createdBookingCodes.push(code);

    const insertRes = await exec
      .request()
      .input('code', sql.VarChar(20), code)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb01)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(baseDate, '07:00')))
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus,
          CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @userId, @startAt, @endAt,
          300000, 0, 300000, 'DEPOSIT', 'PERCENT', 30, 90000,
          90000, 90000, 210000, 'CONFIRMED', 'DEPOSITED',
          @userId, @now, @now, 'ONLINE'
        )
      `);
    const bookingId = Number(insertRes.recordset[0].BookingId);

    const courtInfoRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .query<{ CourtName: string; BranchName: string; BranchAddress: string }>(`
        SELECT c.Name AS CourtName, br.Name AS BranchName, br.Address AS BranchAddress
        FROM dbo.Courts c
        INNER JOIN dbo.Branches br ON br.BranchId = c.BranchId
        WHERE c.CourtId = @courtId
      `);
    const courtInfo = courtInfoRes.recordset[0];

    // 45 minutes before StartAt -> inside 60-minute reminder window
    fakeClock.set(addMinutes(slotStart, -45));
    const sent1 = await jobsService.runSendReminders();
    expect(sent1).toBe(1);

    const notifRes = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(bookingId))
      .query<{ Type: string; Title: string; Body: string }>(`
        SELECT Type, Title, Body
        FROM dbo.Notifications
        WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef
      `);
    expect(notifRes.recordset).toHaveLength(1);
    const notif = notifRes.recordset[0];
    expect(notif.Type).toBe('REMINDER');
    expect(notif.Title).toBe('⏰ Nhắc lịch chơi sắp bắt đầu');
    expect(notif.Body).toContain(courtInfo.CourtName);
    expect(notif.Body).toContain(courtInfo.BranchAddress);
    expect(notif.Body).toContain('14:00–16:00');
    expect(notif.Body).toContain((210000).toLocaleString('vi-VN') + ' VNĐ');

    const remCheck = await exec
      .request()
      .input('id', sql.BigInt, bookingId)
      .query<{ ReminderSentAt: Date | null }>(
        'SELECT ReminderSentAt FROM dbo.Bookings WHERE BookingId = @id',
      );
    expect(remCheck.recordset[0].ReminderSentAt).not.toBeNull();

    // Second run must be idempotent (0 duplicates)
    const sent2 = await jobsService.runSendReminders();
    expect(sent2).toBe(0);

    const notifCountAfter = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(bookingId))
      .query<{ Cnt: number }>(
        "SELECT COUNT(*) AS Cnt FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef",
      );
    expect(notifCountAfter.recordset[0].Cnt).toBe(1);
  });
});
