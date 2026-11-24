import crypto from 'node:crypto';
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
import { CLOCK, FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { addDays, formatDateVn, parseVnDateTime, toSqlDateTime } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { BookingsModule } from '../bookings.module.js';

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
class ConcurrencyTestAppModule {}

describe('M9 concurrency & optimistic locking integration tests', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let systemClock: SystemClock;
  let originalClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());

  let ids: {
    pb01: number;
    pb03: number;
    cl01: number;
    cl02: number;
    br01: number;
    bd01: number;
    bd03: number;
    tn01: number;
    anId: number;
    binhId: number;
    ownerId: number;
  };

  const createdBookingCodes: string[] = [];
  const createdPromoCodes: string[] = [];
  const createdIdemKeys: string[] = [];

  function uuid(): string {
    const key = crypto.randomUUID();
    createdIdemKeys.push(key);
    return key;
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
    if (createdIdemKeys.length > 0) {
      const quoted = createdIdemKeys.map((k) => `'${k}'`).join(',');
      await exec.request().query(`
        DELETE FROM dbo.IdempotencyKeys WHERE IdempotencyKey IN (${quoted});
      `);
      createdIdemKeys.length = 0;
    }
  }

  beforeAll(async () => {
    app = await NestFactory.create(ConcurrencyTestAppModule, new ExpressAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    systemClock = app.get(CLOCK);
    originalClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();

    const exec = await txService.executor();
    const courtsRes = await exec.request().query<{ Code: string; CourtId: number }>(`
      SELECT Code, CourtId FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01','SAN_PB_03','SAN_CL_01','SAN_CL_02','SAN_BR_01','SAN_BD_01','SAN_BD_03','SAN_TN_01')
    `);
    const courtMap = new Map(courtsRes.recordset.map((c) => [c.Code, Number(c.CourtId)]));

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0987654321', '0912345678', '0900000001')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));

    const an = userMap.get('0987654321')!;
    const binh = userMap.get('0912345678')!;
    const owner = userMap.get('0900000001')!;

    ids = {
      pb01: courtMap.get('SAN_PB_01')!,
      pb03: courtMap.get('SAN_PB_03')!,
      cl01: courtMap.get('SAN_CL_01')!,
      cl02: courtMap.get('SAN_CL_02')!,
      br01: courtMap.get('SAN_BR_01')!,
      bd01: courtMap.get('SAN_BD_01')!,
      bd03: courtMap.get('SAN_BD_03')!,
      tn01: courtMap.get('SAN_TN_01')!,
      anId: Number(an.UserId),
      binhId: Number(binh.UserId),
      ownerId: Number(owner.UserId),
    };

    seededUsers = {
      'token-an': { userId: ids.anId, role: 'CUSTOMER', branchId: null, tv: Number(an.TokenVersion) },
      'token-binh': {
        userId: ids.binhId,
        role: 'CUSTOMER',
        branchId: null,
        tv: Number(binh.TokenVersion),
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
    fakeClock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
  });

  afterEach(async () => {
    await cleanupTestArtifacts();
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

  it('Test 1 — Concurrent Slot Contention: 15 parallel bookings on same court/date/slot -> 1x 201, 14x 409 SLOT_TAKEN, and 1 active BookingSlot row', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 15));
    const slotStart = parseVnDateTime(playDate, '18:00');
    const payload = {
      courtId: ids.pb01,
      date: playDate,
      startTime: '18:00',
      endTime: '20:00',
      paymentOption: 'FULL',
    };

    const requests = Array.from({ length: 15 }, (_, idx) =>
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', idx % 2 === 0 ? 'Bearer token-an' : 'Bearer token-binh')
        .set('Idempotency-Key', uuid())
        .send(payload),
    );

    const responses = await Promise.all(requests);
    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status !== 201);

    for (const w of winners) {
      createdBookingCodes.push(w.body.data.booking.bookingCode);
    }

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(14);
    for (const loser of losers) {
      expect(loser.status).toBe(409);
      expect(loser.body.error.code).toBe('SLOT_TAKEN');
    }

    const exec = await txService.executor();
    const slotCountRes = await exec
      .request()
      .input('courtId', sql.Int, ids.pb01)
      .input('slotStart', sql.DateTime2(0), toSqlDateTime(slotStart))
      .query<{ Cnt: number }>(`
        SELECT COUNT(*) AS Cnt
        FROM dbo.BookingSlots
        WHERE CourtId = @courtId
          AND SlotStart = @slotStart
          AND IsActive = 1
      `);
    expect(Number(slotCountRes.recordset[0].Cnt)).toBe(1);
  });

  it('Test 2 — Concurrent Promotion Contention: 8 parallel bookings with MaxUses=1 promo on distinct courts -> 1x 201 (discount > 0), 7x 409 PROMO_EXHAUSTED, UsedCount=1', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 16));
    const raceCode = `CONC${Date.now().toString().slice(-6)}`;
    createdPromoCodes.push(raceCode);

    const exec = await txService.executor();
    await exec
      .request()
      .input('code', sql.VarChar(20), raceCode)
      .input('startDate', sql.Date, playDate)
      .input('endDate', sql.Date, playDate)
      .input('ownerId', sql.BigInt, ids.ownerId)
      .query(`
        INSERT INTO dbo.Promotions (
          Code, Name, DiscountType, DiscountValue, AllBranches, AllSports,
          StartDate, EndDate, AudienceType, MaxUses, UsedCount, Status, CreatedBy
        )
        VALUES (
          @code, N'Concurrent stress promo MaxUses=1', 'FIXED', 20000, 1, 1,
          @startDate, @endDate, 'ALL', 1, 0, 'ACTIVE', @ownerId
        )
      `);

    const distinctCourts = [
      ids.pb01,
      ids.pb03,
      ids.cl01,
      ids.cl02,
      ids.br01,
      ids.bd01,
      ids.bd03,
      ids.tn01,
    ];

    const requests = distinctCourts.map((courtId, idx) =>
      request(app.getHttpServer())
        .post('/api/v1/bookings')
        .set('Authorization', idx % 2 === 0 ? 'Bearer token-an' : 'Bearer token-binh')
        .set('Idempotency-Key', uuid())
        .send({
          courtId,
          date: playDate,
          startTime: '08:00',
          endTime: '09:00',
          paymentOption: 'FULL',
          promotionCode: raceCode,
        }),
    );

    const responses = await Promise.all(requests);
    const winners = responses.filter((r) => r.status === 201);
    const losers = responses.filter((r) => r.status !== 201);

    for (const w of winners) {
      createdBookingCodes.push(w.body.data.booking.bookingCode);
    }

    expect(winners).toHaveLength(1);
    expect(winners[0].body.data.booking.discountAmount).toBeGreaterThan(0);

    expect(losers).toHaveLength(7);
    for (const loser of losers) {
      expect(loser.status).toBe(409);
      expect(loser.body.error.code).toBe('PROMO_EXHAUSTED');
    }

    const promoRes = await exec
      .request()
      .input('code', sql.VarChar(20), raceCode)
      .query<{ UsedCount: number; MaxUses: number }>(`
        SELECT UsedCount, MaxUses
        FROM dbo.Promotions
        WHERE Code = @code
      `);
    expect(Number(promoRes.recordset[0].UsedCount)).toBe(1);
    expect(Number(promoRes.recordset[0].MaxUses)).toBe(1);
  });

  it('Test 3 — Optimistic Concurrency (RowVer) Double-Cancel Race: 5 parallel cancels with same version -> 1x 200, 4x 409 BOOKING_STATE_CHANGED or 422 BOOKING_NOT_CANCELABLE', async () => {
    const playDate = formatDateVn(addDays(fakeClock.now(), 17));
    const createRes = await request(app.getHttpServer())
      .post('/api/v1/bookings')
      .set('Authorization', 'Bearer token-an')
      .set('Idempotency-Key', uuid())
      .send({
        courtId: ids.pb01,
        date: playDate,
        startTime: '10:00',
        endTime: '11:00',
        paymentOption: 'FULL',
      });

    expect(createRes.status).toBe(201);
    const { bookingCode, version } = createRes.body.data.booking;
    createdBookingCodes.push(bookingCode);

    const cancelRequests = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingCode}/cancel`)
        .set('Authorization', 'Bearer token-an')
        .send({
          reason: 'Hủy đồng thời kiểm tra RowVer',
          version,
        }),
    );

    const responses = await Promise.all(cancelRequests);
    const winners = responses.filter((r) => r.status === 200);
    const losers = responses.filter((r) => r.status !== 200);

    expect(winners).toHaveLength(1);
    expect(winners[0].body.data.booking.status).toBe('CANCELED');

    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect([409, 422]).toContain(loser.status);
      if (loser.status === 409) {
        expect(loser.body.error.code).toBe('BOOKING_STATE_CHANGED');
      } else {
        expect(loser.body.error.code).toBe('BOOKING_NOT_CANCELABLE');
      }
    }
  });
});
