import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
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
import { parseVnDateTime, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { DashboardModule } from '../dashboard.module.js';

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

@Global()
@Module({
  providers: [{ provide: TOKEN_VERIFIER, useValue: mockTokenVerifier }],
  exports: [TOKEN_VERIFIER],
})
class TestAuthModule {}

@Module({
  imports: [CoreModule, DatabaseModule, TestAuthModule, DashboardModule],
})
class DashboardTestAppModule {}

describe('dashboard integration (API 40–41)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(parseVnDateTime('2027-05-10', '09:35:00'));

  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    pb02: number;
    pb03: number;
    cl01: number;
    bd03: number;
    ownerId: number;
    staffCs01Id: number;
    anId: number;
  };

  const createdBookingIds: number[] = [];
  const createdBlockIds: number[] = [];

  async function seedBooking(opts: {
    code: string;
    branchId: number;
    courtId: number;
    date: string;
    startTime: string;
    endTime: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_USE' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
    channel?: 'ONLINE' | 'COUNTER';
    paymentOption?: 'FULL' | 'DEPOSIT';
    totalAmount: number;
    depositAmount?: number;
    paidAmount: number;
    cancelType?: 'CUSTOMER_REQUEST' | 'NO_SHOW' | 'BY_FACILITY' | 'COUNTER_ABORT' | null;
    canceledAt?: Date | null;
    refundRate?: number | null;
    refundAmount?: number | null;
    payments?: Array<{
      code: string;
      purpose: 'DEPOSIT' | 'FULL' | 'REMAINING';
      method: 'CASH' | 'BANK_TRANSFER';
      channel: 'ONLINE' | 'COUNTER';
      amount: number;
      paidAt: Date;
    }>;
  }): Promise<number> {
    const exec = await txService.executor();
    const startAt = parseVnDateTime(opts.date, opts.startTime);
    const endAt = parseVnDateTime(opts.date, opts.endTime);
    const now = fakeClock.now();
    const paymentOption = opts.paymentOption ?? 'FULL';
    const depositAmount = opts.depositAmount ?? (paymentOption === 'DEPOSIT' ? Math.round(opts.totalAmount * 0.3) : 0);
    const amountDueNow = paymentOption === 'DEPOSIT' ? depositAmount : opts.totalAmount;
    const remainingAmount = opts.totalAmount - opts.paidAmount;
    const paymentStatus =
      opts.paidAmount === 0 ? 'UNPAID' : remainingAmount === 0 ? 'PAID' : 'DEPOSITED';
    const holdExpireAt = opts.status === 'PENDING_PAYMENT' ? new Date(now.getTime() + 600_000) : null;
    const checkedInAt =
      opts.status === 'IN_USE' || opts.status === 'COMPLETED' ? startAt : null;
    const checkedOutAt = opts.status === 'COMPLETED' ? endAt : null;
    const cancelType = opts.status === 'CANCELED' ? (opts.cancelType ?? 'CUSTOMER_REQUEST') : null;
    const cancelReason = opts.status === 'CANCELED' ? 'Test cancel' : null;
    const canceledAt = opts.status === 'CANCELED' ? (opts.canceledAt ?? now) : null;

    const res = await exec
      .request()
      .input('code', sql.VarChar(20), opts.code)
      .input('branchId', sql.Int, opts.branchId)
      .input('courtId', sql.Int, opts.courtId)
      .input('customerUserId', sql.BigInt, opts.channel === 'COUNTER' ? null : ids.anId)
      .input('guestName', sql.NVarChar(100), opts.channel === 'COUNTER' ? 'Khách Vãng Lai' : null)
      .input('guestPhone', sql.VarChar(10), opts.channel === 'COUNTER' ? '0901112233' : null)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('baseAmount', sql.Decimal(18, 0), opts.totalAmount)
      .input('totalAmount', sql.Decimal(18, 0), opts.totalAmount)
      .input('paymentOption', sql.VarChar(10), paymentOption)
      .input('depositType', sql.VarChar(10), paymentOption === 'DEPOSIT' ? 'PERCENT' : null)
      .input('depositValue', sql.Decimal(18, 2), paymentOption === 'DEPOSIT' ? 30 : null)
      .input('depositAmount', sql.Decimal(18, 0), depositAmount)
      .input('amountDueNow', sql.Decimal(18, 0), amountDueNow)
      .input('paidAmount', sql.Decimal(18, 0), opts.paidAmount)
      .input('remainingAmount', sql.Decimal(18, 0), remainingAmount)
      .input('status', sql.VarChar(20), opts.status)
      .input('paymentStatus', sql.VarChar(20), paymentStatus)
      .input('holdExpireAt', sql.DateTime2(0), holdExpireAt ? toSqlDateTime(holdExpireAt) : null)
      .input('cancelType', sql.VarChar(20), cancelType)
      .input('cancelReason', sql.NVarChar(255), cancelReason)
      .input('canceledAt', sql.DateTime2(0), canceledAt ? toSqlDateTime(canceledAt) : null)
      .input('refundRate', sql.Decimal(5, 2), opts.refundRate ?? null)
      .input('refundAmount', sql.Decimal(18, 0), opts.refundAmount ?? null)
      .input('checkedInAt', sql.DateTime2(0), checkedInAt ? toSqlDateTime(checkedInAt) : null)
      .input('checkedOutAt', sql.DateTime2(0), checkedOutAt ? toSqlDateTime(checkedOutAt) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .input('channel', sql.VarChar(20), opts.channel ?? 'ONLINE')
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone,
          StartAt, EndAt, BaseAmount, DiscountAmount, TotalAmount,
          PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt,
          CancelType, CancelReason, CanceledAt, RefundRate, RefundAmount,
          CheckedInAt, CheckedOutAt, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @customerUserId, @guestName, @guestPhone,
          @startAt, @endAt, @baseAmount, 0, @totalAmount,
          @paymentOption, @depositType, @depositValue, @depositAmount,
          @amountDueNow, @paidAmount, @remainingAmount,
          @status, @paymentStatus, @holdExpireAt,
          @cancelType, @cancelReason, @canceledAt, @refundRate, @refundAmount,
          @checkedInAt, @checkedOutAt, @now, @now, @channel
        )
      `);

    const bookingId = Number(res.recordset[0].BookingId);
    createdBookingIds.push(bookingId);

    for (const p of opts.payments ?? []) {
      let bankTxnId: number | null = null;
      if (p.method === 'BANK_TRANSFER') {
        const txnRes = await exec
          .request()
          .input('provId', sql.VarChar(100), `TEST_${p.code}`)
          .input('amt', sql.Decimal(18, 0), p.amount)
          .input('content', sql.NVarChar(500), `THANHTOAN ${opts.code}`)
          .input('paidAt', sql.DateTime2(0), toSqlDateTime(p.paidAt))
          .input('bookingId', sql.BigInt, bookingId)
          .query<{ BankTxnId: number | string }>(`
            INSERT INTO dbo.BankTransactions (
              Provider, ProviderTxnId, AccountNo, Amount, Content,
              TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt
            )
            OUTPUT inserted.BankTxnId
            VALUES (
              'SEPAY', @provId, '1012345678', @amt, @content,
              @paidAt, '{"transferType":"in"}', 'MATCHED', @bookingId, @paidAt
            )
          `);
        bankTxnId = Number(txnRes.recordset[0].BankTxnId);
      }

      await exec
        .request()
        .input('pCode', sql.VarChar(20), p.code)
        .input('bookingId', sql.BigInt, bookingId)
        .input('purpose', sql.VarChar(20), p.purpose)
        .input('method', sql.VarChar(20), p.method)
        .input('channel', sql.VarChar(20), p.channel)
        .input('amount', sql.Decimal(18, 0), p.amount)
        .input('bankTxnId', sql.BigInt, bankTxnId)
        .input('collectedBy', sql.BigInt, p.channel === 'COUNTER' ? ids.staffCs01Id : null)
        .input('paidAt', sql.DateTime2(0), toSqlDateTime(p.paidAt))
        .query(`
          INSERT INTO dbo.Payments (
            PaymentCode, BookingId, Purpose, Method, Channel, Amount,
            RequestId, BankTxnId, CollectedBy, PaidAt
          )
          VALUES (
            @pCode, @bookingId, @purpose, @method, @channel, @amount,
            NULL, @bankTxnId, @collectedBy, @paidAt
          )
        `);
    }

    return bookingId;
  }

  async function cleanupArtifacts(): Promise<void> {
    const exec = await txService.executor();
    if (createdBookingIds.length > 0) {
      const idList = createdBookingIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.Payments WHERE BookingId IN (${idList});
        DELETE FROM dbo.BankTransactions WHERE MatchedBookingId IN (${idList});
        DELETE FROM dbo.Refunds WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingStatusHistory WHERE BookingId IN (${idList});
        DELETE FROM dbo.BookingSlots WHERE BookingId IN (${idList});
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
  }

  beforeAll(async () => {
    app = await NestFactory.create(DashboardTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
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
      WHERE Code IN ('SAN_PB_01','SAN_PB_02','SAN_PB_03','SAN_CL_01','SAN_BD_03')
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
    const staffCs01 = userMap.get('0933445577')!;
    const cus = userMap.get('0987654321')!;

    ids = {
      cs01: branchMap.get('CS01')!,
      cs02: branchMap.get('CS02')!,
      pb01: courtMap.get('SAN_PB_01')!,
      pb02: courtMap.get('SAN_PB_02')!,
      pb03: courtMap.get('SAN_PB_03')!,
      cl01: courtMap.get('SAN_CL_01')!,
      bd03: courtMap.get('SAN_BD_03')!,
      ownerId: Number(owner.UserId),
      staffCs01Id: Number(staffCs01.UserId),
      anId: Number(cus.UserId),
    };

    seededUsers = {
      owner: { userId: ids.ownerId, role: 'OWNER', branchId: null, tv: owner.TokenVersion },
      staffCs01: {
        userId: ids.staffCs01Id,
        role: 'STAFF',
        branchId: Number(staffCs01.BranchId),
        tv: staffCs01.TokenVersion,
      },
      customer: { userId: ids.anId, role: 'CUSTOMER', branchId: null, tv: cus.TokenVersion },
    };
  });

  beforeEach(() => {
    fakeClock.set(parseVnDateTime('2027-05-10', '09:35:00'));
  });

  afterEach(async () => {
    await cleanupArtifacts();
  });

  afterAll(async () => {
    await cleanupArtifacts();
    systemClock.now = origClockNow;
    await app.close();
    await closePool();
  });

  it('enforces RBAC and branchScope on API-40 and API-41', async () => {
    await request(app.getHttpServer()).get('/api/v1/dashboard/daily').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/dashboard/daily')
      .set('Authorization', 'Bearer customer')
      .expect(403);

    const staffAllRes = await request(app.getHttpServer())
      .get('/api/v1/dashboard/daily?branchId=all&date=2027-05-10')
      .set('Authorization', 'Bearer staffCs01')
      .expect(403);
    expect(staffAllRes.body.error.code).toBe('BRANCH_FORBIDDEN');

    const staffOtherRes = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily?branchId=${ids.cs02}&date=2027-05-10`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(403);
    expect(staffOtherRes.body.error.code).toBe('BRANCH_FORBIDDEN');

    const staffDrillAll = await request(app.getHttpServer())
      .get('/api/v1/dashboard/daily/bookings?branchId=all&kpi=TOTAL&date=2027-05-10')
      .set('Authorization', 'Bearer staffCs01')
      .expect(403);
    expect(staffDrillAll.body.error.code).toBe('BRANCH_FORBIDDEN');

    const staffDrillOther = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily/bookings?branchId=${ids.cs02}&kpi=TOTAL&date=2027-05-10`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(403);
    expect(staffDrillOther.body.error.code).toBe('BRANCH_FORBIDDEN');
  });

  it('computes daily KPIs, revenue, courtBoard, upcoming, affectedCount, and API-41 drilldowns accurately', async () => {
    const exec = await txService.executor();
    const targetDate = '2027-05-10';
    const paidToday1 = parseVnDateTime(targetDate, '06:00:00');
    const paidToday2 = parseVnDateTime(targetDate, '08:00:00');
    const paidPrevDay = parseVnDateTime('2027-05-08', '10:00:00');

    // Maintenance block on SAN_PB_02 for 2027-05-10
    const blkRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb02)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(targetDate, '07:00:00')))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(parseVnDateTime(targetDate, '19:00:00')))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ BlockId: number | string }>(`
        INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy)
        OUTPUT inserted.BlockId
        VALUES (@courtId, 'MAINTENANCE', @startAt, @endAt, N'Bảo trì đèn', @createdBy)
      `);
    createdBlockIds.push(Number(blkRes.recordset[0].BlockId));

    // 1. COMPLETED PAID (ONLINE, BANK_TRANSFER 500k on 2027-05-10)
    await seedBooking({
      code: 'BK2027051001',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: targetDate,
      startTime: '06:00:00',
      endTime: '08:00:00',
      status: 'COMPLETED',
      channel: 'ONLINE',
      totalAmount: 500000,
      paidAmount: 500000,
      payments: [
        {
          code: 'PT2027051001',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 500000,
          paidAt: paidToday1,
        },
      ],
    });

    // 2. IN_USE PAID (COUNTER, CASH 240k on 2027-05-10)
    await seedBooking({
      code: 'BK2027051002',
      branchId: ids.cs01,
      courtId: ids.cl01,
      date: targetDate,
      startTime: '09:00:00',
      endTime: '11:00:00',
      status: 'IN_USE',
      channel: 'COUNTER',
      totalAmount: 240000,
      paidAmount: 240000,
      payments: [
        {
          code: 'PT2027051002',
          purpose: 'FULL',
          method: 'CASH',
          channel: 'COUNTER',
          amount: 240000,
          paidAt: paidToday2,
        },
      ],
    });

    // 3. CONFIRMED DEPOSITED OVERDUE (StartAt 09:00, now 09:35 -> >= 30' overdue!)
    // Also on SAN_PB_02 so it counts as 1 affected booking!
    await seedBooking({
      code: 'BK2027051003',
      branchId: ids.cs01,
      courtId: ids.pb02,
      date: targetDate,
      startTime: '09:00:00',
      endTime: '11:00:00',
      status: 'CONFIRMED',
      channel: 'ONLINE',
      paymentOption: 'DEPOSIT',
      totalAmount: 500000,
      depositAmount: 150000,
      paidAmount: 150000,
      payments: [
        {
          code: 'PT2027051003',
          purpose: 'DEPOSIT',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 150000,
          paidAt: paidToday2,
        },
      ],
    });

    // 4. PENDING_PAYMENT on SAN_PB_02 at 14:00 (>= now 09:35) -> triggers affectedCount = 1!
    await seedBooking({
      code: 'BK2027051004',
      branchId: ids.cs01,
      courtId: ids.pb02,
      date: targetDate,
      startTime: '14:00:00',
      endTime: '16:00:00',
      status: 'PENDING_PAYMENT',
      channel: 'ONLINE',
      totalAmount: 300000,
      paidAmount: 0,
    });

    // 5. CONFIRMED PAID upcoming (paid on 2027-05-08 -> NOT in 2027-05-10 payments, NOT in pendingCount)
    await seedBooking({
      code: 'BK2027051005',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: targetDate,
      startTime: '18:00:00',
      endTime: '20:00:00',
      status: 'CONFIRMED',
      channel: 'ONLINE',
      totalAmount: 500000,
      paidAmount: 500000,
      payments: [
        {
          code: 'PT2027050805',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 500000,
          paidAt: paidPrevDay,
        },
      ],
    });

    // 6. CANCELED CUSTOMER_REQUEST on 2027-05-10 (paid 400k on 2027-05-08, refunded 200k on 2027-05-10)
    await seedBooking({
      code: 'BK2027051006',
      branchId: ids.cs01,
      courtId: ids.pb03,
      date: '2027-05-13',
      startTime: '10:00:00',
      endTime: '12:00:00',
      status: 'CANCELED',
      channel: 'ONLINE',
      totalAmount: 400000,
      paidAmount: 400000,
      cancelType: 'CUSTOMER_REQUEST',
      canceledAt: parseVnDateTime(targetDate, '09:00:00'),
      refundRate: 50,
      refundAmount: 200000,
      payments: [
        {
          code: 'PT2027050806',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 400000,
          paidAt: paidPrevDay,
        },
      ],
    });

    // 7. CANCELED BY_FACILITY on 2027-05-10 (paid 300k on 2027-05-10, refunded 300k -> MUST BE EXCLUDED)
    await seedBooking({
      code: 'BK2027051007',
      branchId: ids.cs01,
      courtId: ids.pb02,
      date: targetDate,
      startTime: '12:00:00',
      endTime: '14:00:00',
      status: 'CANCELED',
      channel: 'ONLINE',
      totalAmount: 300000,
      paidAmount: 300000,
      cancelType: 'BY_FACILITY',
      canceledAt: parseVnDateTime(targetDate, '09:10:00'),
      refundRate: 100,
      refundAmount: 300000,
      payments: [
        {
          code: 'PT2027051007',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 300000,
          paidAt: paidToday1,
        },
      ],
    });

    // 8. EXPIRED on 2027-05-10 (excluded from totalBookings)
    await seedBooking({
      code: 'BK2027051008',
      branchId: ids.cs01,
      courtId: ids.pb03,
      date: targetDate,
      startTime: '16:00:00',
      endTime: '17:00:00',
      status: 'EXPIRED',
      channel: 'ONLINE',
      totalAmount: 250000,
      paidAmount: 0,
    });

    // 9. Booking in CS02 on 2027-05-10 (to verify STAFF CS01 excludes CS02, OWNER all includes CS02)
    await seedBooking({
      code: 'BK2027051009',
      branchId: ids.cs02,
      courtId: ids.bd03,
      date: targetDate,
      startTime: '17:00:00',
      endTime: '19:00:00',
      status: 'CONFIRMED',
      channel: 'COUNTER',
      totalAmount: 650000,
      paidAmount: 650000,
      payments: [
        {
          code: 'PT2027051009',
          purpose: 'FULL',
          method: 'CASH',
          channel: 'COUNTER',
          amount: 650000,
          paidAt: paidToday2,
        },
      ],
    });

    // STAFF CS01 daily dashboard
    const cs01Res = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily?date=${targetDate}`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(200);

    const d1 = cs01Res.body.data;
    expect(d1.date).toBe(targetDate);
    expect(d1.branchId).toBe(ids.cs01);
    expect(d1.kpis.totalBookings).toBe(5); // BK01..BK05
    expect(d1.kpis.onlineBookings).toBe(4);
    expect(d1.kpis.counterBookings).toBe(1);
    expect(d1.kpis.playingCount).toBe(1); // BK02
    expect(d1.kpis.pendingCount).toBe(2); // BK03 (CONFIRMED+DEPOSITED) + BK04 (PENDING_PAYMENT)
    expect(d1.kpis.affectedCount).toBe(1); // BK03 on SAN_PB_02 MAINTENANCE block

    // CS01 Revenue on 2027-05-10:
    // grossPayments = 500,000 + 240,000 + 150,000 = 890,000 (BK07 BY_FACILITY excluded)
    // refunds = 200,000 (BK06)
    // net = 690,000
    expect(d1.revenue.grossPayments).toBe(890000);
    expect(d1.revenue.refunds).toBe(200000);
    expect(d1.revenue.total).toBe(690000);
    expect(d1.kpis.revenue).toBe(690000);
    expect(d1.revenue.bankTransfer).toBe(450000); // 500k + 150k - 200k
    expect(d1.revenue.cash).toBe(240000);
    expect(d1.revenue.bankTransfer + d1.revenue.cash).toBe(d1.revenue.total);

    // Court board checks
    const pb02Board = d1.courtBoard.find((c: { courtId: number }) => c.courtId === ids.pb02);
    const cl01Board = d1.courtBoard.find((c: { courtId: number }) => c.courtId === ids.cl01);
    const pb01Board = d1.courtBoard.find((c: { courtId: number }) => c.courtId === ids.pb01);
    const pb03Board = d1.courtBoard.find((c: { courtId: number }) => c.courtId === ids.pb03);
    expect(pb02Board.status).toBe('LOCKED');
    expect(cl01Board.status).toBe('IN_USE');
    expect(cl01Board.currentBooking.bookingCode).toBe('BK2027051002');
    expect(pb01Board.status).toBe('UPCOMING');
    expect(pb01Board.nextBooking.bookingCode).toBe('BK2027051005');
    expect(pb03Board.status).toBe('FREE');

    // Upcoming CONFIRMED bookings sorted StartAt ASC, BK03 isOverdue = true
    expect(d1.upcoming.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'BK2027051003',
      'BK2027051005',
    ]);
    expect(d1.upcoming[0].isOverdue).toBe(true);
    expect(d1.upcoming[1].isOverdue).toBe(false);

    // OWNER branchId=all includes CS02 too
    const ownerAllRes = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily?branchId=all&date=${targetDate}`)
      .set('Authorization', 'Bearer owner')
      .expect(200);
    expect(ownerAllRes.body.data.branchId).toBeNull();
    expect(ownerAllRes.body.data.kpis.totalBookings).toBe(6);
    expect(ownerAllRes.body.data.revenue.total).toBe(690000 + 650000);

    // API-41 Drilldowns for CS01
    const totalList = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily/bookings?date=${targetDate}&kpi=TOTAL`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(200);
    expect(totalList.body.data).toHaveLength(5);

    const playingList = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily/bookings?date=${targetDate}&kpi=PLAYING`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(200);
    expect(playingList.body.data.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'BK2027051002',
    ]);

    const pendingList = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily/bookings?date=${targetDate}&kpi=PENDING`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(200);
    expect(pendingList.body.data.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      'BK2027051003',
      'BK2027051004',
    ]);

    const revenueList = await request(app.getHttpServer())
      .get(`/api/v1/dashboard/daily/bookings?date=${targetDate}&kpi=REVENUE`)
      .set('Authorization', 'Bearer staffCs01')
      .expect(200);
    const revItems = revenueList.body.data as Array<{
      bookingCode: string;
      collectedOnDate: number;
      refundedOnDate: number;
      retainedAmount: number;
    }>;
    // Includes BK01 (+500k), BK02 (+240k), BK03 (+150k), BK06 (-200k); excludes BK07 (BY_FACILITY) and BK05 (paid on 05-08)
    expect(revItems.map((b) => b.bookingCode).sort()).toEqual([
      'BK2027051001',
      'BK2027051002',
      'BK2027051003',
      'BK2027051006',
    ]);
    const bk06Item = revItems.find((b) => b.bookingCode === 'BK2027051006')!;
    expect(bk06Item.collectedOnDate).toBe(0);
    expect(bk06Item.refundedOnDate).toBe(200000);
    expect(bk06Item.retainedAmount).toBe(-200000);
    const sumRetained = revItems.reduce((s, r) => s + r.retainedAmount, 0);
    expect(sumRetained).toBe(d1.revenue.total);
  });
});
