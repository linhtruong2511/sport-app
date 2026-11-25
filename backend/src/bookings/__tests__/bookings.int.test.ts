import crypto from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookingStateService } from '../booking-state.service.js';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../core/auth/index.js';
import { CLOCK, FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { addDays, addMinutes, formatDateVn, parseVnDateTime, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { BookingsModule } from '../bookings.module.js';
import { BookingsService } from '../bookings.service.js';

let seededUsers: Record<string, AuthenticatedUser> = {};

const mockTokenVerifier: TokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = seededUsers[token];
    if (!user) {
      throw new Error(`Invalid test token: ${token}`);
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
  imports: [CoreModule, DatabaseModule, TestAuthModule, BookingsModule],
})
class BookingsTestAppModule {}

describe('bookings integration (API-13, 14, 18, 19, 20 + expireHolds)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let bookingsService: BookingsService;
  let systemClock: SystemClock;
  let originalClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());

  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    pb02: number;
    pb03: number;
    cl01: number;
    bd01: number;
    bd02: number;
    bd03: number;
    tn01: number;
    anId: number;
    binhId: number;
    ownerId: number;
  };

  const createdBookingCodes: string[] = [];
  const createdPromoCodes: string[] = [];

  function uuid(): string {
    return crypto.randomUUID();
  }

  async function cleanupTestArtifacts(): Promise<void> {
    const exec = await txService.executor();
    if (createdBookingCodes.length > 0) {
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
    if (createdPromoCodes.length > 0) {
      const quoted = createdPromoCodes.map((c) => `'${c}'`).join(',');
      await exec.request().query(`
        DELETE FROM dbo.PromotionCustomers WHERE PromotionId IN (SELECT PromotionId FROM dbo.Promotions WHERE Code IN (${quoted}));
        DELETE FROM dbo.PromotionSports WHERE PromotionId IN (SELECT PromotionId FROM dbo.Promotions WHERE Code IN (${quoted}));
        DELETE FROM dbo.PromotionBranches WHERE PromotionId IN (SELECT PromotionId FROM dbo.Promotions WHERE Code IN (${quoted}));
        DELETE FROM dbo.Promotions WHERE Code IN (${quoted});
      `);
      createdPromoCodes.length = 0;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(BookingsTestAppModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    bookingsService = app.get(BookingsService);
    systemClock = app.get(CLOCK);
    originalClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    const exec = await txService.executor();
    const courtsRes = await exec.request().query<{ Code: string; CourtId: number; BranchId: number }>(`
      SELECT Code, CourtId, BranchId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_PB_02','SAN_PB_03','SAN_CL_01','SAN_BD_01','SAN_BD_02','SAN_BD_03','SAN_TN_01')
    `);
    const courtMap = new Map(courtsRes.recordset.map((c) => [c.Code, c]));

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
    const staffCs01 = userMap.get('0933445577')!;
    const staffCs02 = userMap.get('0933445566')!;
    const owner = userMap.get('0900000001')!;

    ids = {
      cs01: Number(courtMap.get('SAN_PB_01')!.BranchId),
      cs02: Number(courtMap.get('SAN_BD_01')!.BranchId),
      pb01: Number(courtMap.get('SAN_PB_01')!.CourtId),
      pb02: Number(courtMap.get('SAN_PB_02')!.CourtId),
      pb03: Number(courtMap.get('SAN_PB_03')!.CourtId),
      cl01: Number(courtMap.get('SAN_CL_01')!.CourtId),
      bd01: Number(courtMap.get('SAN_BD_01')!.CourtId),
      bd02: Number(courtMap.get('SAN_BD_02')!.CourtId),
      bd03: Number(courtMap.get('SAN_BD_03')!.CourtId),
      tn01: Number(courtMap.get('SAN_TN_01')!.CourtId),
      anId: Number(an.UserId),
      binhId: Number(binh.UserId),
      ownerId: Number(owner.UserId),
    };

    seededUsers = {
      'token-an': { userId: ids.anId, role: 'CUSTOMER', branchId: null, tv: Number(an.TokenVersion) },
      'token-binh': { userId: ids.binhId, role: 'CUSTOMER', branchId: null, tv: Number(binh.TokenVersion) },
      'token-staff-cs01': {
        userId: Number(staffCs01.UserId),
        role: 'STAFF',
        branchId: Number(staffCs01.BranchId),
        tv: Number(staffCs01.TokenVersion),
      },
      'token-staff-cs02': {
        userId: Number(staffCs02.UserId),
        role: 'STAFF',
        branchId: Number(staffCs02.BranchId),
        tv: Number(staffCs02.TokenVersion),
      },
      'token-owner': { userId: ids.ownerId, role: 'OWNER', branchId: null, tv: Number(owner.TokenVersion) },
    };
  });

  beforeEach(() => {
    // Anchor clock to "real now" truncated to seconds so seeded promotions/prices are active
    fakeClock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  });

  afterAll(async () => {
    await cleanupTestArtifacts();
    if (systemClock && originalClockNow) {
      systemClock.now = originalClockNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-13: creates online booking with DEPOSIT QR, handles TotalAmount=0 (CONFIRMED+PAID, no QR), and enforces validation guards', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 3));

    // 1. Online booking with DEPOSIT -> PENDING_PAYMENT + PaymentRequest QR
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '18:00',
        endTime: '20:00',
        paymentOption: 'DEPOSIT',
        promotionCode: 'trian10',
        note: 'Đặt sân tối',
      });

    expect(res.status).toBe(201);
    const { booking, paymentRequest } = res.body.data;
    createdBookingCodes.push(booking.bookingCode);

    expect(booking.channel).toBe('ONLINE');
    expect(booking.status).toBe('PENDING_PAYMENT');
    expect(booking.paymentStatus).toBe('UNPAID');
    expect(booking.baseAmount).toBe(500_000);
    expect(booking.discountAmount).toBe(50_000);
    expect(booking.totalAmount).toBe(450_000);
    expect(booking.deposit.amount).toBe(135_000);
    expect(booking.amountDueNow).toBe(135_000);
    expect(booking.remainingAmount).toBe(450_000);
    expect(booking.holdExpireAt).toBeTruthy();
    expect(booking.allowedActions).toEqual(['PAY', 'CANCEL']);

    expect(paymentRequest).not.toBeNull();
    expect(paymentRequest.bookingCode).toBe(booking.bookingCode);
    expect(paymentRequest.purpose).toBe('DEPOSIT');
    expect(paymentRequest.amount).toBe(135_000);
    expect(paymentRequest.transferContent).toBe(`THANHTOAN ${booking.bookingCode}`);
    expect(paymentRequest.qrPayload).toContain(`THANHTOAN ${booking.bookingCode}`);
    expect(paymentRequest.status).toBe('PENDING');
    expect(paymentRequest.bank.accountNo).toBe('1012345678');

    // 2. TotalAmount = 0 via 100% FIXED discount -> CONFIRMED + PAID, no QR
    const freeCode = `FREE${Date.now().toString().slice(-6)}`;
    createdPromoCodes.push(freeCode);
    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), freeCode)
      .input('startDate', sql.Date, playDate)
      .input('endDate', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Miễn phí test 100%', 'FIXED', 500000, 1, 1, @startDate, @endDate, 'ALL', 10, 0, 'ACTIVE', @ownerId)
      `);

    const freeRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.cl01,
        date: playDate,
        startTime: '08:00',
        endTime: '09:00',
        paymentOption: 'FULL',
        promotionCode: freeCode,
      });

    expect(freeRes.status).toBe(201);
    createdBookingCodes.push(freeRes.body.data.booking.bookingCode);
    expect(freeRes.body.data.booking.status).toBe('CONFIRMED');
    expect(freeRes.body.data.booking.paymentStatus).toBe('PAID');
    expect(freeRes.body.data.booking.totalAmount).toBe(0);
    expect(freeRes.body.data.booking.holdExpireAt).toBeNull();
    expect(freeRes.body.data.paymentRequest).toBeNull();

    // 3. DEPOSIT_NOT_ALLOWED (R-09): SAN_CL_01 09:00-10:00 (80,000) - TRIAN10 (50,000) = 30,000 < 50,000 deposit
    const depNotAllowedRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.cl01,
        date: playDate,
        startTime: '09:00',
        endTime: '10:00',
        paymentOption: 'DEPOSIT',
        promotionCode: 'TRIAN10',
      });
    expect(depNotAllowedRes.status).toBe(422);
    expect(depNotAllowedRes.body.error.code).toBe('DEPOSIT_NOT_ALLOWED');

    // 4. BOOKING_IN_PAST
    const pastDate = formatDateVn(addDays(fakeClock.now(), -1));
    const pastRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: pastDate,
        startTime: '10:00',
        endTime: '11:00',
        paymentOption: 'FULL',
      });
    expect(pastRes.status).toBe(422);
    expect(pastRes.body.error.code).toBe('BOOKING_IN_PAST');

    // 5. OUTSIDE_OPENING_HOURS
    const hoursRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '04:00',
        endTime: '05:00',
        paymentOption: 'FULL',
      });
    expect(hoursRes.status).toBe(422);
    expect(hoursRes.body.error.code).toBe('OUTSIDE_OPENING_HOURS');

    // 6. BRANCH_CLOSED (holiday 2027-01-01)
    const holidayRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: '2027-01-01',
        startTime: '08:00',
        endTime: '09:00',
        paymentOption: 'FULL',
      });
    expect(holidayRes.status).toBe(422);
    expect(holidayRes.body.error.code).toBe('BRANCH_CLOSED');

    // 7. COURT_UNAVAILABLE (inactive SAN_BD_02 & maintenance SAN_PB_02 on D+5)
    const inactiveCourtRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.bd02,
        date: playDate,
        startTime: '08:00',
        endTime: '09:00',
        paymentOption: 'FULL',
      });
    expect(inactiveCourtRes.status).toBe(422);
    expect(inactiveCourtRes.body.error.code).toBe('COURT_UNAVAILABLE');

    const blockDate = formatDateVn(addDays(fakeClock.now(), 5));
    const blockedCourtRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb02,
        date: blockDate,
        startTime: '09:00',
        endTime: '11:00',
        paymentOption: 'FULL',
      });
    expect(blockedCourtRes.status).toBe(422);
    expect(blockedCourtRes.body.error.code).toBe('COURT_UNAVAILABLE');

    // 8. PROMO_INVALID
    const invalidPromoRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '10:00',
        endTime: '11:00',
        paymentOption: 'FULL',
        promotionCode: 'PICKLECS01',
      });
    expect(invalidPromoRes.status).toBe(422);
    expect(invalidPromoRes.body.error.code).toBe('PROMO_INVALID');
    expect(invalidPromoRes.body.error.details.reasonCode).toBe('PROMO_INACTIVE');

    // 9. FORBIDDEN for STAFF
    const staffRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '10:00',
        endTime: '11:00',
        paymentOption: 'FULL',
      });
    expect(staffRes.status).toBe(403);
    expect(staffRes.body.error.code).toBe('FORBIDDEN');
  });

  it('concurrency: 2 parallel bookings on same slot -> 1x 201 and 1x 409 SLOT_TAKEN', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 4));
    const payload = {
      courtId: ids.pb01,
      date: playDate,
      startTime: '14:00',
      endTime: '16:00',
      paymentOption: 'FULL',
    };

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer token-an')
        .set('Idempotency-Key', uuid())
        .send(payload),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer token-binh')
        .set('Idempotency-Key', uuid())
        .send(payload),
    ]);

    const sorted = [r1, r2].sort((a, b) => a.status - b.status);
    expect(sorted[0].status).toBe(201);
    expect(sorted[1].status).toBe(409);
    expect(sorted[1].body.error.code).toBe('SLOT_TAKEN');
    createdBookingCodes.push(sorted[0].body.data.booking.bookingCode);
  });

  it('concurrency: 2 parallel bookings racing last promo use -> 1x 201, 1x 409 PROMO_EXHAUSTED, and loser slot stays FREE', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 4));
    const raceCode = `RACE${Date.now().toString().slice(-6)}`;
    createdPromoCodes.push(raceCode);

    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), raceCode)
      .input('startDate', sql.Date, playDate)
      .input('endDate', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Đua lượt cuối', 'FIXED', 20000, 1, 1, @startDate, @endDate, 'ALL', 1, 0, 'ACTIVE', @ownerId)
      `);

    const [r1, r2] = await Promise.all([
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer token-an')
        .set('Idempotency-Key', uuid())
        .send({
          courtId: ids.pb03,
          date: playDate,
          startTime: '08:00',
          endTime: '09:00',
          paymentOption: 'FULL',
          promotionCode: raceCode,
        }),
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', 'Bearer token-binh')
        .set('Idempotency-Key', uuid())
        .send({
          courtId: ids.bd01,
          date: playDate,
          startTime: '08:00',
          endTime: '09:00',
          paymentOption: 'FULL',
          promotionCode: raceCode,
        }),
    ]);

    const sorted = [r1, r2].sort((a, b) => a.status - b.status);
    expect(sorted[0].status).toBe(201);
    expect(sorted[1].status).toBe(409);
    expect(sorted[1].body.error.code).toBe('PROMO_EXHAUSTED');

    const winnerBooking = sorted[0].body.data.booking;
    createdBookingCodes.push(winnerBooking.bookingCode);

    // Verify loser's court slot was rolled back and can be booked immediately without promo
    const loserCourtId = winnerBooking.courtId === ids.pb03 ? ids.bd01 : ids.pb03;
    const rebookRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-binh')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: loserCourtId,
        date: playDate,
        startTime: '08:00',
        endTime: '09:00',
        paymentOption: 'FULL',
      });
    expect(rebookRes.status).toBe(201);
    createdBookingCodes.push(rebookRes.body.data.booking.bookingCode);
  });

  it('idempotency: same key + same body replays same 201 booking; same key + different body -> 409 IDEMPOTENCY_CONFLICT', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 4));
    const idemKey = uuid();
    const body = {
      courtId: ids.cl01,
      date: playDate,
      startTime: '10:00',
      endTime: '11:00',
      paymentOption: 'FULL',
    };

    const first = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idemKey)
      .send(body);
    expect(first.status).toBe(201);
    createdBookingCodes.push(first.body.data.booking.bookingCode);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idemKey)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.body.data.booking.bookingCode).toBe(first.body.data.booking.bookingCode);

    const conflict = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', idemKey)
      .send({ ...body, startTime: '11:00', endTime: '12:00' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('API-14 & API-19: detail access control (BOOKING_FORBIDDEN / BRANCH_FORBIDDEN), list sorting, statusCounts, INVALID_DATE_RANGE', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 6));

    // Create a booking owned by An at CS01
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '08:00',
        endTime: '10:00',
        paymentOption: 'FULL',
      });
    expect(createRes.status).toBe(201);
    const code = createRes.body.data.booking.bookingCode;
    createdBookingCodes.push(code);

    // API-14: An -> 200 with priceLines & statusHistory
    const detailAn = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-an');
    expect(detailAn.status).toBe(200);
    expect(detailAn.body.data.bookingCode).toBe(code);
    expect(detailAn.body.data.priceLines).toHaveLength(1);
    expect(detailAn.body.data.statusHistory).toHaveLength(1);

    // Binh -> 403 BOOKING_FORBIDDEN
    const detailBinh = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-binh');
    expect(detailBinh.status).toBe(403);
    expect(detailBinh.body.error.code).toBe('BOOKING_FORBIDDEN');

    // Staff CS02 -> 403 BRANCH_FORBIDDEN
    const detailStaff02 = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-staff-cs02');
    expect(detailStaff02.status).toBe(403);
    expect(detailStaff02.body.error.code).toBe('BRANCH_FORBIDDEN');

    // Staff CS01 & Owner -> 200
    const detailStaff01 = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(detailStaff01.status).toBe(200);

    const detailOwner = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-owner');
    expect(detailOwner.status).toBe(200);

    // API-19: listMyBookings across seeded + newly created bookings
    const from = formatDateVn(addDays(fakeClock.now(), -5));
    const to = formatDateVn(addDays(fakeClock.now(), 12));
    const listAll = await request(app.getHttpServer())
      .get(`/api/v1/me/bookings?from=${from}&to=${to}&status=ALL`)
      .set('Authorization', 'Bearer token-an');
    expect(listAll.status).toBe(200);
    expect(listAll.body.meta.statusCounts.ALL).toBeGreaterThanOrEqual(3);
    expect(listAll.body.meta.statusCounts.CONFIRMED).toBeGreaterThanOrEqual(1);
    expect(listAll.body.meta.statusCounts.PENDING_PAYMENT).toBeGreaterThanOrEqual(1);
    expect(listAll.body.meta.statusCounts.COMPLETED).toBeGreaterThanOrEqual(1);

    // Verify sorting group order: CONFIRMED/IN_USE -> PENDING_PAYMENT -> COMPLETED -> EXPIRED/CANCELED
    const groupRank = (status: string) =>
      status === 'CONFIRMED' || status === 'IN_USE'
        ? 1
        : status === 'PENDING_PAYMENT'
          ? 2
          : status === 'COMPLETED'
            ? 3
            : 4;
    const ranks = (listAll.body.data as Array<{ status: string }>).map((b) => groupRank(b.status));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]);
    }

    // Filtered query preserves full statusCounts
    const listPending = await request(app.getHttpServer())
      .get(`/api/v1/me/bookings?from=${from}&to=${to}&status=PENDING_PAYMENT`)
      .set('Authorization', 'Bearer token-an');
    expect(listPending.status).toBe(200);
    expect(listPending.body.meta.statusCounts).toEqual(listAll.body.meta.statusCounts);
    expect(
      (listPending.body.data as Array<{ status: string }>).every((b) => b.status === 'PENDING_PAYMENT'),
    ).toBe(true);

    // INVALID_DATE_RANGE
    const badRange1 = await request(app.getHttpServer())
      .get(`/api/v1/me/bookings?from=${to}&to=${from}`)
      .set('Authorization', 'Bearer token-an');
    expect(badRange1.status).toBe(400);
    expect(badRange1.body.error.code).toBe('INVALID_DATE_RANGE');

    const tooLongTo = formatDateVn(addDays(fakeClock.now(), 370));
    const badRange2 = await request(app.getHttpServer())
      .get(`/api/v1/me/bookings?from=${from}&to=${tooLongTo}`)
      .set('Authorization', 'Bearer token-an');
    expect(badRange2.status).toBe(400);
    expect(badRange2.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('API-20 & API-18: cancel-preview, version conflict, customer past cutoff, refund tiers, promo UsedCount, NO_SHOW DEPOSITED vs PAID (R-04)', async () => {
    const exec = await txService.executor();
    const today = fakeClock.now();
    const d3 = formatDateVn(addDays(today, 3));
    const d7 = formatDateVn(addDays(today, 7));

    // 1. Cancel PENDING_PAYMENT with promo -> UsedCount decremented by 1
    const promoCode = `CNL${Date.now().toString().slice(-6)}`;
    createdPromoCodes.push(promoCode);
    await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .input('startDate', sql.Date, d3)
      .input('endDate', sql.Date, d7)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Hủy trả lượt', 'FIXED', 20000, 1, 1, @startDate, @endDate, 'ALL', 5, 0, 'ACTIVE', @ownerId)
      `);

    const pendingRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: d7,
        startTime: '10:00',
        endTime: '11:00',
        paymentOption: 'FULL',
        promotionCode: promoCode,
      });
    expect(pendingRes.status).toBe(201);
    const pendingBooking = pendingRes.body.data.booking;
    createdBookingCodes.push(pendingBooking.bookingCode);

    // Mismatch version -> 409 BOOKING_STATE_CHANGED
    const badVerRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${pendingBooking.bookingCode}/cancel`)
      .set('Authorization', 'Bearer token-an')
      .send({ reason: 'Test version cũ', version: 'AAAAAAAAAAA=' });
    expect(badVerRes.status).toBe(409);
    expect(badVerRes.body.error.code).toBe('BOOKING_STATE_CHANGED');

    // Valid cancel on PENDING_PAYMENT -> UsedCount returns to 0
    const cancelPendingRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${pendingBooking.bookingCode}/cancel`)
      .set('Authorization', 'Bearer token-an')
      .send({ reason: 'Khách đổi lịch', version: pendingBooking.version });
    expect(cancelPendingRes.status).toBe(200);
    expect(cancelPendingRes.body.data.booking.status).toBe('CANCELED');
    expect(cancelPendingRes.body.data.booking.cancel.refundRate).toBeNull();
    expect(cancelPendingRes.body.data.refund).toBeNull();

    const promoAfterPending = await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .query<{ UsedCount: number }>('SELECT UsedCount FROM dbo.Promotions WHERE Code = @code');
    expect(promoAfterPending.recordset[0].UsedCount).toBe(0);

    // 2. CONFIRMED + DEPOSITED + settled to PAID (500k total, 150k deposit, 500k paid, with promo) cancelled ~3 days ahead -> 50% of (500k - 150k) = 175k refund, UsedCount stays 1
    const settledCode = `BK${formatDateVn(today).replaceAll('-', '')}901`;
    createdBookingCodes.push(settledCode);
    const startD3 = parseVnDateTime(d3, '18:00');
    const endD3 = parseVnDateTime(d3, '20:00');
    // Set fakeClock to exact 3 days before startD3 so T = 3.0 days (between 2 and 5)
    fakeClock.set(addDays(startD3, -3));
    const settledInsert = await exec
      .request()
      .input('code', sql.VarChar(20), settledCode)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb01)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(startD3))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(endD3))
      .input('promoCode', sql.VarChar(20), promoCode)
      .input('now', sql.DateTime2(0), toSqlDateTime(fakeClock.now()))
      .query<{ BookingId: number; RowVer: Buffer }>(`
        INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus, PromotionCode, CreatedBy, CreatedAt, UpdatedAt, Channel)
        OUTPUT inserted.BookingId, inserted.RowVer
        VALUES (@code, @branchId, @courtId, @userId, @startAt, @endAt,
          520000, 20000, 500000, 'DEPOSIT', 'PERCENT', 30, 150000,
          150000, 500000, 0, 'CONFIRMED', 'PAID', @promoCode, @userId, @now, @now, 'ONLINE')
      `);
    await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .query('UPDATE dbo.Promotions SET UsedCount = 1 WHERE Code = @code');

    const settledVer = settledInsert.recordset[0].RowVer.toString('base64');

    const previewSettled = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${settledCode}/cancel-preview`)
      .set('Authorization', 'Bearer token-an');
    expect(previewSettled.status).toBe(200);
    expect(previewSettled.body.data).toMatchObject({
      cancelType: 'CUSTOMER_REQUEST',
      canCancel: true,
      depositKept: 150_000,
      refundableBase: 350_000,
      refundRate: 50,
      refundAmount: 175_000,
      retainedAmount: 325_000,
    });

    // Staff cancels -> creates PENDING refund + SCHEDULE_CHANGE notification, UsedCount unchanged (1)
    const cancelSettled = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${settledCode}/cancel`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ reason: 'Hỗ trợ khách hủy', version: settledVer });
    expect(cancelSettled.status).toBe(200);
    expect(cancelSettled.body.data.refund).toMatchObject({
      amount: 175_000,
      rate: 50,
      status: 'PENDING',
    });

    const promoAfterConfirmed = await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .query<{ UsedCount: number }>('SELECT UsedCount FROM dbo.Promotions WHERE Code = @code');
    expect(promoAfterConfirmed.recordset[0].UsedCount).toBe(1);

    const notifRes = await exec
      .request()
      .input('linkRef', sql.VarChar(50), String(settledInsert.recordset[0].BookingId))
      .query<{ Type: string }>(`
        SELECT Type FROM dbo.Notifications WHERE LinkType = 'BOOKING' AND LinkRef = @linkRef
      `);
    expect(notifRes.recordset.some((n) => n.Type === 'SCHEDULE_CHANGE')).toBe(true);

    // 3. NO_SHOW DEPOSITED vs PAID (R-04) + customer cancel after StartAt
    const depNoShowCode = `BK${formatDateVn(today).replaceAll('-', '')}902`;
    const paidNoShowCode = `BK${formatDateVn(today).replaceAll('-', '')}903`;
    createdBookingCodes.push(depNoShowCode, paidNoShowCode);

    const slotStart = parseVnDateTime(d3, '10:00');
    const slotEnd = parseVnDateTime(d3, '12:00');

    const depRes = await exec
      .request()
      .input('code', sql.VarChar(20), depNoShowCode)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb01)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(fakeClock.now()))
      .query<{ BookingId: number; RowVer: Buffer }>(`
        INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositType, DepositValue, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus, CreatedBy, CreatedAt, UpdatedAt, Channel)
        OUTPUT inserted.BookingId, inserted.RowVer
        VALUES (@code, @branchId, @courtId, @userId, @startAt, @endAt,
          300000, 0, 300000, 'DEPOSIT', 'PERCENT', 30, 90000,
          90000, 90000, 210000, 'CONFIRMED', 'DEPOSITED', @userId, @now, @now, 'ONLINE')
      `);
    const paidRes = await exec
      .request()
      .input('code', sql.VarChar(20), paidNoShowCode)
      .input('branchId', sql.Int, ids.cs01)
      .input('courtId', sql.Int, ids.pb03)
      .input('userId', sql.BigInt, ids.anId)
      .input('startAt', sql.DateTime2(0), toSqlDateTime(slotStart))
      .input('endAt', sql.DateTime2(0), toSqlDateTime(slotEnd))
      .input('now', sql.DateTime2(0), toSqlDateTime(fakeClock.now()))
      .query<{ BookingId: number; RowVer: Buffer }>(`
        INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
          BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount,
          AmountDueNow, PaidAmount, RemainingAmount, Status, PaymentStatus, CreatedBy, CreatedAt, UpdatedAt, Channel)
        OUTPUT inserted.BookingId, inserted.RowVer
        VALUES (@code, @branchId, @courtId, @userId, @startAt, @endAt,
          300000, 0, 300000, 'FULL', 0,
          300000, 300000, 0, 'CONFIRMED', 'PAID', @userId, @now, @now, 'ONLINE')
      `);

    const depVer = depRes.recordset[0].RowVer.toString('base64');
    const paidVer = paidRes.recordset[0].RowVer.toString('base64');

    // Move clock to StartAt + 30 minutes
    fakeClock.set(addMinutes(slotStart, 30));

    // Customer cannot cancel after StartAt
    const custLateCancel = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${depNoShowCode}/cancel`)
      .set('Authorization', 'Bearer token-an')
      .send({ reason: 'Hủy muộn', version: depVer });
    expect(custLateCancel.status).toBe(422);
    expect(custLateCancel.body.error.code).toBe('BOOKING_NOT_CANCELABLE');

    // Customer cannot use NO_SHOW
    const custNoShow = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${depNoShowCode}/cancel`)
      .set('Authorization', 'Bearer token-an')
      .send({ cancelType: 'NO_SHOW', reason: 'No show', version: depVer });
    expect(custNoShow.status).toBe(403);
    expect(custNoShow.body.error.code).toBe('FORBIDDEN');

    // Staff NO_SHOW on DEPOSITED at StartAt + 30' -> 200 CANCELED
    const staffNoShowDep = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${depNoShowCode}/cancel`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ cancelType: 'NO_SHOW', reason: 'Khách không tới nhận sân', version: depVer });
    expect(staffNoShowDep.status).toBe(200);
    expect(staffNoShowDep.body.data.booking.status).toBe('CANCELED');
    expect(staffNoShowDep.body.data.booking.cancel.depositKept).toBe(90_000);
    expect(staffNoShowDep.body.data.refund).toBeNull();

    // Staff NO_SHOW on PAID at StartAt + 30' -> 422 NO_SHOW_NOT_ELIGIBLE (R-04!)
    const staffNoShowPaidEarly = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paidNoShowCode}/cancel`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ cancelType: 'NO_SHOW', reason: 'Khách không tới nhận sân', version: paidVer });
    expect(staffNoShowPaidEarly.status).toBe(422);
    expect(staffNoShowPaidEarly.body.error.code).toBe('NO_SHOW_NOT_ELIGIBLE');

    // Move clock to EndAt -> NO_SHOW on PAID succeeds
    fakeClock.set(slotEnd);
    const staffNoShowPaidEnd = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${paidNoShowCode}/cancel`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ cancelType: 'NO_SHOW', reason: 'Khách không tới nhận sân', version: paidVer });
    expect(staffNoShowPaidEnd.status).toBe(200);
    expect(staffNoShowPaidEnd.body.data.booking.status).toBe('CANCELED');
    expect(staffNoShowPaidEnd.body.data.booking.cancel.refundRate).toBe(0);
    expect(staffNoShowPaidEnd.body.data.booking.cancel.refundAmount).toBe(0);
  });

  it('expireHolds: expires held booking, frees slots, decrements promo UsedCount, expires QR, and allows immediate re-booking', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 8));
    const promoCode = `EXP${Date.now().toString().slice(-6)}`;
    createdPromoCodes.push(promoCode);

    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .input('startDate', sql.Date, playDate)
      .input('endDate', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Hết hạn giữ chỗ', 'FIXED', 20000, 1, 1, @startDate, @endDate, 'ALL', 5, 0, 'ACTIVE', @ownerId)
      `);

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '08:00',
        endTime: '10:00',
        paymentOption: 'DEPOSIT',
        promotionCode: promoCode,
      });
    expect(createRes.status).toBe(201);
    const code = createRes.body.data.booking.bookingCode;
    createdBookingCodes.push(code);

    // Advance clock past HoldExpireAt (+11 minutes)
    fakeClock.advanceMinutes(11);
    const expiredCount = await bookingsService.expireHolds();
    expect(expiredCount).toBeGreaterThanOrEqual(1);

    // Verify booking is EXPIRED, PaymentRequest is EXPIRED, UsedCount back to 0
    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code}`)
      .set('Authorization', 'Bearer token-an');
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.status).toBe('EXPIRED');
    expect(detailRes.body.data.holdExpireAt).toBeNull();
    expect(
      detailRes.body.data.statusHistory.some(
        (h: { toStatus: string }) => h.toStatus === 'EXPIRED',
      ),
    ).toBe(true);

    const prRes = await exec
      .request()
      .input('code', sql.VarChar(20), code)
      .query<{ Status: string }>(`
        SELECT pr.Status FROM dbo.PaymentRequest pr
        INNER JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        WHERE b.BookingCode = @code
      `);
    expect(prRes.recordset[0].Status).toBe('EXPIRED');

    const promoAfterExpire = await exec
      .request()
      .input('code', sql.VarChar(20), promoCode)
      .query<{ UsedCount: number }>('SELECT UsedCount FROM dbo.Promotions WHERE Code = @code');
    expect(promoAfterExpire.recordset[0].UsedCount).toBe(0);

    // Immediate re-booking of that exact slot succeeds
    const rebookRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-binh')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '08:00',
        endTime: '10:00',
        paymentOption: 'FULL',
      });
    expect(rebookRes.status).toBe(201);
    createdBookingCodes.push(rebookRes.body.data.booking.bookingCode);
  });

  it('expireHolds (M-2): isolates per-booking failures so one failing booking does not block subsequent holds in the batch', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 9));
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '14:00',
        endTime: '15:00',
        paymentOption: 'FULL',
      });
    const r2 = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-binh')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb03,
        date: playDate,
        startTime: '14:00',
        endTime: '15:00',
        paymentOption: 'FULL',
      });

    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const code1 = r1.body.data.booking.bookingCode as string;
    const code2 = r2.body.data.booking.bookingCode as string;
    createdBookingCodes.push(code1, code2);

    fakeClock.advanceMinutes(11);

    const bookingState = app.get(BookingStateService);
    const spy = vi
      .spyOn(bookingState, 'expireBookingInTx')
      .mockRejectedValueOnce(new Error('Simulated expire failure on first item'));

    let expiredCount = 0;
    try {
      expiredCount = await bookingsService.expireHolds(200);
    } finally {
      spy.mockRestore();
    }

    expect(expiredCount).toBeGreaterThanOrEqual(1);

    const detail2 = await request(app.getHttpServer())
      .get(`/api/v1/bookings/${code2}`)
      .set('Authorization', 'Bearer token-binh');
    expect(detail2.status).toBe(200);
    expect(detail2.body.data.status).toBe('EXPIRED');

    // Clean up remaining pending hold (code1) cleanly on next expireHolds pass
    const secondPass = await bookingsService.expireHolds(200);
    expect(secondPass).toBeGreaterThanOrEqual(1);
  });
});
