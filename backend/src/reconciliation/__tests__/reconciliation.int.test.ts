import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type {
  BankMatchStatus,
  BookingChannel,
  BookingStatus,
  CancelType,
  PaymentOption,
  PaymentStatus,
  RefundStatus,
} from '@sporthub/shared/enums';
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
import { parseVnDateTime, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { ReconciliationModule } from '../reconciliation.module.js';

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
  imports: [
    CoreModule,
    DatabaseModule,
    IntegrationsModule,
    TestAuthModule,
    ReconciliationModule,
  ],
})
class ReconciliationTestAppModule {}

describe('reconciliation & refunds integration (API 67–73)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  const fakeClock = new FakeClock(parseVnDateTime('2026-12-20', '10:00:00'));
  let emittedEvents: EmittedEvent[] = [];

  let ids: {
    cs01: number;
    cs02: number;
    cs01Account: string;
    cs02Account: string;
    pb01: number;
    bd03: number;
    ownerId: number;
    staffCs01Id: number;
    staffCs02Id: number;
    anId: number;
    binhId: number;
  };

  const createdBookingIds: number[] = [];
  const createdBankTxnIds: number[] = [];
  const createdRefundIds: number[] = [];
  const createdAuditIds: number[] = [];

  async function seedBooking(opts: {
    code: string;
    branchId: number;
    courtId: number;
    customerUserId?: number | null;
    channel?: BookingChannel;
    status?: BookingStatus;
    paymentStatus?: PaymentStatus;
    paymentOption?: PaymentOption;
    totalAmount?: number;
    depositAmount?: number;
    amountDueNow?: number;
    paidAmount?: number;
    remainingAmount?: number;
    holdExpireAt?: Date | null;
    cancelType?: CancelType | null;
    withPendingQr?: boolean;
  }): Promise<number> {
    const exec = await txService.executor();
    const now = fakeClock.now();
    const startAt = parseVnDateTime('2026-12-21', '14:00:00');
    const endAt = parseVnDateTime('2026-12-21', '16:00:00');
    const status = opts.status ?? 'PENDING_PAYMENT';
    const paymentOption = opts.paymentOption ?? 'FULL';
    const totalAmount = opts.totalAmount ?? 300000;
    const depositAmount = opts.depositAmount ?? (paymentOption === 'DEPOSIT' ? 90000 : 0);
    const amountDueNow = opts.amountDueNow ?? (paymentOption === 'DEPOSIT' ? depositAmount : totalAmount);
    const paidAmount = opts.paidAmount ?? 0;
    const remainingAmount = opts.remainingAmount ?? totalAmount - paidAmount;
    const paymentStatus =
      opts.paymentStatus ??
      (paidAmount === 0 ? 'UNPAID' : remainingAmount === 0 ? 'PAID' : 'DEPOSITED');
    const holdExpireAt =
      opts.holdExpireAt !== undefined
        ? opts.holdExpireAt
        : status === 'PENDING_PAYMENT'
          ? new Date(now.getTime() + 600_000)
          : null;
    const customerUserId = opts.customerUserId === undefined ? ids.anId : opts.customerUserId;
    const cancelType = opts.cancelType ?? (status === 'CANCELED' ? 'CUSTOMER_REQUEST' : null);

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
      .input('cancelType', sql.VarChar(20), cancelType)
      .input('cancelReason', sql.NVarChar(255), status === 'CANCELED' ? 'Hủy đơn test' : null)
      .input('canceledAt', sql.DateTime2(0), status === 'CANCELED' ? toSqlDateTime(now) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .input('channel', sql.VarChar(20), opts.channel ?? 'ONLINE')
      .query<{ BookingId: number | string }>(`
        INSERT INTO dbo.Bookings (
          BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone,
          StartAt, EndAt, BaseAmount, DiscountAmount, TotalAmount,
          PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount,
          Status, PaymentStatus, HoldExpireAt,
          CancelType, CancelReason, CanceledAt,
          CreatedBy, CreatedAt, UpdatedAt, Channel
        )
        OUTPUT inserted.BookingId
        VALUES (
          @code, @branchId, @courtId, @customerUserId, @guestName, @guestPhone,
          @startAt, @endAt, @totalAmount, 0, @totalAmount,
          @paymentOption, @depositType, @depositValue, @depositAmount,
          @amountDueNow, @paidAmount, @remainingAmount,
          @status, @paymentStatus, @holdExpireAt,
          @cancelType, @cancelReason, @canceledAt,
          @customerUserId, @now, @now, @channel
        )
      `);

    const bookingId = Number(res.recordset[0].BookingId);
    createdBookingIds.push(bookingId);

    if (opts.withPendingQr) {
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

    return bookingId;
  }

  async function seedBankTxn(opts: {
    accountNo: string;
    amount: number;
    content: string | null;
    matchStatus?: BankMatchStatus;
    matchedBookingId?: number | null;
    transactionAt?: Date;
    receivedAt?: Date;
  }): Promise<number> {
    const exec = await txService.executor();
    const now = fakeClock.now();
    const txnAt = opts.transactionAt ?? now;
    const recvAt = opts.receivedAt ?? now;
    const providerTxnId = `TEST_${randomUUID().slice(0, 12)}`;

    const res = await exec
      .request()
      .input('providerTxnId', sql.VarChar(100), providerTxnId)
      .input('accountNo', sql.VarChar(30), opts.accountNo)
      .input('amount', sql.Decimal(18, 0), opts.amount)
      .input('content', sql.NVarChar(500), opts.content)
      .input('transactionAt', sql.DateTime2(0), toSqlDateTime(txnAt))
      .input(
        'rawPayload',
        sql.NVarChar(sql.MAX),
        JSON.stringify({ id: providerTxnId, transferAmount: opts.amount, content: opts.content }),
      )
      .input('matchStatus', sql.VarChar(20), opts.matchStatus ?? 'NEEDS_REVIEW')
      .input('matchedBookingId', sql.BigInt, opts.matchedBookingId ?? null)
      .input('receivedAt', sql.DateTime2(0), toSqlDateTime(recvAt))
      .query<{ BankTxnId: number | string }>(`
        INSERT INTO dbo.BankTransactions (
          Provider, ProviderTxnId, AccountNo, Amount, Content,
          TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt
        )
        OUTPUT inserted.BankTxnId
        VALUES (
          'SEPAY', @providerTxnId, @accountNo, @amount, @content,
          @transactionAt, @rawPayload, @matchStatus, @matchedBookingId, @receivedAt
        )
      `);

    const bankTxnId = Number(res.recordset[0].BankTxnId);
    createdBankTxnIds.push(bankTxnId);
    return bankTxnId;
  }

  async function seedRefund(opts: {
    bookingId: number;
    amount: number;
    rate?: 50 | 100;
    reason?: string;
    status?: RefundStatus;
    createdAt?: Date;
  }): Promise<number> {
    const exec = await txService.executor();
    const now = fakeClock.now();
    const status = opts.status ?? 'PENDING';
    const processedAt = status === 'COMPLETED' ? now : null;
    const processedBy = status === 'COMPLETED' ? ids.ownerId : null;

    const res = await exec
      .request()
      .input('bookingId', sql.BigInt, opts.bookingId)
      .input('amount', sql.Decimal(18, 0), opts.amount)
      .input('rate', sql.Decimal(5, 2), opts.rate ?? 100)
      .input('reason', sql.NVarChar(255), opts.reason ?? 'Khách hủy trước 5 ngày')
      .input('status', sql.VarChar(20), status)
      .input('processedBy', sql.BigInt, processedBy)
      .input('processedAt', sql.DateTime2(0), processedAt ? toSqlDateTime(processedAt) : null)
      .input('createdAt', sql.DateTime2(0), toSqlDateTime(opts.createdAt ?? now))
      .query<{ RefundId: number | string }>(`
        INSERT INTO dbo.Refunds (
          BookingId, Amount, Rate, Reason, Status, ProcessedBy, ProcessedAt, CreatedAt
        )
        OUTPUT inserted.RefundId
        VALUES (
          @bookingId, @amount, @rate, @reason, @status, @processedBy, @processedAt, @createdAt
        )
      `);

    const refundId = Number(res.recordset[0].RefundId);
    createdRefundIds.push(refundId);
    return refundId;
  }

  async function cleanupArtifacts(): Promise<void> {
    const exec = await txService.executor();

    if (createdAuditIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.AuditLogs WHERE AuditId IN (${createdAuditIds.join(',')});
      `);
      createdAuditIds.length = 0;
    }

    if (createdBankTxnIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.AuditLogs WHERE EntityType = 'BankTransactions' AND EntityId IN (${createdBankTxnIds.map((id) => `'${id}'`).join(',')});
        DELETE FROM dbo.Payments WHERE BankTxnId IN (${createdBankTxnIds.join(',')});
        DELETE FROM dbo.BankTransactions WHERE BankTxnId IN (${createdBankTxnIds.join(',')});
      `);
      createdBankTxnIds.length = 0;
    }

    if (createdRefundIds.length > 0) {
      await exec.request().query(`
        DELETE FROM dbo.AuditLogs WHERE EntityType = 'Refunds' AND EntityId IN (${createdRefundIds.map((id) => `'${id}'`).join(',')});
        DELETE FROM dbo.Refunds WHERE RefundId IN (${createdRefundIds.join(',')});
      `);
      createdRefundIds.length = 0;
    }

    if (createdBookingIds.length > 0) {
      const idList = createdBookingIds.join(',');
      await exec.request().query(`
        DELETE FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef IN (${createdBookingIds.map((id) => `'${id}'`).join(',')});
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
  }

  beforeAll(async () => {
    const moduleRef = await NestFactory.create(ReconciliationTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app = moduleRef;
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(new AppLogger()));
    await app.init();

    txService = app.get(DbTransactionService);
    realtimeService = app.get(RealtimeService);
    systemClock = app.get(SystemClock);
    origClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    const fakeServer = {
      to(rooms: string | string[]) {
        const roomList = Array.isArray(rooms) ? rooms : [rooms];
        return {
          emit(event: string, payload: unknown) {
            emittedEvents.push({ rooms: roomList, event, payload });
          },
        };
      },
    } as unknown as Server;
    realtimeService.attachServer(fakeServer);

    const exec = await txService.executor();
    const branchRes = await exec.request().query<{
      BranchId: number;
      Code: string;
      BankAccountNo: string;
    }>(`SELECT BranchId, Code, BankAccountNo FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')`);

    const courtRes = await exec.request().query<{ CourtId: number; Code: string }>(
      `SELECT CourtId, Code FROM dbo.Courts WHERE Code IN ('SAN_PB_01', 'SAN_BD_03')`,
    );

    const userRes = await exec.request().query<{
      UserId: number | string;
      Phone: string;
      Role: 'OWNER' | 'STAFF' | 'CUSTOMER';
      BranchId: number | null;
    }>(`
      SELECT UserId, Phone, Role, BranchId
      FROM dbo.Users
      WHERE Phone IN ('0900000001', '0933445577', '0933445566', '0987654321', '0912345678')
    `);

    const cs01 = branchRes.recordset.find((b) => b.Code === 'CS01')!;
    const cs02 = branchRes.recordset.find((b) => b.Code === 'CS02')!;
    const pb01 = courtRes.recordset.find((c) => c.Code === 'SAN_PB_01')!;
    const bd03 = courtRes.recordset.find((c) => c.Code === 'SAN_BD_03')!;

    const owner = userRes.recordset.find((u) => u.Phone === '0900000001')!;
    const staffCs01 = userRes.recordset.find((u) => u.Phone === '0933445577')!;
    const staffCs02 = userRes.recordset.find((u) => u.Phone === '0933445566')!;
    const an = userRes.recordset.find((u) => u.Phone === '0987654321')!;
    const binh = userRes.recordset.find((u) => u.Phone === '0912345678')!;

    ids = {
      cs01: cs01.BranchId,
      cs02: cs02.BranchId,
      cs01Account: cs01.BankAccountNo,
      cs02Account: cs02.BankAccountNo,
      pb01: pb01.CourtId,
      bd03: bd03.CourtId,
      ownerId: Number(owner.UserId),
      staffCs01Id: Number(staffCs01.UserId),
      staffCs02Id: Number(staffCs02.UserId),
      anId: Number(an.UserId),
      binhId: Number(binh.UserId),
    };

    seededUsers = {
      'owner-token': {
        userId: ids.ownerId,
        role: 'OWNER',
        branchId: null,
        tv: 0,
      },
      'staff-cs01-token': {
        userId: ids.staffCs01Id,
        role: 'STAFF',
        branchId: ids.cs01,
        tv: 0,
      },
      'staff-cs02-token': {
        userId: ids.staffCs02Id,
        role: 'STAFF',
        branchId: ids.cs02,
        tv: 0,
      },
      'customer-an-token': {
        userId: ids.anId,
        role: 'CUSTOMER',
        branchId: null,
        tv: 0,
      },
    };
  });

  beforeEach(() => {
    fakeClock.set(parseVnDateTime('2026-12-20', '10:00:00'));
    emittedEvents = [];
  });

  afterEach(async () => {
    await cleanupArtifacts();
  });

  afterAll(async () => {
    systemClock.now = origClockNow;
    await app.close();
    await closePool();
  });

  it('API-67: enforces auth, STAFF branch scope, date validation, and derives issue & expectedAmount', async () => {
    await request(app.getHttpServer()).get('/api/v1/reconciliation/transactions').expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/reconciliation/transactions')
      .set('Authorization', 'Bearer customer-an-token')
      .expect(403);

    await request(app.getHttpServer())
      .get('/api/v1/reconciliation/transactions?from=2026-12-25&to=2026-12-20')
      .set('Authorization', 'Bearer owner-token')
      .expect(400);

    const bWrongAmt = await seedBooking({
      code: 'BK2026122091',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'PENDING_PAYMENT',
      totalAmount: 200000,
    });
    const bExpired = await seedBooking({
      code: 'BK2026122092',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'EXPIRED',
      totalAmount: 300000,
    });
    const bOtherBranch = await seedBooking({
      code: 'BK2026122093',
      branchId: ids.cs02,
      courtId: ids.bd03,
      status: 'PENDING_PAYMENT',
      totalAmount: 450000,
    });

    const txnWrongAmt = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 150000,
      content: 'THANHTOAN BK2026122091',
      matchedBookingId: bWrongAmt,
      transactionAt: parseVnDateTime('2026-12-20', '09:30:00'),
    });
    const txnUnknown = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 250000,
      content: 'CK SAN CAU LONG',
      matchedBookingId: null,
      transactionAt: parseVnDateTime('2026-12-20', '09:40:00'),
    });
    const txnLate = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 300000,
      content: 'THANHTOAN BK2026122092',
      matchedBookingId: bExpired,
      transactionAt: parseVnDateTime('2026-12-20', '09:50:00'),
    });
    const txnAcctMismatch = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 450000,
      content: 'THANHTOAN BK2026122093',
      matchedBookingId: bOtherBranch,
      transactionAt: parseVnDateTime('2026-12-20', '09:55:00'),
    });
    const txnCs02 = await seedBankTxn({
      accountNo: ids.cs02Account,
      amount: 100000,
      content: 'CK CS02',
      matchedBookingId: null,
      transactionAt: parseVnDateTime('2026-12-20', '09:58:00'),
    });

    // STAFF CS01 tries passing branchId=cs02 -> BranchScopeGuard forces cs01
    const staffRes = await request(app.getHttpServer())
      .get(`/api/v1/reconciliation/transactions?branchId=${ids.cs02}&from=2026-12-20&to=2026-12-20`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(200);

    const staffItems = staffRes.body.data as Array<{
      bankTxnId: number;
      branchId: number;
      branchName: string;
      parsedBookingCode: string | null;
      expectedAmount: number | null;
      issue: string | null;
    }>;

    const returnedIds = staffItems.map((i) => i.bankTxnId);
    expect(returnedIds).toContain(txnWrongAmt);
    expect(returnedIds).toContain(txnUnknown);
    expect(returnedIds).toContain(txnLate);
    expect(returnedIds).toContain(txnAcctMismatch);
    expect(returnedIds).not.toContain(txnCs02);

    const byId = new Map(staffItems.map((i) => [i.bankTxnId, i]));
    expect(byId.get(txnWrongAmt)).toMatchObject({
      branchId: ids.cs01,
      parsedBookingCode: 'BK2026122091',
      expectedAmount: 200000,
      issue: 'WRONG_AMOUNT',
    });
    expect(byId.get(txnUnknown)).toMatchObject({
      branchId: ids.cs01,
      parsedBookingCode: null,
      expectedAmount: null,
      issue: 'UNKNOWN_CONTENT',
    });
    expect(byId.get(txnLate)).toMatchObject({
      parsedBookingCode: 'BK2026122092',
      expectedAmount: 300000,
      issue: 'LATE_PAYMENT',
    });
    expect(byId.get(txnAcctMismatch)).toMatchObject({
      parsedBookingCode: 'BK2026122093',
      expectedAmount: 450000,
      issue: 'ACCOUNT_MISMATCH',
    });

    expect(staffRes.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
    });
    expect(staffRes.body.meta.countByStatus.NEEDS_REVIEW).toBeGreaterThanOrEqual(4);

    // OWNER filtering by CS02 sees txnCs02
    const ownerCs02Res = await request(app.getHttpServer())
      .get(`/api/v1/reconciliation/transactions?branchId=${ids.cs02}&from=2026-12-20&to=2026-12-20`)
      .set('Authorization', 'Bearer owner-token')
      .expect(200);

    expect(ownerCs02Res.body.data.map((i: { bankTxnId: number }) => i.bankTxnId)).toContain(txnCs02);
  });

  it('API-68: returns payable candidates in txn branch with amountMatches and enforces STAFF scope', async () => {
    const bPendingMatch = await seedBooking({
      code: 'BK2026122081',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'PENDING_PAYMENT',
      totalAmount: 250000,
    });
    expect(bPendingMatch).toBeGreaterThan(0);

    await seedBooking({
      code: 'BK2026122082',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'CONFIRMED',
      paymentOption: 'DEPOSIT',
      totalAmount: 400000,
      depositAmount: 120000,
      amountDueNow: 120000,
      paidAmount: 120000,
      remainingAmount: 280000,
      paymentStatus: 'DEPOSITED',
    });
    await seedBooking({
      code: 'BK2026122083',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'CONFIRMED',
      totalAmount: 250000,
      paidAmount: 250000,
      remainingAmount: 0,
      paymentStatus: 'PAID',
    });
    await seedBooking({
      code: 'BK2026122084',
      branchId: ids.cs02,
      courtId: ids.bd03,
      status: 'PENDING_PAYMENT',
      totalAmount: 250000,
    });

    const txnCs01 = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 250000,
      content: 'CHUYEN TIEN',
    });
    const txnCs02 = await seedBankTxn({
      accountNo: ids.cs02Account,
      amount: 250000,
      content: 'CHUYEN TIEN CS02',
    });

    // STAFF CS01 cannot query candidates for CS02 txn
    const forbiddenRes = await request(app.getHttpServer())
      .get(`/api/v1/reconciliation/transactions/${txnCs02}/candidates`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(403);
    expect(forbiddenRes.body.error.code).toBe('BRANCH_FORBIDDEN');

    const res = await request(app.getHttpServer())
      .get(`/api/v1/reconciliation/transactions/${txnCs01}/candidates`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(200);

    const codes = res.body.data.map((c: { bookingCode: string }) => c.bookingCode);
    expect(codes).toContain('BK2026122081');
    expect(codes).toContain('BK2026122082');
    expect(codes).not.toContain('BK2026122083'); // already PAID
    expect(codes).not.toContain('BK2026122084'); // different branch

    const c1 = res.body.data.find(
      (c: { bookingCode: string }) => c.bookingCode === 'BK2026122081',
    );
    const c2 = res.body.data.find(
      (c: { bookingCode: string }) => c.bookingCode === 'BK2026122082',
    );
    expect(c1).toMatchObject({ amountDue: 250000, amountMatches: true });
    expect(c2).toMatchObject({ amountDue: 280000, amountMatches: false });

    // Search filter ?q=
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/reconciliation/transactions/${txnCs01}/candidates?q=BK2026122082`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].bookingCode).toBe('BK2026122082');
  });

  it('API-69: matches exact amount, updates booking/payment/QR/notification/audit/sockets, rejects mismatch/already-resolved/non-payable', async () => {
    const bookingId = await seedBooking({
      code: 'BK2026122071',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'PENDING_PAYMENT',
      paymentOption: 'DEPOSIT',
      totalAmount: 500000,
      depositAmount: 150000,
      amountDueNow: 150000,
      withPendingQr: true,
    });
    const expiredBookingId = await seedBooking({
      code: 'BK2026122072',
      branchId: ids.cs01,
      courtId: ids.pb01,
      status: 'EXPIRED',
      totalAmount: 150000,
    });
    const cs02BookingId = await seedBooking({
      code: 'BK2026122073',
      branchId: ids.cs02,
      courtId: ids.bd03,
      status: 'PENDING_PAYMENT',
      totalAmount: 150000,
    });
    expect(expiredBookingId).toBeGreaterThan(0);
    expect(cs02BookingId).toBeGreaterThan(0);

    const txnWrong = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 100000,
      content: 'KHACH CHUYEN THIEU',
    });
    const txnExact = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 150000,
      content: 'KHACH GHI SAI NOI DUNG',
      transactionAt: parseVnDateTime('2026-12-20', '09:50:00'),
    });

    // Amount mismatch -> 422 AMOUNT_MISMATCH (Invariant #6)
    const mismatchRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnWrong}/match`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ bookingCode: 'BK2026122071' })
      .expect(422);
    expect(mismatchRes.body.error.code).toBe('AMOUNT_MISMATCH');

    // Non-payable booking -> 422 BOOKING_NOT_PAYABLE
    const nonPayableRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnExact}/match`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ bookingCode: 'BK2026122072' })
      .expect(422);
    expect(nonPayableRes.body.error.code).toBe('BOOKING_NOT_PAYABLE');

    // Cross-branch booking -> 403 BRANCH_FORBIDDEN
    const crossBranchRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnExact}/match`)
      .set('Authorization', 'Bearer owner-token')
      .send({ bookingCode: 'BK2026122073' })
      .expect(403);
    expect(crossBranchRes.body.error.code).toBe('BRANCH_FORBIDDEN');

    // Exact match -> 200
    const matchRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnExact}/match`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ bookingCode: 'BK2026122071', note: 'Đã gọi xác minh' })
      .expect(200);

    expect(matchRes.body.data).toMatchObject({
      bankTxnId: txnExact,
      matchStatus: 'RESOLVED',
      booking: {
        bookingCode: 'BK2026122071',
        status: 'CONFIRMED',
        paymentStatus: 'DEPOSITED',
        paidAmount: 150000,
        remainingAmount: 350000,
      },
      receipt: {
        bookingCode: 'BK2026122071',
        purpose: 'DEPOSIT',
        method: 'BANK_TRANSFER',
        amount: 150000,
      },
    });
    expect(matchRes.body.data.receipt.paymentCode).toMatch(/^PT\d{10,}$/);

    // Verify DB state: Payments, PaymentRequest, BankTransactions, Notifications, AuditLogs
    const exec = await txService.executor();
    const payRow = await exec
      .request()
      .input('bankTxnId', sql.BigInt, txnExact)
      .query<{ Purpose: string; Method: string; Amount: number; CollectedBy: number }>(
        `SELECT Purpose, Method, Amount, CollectedBy FROM dbo.Payments WHERE BankTxnId = @bankTxnId`,
      );
    expect(payRow.recordset).toHaveLength(1);
    expect(Number(payRow.recordset[0].Amount)).toBe(150000);
    expect(Number(payRow.recordset[0].CollectedBy)).toBe(ids.staffCs01Id);

    const qrRow = await exec
      .request()
      .input('bookingId', sql.BigInt, bookingId)
      .query<{ Status: string }>(`SELECT Status FROM dbo.PaymentRequest WHERE BookingId = @bookingId`);
    expect(qrRow.recordset[0].Status).toBe('PAID');

    const txnRow = await exec
      .request()
      .input('bankTxnId', sql.BigInt, txnExact)
      .query<{ MatchStatus: string; MatchedBookingId: number; ResolveNote: string }>(
        `SELECT MatchStatus, MatchedBookingId, ResolveNote FROM dbo.BankTransactions WHERE BankTxnId = @bankTxnId`,
      );
    expect(txnRow.recordset[0].MatchStatus).toBe('RESOLVED');
    expect(Number(txnRow.recordset[0].MatchedBookingId)).toBe(bookingId);
    expect(txnRow.recordset[0].ResolveNote).toBe('Đã gọi xác minh');

    const notifRow = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(bookingId))
      .query<{ Type: string; UserId: number }>(
        `SELECT Type, UserId FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef`,
      );
    expect(notifRow.recordset.some((n) => n.Type === 'PAYMENT_RESULT')).toBe(true);

    const auditRow = await exec
      .request()
      .input('entityId', sql.VarChar(50), String(txnExact))
      .query<{ Action: string }>(
        `SELECT Action FROM dbo.AuditLogs WHERE EntityType = 'BankTransactions' AND EntityId = @entityId`,
      );
    expect(auditRow.recordset.some((a) => a.Action === 'MATCH_BANK_TXN')).toBe(true);

    // Socket events emitted post-commit
    expect(emittedEvents.some((e) => e.event === 'booking.paid')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'booking.updated')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'slot.updated')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'notification.created')).toBe(true);

    // Re-matching same txn -> 422 BANK_TXN_ALREADY_RESOLVED
    const retryRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnExact}/match`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ bookingCode: 'BK2026122071' })
      .expect(422);
    expect(retryRes.body.error.code).toBe('BANK_TXN_ALREADY_RESOLVED');

    // Also test matching remaining amount of CONFIRMED + DEPOSITED booking
    const txnRemaining = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 350000,
      content: 'TAT TOAN BK2026122071',
    });
    const settleMatchRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnRemaining}/match`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ bookingCode: 'BK2026122071' })
      .expect(200);

    expect(settleMatchRes.body.data.booking).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: 500000,
      remainingAmount: 0,
    });
    expect(settleMatchRes.body.data.receipt.purpose).toBe('REMAINING');
  });

  it('API-70 & API-71: refund-to-customer and ignore transactions with validation, scope, and already-resolved checks', async () => {
    const txnRefund = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 90000,
      content: 'CHUYEN SAI SO TIEN',
    });
    const txnIgnore = await seedBankTxn({
      accountNo: ids.cs01Account,
      amount: 50000,
      content: 'LAI NGAN HANG',
    });
    const txnCs02 = await seedBankTxn({
      accountNo: ids.cs02Account,
      amount: 50000,
      content: 'CS02 TXN',
    });

    // STAFF CS01 blocked from CS02 txn
    await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnCs02}/refund-to-customer`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ note: 'Đã hoàn lại khách' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnCs02}/ignore`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({})
      .expect(403);

    // Refund note min 3 chars
    await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnRefund}/refund-to-customer`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ note: 'ab' })
      .expect(400);

    const refundRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnRefund}/refund-to-customer`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ note: 'Đã CK trả 90.000đ cho VCB 999888' })
      .expect(200);

    expect(refundRes.body.data).toMatchObject({
      bankTxnId: txnRefund,
      matchStatus: 'RESOLVED',
      resolution: {
        action: 'REFUNDED',
        note: 'Đã CK trả 90.000đ cho VCB 999888',
      },
    });

    // Already resolved -> 422
    const retryIgnore = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnRefund}/ignore`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({})
      .expect(422);
    expect(retryIgnore.body.error.code).toBe('BANK_TXN_ALREADY_RESOLVED');

    // Ignore without body or empty body
    const ignoreRes = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnIgnore}/ignore`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(200);

    expect(ignoreRes.body.data).toMatchObject({
      bankTxnId: txnIgnore,
      matchStatus: 'IGNORED',
    });

    // Retry refund on ignored -> 422
    const retryRefund = await request(app.getHttpServer())
      .post(`/api/v1/reconciliation/transactions/${txnIgnore}/refund-to-customer`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ note: 'Test retry' })
      .expect(422);
    expect(retryRefund.body.error.code).toBe('BANK_TXN_ALREADY_RESOLVED');
  });

  it('API-72 & API-73: OWNER-only refunds list, complete/fail, notifications, audit, and 403 for STAFF', async () => {
    const b1 = await seedBooking({
      code: 'BK2026122061',
      branchId: ids.cs01,
      courtId: ids.pb01,
      customerUserId: ids.anId,
      status: 'CANCELED',
      totalAmount: 300000,
      paidAmount: 300000,
      remainingAmount: 0,
      paymentStatus: 'PAID',
      cancelType: 'BY_FACILITY',
    });
    const b2 = await seedBooking({
      code: 'BK2026122062',
      branchId: ids.cs02,
      courtId: ids.bd03,
      customerUserId: ids.binhId,
      status: 'CANCELED',
      totalAmount: 400000,
      paidAmount: 400000,
      remainingAmount: 0,
      paymentStatus: 'PAID',
      cancelType: 'CUSTOMER_REQUEST',
    });

    const refund1 = await seedRefund({
      bookingId: b1,
      amount: 300000,
      rate: 100,
      reason: 'Đóng sân bảo trì',
      status: 'PENDING',
    });
    const refund2 = await seedRefund({
      bookingId: b2,
      amount: 200000,
      rate: 50,
      reason: 'Khách hủy trước 3 ngày',
      status: 'PENDING',
    });

    // STAFF gets 403 on all /refunds endpoints
    await request(app.getHttpServer())
      .get('/api/v1/refunds')
      .set('Authorization', 'Bearer staff-cs01-token')
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund1}/complete`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({})
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund1}/fail`)
      .set('Authorization', 'Bearer staff-cs01-token')
      .send({ note: 'Sai STK' })
      .expect(403);

    // OWNER lists pending refunds filtered by branch
    const listCs01 = await request(app.getHttpServer())
      .get(`/api/v1/refunds?branchId=${ids.cs01}&status=PENDING&from=2026-12-20&to=2026-12-20`)
      .set('Authorization', 'Bearer owner-token')
      .expect(200);

    expect(listCs01.body.data).toHaveLength(1);
    expect(listCs01.body.data[0]).toMatchObject({
      refundId: refund1,
      bookingCode: 'BK2026122061',
      branchId: ids.cs01,
      amount: 300000,
      rate: 100,
      cancelType: 'BY_FACILITY',
      status: 'PENDING',
    });
    expect(listCs01.body.meta).toMatchObject({
      total: 1,
      totalAmount: 300000,
      countByStatus: { PENDING: 1, COMPLETED: 0, FAILED: 0 },
    });

    // Complete refund1
    const completeRes = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund1}/complete`)
      .set('Authorization', 'Bearer owner-token')
      .send({ note: 'Đã CK VCB ref 12345' })
      .expect(200);

    expect(completeRes.body.data).toMatchObject({
      refundId: refund1,
      status: 'COMPLETED',
      note: 'Đã CK VCB ref 12345',
    });
    expect(completeRes.body.data.processedAt).toBeTruthy();

    // Notification sent to customer An
    const exec = await txService.executor();
    const notifRes = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(b1))
      .query<{ Type: string; Title: string }>(
        `SELECT Type, Title FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef`,
      );
    expect(notifRes.recordset.some((n) => n.Type === 'PAYMENT_RESULT')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'notification.created')).toBe(true);

    // Re-completing or failing processed refund -> 422 REFUND_ALREADY_PROCESSED
    const dupComplete = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund1}/complete`)
      .set('Authorization', 'Bearer owner-token')
      .send({})
      .expect(422);
    expect(dupComplete.body.error.code).toBe('REFUND_ALREADY_PROCESSED');

    const dupFail = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund1}/fail`)
      .set('Authorization', 'Bearer owner-token')
      .send({ note: 'Thử lại' })
      .expect(422);
    expect(dupFail.body.error.code).toBe('REFUND_ALREADY_PROCESSED');

    // Fail refund2 requires note min 3 chars
    await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund2}/fail`)
      .set('Authorization', 'Bearer owner-token')
      .send({ note: 'no' })
      .expect(400);

    const failRes = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refund2}/fail`)
      .set('Authorization', 'Bearer owner-token')
      .send({ note: 'Khách cung cấp sai số tài khoản' })
      .expect(200);

    expect(failRes.body.data).toMatchObject({
      refundId: refund2,
      status: 'FAILED',
      note: 'Khách cung cấp sai số tài khoản',
    });

    // Missing refund -> 404
    await request(app.getHttpServer())
      .post('/api/v1/refunds/999999999/complete')
      .set('Authorization', 'Bearer owner-token')
      .send({})
      .expect(404);
  });
});
