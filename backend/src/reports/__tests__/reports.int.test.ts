import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../core/auth/index.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppError, AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { parseVnDateTime, toSqlDate, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { ReportsModule } from '../reports.module.js';

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
  imports: [CoreModule, DatabaseModule, TestAuthModule, ReportsModule],
})
class ReportsTestAppModule {}

describe('reports integration (API-66)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;

  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    cl01: number;
    bd03: number;
    ownerId: number;
    staffCs01Id: number;
    anId: number;
  };

  const createdBookingIds: number[] = [];
  const createdHolidayIds: number[] = [];

  async function seedReportBooking(opts: {
    code: string;
    branchId: number;
    courtId: number;
    date: string;
    startTime: string;
    endTime: string;
    status: 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_USE' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
    channel?: 'ONLINE' | 'COUNTER';
    paymentOption?: 'FULL' | 'DEPOSIT';
    baseAmount: number;
    discountAmount?: number;
    promotionCode?: string | null;
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
    pendingRefund?: boolean;
  }): Promise<number> {
    const exec = await txService.executor();
    const startAt = parseVnDateTime(opts.date, opts.startTime);
    const endAt = parseVnDateTime(opts.date, opts.endTime);
    const discountAmount = opts.discountAmount ?? 0;
    const totalAmount = opts.baseAmount - discountAmount;
    const paymentOption = opts.paymentOption ?? 'FULL';
    const depositAmount =
      opts.depositAmount ?? (paymentOption === 'DEPOSIT' ? Math.round(totalAmount * 0.3) : 0);
    const amountDueNow = paymentOption === 'DEPOSIT' ? depositAmount : totalAmount;
    const remainingAmount = totalAmount - opts.paidAmount;
    const paymentStatus =
      opts.paidAmount === 0 ? 'UNPAID' : remainingAmount === 0 ? 'PAID' : 'DEPOSITED';
    const holdExpireAt =
      opts.status === 'PENDING_PAYMENT' ? new Date(startAt.getTime() + 600_000) : null;
    const cancelType = opts.status === 'CANCELED' ? (opts.cancelType ?? 'CUSTOMER_REQUEST') : null;
    const cancelReason = opts.status === 'CANCELED' ? 'Test cancel' : null;
    const canceledAt = opts.status === 'CANCELED' ? (opts.canceledAt ?? startAt) : null;
    const createdAt = parseVnDateTime(opts.date, '05:00:00');

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
      .input('baseAmount', sql.Decimal(18, 0), opts.baseAmount)
      .input('discountAmount', sql.Decimal(18, 0), discountAmount)
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
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
      .input('promoCode', sql.VarChar(20), opts.promotionCode ?? null)
      .input('cancelType', sql.VarChar(20), cancelType)
      .input('cancelReason', sql.NVarChar(255), cancelReason)
      .input('canceledAt', sql.DateTime2(0), canceledAt ? toSqlDateTime(canceledAt) : null)
      .input('refundRate', sql.Decimal(5, 2), opts.refundRate ?? null)
      .input('refundAmount', sql.Decimal(18, 0), opts.refundAmount ?? null)
      .input('createdAt', sql.DateTime2(0), toSqlDateTime(createdAt))
      .input('channel', sql.VarChar(20), opts.channel ?? 'ONLINE')
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone,
          StartAt, EndAt, BaseAmount, DiscountAmount, TotalAmount,
          PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt, PromotionCode,
          CancelType, CancelReason, CanceledAt, RefundRate, RefundAmount,
          CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @customerUserId, @guestName, @guestPhone,
          @startAt, @endAt, @baseAmount, @discountAmount, @totalAmount,
          @paymentOption, @depositType, @depositValue, @depositAmount,
          @amountDueNow, @paidAmount, @remainingAmount,
          @status, @paymentStatus, @holdExpireAt, @promoCode,
          @cancelType, @cancelReason, @canceledAt, @refundRate, @refundAmount,
          @createdAt, @createdAt, @channel
        )
      `);

    const bookingId = Number(res.recordset[0].BookingId);
    createdBookingIds.push(bookingId);

    for (const p of opts.payments ?? []) {
      let bankTxnId: number | null = null;
      if (p.method === 'BANK_TRANSFER') {
        const txnRes = await exec
          .request()
          .input('provId', sql.VarChar(100), `RPT_${p.code}`)
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

    if (opts.pendingRefund && opts.refundAmount && opts.refundAmount > 0 && opts.refundRate) {
      await exec
        .request()
        .input('bookingId', sql.BigInt, bookingId)
        .input('amount', sql.Decimal(18, 0), opts.refundAmount)
        .input('rate', sql.Decimal(5, 2), opts.refundRate)
        .query(`
          INSERT INTO dbo.Refunds (BookingId, Amount, Rate, Reason, Status)
          VALUES (@bookingId, @amount, @rate, N'Test refund', 'PENDING')
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
    if (createdHolidayIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.BranchHolidays WHERE HolidayId IN (${createdHolidayIds.join(',')});
      `);
      createdHolidayIds.length = 0;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(ReportsTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    const exec = await txService.executor();

    const branchesRes = await exec.request().query<{ BranchId: number; Code: string }>(`
      SELECT BranchId, Code FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')
    `);
    const branchMap = new Map(branchesRes.recordset.map((b) => [b.Code, Number(b.BranchId)]));

    const courtsRes = await exec.request().query<{ Code: string; CourtId: number }>(`
      SELECT Code, CourtId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_CL_01','SAN_BD_03')
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

  afterEach(async () => {
    await cleanupArtifacts();
  });

  afterAll(async () => {
    await cleanupArtifacts();
    await app.close();
    await closePool();
  });

  it('rejects non-OWNER roles and invalid date ranges', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2027-06-01&to=2027-06-30')
      .set('Authorization', 'Bearer staffCs01')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2027-06-01&to=2027-06-30')
      .set('Authorization', 'Bearer customer')
      .expect(403);

    const reversedRes = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2027-06-15&to=2027-06-01')
      .set('Authorization', 'Bearer owner')
      .expect(400);
    expect(reversedRes.body.error.code).toBe('INVALID_DATE_RANGE');

    // 367 inclusive days (2026-01-01 to 2027-01-02) -> INVALID_DATE_RANGE
    const tooLongRes = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2026-01-01&to=2027-01-02')
      .set('Authorization', 'Bearer owner')
      .expect(400);
    expect(tooLongRes.body.error.code).toBe('INVALID_DATE_RANGE');

    // 366 inclusive days (leap year 2024-01-01 to 2024-12-31) -> allowed
    await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2024-01-01&to=2024-12-31')
      .set('Authorization', 'Bearer owner')
      .expect(200);
  });

  it('returns isEmpty=true when no bookings or transactions exist in range', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2028-03-01&to=2028-03-07')
      .set('Authorization', 'Bearer owner')
      .expect(200);

    const d = res.body.data;
    expect(d.isEmpty).toBe(true);
    expect(d.summary.orders).toBe(0);
    expect(d.summary.total).toBe(0);
    expect(d.summary.netRevenue).toBe(0);
    expect(d.summary.occupancyRate).toBe(0);
    expect(d.summary.capacityHours).toBeGreaterThan(0);
  });

  it('matches exact hand-calculated revenue, breakdown, occupancy, holiday, and promo stats (business-rules §14)', async () => {
    const exec = await txService.executor();

    // Add 1 holiday on 2027-06-15 for CS01 (should reduce CS01 capacity by 18h * 6 active courts = 108h)
    const holRes = await exec
      .request()
      .input('branchId', sql.Int, ids.cs01)
      .input('startDate', sql.Date, toSqlDate('2027-06-15'))
      .input('endDate', sql.Date, toSqlDate('2027-06-15'))
      .input('createdBy', sql.BigInt, ids.ownerId)
      .query<{ HolidayId: number | string }>(`
        INSERT INTO dbo.BranchHolidays (BranchId, StartDate, EndDate, Reason, CreatedBy)
        OUTPUT inserted.HolidayId
        VALUES (@branchId, @startDate, @endDate, N'Nghỉ bảo trì CS01', @createdBy)
      `);
    createdHolidayIds.push(Number(holRes.recordset[0].HolidayId));

    // 1. COMPLETED PAID: 500,000 BANK_TRANSFER (2h on SAN_PB_01)
    await seedReportBooking({
      code: 'BK2027060501',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2027-06-05',
      startTime: '18:00:00',
      endTime: '20:00:00',
      status: 'COMPLETED',
      baseAmount: 500000,
      paidAmount: 500000,
      payments: [
        {
          code: 'PT2027060501',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 500000,
          paidAt: parseVnDateTime('2027-06-05', '10:00:00'),
        },
      ],
    });

    // 2. CONFIRMED DEPOSITED upcoming with promo: base 400k, discount 80k -> total 320k, deposit 120k CASH (2h on SAN_PB_01)
    await seedReportBooking({
      code: 'BK2027061002',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2027-06-10',
      startTime: '09:00:00',
      endTime: '11:00:00',
      status: 'CONFIRMED',
      channel: 'COUNTER',
      paymentOption: 'DEPOSIT',
      baseAmount: 400000,
      discountAmount: 80000,
      promotionCode: 'SANGVUI20',
      depositAmount: 120000,
      paidAmount: 120000,
      payments: [
        {
          code: 'PT2027061002',
          purpose: 'DEPOSIT',
          method: 'CASH',
          channel: 'COUNTER',
          amount: 120000,
          paidAt: parseVnDateTime('2027-06-10', '08:00:00'),
        },
      ],
    });

    // 3. CANCELED NO_SHOW deposited: 90,000 BANK_TRANSFER kept, RefundAmount = 0 (SAN_CL_01)
    await seedReportBooking({
      code: 'BK2027061203',
      branchId: ids.cs01,
      courtId: ids.cl01,
      date: '2027-06-12',
      startTime: '17:00:00',
      endTime: '18:30:00',
      status: 'CANCELED',
      paymentOption: 'DEPOSIT',
      baseAmount: 300000,
      depositAmount: 90000,
      paidAmount: 90000,
      cancelType: 'NO_SHOW',
      canceledAt: parseVnDateTime('2027-06-12', '17:30:00'),
      refundRate: 0,
      refundAmount: 0,
      payments: [
        {
          code: 'PT2027061203',
          purpose: 'DEPOSIT',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 90000,
          paidAt: parseVnDateTime('2027-06-12', '10:00:00'),
        },
      ],
    });

    // 4. CANCELED CUSTOMER_REQUEST 50% refund (Q-14: Refunds still PENDING):
    // Deposit 120k BANK_TRANSFER + Remaining 280k CASH = 400k paid
    // Refund = 50% * (400k - 120k) = 140k (CS02 SAN_BD_03)
    await seedReportBooking({
      code: 'BK2027061504',
      branchId: ids.cs02,
      courtId: ids.bd03,
      date: '2027-06-18',
      startTime: '10:00:00',
      endTime: '12:00:00',
      status: 'CANCELED',
      paymentOption: 'DEPOSIT',
      baseAmount: 400000,
      depositAmount: 120000,
      paidAmount: 400000,
      cancelType: 'CUSTOMER_REQUEST',
      canceledAt: parseVnDateTime('2027-06-15', '12:00:00'),
      refundRate: 50,
      refundAmount: 140000,
      pendingRefund: true,
      payments: [
        {
          code: 'PT2027061004',
          purpose: 'DEPOSIT',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 120000,
          paidAt: parseVnDateTime('2027-06-10', '09:00:00'),
        },
        {
          code: 'PT2027061104',
          purpose: 'REMAINING',
          method: 'CASH',
          channel: 'COUNTER',
          amount: 280000,
          paidAt: parseVnDateTime('2027-06-11', '09:00:00'),
        },
      ],
    });

    // 5. CANCELED BY_FACILITY 100% refund: 500k BANK_TRANSFER paid, 500k refunded -> EXCLUDED from revenue!
    await seedReportBooking({
      code: 'BK2027061905',
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: '2027-06-20',
      startTime: '18:00:00',
      endTime: '20:00:00',
      status: 'CANCELED',
      baseAmount: 500000,
      paidAmount: 500000,
      cancelType: 'BY_FACILITY',
      canceledAt: parseVnDateTime('2027-06-19', '10:00:00'),
      refundRate: 100,
      refundAmount: 500000,
      pendingRefund: true,
      payments: [
        {
          code: 'PT2027061805',
          purpose: 'FULL',
          method: 'BANK_TRANSFER',
          channel: 'ONLINE',
          amount: 500000,
          paidAt: parseVnDateTime('2027-06-18', '10:00:00'),
        },
      ],
    });

    // 6. EXPIRED: 0 paid
    await seedReportBooking({
      code: 'BK2027062206',
      branchId: ids.cs01,
      courtId: ids.cl01,
      date: '2027-06-22',
      startTime: '16:00:00',
      endTime: '18:00:00',
      status: 'EXPIRED',
      baseAmount: 240000,
      paidAmount: 0,
    });

    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2027-06-01&to=2027-06-30')
      .set('Authorization', 'Bearer owner')
      .expect(200);

    const d = res.body.data;
    expect(d.isEmpty).toBe(false);
    expect(d.period).toEqual({ from: '2027-06-01', to: '2027-06-30' });

    const s = d.summary;
    // Revenue check:
    // grossCollected = 500k + 120k + 90k + 400k = 1,110,000
    // totalRefunded = 140,000
    // netRevenue = 970,000
    expect(s.grossCollected).toBe(1110000);
    expect(s.totalRefunded).toBe(140000);
    expect(s.netRevenue).toBe(970000);
    expect(s.total).toBe(970000);

    // Breakdown invariant: fromCompleted + fromUpcoming + fromCanceled === netRevenue
    expect(s.fromCompleted).toBe(500000);
    expect(s.fromUpcoming).toBe(120000);
    expect(s.fromCanceled).toBe(350000); // 90k + (400k - 140k)
    expect(s.fromCompleted + s.fromUpcoming + s.fromCanceled).toBe(s.netRevenue);

    // Method invariant: bankTransfer + cash === netRevenue
    // Cash refund share on BK04 = round(140000 * 280000 / 400000) = 98000; bank share = 42000
    expect(s.bankTransfer).toBe(668000); // 500k + 90k + (120k - 42k)
    expect(s.cash).toBe(302000); // 120k + (280k - 98k)
    expect(s.bankTransfer + s.cash).toBe(s.netRevenue);

    // Orders & hours
    expect(s.orders).toBe(6);
    expect(s.completed).toBe(1);
    expect(s.canceled).toBe(2); // NO_SHOW + CUSTOMER_REQUEST
    expect(s.byFacility).toBe(1);
    expect(s.expired).toBe(1);
    expect(s.bookedHours).toBe(4); // BK01 (2h) + BK02 (2h)

    // Capacity hours check:
    // June 2027 has 30 days (4 Sundays: 2027-06-06, 13, 20, 27).
    // CS01: 05:00-23:00 (18h) all week, minus 1 holiday (2027-06-15) = 29 * 18 = 522h per active court * 6 = 3132h
    // CS02: 26 days * 18h + 4 Sundays * 16h = 468 + 64 = 532h per active court * 4 active courts = 2128h
    // Total capacity = 3132 + 2128 = 5260h
    expect(s.capacityHours).toBe(5260);
    expect(s.occupancyRate).toBe(Math.round((4 / 5260) * 100));

    // Branch breakdown sums
    expect(d.byBranch).toHaveLength(2);
    const branchSumNet = d.byBranch.reduce(
      (acc: number, row: { netRevenue: number }) => acc + row.netRevenue,
      0,
    );
    expect(branchSumNet).toBe(s.netRevenue);

    // Court filter check (SAN_PB_01)
    const courtRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/revenue?from=2027-06-01&to=2027-06-30&branchId=${ids.cs01}&courtId=${ids.pb01}`)
      .set('Authorization', 'Bearer owner')
      .expect(200);
    const cd = courtRes.body.data;
    expect(cd.summary.courtCount).toBe(1);
    expect(cd.summary.capacityHours).toBe(522);
    expect(cd.summary.bookedHours).toBe(4);
    expect(cd.summary.netRevenue).toBe(620000); // 500k + 120k (BY_FACILITY excluded)
    expect(cd.promotion).toEqual({
      orders: 1,
      discountTotal: 80000,
      revenue: 120000,
    });
  });

  it('maintains revenue breakdown invariants on the seeded database window', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/reports/revenue?from=2026-01-01&to=2026-12-31')
      .set('Authorization', 'Bearer owner')
      .expect(200);

    const s = res.body.data.summary;
    expect(s.fromCompleted + s.fromUpcoming + s.fromCanceled).toBe(s.netRevenue);
    expect(s.bankTransfer + s.cash).toBe(s.netRevenue);
  });
});
