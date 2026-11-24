import { Global, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import {
  type AuthenticatedUser,
  TOKEN_VERIFIER,
  type TokenVerifier,
} from '../../core/auth/index.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { addDays, formatDateVn } from '../../core/time.js';
import { DatabaseModule } from '../../database/database.module.js';
import { PricingModule } from '../pricing.module.js';

let seededUsers: Record<string, AuthenticatedUser> = {};

const mockTokenVerifier: TokenVerifier = {
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const user = seededUsers[token];
    if (!user) {
      throw new Error('Invalid test token');
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
  imports: [CoreModule, DatabaseModule, TestAuthModule, PricingModule],
})
class QuoteTestAppModule {}

describe('pricing /bookings/quote integration', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let futureDate: string;
  let courtIds: {
    pb01: number;
    pb03: number;
    cl01: number;
    bd02: number;
    bd03: number;
    cs01: number;
    sportPb: number;
  };

  beforeAll(async () => {
    app = await NestFactory.create(QuoteTestAppModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    const exec = await txService.executor();

    const courtsRes = await exec.request().query<{
      Code: string;
      CourtId: number;
      BranchId: number;
      SportId: number;
    }>(`
      SELECT Code, CourtId, BranchId, SportId
      FROM dbo.Courts
      WHERE Code IN ('SAN_PB_01', 'SAN_PB_03', 'SAN_CL_01', 'SAN_BD_02', 'SAN_BD_03')
    `);
    const courtMap = new Map(courtsRes.recordset.map((r) => [r.Code, r]));
    courtIds = {
      pb01: Number(courtMap.get('SAN_PB_01')!.CourtId),
      pb03: Number(courtMap.get('SAN_PB_03')!.CourtId),
      cl01: Number(courtMap.get('SAN_CL_01')!.CourtId),
      bd02: Number(courtMap.get('SAN_BD_02')!.CourtId),
      bd03: Number(courtMap.get('SAN_BD_03')!.CourtId),
      cs01: Number(courtMap.get('SAN_PB_01')!.BranchId),
      sportPb: Number(courtMap.get('SAN_PB_01')!.SportId),
    };

    const usersRes = await exec.request().query<{
      Phone: string;
      UserId: number | string;
      Role: 'OWNER' | 'STAFF' | 'CUSTOMER';
      BranchId: number | null;
      TokenVersion: number;
    }>(`
      SELECT Phone, UserId, Role, BranchId, TokenVersion
      FROM dbo.Users
      WHERE Phone IN ('0987654321', '0933445577', '0900000001')
    `);
    const userMap = new Map(usersRes.recordset.map((u) => [u.Phone, u]));
    const an = userMap.get('0987654321')!;
    const staff = userMap.get('0933445577')!;
    const owner = userMap.get('0900000001')!;

    seededUsers = {
      'token-an': {
        userId: Number(an.UserId),
        role: an.Role,
        branchId: an.BranchId,
        tv: Number(an.TokenVersion),
      },
      'token-staff-cs01': {
        userId: Number(staff.UserId),
        role: staff.Role,
        branchId: staff.BranchId !== null ? Number(staff.BranchId) : null,
        tv: Number(staff.TokenVersion),
      },
      'token-owner': {
        userId: Number(owner.UserId),
        role: owner.Role,
        branchId: null,
        tv: Number(owner.TokenVersion),
      },
    };

    // Pick D+3 so it does not collide with seeded D+1/D+2 bookings and stays inside SANGVUI20/TRIAN10 dates
    futureDate = formatDateVn(addDays(new Date(), 3));
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('computes split price lines (15:00–17:00 on SAN_PB_03 -> 400,000)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb03,
        date: futureDate,
        startTime: '15:00',
        endTime: '17:00',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.baseAmount).toBe(400_000);
    expect(res.body.data.totalAmount).toBe(400_000);
    expect(res.body.data.durationMinutes).toBe(120);
    expect(res.body.data.slotAvailable).toBe(true);
    expect(res.body.data.promotion).toBeNull();
    expect(res.body.data.priceLines).toEqual([
      { label: 'Giờ thường', startTime: '15:00', endTime: '16:00', pricePerHour: 150_000, amount: 150_000 },
      { label: 'Giờ cao điểm', startTime: '16:00', endTime: '17:00', pricePerHour: 250_000, amount: 250_000 },
    ]);
    expect(res.body.meta.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });

  it('applies SANGVUI20 on SAN_BD_03 09:00–10:30 with DEPOSIT 30%', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.bd03,
        date: futureDate,
        startTime: '09:00',
        endTime: '10:30',
        promotionCode: 'sangvui20',
        paymentOption: 'DEPOSIT',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.baseAmount).toBe(450_000);
    expect(res.body.data.promotion).toMatchObject({
      code: 'SANGVUI20',
      applied: true,
      reasonCode: null,
      discountAmount: 90_000,
    });
    expect(res.body.data.discountAmount).toBe(90_000);
    expect(res.body.data.totalAmount).toBe(360_000);
    expect(res.body.data.deposit).toEqual({
      type: 'PERCENT',
      value: 30,
      amount: 108_000,
      fullPaymentRequired: false,
    });
    expect(res.body.data.paymentOption).toBe('DEPOSIT');
    expect(res.body.data.amountDueNow).toBe(108_000);
    expect(res.body.data.remainingOnArrival).toBe(252_000);
  });

  it('applies TRIAN10 for An (ONLINE & COUNTER phone) and rejects guest with PROMO_WRONG_AUDIENCE', async () => {
    // Authenticated as An -> applied
    const resAn = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .set('Authorization', 'Bearer token-an')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '18:00',
        endTime: '20:00',
        promotionCode: 'TRIAN10',
        paymentOption: 'DEPOSIT',
      });

    expect(resAn.status).toBe(200);
    expect(resAn.body.data.promotion.applied).toBe(true);
    expect(resAn.body.data.promotion.reasonCode).toBeNull();
    expect(resAn.body.data.discountAmount).toBe(50_000);
    expect(resAn.body.data.totalAmount).toBe(450_000);
    expect(resAn.body.data.deposit.amount).toBe(135_000);
    expect(resAn.body.data.remainingOnArrival).toBe(315_000);

    // Unauthenticated guest -> PROMO_WRONG_AUDIENCE (still 200)
    const resGuest = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '18:00',
        endTime: '20:00',
        promotionCode: 'TRIAN10',
      });

    expect(resGuest.status).toBe(200);
    expect(resGuest.body.data.promotion.applied).toBe(false);
    expect(resGuest.body.data.promotion.reasonCode).toBe('PROMO_WRONG_AUDIENCE');
    expect(resGuest.body.data.discountAmount).toBe(0);
    expect(resGuest.body.data.totalAmount).toBe(500_000);

    // STAFF COUNTER with An's phone -> applied
    const resCounter = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .set('Authorization', 'Bearer token-staff-cs01')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '18:00',
        endTime: '20:00',
        promotionCode: 'TRIAN10',
        channel: 'COUNTER',
        customerPhone: '0987654321',
      });

    expect(resCounter.status).toBe(200);
    expect(resCounter.body.data.promotion.applied).toBe(true);
    expect(resCounter.body.data.discountAmount).toBe(50_000);
  });

  it('sets deposit.fullPaymentRequired = true when deposit >= totalAmount (R-09 / DEPOSIT_NOT_ALLOWED guard)', async () => {
    // SAN_CL_01 08:00-09:00 = 80,000; TRIAN10 = -50,000 -> total = 30,000; FIXED deposit = 50,000
    const res = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .set('Authorization', 'Bearer token-an')
      .send({
        courtId: courtIds.cl01,
        date: futureDate,
        startTime: '08:00',
        endTime: '09:00',
        promotionCode: 'TRIAN10',
        paymentOption: 'DEPOSIT',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.baseAmount).toBe(80_000);
    expect(res.body.data.discountAmount).toBe(50_000);
    expect(res.body.data.totalAmount).toBe(30_000);
    expect(res.body.data.deposit).toEqual({
      type: 'FIXED',
      value: 50_000,
      amount: 0,
      fullPaymentRequired: true,
    });
    expect(res.body.data.paymentOption).toBe('FULL');
    expect(res.body.data.amountDueNow).toBe(30_000);
    expect(res.body.data.remainingOnArrival).toBe(0);
  });

  it('returns 422 PRICE_NOT_CONFIGURED when court has no price rule covering the range', async () => {
    const exec = await txService.executor();
    const insertRes = await exec
      .request()
      .input('branchId', sql.Int, courtIds.cs01)
      .input('sportId', sql.Int, courtIds.sportPb)
      .query<{ CourtId: number }>(`
        INSERT INTO dbo.Courts (Code, BranchId, SportId, Name, DepositType, DepositValue, Status)
        OUTPUT inserted.CourtId
        VALUES ('SAN_TEST_NOPRICE', @branchId, @sportId, N'Sân Test Không Giá', 'PERCENT', 30, 'ACTIVE')
      `);
    const tempCourtId = Number(insertRes.recordset[0].CourtId);

    try {
      const res = await request(app.getHttpServer())
        .post('/api/v1/bookings/quote')
        .send({
          courtId: tempCourtId,
          date: futureDate,
          startTime: '08:00',
          endTime: '10:00',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('PRICE_NOT_CONFIGURED');
    } finally {
      await exec
        .request()
        .input('courtId', sql.Int, tempCourtId)
        .query('DELETE FROM dbo.Courts WHERE CourtId = @courtId');
    }
  });

  it('returns 422 OUTSIDE_OPENING_HOURS, 422 INVALID_TIME_STEP, and 422 BRANCH_CLOSED on 2027-01-01', async () => {
    // Outside opening hours (04:00-05:00)
    const resHours = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '04:00',
        endTime: '05:00',
      });
    expect(resHours.status).toBe(422);
    expect(resHours.body.error.code).toBe('OUTSIDE_OPENING_HOURS');

    // Invalid time step (Pickleball GridBlockMinutes = 60, request 08:30-09:30)
    const resStep = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '08:30',
        endTime: '09:30',
      });
    expect(resStep.status).toBe(422);
    expect(resStep.body.error.code).toBe('INVALID_TIME_STEP');

    // Holiday on 2027-01-01 -> BRANCH_CLOSED
    const resHoliday = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb01,
        date: '2027-01-01',
        startTime: '08:00',
        endTime: '10:00',
      });
    expect(resHoliday.status).toBe(422);
    expect(resHoliday.body.error.code).toBe('BRANCH_CLOSED');
  });

  it('forbids COUNTER channel for CUSTOMER and unauthenticated callers, and sets slotAvailable=false for INACTIVE court', async () => {
    const resCust = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .set('Authorization', 'Bearer token-an')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '08:00',
        endTime: '10:00',
        channel: 'COUNTER',
      });
    expect(resCust.status).toBe(403);
    expect(resCust.body.error.code).toBe('FORBIDDEN');

    const resAnon = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.pb01,
        date: futureDate,
        startTime: '08:00',
        endTime: '10:00',
        channel: 'COUNTER',
      });
    expect(resAnon.status).toBe(403);
    expect(resAnon.body.error.code).toBe('FORBIDDEN');

    // Inactive court SAN_BD_02 still returns 200 quote with slotAvailable = false
    const resInactive = await request(app.getHttpServer())
      .post('/api/v1/bookings/quote')
      .send({
        courtId: courtIds.bd02,
        date: futureDate,
        startTime: '08:00',
        endTime: '09:30',
      });
    expect(resInactive.status).toBe(200);
    expect(resInactive.body.data.slotAvailable).toBe(false);
  });
});
