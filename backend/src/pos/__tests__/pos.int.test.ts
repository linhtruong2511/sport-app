import crypto from 'node:crypto';
import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import type { Server } from 'socket.io';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BookingsModule } from '../../bookings/bookings.module.js';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../core/auth/index.js';
import { CLOCK, FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppError, AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { RealtimeService } from '../../core/realtime/realtime.service.js';
import { SettingsService } from '../../core/settings.service.js';
import { addDays, addMinutes, formatDateVn, parseVnDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PaymentsModule } from '../../payments/payments.module.js';
import { PosModule } from '../pos.module.js';

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
  imports: [CoreModule, DatabaseModule, TestAuthModule, PosModule, BookingsModule, PaymentsModule],
})
class PosTestAppModule {}

describe('pos integration (API-25..35)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let originalClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());
  let emittedEvents: EmittedEvent[] = [];

  let baseToday: string;
  let ids: {
    cs01: number;
    cs02: number;
    pb01: number;
    pb02: number;
    pb03: number;
    cl01: number;
    cl02: number;
    bd01: number;
    anId: number;
    ownerId: number;
    pickleballSportId: number;
    badmintonSportId: number;
  };

  const createdBookingCodes: string[] = [];
  const createdPromoCodes: string[] = [];
  const createdIdempotencyKeys: string[] = [];

  function uuid(): string {
    const id = crypto.randomUUID();
    createdIdempotencyKeys.push(id);
    return id;
  }

  async function cleanupTestArtifacts(): Promise<void> {
    const exec = await txService.executor();
    if (createdIdempotencyKeys.length > 0) {
      const quoted = createdIdempotencyKeys.map((k) => `'${k}'`).join(',');
      await exec.request().query(`
        DELETE FROM dbo.IdempotencyKeys WHERE IdempotencyKey IN (${quoted});
      `);
      createdIdempotencyKeys.length = 0;
    }
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
    app = await NestFactory.create(PosTestAppModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    realtimeService = app.get(RealtimeService);
    systemClock = app.get(CLOCK);
    originalClockNow = systemClock.now.bind(systemClock);
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

    baseToday = formatDateVn(new Date());

    const exec = await txService.executor();
    const courtsRes = await exec.request().query<{
      Code: string;
      CourtId: number;
      BranchId: number;
      SportId: number;
    }>(`
      SELECT Code, CourtId, BranchId, SportId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_PB_02','SAN_PB_03','SAN_CL_01','SAN_CL_02','SAN_BD_01')
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
      WHERE Phone IN ('0987654321', '0933445577', '0933445566', '0900000001')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));

    const an = userMap.get('0987654321')!;
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
      cl02: Number(courtMap.get('SAN_CL_02')!.CourtId),
      bd01: Number(courtMap.get('SAN_BD_01')!.CourtId),
      anId: Number(an.UserId),
      ownerId: Number(owner.UserId),
      pickleballSportId: Number(courtMap.get('SAN_PB_01')!.SportId),
      badmintonSportId: Number(courtMap.get('SAN_CL_01')!.SportId),
    };

    seededUsers = {
      'token-an': { userId: ids.anId, role: 'CUSTOMER', branchId: null, tv: Number(an.TokenVersion) },
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
      'token-owner': {
        userId: ids.ownerId,
        role: 'OWNER',
        branchId: null,
        tv: Number(owner.TokenVersion),
      },
    };
  });

  beforeEach(() => {
    emittedEvents = [];
    fakeClock.set(parseVnDateTime(baseToday, '07:00'));
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

  it('API-26 & API-27: customer lookup, branch-scoped promotions evaluation, and role guards', async () => {
    // CUSTOMER is forbidden on POS routes
    const forbiddenRes = await request(app.getHttpServer())
      .get('/api/v1/pos/customers?phone=0987654321')
      .set('Authorization', 'Bearer token-an');
    expect(forbiddenRes.status).toBe(403);
    expect(forbiddenRes.body.error.code).toBe('FORBIDDEN');

    // Invalid phone -> 400 VALIDATION_ERROR with exact SDD message
    const invalidPhoneRes = await request(app.getHttpServer())
      .get('/api/v1/pos/customers?phone=123')
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(invalidPhoneRes.status).toBe(400);
    expect(invalidPhoneRes.body.error.code).toBe('VALIDATION_ERROR');
    expect(invalidPhoneRes.body.error.details[0].message).toBe(
      'Số điện thoại không hợp lệ (10 chữ số, bắt đầu bằng 0).',
    );

    // Found member
    const foundRes = await request(app.getHttpServer())
      .get('/api/v1/pos/customers?phone=0987654321')
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(foundRes.status).toBe(200);
    expect(foundRes.body.data.found).toBe(true);
    expect(foundRes.body.data.customer.userId).toBe(ids.anId);
    expect(foundRes.body.data.customer.fullName).toBe('Nguyễn Văn An');

    // Not found -> 200 found: false
    const notFoundRes = await request(app.getHttpServer())
      .get('/api/v1/pos/customers?phone=0999888777')
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(notFoundRes.status).toBe(200);
    expect(notFoundRes.body.data).toEqual({ found: false, customer: null });

    // OWNER without branchId on promotions -> 400 VALIDATION_ERROR
    const ownerMissingBranch = await request(app.getHttpServer())
      .get('/api/v1/pos/promotions')
      .set('Authorization', 'Bearer token-owner');
    expect(ownerMissingBranch.status).toBe(400);
    expect(ownerMissingBranch.body.error.code).toBe('VALIDATION_ERROR');

    // Morning slot 08:00-10:00 on SAN_PB_01 (300,000) with member An -> SANGVUI20 (60k) + TRIAN10 (50k) applicable
    const playDate = formatDateVn(addDays(fakeClock.now(), 3));
    const promoRes = await request(app.getHttpServer())
      .get(
        `/api/v1/pos/promotions?branchId=${ids.cs02}&courtId=${ids.pb01}&date=${playDate}&startTime=08:00&endTime=10:00&customerPhone=0987654321`,
      )
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(promoRes.status).toBe(200);
    const items = promoRes.body.data.items as Array<{
      code: string;
      applicable: boolean;
      discountAmount: number;
      reasonCode: string | null;
    }>;
    const sang = items.find((i) => i.code === 'SANGVUI20');
    const trian = items.find((i) => i.code === 'TRIAN10');
    expect(sang).toMatchObject({ applicable: true, discountAmount: 60_000, reasonCode: null });
    expect(trian).toMatchObject({ applicable: true, discountAmount: 50_000, reasonCode: null });

    // Evening slot 18:00-20:00 as guest -> SANGVUI20 PROMO_OUT_OF_TIME, TRIAN10 PROMO_WRONG_AUDIENCE
    const promoGuestRes = await request(app.getHttpServer())
      .get(
        `/api/v1/pos/promotions?courtId=${ids.pb01}&date=${playDate}&startTime=18:00&endTime=20:00`,
      )
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(promoGuestRes.status).toBe(200);
    const guestItems = promoGuestRes.body.data.items as typeof items;
    expect(guestItems.find((i) => i.code === 'SANGVUI20')).toMatchObject({
      applicable: false,
      discountAmount: 0,
      reasonCode: 'PROMO_OUT_OF_TIME',
    });
    expect(guestItems.find((i) => i.code === 'TRIAN10')).toMatchObject({
      applicable: false,
      discountAmount: 0,
      reasonCode: 'PROMO_WRONG_AUDIENCE',
    });
  });

  it('API-28, API-25, API-31: creates counter booking with cash receipt, enforces Idempotency-Key & BRANCH_FORBIDDEN, updates schedule and latest receipt', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 4));

    // 1. STAFF CS01 sending courtId of CS02 -> 403 BRANCH_FORBIDDEN
    const crossBranchRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs02,
        courtId: ids.bd01,
        date: playDate,
        startTime: '08:00',
        endTime: '09:30',
        customer: { type: 'GUEST', phone: '0905112233', fullName: 'Khách test' },
        paymentOption: 'FULL',
      });
    expect(crossBranchRes.status).toBe(403);
    expect(crossBranchRes.body.error.code).toBe('BRANCH_FORBIDDEN');

    // 2. MEMBER without valid userId -> 422 MEMBER_NOT_FOUND
    const missingMemberRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.pb01,
        date: playDate,
        startTime: '08:00',
        endTime: '10:00',
        customer: { type: 'MEMBER', userId: 99999999 },
        paymentOption: 'FULL',
      });
    expect(missingMemberRes.status).toBe(422);
    expect(missingMemberRes.body.error.code).toBe('MEMBER_NOT_FOUND');

    // 3. Payment amount mismatch -> 422 AMOUNT_MISMATCH
    const mismatchRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.pb01,
        date: playDate,
        startTime: '08:00',
        endTime: '10:00',
        customer: { type: 'GUEST', phone: '0905112233', fullName: 'Trần Minh Hoàng' },
        paymentOption: 'FULL',
        payment: { method: 'CASH', amount: 100_000 },
      });
    expect(mismatchRes.status).toBe(422);
    expect(mismatchRes.body.error.code).toBe('AMOUNT_MISMATCH');

    // 4. Create GUEST FULL + CASH booking with Idempotency-Key
    // Advance clock past seeded B3 payment timestamp (@Now - 29m) so API-31 latest receipt selects this new payment
    fakeClock.set(addMinutes(new Date(), 1));
    const idemKey = uuid();
    const createPayload = {
      branchId: ids.cs01,
      courtId: ids.pb01,
      date: playDate,
      startTime: '18:00',
      endTime: '20:00',
      customer: {
        type: 'GUEST',
        userId: null,
        phone: '0905112233',
        fullName: 'Trần Minh Hoàng',
      },
      paymentOption: 'FULL',
      payment: { method: 'CASH', amount: 500_000 },
      note: 'Khách đặt tại quầy',
    };

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', idemKey)
      .send(createPayload);

    expect(createRes.status).toBe(201);
    const { booking, receipt } = createRes.body.data;
    createdBookingCodes.push(booking.bookingCode);

    expect(booking.channel).toBe('COUNTER');
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.paymentStatus).toBe('PAID');
    expect(booking.isGuest).toBe(true);
    expect(booking.customerName).toBe('Trần Minh Hoàng');
    expect(booking.paidAmount).toBe(500_000);
    expect(booking.remainingAmount).toBe(0);
    expect(booking.holdExpireAt).toBeNull();

    expect(receipt).not.toBeNull();
    expect(receipt.paymentCode).toMatch(/^PT\d{10,}$/);
    expect(receipt.bookingCode).toBe(booking.bookingCode);
    expect(receipt.purpose).toBe('FULL');
    expect(receipt.method).toBe('CASH');
    expect(receipt.channel).toBe('COUNTER');
    expect(receipt.amount).toBe(500_000);
    expect(receipt.collectedByName).toBe('Phạm Thu Trang');

    expect(emittedEvents.some((e) => e.event === 'slot.updated')).toBe(true);
    expect(emittedEvents.some((e) => e.event === 'booking.paid')).toBe(true);

    // 5. Idempotency replay -> identical 201 result, no new booking
    const replayRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', idemKey)
      .send(createPayload);
    expect(replayRes.status).toBe(201);
    expect(replayRes.body.data.booking.bookingCode).toBe(booking.bookingCode);
    expect(replayRes.body.data.receipt.paymentCode).toBe(receipt.paymentCode);

    // Same key, different body -> 409 IDEMPOTENCY_CONFLICT
    const conflictRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', idemKey)
      .send({ ...createPayload, startTime: '16:00', endTime: '18:00' });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

    // 6. API-31: Latest counter receipt for CS01
    const ownerMissingBranch = await request(app.getHttpServer())
      .get('/api/v1/pos/receipts/latest')
      .set('Authorization', 'Bearer token-owner');
    expect(ownerMissingBranch.status).toBe(400);

    const latestRes = await request(app.getHttpServer())
      .get('/api/v1/pos/receipts/latest')
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(latestRes.status).toBe(200);
    expect(latestRes.body.data.paymentCode).toBe(receipt.paymentCode);
    expect(latestRes.body.data.bookingCode).toBe(booking.bookingCode);

    // 7. TotalAmount = 0 via FIXED promo -> CONFIRMED + PAID immediately, receipt = null
    const freeCode = `POSFREE${Date.now().toString().slice(-5)}`;
    createdPromoCodes.push(freeCode);
    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), freeCode)
      .input('d', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Miễn phí POS 100%', 'FIXED', 500000, 1, 1, @d, @d, 'ALL', 10, 0, 'ACTIVE', @ownerId)
      `);

    const freeRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl01,
        date: playDate,
        startTime: '08:00',
        endTime: '09:00',
        customer: { type: 'MEMBER', userId: ids.anId },
        promotionCode: freeCode,
        paymentOption: 'FULL',
      });
    expect(freeRes.status).toBe(201);
    createdBookingCodes.push(freeRes.body.data.booking.bookingCode);
    expect(freeRes.body.data.booking.status).toBe('CONFIRMED');
    expect(freeRes.body.data.booking.paymentStatus).toBe('PAID');
    expect(freeRes.body.data.booking.totalAmount).toBe(0);
    expect(freeRes.body.data.receipt).toBeNull();

    // 8. API-25: POS schedule shows BOOKED cell on SAN_PB_01 18:00-20:00 and LOCKED on SAN_PB_02 on D+5
    const schedRes = await request(app.getHttpServer())
      .get(`/api/v1/pos/schedule?date=${playDate}&sportId=${ids.pickleballSportId}`)
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(schedRes.status).toBe(200);
    expect(schedRes.body.data.slotMinutes).toBe(120);
    const pb01Row = schedRes.body.data.courts.find(
      (c: { courtId: number }) => c.courtId === ids.pb01,
    );
    // Pickleball DisplayBlockMinutes = 120 starting at 05:00 -> 17:00-19:00 and 19:00-21:00 both overlap 18:00-20:00
    const bookedCell17 = pb01Row.cells.find(
      (c: { start: string }) => c.start === '17:00',
    );
    const bookedCell19 = pb01Row.cells.find(
      (c: { start: string }) => c.start === '19:00',
    );
    expect(bookedCell17.state).toBe('BOOKED');
    expect(bookedCell17.booking.bookingCode).toBe(booking.bookingCode);
    expect(bookedCell17.booking.paymentStatus).toBe('PAID');
    expect(bookedCell19.state).toBe('BOOKED');
    expect(bookedCell19.booking.bookingCode).toBe(booking.bookingCode);

    const freeCell = pb01Row.cells.find((c: { start: string }) => c.start === '09:00');
    expect(freeCell.state).toBe('FREE');
    expect(freeCell.price).toBe(300_000);

    // Check D+5 maintenance block on SAN_PB_02
    const blockDate = formatDateVn(addDays(new Date(), 5));
    const blockSchedRes = await request(app.getHttpServer())
      .get(`/api/v1/pos/schedule?branchId=${ids.cs01}&date=${blockDate}&sportId=${ids.pickleballSportId}`)
      .set('Authorization', 'Bearer token-owner');
    expect(blockSchedRes.status).toBe(200);
    const pb02Row = blockSchedRes.body.data.courts.find(
      (c: { courtId: number }) => c.courtId === ids.pb02,
    );
    const lockedCell = pb02Row.cells.find((c: { start: string }) => c.start === '09:00');
    expect(lockedCell.state).toBe('LOCKED');
    expect(lockedCell.blockType).toBe('MAINTENANCE');
  });

  it('API-28 (hold), API-29 (collect cash / HOLD_EXPIRED / AMOUNT_MISMATCH), and API-30 (COUNTER_ABORT + promo restore)', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 5));

    // Create a custom promo to verify UsedCount decrement on abort
    const abortPromo = `ABRT${Date.now().toString().slice(-5)}`;
    createdPromoCodes.push(abortPromo);
    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), abortPromo)
      .input('d', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (Code, Name, DiscountType, DiscountValue, AllBranches, AllSports, StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy)
        VALUES (@code, N'Promo test abort', 'FIXED', 20000, 1, 1, @d, @d, 'ALL', 5, 0, 'ACTIVE', @ownerId)
      `);

    // 1. Create counter booking without payment -> PENDING_PAYMENT
    const holdRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl01,
        date: playDate,
        startTime: '14:00',
        endTime: '16:00',
        customer: { type: 'GUEST', phone: '0906111222', fullName: 'Khách QR Quầy' },
        promotionCode: abortPromo,
        paymentOption: 'FULL',
        payment: null,
      });

    expect(holdRes.status).toBe(201);
    const heldBooking = holdRes.body.data.booking;
    createdBookingCodes.push(heldBooking.bookingCode);
    expect(heldBooking.status).toBe('PENDING_PAYMENT');
    expect(heldBooking.paymentStatus).toBe('UNPAID');
    expect(heldBooking.totalAmount).toBe(140_000);
    expect(heldBooking.holdExpireAt).not.toBeNull();
    expect(holdRes.body.data.receipt).toBeNull();

    // Check UsedCount = 1
    const promoAfterHold = await exec
      .request()
      .input('code', sql.VarChar(20), abortPromo)
      .query<{ UsedCount: number }>('SELECT UsedCount FROM dbo.Promotions WHERE Code = @code');
    expect(promoAfterHold.recordset[0].UsedCount).toBe(1);

    // 2. API-30: Abort counter booking -> CANCELED + COUNTER_ABORT, slots freed, UsedCount = 0
    const abortRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${heldBooking.bookingCode}/abort`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: heldBooking.version });
    expect(abortRes.status).toBe(200);
    expect(abortRes.body.data).toEqual({
      bookingCode: heldBooking.bookingCode,
      status: 'CANCELED',
      cancelType: 'COUNTER_ABORT',
    });

    const promoAfterAbort = await exec
      .request()
      .input('code', sql.VarChar(20), abortPromo)
      .query<{ UsedCount: number }>('SELECT UsedCount FROM dbo.Promotions WHERE Code = @code');
    expect(promoAfterAbort.recordset[0].UsedCount).toBe(0);

    // 3. Rebook the same freed slot without payment -> PENDING_PAYMENT
    const rebookRes = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl01,
        date: playDate,
        startTime: '14:00',
        endTime: '16:00',
        customer: { type: 'MEMBER', userId: ids.anId },
        paymentOption: 'DEPOSIT',
      });
    expect(rebookRes.status).toBe(201);
    const pendingBooking = rebookRes.body.data.booking;
    createdBookingCodes.push(pendingBooking.bookingCode);
    expect(pendingBooking.amountDueNow).toBe(50_000);

    // Create an active QR request on this booking so API-29 must cancel it
    const qrRes = await request(app.getHttpServer())
      .post(`/api/v1/bookings/${pendingBooking.bookingCode}/payment-requests`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({ purpose: 'DEPOSIT' });
    expect(qrRes.status).toBe(201);

    // Wrong amount -> 422 AMOUNT_MISMATCH
    const badAmtRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${pendingBooking.bookingCode}/payments`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({ method: 'CASH', amount: 40_000, version: pendingBooking.version });
    expect(badAmtRes.status).toBe(422);
    expect(badAmtRes.body.error.code).toBe('AMOUNT_MISMATCH');

    // Advance past hold -> 422 HOLD_EXPIRED
    const savedNow = fakeClock.now();
    fakeClock.set(addMinutes(savedNow, 11));
    const expiredPayRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${pendingBooking.bookingCode}/payments`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({ method: 'CASH', amount: 50_000, version: pendingBooking.version });
    expect(expiredPayRes.status).toBe(422);
    expect(expiredPayRes.body.error.code).toBe('HOLD_EXPIRED');

    // Restore clock within hold window -> 201 CONFIRMED + DEPOSITED, QR CANCELED
    fakeClock.set(addMinutes(savedNow, 2));
    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${pendingBooking.bookingCode}/payments`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({ method: 'CASH', amount: 50_000, version: pendingBooking.version });
    expect(payRes.status).toBe(201);
    expect(payRes.body.data.booking.status).toBe('CONFIRMED');
    expect(payRes.body.data.booking.paymentStatus).toBe('DEPOSITED');
    expect(payRes.body.data.receipt.purpose).toBe('DEPOSIT');

    const qrStatusRes = await exec
      .request()
      .input('code', sql.VarChar(20), pendingBooking.bookingCode)
      .query<{ Status: string }>(`
        SELECT pr.Status FROM dbo.PaymentRequest pr
        JOIN dbo.Bookings b ON b.BookingId = pr.BookingId
        WHERE b.BookingCode = @code
      `);
    expect(qrStatusRes.recordset[0].Status).toBe('CANCELED');

    // Calling abort on CONFIRMED booking -> 422 BOOKING_NOT_CANCELABLE
    const abortPaidRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${pendingBooking.bookingCode}/abort`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: payRes.body.data.booking.version });
    expect(abortPaidRes.status).toBe(422);
    expect(abortPaidRes.body.error.code).toBe('BOOKING_NOT_CANCELABLE');
  });

  it('API-32, API-33, API-34, API-35: list bookings, settle (COURT_IN_USE checked before cash), check-in (PAYMENT_INCOMPLETE, CHECK_IN_TOO_EARLY), and early complete releasing future slots', async () => {
    // Set clock at 08:00 on baseToday
    fakeClock.set(parseVnDateTime(baseToday, '08:00'));

    // Booking A: cl01 10:00-12:00 FULL CASH (160,000)
    const resA = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl01,
        date: baseToday,
        startTime: '10:00',
        endTime: '12:00',
        customer: { type: 'GUEST', phone: '0907111222', fullName: 'Khách A' },
        paymentOption: 'FULL',
        payment: { method: 'CASH', amount: 160_000 },
      });
    expect(resA.status).toBe(201);
    let bookingA = resA.body.data.booking;
    createdBookingCodes.push(bookingA.bookingCode);

    // Booking B: cl01 12:00-14:00 DEPOSIT CASH (deposit 50,000, remaining 110,000)
    const resB = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl01,
        date: baseToday,
        startTime: '12:00',
        endTime: '14:00',
        customer: { type: 'MEMBER', userId: ids.anId },
        paymentOption: 'DEPOSIT',
        payment: { method: 'CASH', amount: 50_000 },
      });
    expect(resB.status).toBe(201);
    let bookingB = resB.body.data.booking;
    createdBookingCodes.push(bookingB.bookingCode);

    // Booking C: cl02 16:00-18:00 PENDING_PAYMENT
    const resC = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl02,
        date: baseToday,
        startTime: '16:00',
        endTime: '18:00',
        customer: { type: 'GUEST', phone: '0907333444', fullName: 'Khách C' },
        paymentOption: 'FULL',
      });
    expect(resC.status).toBe(201);
    const bookingC = resC.body.data.booking;
    createdBookingCodes.push(bookingC.bookingCode);

    // Advance clock to 10:40 -> A is OVERDUE (StartAt 10:00 + 30' = 10:30 <= 10:40), B is WAITING, C is PENDING_PAYMENT
    fakeClock.set(parseVnDateTime(baseToday, '10:40'));

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/pos/bookings?date=${baseToday}`)
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(listRes.status).toBe(200);
    expect(listRes.body.meta.tabCounts).toMatchObject({
      ALL: 3,
      OVERDUE: 1,
      WAITING: 1,
      IN_USE: 0,
      PENDING_PAYMENT: 1,
      COMPLETED: 0,
      CANCELED: 0,
      EXPIRED: 0,
    });
    // Sort order: OVERDUE (A) -> WAITING (B) -> PENDING_PAYMENT (C)
    expect(listRes.body.data.map((b: { bookingCode: string }) => b.bookingCode)).toEqual([
      bookingA.bookingCode,
      bookingB.bookingCode,
      bookingC.bookingCode,
    ]);
    expect(listRes.body.data[0].isOverdue).toBe(true);

    // Search with #bookingCode
    const searchRes = await request(app.getHttpServer())
      .get(`/api/v1/pos/bookings?date=${baseToday}&q=${encodeURIComponent(`#${bookingB.bookingCode}`)}`)
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(searchRes.status).toBe(200);
    expect(searchRes.body.data).toHaveLength(1);
    expect(searchRes.body.data[0].bookingCode).toBe(bookingB.bookingCode);

    // Filter tab=OVERDUE
    const overdueRes = await request(app.getHttpServer())
      .get(`/api/v1/pos/bookings?date=${baseToday}&tab=OVERDUE`)
      .set('Authorization', 'Bearer token-staff-cs01');
    expect(overdueRes.status).toBe(200);
    expect(overdueRes.body.data).toHaveLength(1);
    expect(overdueRes.body.data[0].bookingCode).toBe(bookingA.bookingCode);

    // API-34: Check-in Booking A -> IN_USE
    const checkInARes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingA.bookingCode}/check-in`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: bookingA.version });
    expect(checkInARes.status).toBe(200);
    bookingA = checkInARes.body.data.booking;
    expect(bookingA.status).toBe('IN_USE');
    expect(bookingA.allowedActions).toEqual(['COMPLETE']);
    expect(bookingA.checkedInAt).not.toBeNull();

    // Stale version on Booking A complete -> 409 BOOKING_STATE_CHANGED
    const staleCompleteRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingA.bookingCode}/complete`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: resA.body.data.booking.version });
    expect(staleCompleteRes.status).toBe(409);
    expect(staleCompleteRes.body.error.code).toBe('BOOKING_STATE_CHANGED');

    // API-34: Check-in Booking B (still DEPOSITED) at 11:50 -> 422 PAYMENT_INCOMPLETE
    fakeClock.set(parseVnDateTime(baseToday, '11:50'));
    const incompleteCheckIn = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingB.bookingCode}/check-in`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: bookingB.version });
    expect(incompleteCheckIn.status).toBe(422);
    expect(incompleteCheckIn.body.error.code).toBe('PAYMENT_INCOMPLETE');

    // API-33: Settle Booking B at 11:30 (>15' early) -> 422 CHECK_IN_TOO_EARLY
    fakeClock.set(parseVnDateTime(baseToday, '11:30'));
    const earlySettle = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingB.bookingCode}/settle`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        method: 'CASH',
        amount: 110_000,
        checkIn: true,
        version: bookingB.version,
      });
    expect(earlySettle.status).toBe(422);
    expect(earlySettle.body.error.code).toBe('CHECK_IN_TOO_EARLY');

    // API-33: Settle Booking B at 11:50 while A is STILL IN_USE on cl01 -> 409 COURT_IN_USE BEFORE taking cash!
    fakeClock.set(parseVnDateTime(baseToday, '11:50'));
    const courtInUseSettle = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingB.bookingCode}/settle`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        method: 'CASH',
        amount: 110_000,
        checkIn: true,
        version: bookingB.version,
      });
    expect(courtInUseSettle.status).toBe(409);
    expect(courtInUseSettle.body.error.code).toBe('COURT_IN_USE');
    expect(courtInUseSettle.body.error.details.blockingBookingCode).toBe(bookingA.bookingCode);

    // Verify NO REMAINING payment was recorded for Booking B
    const exec = await txService.executor();
    const paymentsForB = await exec
      .request()
      .input('code', sql.VarChar(20), bookingB.bookingCode)
      .query<{ Purpose: string; PaidAmount: number }>(`
        SELECT p.Purpose, b.PaidAmount
        FROM dbo.Bookings b
        LEFT JOIN dbo.Payments p ON p.BookingId = b.BookingId
        WHERE b.BookingCode = @code
      `);
    expect(paymentsForB.recordset).toHaveLength(1);
    expect(paymentsForB.recordset[0].Purpose).toBe('DEPOSIT');
    expect(Number(paymentsForB.recordset[0].PaidAmount)).toBe(50_000);

    // API-35: Complete Booking A early at 11:10 -> COMPLETED, future slots (>= 11:10, i.e. 11:30) deactivated
    fakeClock.set(parseVnDateTime(baseToday, '11:10'));
    const completeARes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingA.bookingCode}/complete`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ note: 'Khách về sớm', version: bookingA.version });
    expect(completeARes.status).toBe(200);
    bookingA = completeARes.body.data.booking;
    expect(bookingA.status).toBe('COMPLETED');
    expect(bookingA.allowedActions).toEqual([]);
    expect(bookingA.checkedOutAt).not.toBeNull();

    // Verify 11:30 slot of Booking A has IsActive = 0 while 10:00, 10:30, 11:00 have IsActive = 1
    const slotsARes = await exec
      .request()
      .input('code', sql.VarChar(20), bookingA.bookingCode)
      .query<{ SlotStart: Date; IsActive: boolean }>(`
        SELECT bs.SlotStart, bs.IsActive
        FROM dbo.BookingSlots bs
        JOIN dbo.Bookings b ON b.BookingId = bs.BookingId
        WHERE b.BookingCode = @code
        ORDER BY bs.SlotStart ASC
      `);
    expect(slotsARes.recordset.map((r) => Boolean(r.IsActive))).toEqual([true, true, true, false]);

    // Calling complete again on COMPLETED booking -> 422 BOOKING_NOT_IN_USE
    const completeAgain = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingA.bookingCode}/complete`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: bookingA.version });
    expect(completeAgain.status).toBe(422);
    expect(completeAgain.body.error.code).toBe('BOOKING_NOT_IN_USE');

    // API-33: Now at 11:50, settle Booking B with checkIn: true -> 200 IN_USE + PAID + REMAINING receipt
    fakeClock.set(parseVnDateTime(baseToday, '11:50'));
    const settleBRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingB.bookingCode}/settle`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        method: 'CASH',
        amount: 110_000,
        checkIn: true,
        version: bookingB.version,
      });
    expect(settleBRes.status).toBe(200);
    bookingB = settleBRes.body.data.booking;
    const settleReceipt = settleBRes.body.data.receipt;
    expect(bookingB.status).toBe('IN_USE');
    expect(bookingB.paymentStatus).toBe('PAID');
    expect(bookingB.paidAmount).toBe(160_000);
    expect(bookingB.remainingAmount).toBe(0);
    expect(bookingB.allowedActions).toEqual(['COMPLETE']);
    expect(settleReceipt.purpose).toBe('REMAINING');
    expect(settleReceipt.method).toBe('CASH');
    expect(settleReceipt.amount).toBe(110_000);

    // Calling settle again on already PAID/IN_USE -> 409 BOOKING_STATE_CHANGED
    const settleAgain = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${bookingB.bookingCode}/settle`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        method: 'CASH',
        amount: 110_000,
        checkIn: true,
        version: bookingB.version,
      });
    expect(settleAgain.status).toBe(409);
    expect(settleAgain.body.error.code).toBe('BOOKING_STATE_CHANGED');
  });

  it('M-4: reads CHECKIN_EARLY_MINUTES from SystemSettings instead of hardcoding 15m', async () => {
    const settingsService = app.get(SettingsService);
    fakeClock.set(parseVnDateTime(baseToday, '08:00'));

    const res = await request(app.getHttpServer())
      .post('/api/v1/pos/bookings')
      .set('Authorization', 'Bearer token-staff-cs01')
      .set('Idempotency-Key', uuid())
      .send({
        branchId: ids.cs01,
        courtId: ids.cl02,
        date: baseToday,
        startTime: '14:00',
        endTime: '15:00',
        customer: { type: 'GUEST', phone: '0908111222', fullName: 'Khách Early Checkin' },
        paymentOption: 'FULL',
        payment: { method: 'CASH', amount: 80_000 },
      });
    expect(res.status).toBe(201);
    const created = res.body.data.booking;
    createdBookingCodes.push(created.bookingCode);

    // At 13:35 (25 minutes early): default 15m rejects with 422 CHECK_IN_TOO_EARLY
    fakeClock.set(parseVnDateTime(baseToday, '13:35'));
    const tooEarlyRes = await request(app.getHttpServer())
      .post(`/api/v1/pos/bookings/${created.bookingCode}/check-in`)
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({ version: created.version });
    expect(tooEarlyRes.status).toBe(422);
    expect(tooEarlyRes.body.error.code).toBe('CHECK_IN_TOO_EARLY');

    // Override CHECKIN_EARLY_MINUTES = 30 -> check-in 25 minutes early succeeds
    settingsService.setOverrides({ CHECKIN_EARLY_MINUTES: 30 });
    try {
      const allowedRes = await request(app.getHttpServer())
        .post(`/api/v1/pos/bookings/${created.bookingCode}/check-in`)
        .set('Authorization', 'Bearer token-staff-cs01')
        .send({ version: created.version });
      expect(allowedRes.status).toBe(200);
      expect(allowedRes.body.data.booking.status).toBe('IN_USE');
    } finally {
      settingsService.setOverrides(null);
    }
  });
});
