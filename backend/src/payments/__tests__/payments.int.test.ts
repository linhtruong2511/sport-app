import { randomUUID } from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { BookingChannel, BookingStatus, PaymentOption, PaymentStatus } from '@sporthub/shared/enums';
import express from 'express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingStateService } from '../../bookings/booking-state.service.js';
import { closePool, sql } from '../../config/database.js';
import { env } from '../../config/env.js';
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
import { SettingsService } from '../../core/settings.service.js';
import { addMinutes, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { FakeBankGateway, SepayBankGateway } from '../../integrations/sepay/bank-gateway.js';
import { PaymentsModule } from '../payments.module.js';
import { PaymentsService } from '../payments.service.js';

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

const fakeClock = new FakeClock(new Date('2026-11-12T10:00:00.000Z')); // 17:00:00 +07:00
const fakeBankGateway = new FakeBankGateway();

@Module({
  imports: [CoreModule, DatabaseModule, TestAuthModule, PaymentsModule],
})
class PaymentsTestAppModule {}

describe('payments & webhook integration', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let paymentsService: PaymentsService;
  let settingsService: SettingsService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let origClockNow: () => Date;
  let sepayGateway: SepayBankGateway;
  let origFindTransactions: SepayBankGateway['findTransactions'];
  let emittedEvents: EmittedEvent[] = [];

  let cs01Id: number;
  let pb01Id: number;
  let anId: number;
  let binhId: number;
  let staffCs01Id: number;
  let cs01BankAcc: string;
  let cs02BankAcc: string;

  const createdBookingIds: number[] = [];
  const createdProviderTxnIds: string[] = [];
  const createdIdempotencyKeys: string[] = [];

  async function seedBooking(opts: {
    code: string;
    branchId?: number;
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
  }): Promise<number> {
    const now = fakeClock.now();
    const startAt = addMinutes(now, 120);
    const endAt = addMinutes(startAt, 60);
    const totalAmount = opts.totalAmount ?? 300_000;
    const paymentOption = opts.paymentOption ?? 'DEPOSIT';
    const depositAmount = opts.depositAmount ?? (paymentOption === 'DEPOSIT' ? 90_000 : 0);
    const amountDueNow = opts.amountDueNow ?? (paymentOption === 'DEPOSIT' ? depositAmount : totalAmount);
    const paidAmount = opts.paidAmount ?? 0;
    const remainingAmount = opts.remainingAmount ?? totalAmount - paidAmount;
    const status = opts.status ?? 'PENDING_PAYMENT';
    const paymentStatus = opts.paymentStatus ?? 'UNPAID';
    const holdExpireAt =
      opts.holdExpireAt !== undefined
        ? opts.holdExpireAt
        : status === 'PENDING_PAYMENT'
          ? addMinutes(now, 10)
          : null;
    const customerUserId = opts.customerUserId !== undefined ? opts.customerUserId : anId;
    const channel = opts.channel ?? 'ONLINE';

    const exec = await txService.executor();
    const res = await exec
      .request()
      .input('code', sql.VarChar(20), opts.code)
      .input('branchId', sql.Int, opts.branchId ?? cs01Id)
      .input('courtId', sql.Int, pb01Id)
      .input('customerUserId', sql.BigInt, customerUserId)
      .input('guestName', sql.NVarChar(100), customerUserId === null ? 'Khách vãng lai' : null)
      .input('guestPhone', sql.VarChar(10), customerUserId === null ? '0909111222' : null)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startAt))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endAt))
      .input('totalAmount', sql.Decimal(18, 0), totalAmount)
      .input('paymentOption', sql.VarChar(10), paymentOption)
      .input('depositType', sql.VarChar(10), paymentOption === 'DEPOSIT' ? 'PERCENT' : null)
      .input('depositValue', sql.Decimal(18, 2), paymentOption === 'DEPOSIT' ? 30 : null)
      .input('depositAmount', sql.Decimal(18, 0), depositAmount)
      .input('amountDueNow', sql.Decimal(18, 0), amountDueNow)
      .input('paidAmount', sql.Decimal(18, 0), paidAmount)
      .input('remainingAmount', sql.Decimal(18, 0), remainingAmount)
      .input('status', sql.VarChar(20), status)
      .input('paymentStatus', sql.VarChar(20), paymentStatus)
      .input('holdExpireAt', sql.DateTime2(0), holdExpireAt ? toSqlDateTime(holdExpireAt) : null)
      .input('cancelType', sql.VarChar(20), status === 'CANCELED' ? 'CUSTOMER_REQUEST' : null)
      .input('cancelReason', sql.NVarChar(255), status === 'CANCELED' ? 'Test cancel' : null)
      .input('canceledAt', sql.DateTime2(0), status === 'CANCELED' ? toSqlDateTime(now) : null)
      .input('now', sql.DateTime2(0), toSqlDateTime(now))
      .input('channel', sql.VarChar(20), channel)
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
    return bookingId;
  }

  beforeAll(async () => {
    const expressApp = express();
    app = await NestFactory.create(PaymentsTestAppModule, new ExpressAdapter(expressApp), {
      logger: false,
      bodyParser: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(
      express.json({
        limit: '1mb',
        verify: (req, _res, buf) => {
          (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
        },
      }),
    );
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    paymentsService = app.get(PaymentsService);
    settingsService = app.get(SettingsService);
    realtimeService = app.get(RealtimeService);

    systemClock = app.get(SystemClock);
    origClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    sepayGateway = app.get(SepayBankGateway);
    origFindTransactions = sepayGateway.findTransactions.bind(sepayGateway);
    sepayGateway.findTransactions = (q) => fakeBankGateway.findTransactions(q);

    settingsService.setOverrides({
      QR_EXPIRE_MINUTES: 10,
      NO_SHOW_GRACE_MINUTES: 30,
    });

    const fakeServer = {
      to: (rooms: string | string[]) => ({
        emit: (event: string, payload: unknown) => {
          emittedEvents.push({
            rooms: Array.isArray(rooms) ? rooms : [rooms],
            event,
            payload,
          });
        },
      }),
    } as unknown as Server;
    realtimeService.attachServer(fakeServer);

    const exec = await txService.executor();
    const branchesRes = await exec.request().query<{
      Code: string;
      BranchId: number;
      BankAccountNo: string;
    }>(`SELECT Code, BranchId, BankAccountNo FROM dbo.Branches WHERE Code IN ('CS01', 'CS02')`);
    const branchMap = new Map(branchesRes.recordset.map((b) => [b.Code, b]));
    cs01Id = Number(branchMap.get('CS01')!.BranchId);
    cs01BankAcc = branchMap.get('CS01')!.BankAccountNo;
    cs02BankAcc = branchMap.get('CS02')!.BankAccountNo;

    const courtRes = await exec.request().query<{ CourtId: number }>(`
      SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_PB_01'
    `);
    pb01Id = Number(courtRes.recordset[0].CourtId);

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      Role: 'OWNER' | 'STAFF' | 'CUSTOMER';
      BranchId: number | null;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, Role, BranchId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0987654321', '0912345678', '0933445577', '0933445566', '0900000001')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));
    const an = userMap.get('0987654321')!;
    const binh = userMap.get('0912345678')!;
    const staff1 = userMap.get('0933445577')!;
    const staff2 = userMap.get('0933445566')!;
    const owner = userMap.get('0900000001')!;

    anId = Number(an.UserId);
    binhId = Number(binh.UserId);
    staffCs01Id = Number(staff1.UserId);

    seededUsers = {
      'token-an': { userId: anId, role: an.Role, branchId: null, tv: Number(an.TokenVersion) },
      'token-binh': { userId: binhId, role: binh.Role, branchId: null, tv: Number(binh.TokenVersion) },
      'token-staff-cs01': {
        userId: staffCs01Id,
        role: staff1.Role,
        branchId: Number(staff1.BranchId),
        tv: Number(staff1.TokenVersion),
      },
      'token-staff-cs02': {
        userId: Number(staff2.UserId),
        role: staff2.Role,
        branchId: Number(staff2.BranchId),
        tv: Number(staff2.TokenVersion),
      },
      'token-owner': {
        userId: Number(owner.UserId),
        role: owner.Role,
        branchId: null,
        tv: Number(owner.TokenVersion),
      },
    };
  });

  beforeEach(() => {
    fakeClock.set(new Date('2026-11-12T10:00:00.000Z'));
    fakeBankGateway.clear();
    emittedEvents = [];
  });

  afterEach(async () => {
    const exec = await txService.executor();

    if (createdBookingIds.length > 0) {
      const idList = createdBookingIds.join(',');
      await exec.request().query(`DELETE FROM dbo.Payments WHERE BookingId IN (${idList})`);
      await exec.request().query(`DELETE FROM dbo.BankTransactions WHERE MatchedBookingId IN (${idList})`);
      await exec.request().query(`DELETE FROM dbo.PaymentRequest WHERE BookingId IN (${idList})`);
      await exec.request().query(`DELETE FROM dbo.BookingStatusHistory WHERE BookingId IN (${idList})`);
      await exec.request().query(`DELETE FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef IN (${createdBookingIds.map((id) => `'${id}'`).join(',')})`);
      await exec.request().query(`DELETE FROM dbo.Bookings WHERE BookingId IN (${idList})`);
      createdBookingIds.length = 0;
    }

    if (createdProviderTxnIds.length > 0) {
      for (const txnId of createdProviderTxnIds) {
        await exec
          .request()
          .input('txnId', sql.VarChar(100), txnId)
          .query(`DELETE FROM dbo.BankTransactions WHERE Provider = 'SEPAY' AND ProviderTxnId = @txnId`);
      }
      createdProviderTxnIds.length = 0;
    }

    if (createdIdempotencyKeys.length > 0) {
      for (const key of createdIdempotencyKeys) {
        await exec
          .request()
          .input('key', sql.UniqueIdentifier, key)
          .query(`DELETE FROM dbo.IdempotencyKeys WHERE IdempotencyKey = @key`);
      }
      createdIdempotencyKeys.length = 0;
    }
  });

  afterAll(async () => {
    if (systemClock && origClockNow) {
      systemClock.now = origClockNow;
    }
    if (sepayGateway && origFindTransactions) {
      sepayGateway.findTransactions = origFindTransactions;
    }
    settingsService?.setOverrides(null);
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-15 & API-16: creates, retrieves, regenerates QR and enforces access/idempotency/errors', async () => {
    const code = 'BK20261112901';
    const bookingId = await seedBooking({ code, paymentOption: 'DEPOSIT', totalAmount: 300_000, depositAmount: 90_000 });

    // No PENDING request yet -> 404
    const getMissing = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}/payment-request`)
      .set('Authorization', 'Bearer token-an');
    expect(getMissing.status).toBe(404);
    expect(getMissing.body.error.code).toBe('NOT_FOUND');

    // Missing Idempotency-Key -> 400
    const missingIdem = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .send({});
    expect(missingIdem.status).toBe(400);
    expect(missingIdem.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    // Create QR (API-16)
    const idem1 = randomUUID();
    createdIdempotencyKeys.push(idem1);
    const create1 = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem1)
      .send({ purpose: null });
    expect(create1.status).toBe(201);
    expect(create1.body.data).toMatchObject({
      bookingCode: code,
      purpose: 'DEPOSIT',
      amount: 90_000,
      transferContent: `THANHTOAN ${code}`,
      status: 'PENDING',
      bank: {
        bin: '970436',
        accountNo: cs01BankAcc,
      },
    });
    expect(create1.body.data.qrPayload).toContain(`THANHTOAN ${code}`);
    const req1Id = create1.body.data.requestId;

    // Replay same Idempotency-Key -> same requestId
    const replay = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem1)
      .send({ purpose: null });
    expect(replay.status).toBe(201);
    expect(replay.body.data.requestId).toBe(req1Id);

    // Get active QR (API-15)
    const getActive = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}/payment-request`)
      .set('Authorization', 'Bearer token-an');
    expect(getActive.status).toBe(200);
    expect(getActive.body.data.requestId).toBe(req1Id);

    // Access control: other customer -> 403 BOOKING_FORBIDDEN; CS02 staff -> 403 BRANCH_FORBIDDEN
    const forbiddenCust = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}/payment-request`)
      .set('Authorization', 'Bearer token-binh');
    expect(forbiddenCust.status).toBe(403);
    expect(forbiddenCust.body.error.code).toBe('BOOKING_FORBIDDEN');

    const forbiddenStaff = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}/payment-request`)
      .set('Authorization', 'Bearer token-staff-cs02');
    expect(forbiddenStaff.status).toBe(403);
    expect(forbiddenStaff.body.error.code).toBe('BRANCH_FORBIDDEN');

    // Regenerate QR marks previous PENDING as EXPIRED
    const idem2 = randomUUID();
    createdIdempotencyKeys.push(idem2);
    const create2 = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem2)
      .send({});
    expect(create2.status).toBe(201);
    expect(create2.body.data.requestId).not.toBe(req1Id);

    const exec = await txService.executor();
    const oldReqRes = await exec
      .request()
      .input('id', sql.BigInt, req1Id)
      .query<{ Status: string }>('SELECT Status FROM dbo.PaymentRequest WHERE RequestId = @id');
    expect(oldReqRes.recordset[0].Status).toBe('EXPIRED');

    // Hold expired -> 422 HOLD_EXPIRED
    fakeClock.advanceMinutes(11);
    const idem3 = randomUUID();
    createdIdempotencyKeys.push(idem3);
    const expiredRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem3)
      .send({});
    expect(expiredRes.status).toBe(422);
    expect(expiredRes.body.error.code).toBe('HOLD_EXPIRED');

    // Cleanup bookingId reference used
    expect(bookingId).toBeGreaterThan(0);
  });

  it('API-16: returns 422 BRANCH_BANK_NOT_CONFIGURED, BOOKING_NOT_PAYABLE, NOTHING_TO_PAY, and creates REMAINING QR', async () => {
    const exec = await txService.executor();

    // 1. BRANCH_BANK_NOT_CONFIGURED
    const tempBranchRes = await exec.request().query<{ BranchId: number }>(`
      INSERT INTO dbo.Branches (Code, Name, Address, Status)
      OUTPUT inserted.BranchId
      VALUES ('CS_NOBANK', N'Cơ sở chưa cấu hình NH', N'Hà Nội', 'ACTIVE')
    `);
    const noBankBranchId = Number(tempBranchRes.recordset[0].BranchId);

    try {
      const noBankCode = 'BK20261112902';
      await seedBooking({ code: noBankCode, branchId: noBankBranchId });
      const idem = randomUUID();
      createdIdempotencyKeys.push(idem);

      const resNoBank = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${noBankCode}/payment-requests`)
        .set('Authorization', 'Bearer token-an')
        .set('Idempotency-Key', idem)
        .send({});
      expect(resNoBank.status).toBe(422);
      expect(resNoBank.body.error.code).toBe('BRANCH_BANK_NOT_CONFIGURED');
    } finally {
      // Delete bookings first if any exist before deleting temp branch
      if (createdBookingIds.length > 0) {
        await exec.request().query(`DELETE FROM dbo.Bookings WHERE BookingId IN (${createdBookingIds.join(',')})`);
        createdBookingIds.length = 0;
      }
      await exec.request().input('bid', sql.Int, noBankBranchId).query('DELETE FROM dbo.Branches WHERE BranchId = @bid');
    }

    // 2. CANCELED -> BOOKING_NOT_PAYABLE
    const canceledCode = 'BK20261112903';
    await seedBooking({ code: canceledCode, status: 'CANCELED' });
    const idemCancel = randomUUID();
    createdIdempotencyKeys.push(idemCancel);
    const resCanceled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${canceledCode}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idemCancel)
      .send({});
    expect(resCanceled.status).toBe(422);
    expect(resCanceled.body.error.code).toBe('BOOKING_NOT_PAYABLE');

    // 3. CONFIRMED + PAID -> NOTHING_TO_PAY
    const paidCode = 'BK20261112904';
    await seedBooking({
      code: paidCode,
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paymentOption: 'FULL',
      totalAmount: 200_000,
      paidAmount: 200_000,
      remainingAmount: 0,
    });
    const idemPaid = randomUUID();
    createdIdempotencyKeys.push(idemPaid);
    const resPaid = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paidCode}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idemPaid)
      .send({});
    expect(resPaid.status).toBe(422);
    expect(resPaid.body.error.code).toBe('NOTHING_TO_PAY');

    // 4. CONFIRMED + DEPOSITED -> REMAINING
    const depCode = 'BK20261112905';
    await seedBooking({
      code: depCode,
      status: 'CONFIRMED',
      paymentStatus: 'DEPOSITED',
      paymentOption: 'DEPOSIT',
      totalAmount: 300_000,
      depositAmount: 90_000,
      amountDueNow: 90_000,
      paidAmount: 90_000,
      remainingAmount: 210_000,
    });
    const idemDep = randomUUID();
    createdIdempotencyKeys.push(idemDep);
    const resDep = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${depCode}/payment-requests`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', idemDep)
      .send({ purpose: null });
    expect(resDep.status).toBe(201);
    expect(resDep.body.data.purpose).toBe('REMAINING');
    expect(resDep.body.data.amount).toBe(210_000);
  });

  it('API-17: recheck handles gateway error (502), rate limit (429), pending, and matching transaction (PAID)', async () => {
    const code = 'BK20261112906';
    await seedBooking({ code, paymentOption: 'DEPOSIT', totalAmount: 300_000, depositAmount: 90_000 });
    const idem = randomUUID();
    createdIdempotencyKeys.push(idem);

    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem)
      .send({});
    const requestId = createRes.body.data.requestId as number;

    // 1. Gateway error -> 502 PAYMENT_GATEWAY_ERROR
    fakeBankGateway.setNextError(new AppError('PAYMENT_GATEWAY_ERROR'));
    const res502 = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${requestId}/recheck`)
      .set('Authorization', 'Bearer token-an');
    expect(res502.status).toBe(502);
    expect(res502.body.error.code).toBe('PAYMENT_GATEWAY_ERROR');

    // 2. Immediate second call -> 429 TOO_MANY_REQUESTS + Retry-After header
    const res429 = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${requestId}/recheck`)
      .set('Authorization', 'Bearer token-an');
    expect(res429.status).toBe(429);
    expect(res429.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(Number(res429.headers['retry-after'])).toBeGreaterThanOrEqual(1);

    // 3. Advance 5s -> returns 200 PENDING when gateway has no txn
    fakeClock.advanceSeconds(5);
    const resPending = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${requestId}/recheck`)
      .set('Authorization', 'Bearer token-an');
    expect(resPending.status).toBe(200);
    expect(resPending.body.data).toEqual({
      requestId,
      status: 'PENDING',
      message: 'Chưa nhận được giao dịch báo có. Vui lòng kiểm tra lại sau ít giây.',
    });

    // 4. Advance 5s + add matching txn in gateway -> returns 200 PAID
    fakeClock.advanceSeconds(5);
    const txnId = 'RECHECK_TXN_906';
    createdProviderTxnIds.push(txnId);
    fakeBankGateway.addTransaction({
      id: txnId,
      gateway: 'Vietcombank',
      transactionDate: '2026-11-12 17:00:10',
      accountNumber: cs01BankAcc,
      content: `THANHTOAN ${code}`,
      transferType: 'in',
      transferAmount: 90_000,
    });

    const resPaid = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${requestId}/recheck`)
      .set('Authorization', 'Bearer token-an');
    expect(resPaid.status).toBe(200);
    expect(resPaid.body.data).toMatchObject({
      requestId,
      status: 'PAID',
      message: 'Đã nhận giao dịch 90.000 VNĐ đúng số tiền & nội dung.',
      booking: {
        bookingCode: code,
        status: 'CONFIRMED',
        paymentStatus: 'DEPOSITED',
        paidAmount: 90_000,
        remainingAmount: 210_000,
      },
    });
  });

  it('Webhook: 401 wrong key, auto-matches DEPOSIT -> CONFIRMED+DEPOSITED, then REMAINING -> PAID, and is idempotent', async () => {
    const code = 'BK20261112907';
    const bookingId = await seedBooking({
      code,
      paymentOption: 'DEPOSIT',
      totalAmount: 300_000,
      depositAmount: 90_000,
    });

    const idem = randomUUID();
    createdIdempotencyKeys.push(idem);
    const qrRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem)
      .send({});
    const depositReqId = qrRes.body.data.requestId as number;

    // 1. Wrong API key -> 401, writes nothing
    const badAuth = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', 'Apikey wrong-key')
      .send({
        id: 'TXN_BAD_AUTH',
        transactionDate: '2026-11-12 17:01:00',
        accountNumber: cs01BankAcc,
        content: `THANHTOAN ${code}`,
        transferType: 'in',
        transferAmount: 90_000,
      });
    expect(badAuth.status).toBe(401);

    const exec = await txService.executor();
    const badCheck = await exec
      .request()
      .query(`SELECT COUNT(*) AS Cnt FROM dbo.BankTransactions WHERE ProviderTxnId = 'TXN_BAD_AUTH'`);
    expect(badCheck.recordset[0].Cnt).toBe(0);

    // 2. Deposit webhook -> CONFIRMED + DEPOSITED + PAYMENT_RESULT notification + booking.paid + slot.updated
    const depTxnId = 'SP_WEBHOOK_DEP_907';
    createdProviderTxnIds.push(depTxnId);
    const depRes = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: depTxnId,
        gateway: 'Vietcombank',
        transactionDate: '2026-11-12 17:01:00',
        accountNumber: cs01BankAcc,
        content: `CK ${code.toLowerCase()}`,
        transferType: 'in',
        transferAmount: 90_000,
      });
    expect(depRes.status).toBe(200);
    expect(depRes.body).toEqual({ success: true });

    const bAfterDep = await exec
      .request()
      .input('bid', sql.BigInt, bookingId)
      .query<{ Status: string; PaymentStatus: string; PaidAmount: number; RemainingAmount: number; HoldExpireAt: Date | null }>(
        'SELECT Status, PaymentStatus, PaidAmount, RemainingAmount, HoldExpireAt FROM dbo.Bookings WHERE BookingId = @bid',
      );
    expect(bAfterDep.recordset[0]).toMatchObject({
      Status: 'CONFIRMED',
      PaymentStatus: 'DEPOSITED',
      PaidAmount: 90_000,
      RemainingAmount: 210_000,
      HoldExpireAt: null,
    });

    const reqAfterDep = await exec
      .request()
      .input('rid', sql.BigInt, depositReqId)
      .query<{ Status: string }>('SELECT Status FROM dbo.PaymentRequest WHERE RequestId = @rid');
    expect(reqAfterDep.recordset[0].Status).toBe('PAID');

    const notifRes = await exec
      .request()
      .input('ref', sql.VarChar(50), String(bookingId))
      .query<{ Type: string; UserId: number }>(
        "SELECT Type, UserId FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @ref",
      );
    expect(notifRes.recordset.length).toBe(1);
    expect(notifRes.recordset[0].Type).toBe('PAYMENT_RESULT');
    expect(Number(notifRes.recordset[0].UserId)).toBe(anId);

    expect(emittedEvents.some((e) => e.event === 'booking.paid')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'booking.updated')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'slot.updated')).toBe(true);

    // 3. Duplicate ProviderTxnId -> 200 idempotent, no second Payments row
    const dupRes = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: depTxnId,
        gateway: 'Vietcombank',
        transactionDate: '2026-11-12 17:01:00',
        accountNumber: cs01BankAcc,
        content: `CK ${code}`,
        transferType: 'in',
        transferAmount: 90_000,
      });
    expect(dupRes.status).toBe(200);
    expect(dupRes.body).toEqual({ success: true });

    const payCountRes = await exec
      .request()
      .input('bid', sql.BigInt, bookingId)
      .query<{ Cnt: number }>('SELECT COUNT(*) AS Cnt FROM dbo.Payments WHERE BookingId = @bid');
    expect(payCountRes.recordset[0].Cnt).toBe(1);

    // 4. Remaining payment webhook -> CONFIRMED + PAID
    emittedEvents = [];
    const remTxnId = 'SP_WEBHOOK_REM_907';
    createdProviderTxnIds.push(remTxnId);
    const remRes = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: remTxnId,
        gateway: 'Vietcombank',
        transactionDate: '2026-11-12 17:02:00',
        accountNumber: cs01BankAcc,
        content: `THANHTOAN ${code}`,
        transferType: 'in',
        transferAmount: 210_000,
      });
    expect(remRes.status).toBe(200);

    const bAfterRem = await exec
      .request()
      .input('bid', sql.BigInt, bookingId)
      .query<{ Status: string; PaymentStatus: string; PaidAmount: number; RemainingAmount: number }>(
        'SELECT Status, PaymentStatus, PaidAmount, RemainingAmount FROM dbo.Bookings WHERE BookingId = @bid',
      );
    expect(bAfterRem.recordset[0]).toMatchObject({
      Status: 'CONFIRMED',
      PaymentStatus: 'PAID',
      PaidAmount: 300_000,
      RemainingAmount: 0,
    });
    expect(emittedEvents.some((e) => e.event === 'booking.paid')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'slot.updated')).toBe(false);
  });

  it('Webhook: marks NEEDS_REVIEW for wrong amount, unknown content, account mismatch, expired hold, and IGNORED for out', async () => {
    const exec = await txService.executor();

    // Case 1: Wrong amount
    const code1 = 'BK20261112908';
    await seedBooking({ code: code1, paymentOption: 'FULL', totalAmount: 250_000 });
    const txnWrongAmt = 'SP_WRONG_AMT_908';
    createdProviderTxnIds.push(txnWrongAmt);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: txnWrongAmt,
        transactionDate: '2026-11-12 17:00:00',
        accountNumber: cs01BankAcc,
        content: `THANHTOAN ${code1}`,
        transferType: 'in',
        transferAmount: 240_000,
      });
    expect(
      emittedEvents.find((e) => e.event === 'reconciliation.created')?.payload,
    ).toMatchObject({ issue: 'WRONG_AMOUNT', bookingCode: code1 });

    // Case 2: Unknown content
    emittedEvents = [];
    const txnUnknown = 'SP_UNKNOWN_908';
    createdProviderTxnIds.push(txnUnknown);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: txnUnknown,
        transactionDate: '2026-11-12 17:00:00',
        accountNumber: cs01BankAcc,
        content: 'CHUYEN TIEN SAN',
        transferType: 'in',
        transferAmount: 100_000,
      });
    expect(
      emittedEvents.find((e) => e.event === 'reconciliation.created')?.payload,
    ).toMatchObject({ issue: 'UNKNOWN_CONTENT', bookingCode: null });

    // Case 3: Account mismatch (CS01 booking paid to CS02 account)
    emittedEvents = [];
    const txnMismatch = 'SP_MISMATCH_908';
    createdProviderTxnIds.push(txnMismatch);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: txnMismatch,
        transactionDate: '2026-11-12 17:00:00',
        accountNumber: cs02BankAcc,
        content: `THANHTOAN ${code1}`,
        transferType: 'in',
        transferAmount: 250_000,
      });
    expect(
      emittedEvents.find((e) => e.event === 'reconciliation.created')?.payload,
    ).toMatchObject({ issue: 'ACCOUNT_MISMATCH', bookingCode: code1 });

    // Case 4: now > HoldExpireAt before expireHolds job runs -> LATE_PAYMENT
    emittedEvents = [];
    const codeLate = 'BK20261112909';
    const lateBookingId = await seedBooking({
      code: codeLate,
      paymentOption: 'FULL',
      totalAmount: 250_000,
      holdExpireAt: addMinutes(fakeClock.now(), -1),
    });
    const txnLate = 'SP_LATE_909';
    createdProviderTxnIds.push(txnLate);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: txnLate,
        transactionDate: '2026-11-12 17:00:00',
        accountNumber: cs01BankAcc,
        content: `THANHTOAN ${codeLate}`,
        transferType: 'in',
        transferAmount: 250_000,
      });
    expect(
      emittedEvents.find((e) => e.event === 'reconciliation.created')?.payload,
    ).toMatchObject({ issue: 'LATE_PAYMENT', bookingCode: codeLate });

    const lateBookingRes = await exec
      .request()
      .input('bid', sql.BigInt, lateBookingId)
      .query<{ Status: string }>('SELECT Status FROM dbo.Bookings WHERE BookingId = @bid');
    expect(lateBookingRes.recordset[0].Status).toBe('PENDING_PAYMENT');

    // Case 5: transferType = 'out' -> IGNORED
    const txnOut = 'SP_OUT_909';
    createdProviderTxnIds.push(txnOut);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send({
        id: txnOut,
        transactionDate: '2026-11-12 17:00:00',
        accountNumber: cs01BankAcc,
        content: 'RUT TIEN',
        transferType: 'out',
        transferAmount: 50_000,
      });
    const outRes = await exec
      .request()
      .input('tid', sql.VarChar(100), txnOut)
      .query<{ MatchStatus: string }>(
        "SELECT MatchStatus FROM dbo.BankTransactions WHERE Provider = 'SEPAY' AND ProviderTxnId = @tid",
      );
    expect(outRes.recordset[0].MatchStatus).toBe('IGNORED');
  });

  it('expirePendingQrRequests expires overdue PENDING requests and emits payment_request.expired', async () => {
    const code = 'BK20261112910';
    await seedBooking({
      code,
      paymentOption: 'FULL',
      totalAmount: 200_000,
      holdExpireAt: addMinutes(fakeClock.now(), 5),
    });

    const idem = randomUUID();
    createdIdempotencyKeys.push(idem);
    const qrRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${code}/payment-requests`)
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idem)
      .send({});
    const reqId = qrRes.body.data.requestId as number;

    // Not expired yet
    expect(await paymentsService.expirePendingQrRequests()).toBe(0);

    // Advance past ExpiresAt
    fakeClock.advanceMinutes(6);
    const count = await paymentsService.expirePendingQrRequests();
    expect(count).toBeGreaterThanOrEqual(1);

    const exec = await txService.executor();
    const row = await exec
      .request()
      .input('id', sql.BigInt, reqId)
      .query<{ Status: string }>('SELECT Status FROM dbo.PaymentRequest WHERE RequestId = @id');
    expect(row.recordset[0].Status).toBe('EXPIRED');

    expect(
      emittedEvents.some(
        (e) =>
          e.event === 'payment_request.expired' &&
          e.rooms.includes(`booking:${code}`) &&
          (e.payload as { requestId: number }).requestId === reqId,
      ),
    ).toBe(true);
  });

  it('Webhook durability (C-4, L-6): checks auth before validation, preserves verbatim RawPayload & decimal/no-date payloads, and falls back to NEEDS_REVIEW on matching error', async () => {
    // 1. L-6 / C-4: Invalid body + missing/wrong API key -> 401 (not 400)
    const unauthInvalidBody = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', 'Apikey wrong-key')
      .send({ invalidField: true });
    expect(unauthInvalidBody.status).toBe(401);

    // 2. C-4: Missing transactionDate + decimal transferAmount + extra fields + custom JSON formatting -> 200 NEEDS_REVIEW with verbatim RawPayload
    const decTxnId = 'SP_DEC_RAW_911';
    createdProviderTxnIds.push(decTxnId);
    const rawJsonStr = `{  "id": "${decTxnId}", "accountNumber": "${cs01BankAcc}", "transferType": "in", "transferAmount": 250000.5, "content": "UNKNOWN", "extraTag": "keep-me" }`;
    const decRes = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .set('Content-Type', 'application/json')
      .send(rawJsonStr);
    expect(decRes.status).toBe(200);
    expect(decRes.body).toEqual({ success: true });

    const exec = await txService.executor();
    const decDbRes = await exec
      .request()
      .input('tid', sql.VarChar(100), decTxnId)
      .query<{ MatchStatus: string; RawPayload: string; Amount: number }>(
        "SELECT MatchStatus, RawPayload, Amount FROM dbo.BankTransactions WHERE Provider = 'SEPAY' AND ProviderTxnId = @tid",
      );
    expect(decDbRes.recordset[0].MatchStatus).toBe('NEEDS_REVIEW');
    expect(decDbRes.recordset[0].RawPayload).toBe(rawJsonStr);
    expect(Number(decDbRes.recordset[0].Amount)).toBe(250_001);

    // 3. C-4: Matching step throws unexpected error -> BankTransactions is STILL committed as NEEDS_REVIEW (never lost)
    const codeErr = 'BK20261112912';
    await seedBooking({ code: codeErr, paymentOption: 'FULL', totalAmount: 250_000 });
    const bookingState = app.get(BookingStateService);
    const spy = vi
      .spyOn(bookingState, 'applyPaymentInTx')
      .mockRejectedValueOnce(new Error('Simulated matching failure'));

    emittedEvents = [];
    const errTxnId = 'SP_ERR_FALLBACK_912';
    createdProviderTxnIds.push(errTxnId);
    try {
      const errRes = await request(app.getHttpServer())
        .post('/api/v1/webhooks/bank/sepay')
        .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
        .send({
          id: errTxnId,
          transactionDate: '2026-11-12 17:00:00',
          accountNumber: cs01BankAcc,
          content: `THANHTOAN ${codeErr}`,
          transferType: 'in',
          transferAmount: 250_000,
        });
      expect(errRes.status).toBe(200);
      expect(errRes.body).toEqual({ success: true });
    } finally {
      spy.mockRestore();
    }

    const errDbRes = await exec
      .request()
      .input('tid', sql.VarChar(100), errTxnId)
      .query<{ MatchStatus: string }>(
        "SELECT MatchStatus FROM dbo.BankTransactions WHERE Provider = 'SEPAY' AND ProviderTxnId = @tid",
      );
    expect(errDbRes.recordset[0].MatchStatus).toBe('NEEDS_REVIEW');
    expect(
      emittedEvents.some((e) => e.event === 'reconciliation.created'),
    ).toBe(true);
  });

  it('Webhook redelivery (C-4): transient DB error keeps txn PENDING + 5xx; redelivery resumes matching; a handled txn stays idempotent', async () => {
    const code = 'BK20261112913';
    await seedBooking({ code, paymentOption: 'FULL', totalAmount: 250_000 });
    const txnId = 'SP_TRANSIENT_913';
    createdProviderTxnIds.push(txnId);
    const body = {
      id: txnId,
      transactionDate: '2026-11-12 17:00:00',
      accountNumber: cs01BankAcc,
      content: `THANHTOAN ${code}`,
      transferType: 'in',
      transferAmount: 250_000,
    };
    const exec = await txService.executor();
    const readStatus = async () =>
      (
        await exec
          .request()
          .input('tid', sql.VarChar(100), txnId)
          .query<{ MatchStatus: string }>(
            "SELECT MatchStatus FROM dbo.BankTransactions WHERE Provider = 'SEPAY' AND ProviderTxnId = @tid",
          )
      ).recordset[0]?.MatchStatus;

    // 1. Matching hits a transient error (timeout) -> 5xx, txn stored and still PENDING (not NEEDS_REVIEW)
    const bookingState = app.get(BookingStateService);
    const spy = vi
      .spyOn(bookingState, 'applyPaymentInTx')
      .mockRejectedValueOnce(Object.assign(new Error('Simulated timeout'), { code: 'ETIMEOUT' }));
    try {
      const first = await request(app.getHttpServer())
        .post('/api/v1/webhooks/bank/sepay')
        .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
        .send(body);
      expect(first.status).toBeGreaterThanOrEqual(500);
    } finally {
      spy.mockRestore();
    }
    expect(await readStatus()).toBe('PENDING');

    // 2. SePay redelivers the same txn -> matching resumes and succeeds
    const second = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send(body);
    expect(second.status).toBe(200);
    expect(await readStatus()).toBe('MATCHED');

    // 3. A further redelivery of an already handled txn is a no-op (no double payment)
    const third = await request(app.getHttpServer())
      .post('/api/v1/webhooks/bank/sepay')
      .set('Authorization', `Apikey ${env.sepayWebhookApiKey}`)
      .send(body);
    expect(third.status).toBe(200);
    const payCount = await exec
      .request()
      .input('code', sql.VarChar(20), code)
      .query<{ Cnt: number }>(
        `SELECT COUNT(*) AS Cnt FROM dbo.Payments p JOIN dbo.Bookings b ON b.BookingId = p.BookingId WHERE b.BookingCode = @code`,
      );
    expect(payCount.recordset[0].Cnt).toBe(1);
  });
});
