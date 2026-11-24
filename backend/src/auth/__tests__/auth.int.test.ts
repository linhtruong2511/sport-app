import {
  Controller,
  Get,
  HttpCode,
  type INestApplication,
  Module,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool, sql } from '../../config/database.js';
import {
  BranchScoped,
  CurrentUser,
  Roles,
  ScopedBranchId,
} from '../../core/auth/auth.decorators.js';
import type { AuthenticatedUser } from '../../core/auth/auth.types.js';
import { BranchScopeGuard } from '../../core/auth/branch-scope.guard.js';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard.js';
import { RolesGuard } from '../../core/auth/roles.guard.js';
import { CLOCK, FakeClock, SystemClock } from '../../core/clock.js';
import { CoreModule } from '../../core/core.module.js';
import { DbTransactionService } from '../../core/db/transaction.js';
import { AppExceptionsFilter } from '../../core/errors.js';
import { ok } from '../../core/http/envelope.js';
import { traceIdMiddleware } from '../../core/http/trace-id.middleware.js';
import { AppLogger } from '../../core/logger.js';
import { type DomainEvent, RealtimeService } from '../../core/realtime/realtime.service.js';
import { DatabaseModule } from '../../database/database.module.js';
import { AuthModule } from '../auth.module.js';
import { AuthService } from '../auth.service.js';
import { TokenVersionCacheService } from '../token-version-cache.service.js';

function getSetCookies(headers: Record<string, unknown>): string[] {
  const raw = headers['set-cookie'];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string');
  }
  return typeof raw === 'string' ? [raw] : [];
}

@Controller('test-auth-guards')
class TestGuardsController {
  @Get('owner-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  ownerOnly(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.userId, role: user.role };
  }

  @Get('branches/:branchId/scoped')
  @UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
  @Roles('OWNER', 'STAFF')
  @BranchScoped()
  branchParamScoped(
    @Param('branchId') branchId: string,
    @ScopedBranchId() scopedBranchId: number | null | undefined,
  ) {
    return { paramBranchId: Number(branchId), scopedBranchId: scopedBranchId ?? null };
  }

  @Post('scoped-body')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard, BranchScopeGuard)
  @Roles('OWNER', 'STAFF')
  @BranchScoped()
  branchBodyScoped(@ScopedBranchId() scopedBranchId: number | null | undefined) {
    return ok({ scopedBranchId: scopedBranchId ?? null }, new SystemClock());
  }
}

@Module({
  imports: [CoreModule, DatabaseModule, AuthModule],
  controllers: [TestGuardsController],
})
class TestAuthAppModule {}

describe('auth integration (API-01, API-02, API-06, API-09, API-10, Guards)', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let authService: AuthService;
  let tokenVersionCache: TokenVersionCacheService;
  let realtimeService: RealtimeService;
  let systemClock: SystemClock;
  let originalClockNow: () => Date;
  const fakeClock = new FakeClock(new Date());

  beforeAll(async () => {
    app = await NestFactory.create(TestAuthAppModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    authService = app.get(AuthService);
    tokenVersionCache = app.get(TokenVersionCacheService);
    realtimeService = app.get(RealtimeService);
    systemClock = app.get(CLOCK);
    originalClockNow = systemClock.now.bind(systemClock);
    systemClock.now = () => fakeClock.now();
  });

  beforeEach(() => {
    fakeClock.set(new Date(Math.floor(Date.now() / 1000) * 1000));
    tokenVersionCache.clear();
  });

  afterAll(async () => {
    if (systemClock && originalClockNow) {
      systemClock.now = originalClockNow;
    }
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('API-06: logs in customer, staff, and owner via phone or case-insensitive email and sets sh_rt cookie', async () => {
    const resCustomer = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0987654321', password: 'An123456' });

    expect(resCustomer.status).toBe(200);
    expect(resCustomer.body.data.tokenType).toBe('Bearer');
    expect(resCustomer.body.data.expiresIn).toBe(900);
    expect(resCustomer.body.data.accessToken).toBeTruthy();
    expect(resCustomer.body.data.user).toMatchObject({
      phone: '0987654321',
      role: 'CUSTOMER',
      branchId: null,
      title: 'Hội viên',
    });
    const setCookies = getSetCookies(resCustomer.headers);
    expect(setCookies.some((c) => c.startsWith('sh_rt=') && c.includes('HttpOnly') && c.includes('Path=/api/v1/auth'))).toBe(
      true,
    );

    const resOwner = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '  OWNER@SPORTHUB.VN  ', password: 'Owner@123' });

    expect(resOwner.status).toBe(200);
    expect(resOwner.body.data.user).toMatchObject({
      role: 'OWNER',
      branchId: null,
      title: 'Chủ hệ thống sân',
    });

    const resStaff = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0933445577', password: 'Nv123456' });

    expect(resStaff.status).toBe(200);
    expect(resStaff.body.data.user).toMatchObject({
      role: 'STAFF',
      branchId: 1,
      title: 'Nhân viên thu ngân',
    });
  });

  it('API-06: returns 400 VALIDATION_ERROR, 401 ACCOUNT_NOT_FOUND, and 403 ACCOUNT_LOCKED', async () => {
    const resInvalid = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '', password: '123' });
    expect(resInvalid.status).toBe(400);
    expect(resInvalid.body.error.code).toBe('VALIDATION_ERROR');

    const resNotFound = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0999999999', password: 'Matkhau123' });
    expect(resNotFound.status).toBe(401);
    expect(resNotFound.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const resLocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0933445588', password: 'Nv123456' });
    expect(resLocked.status).toBe(403);
    expect(resLocked.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(resLocked.body.error.message).toBe(
      'Tài khoản nhân viên đã bị khóa, vui lòng liên hệ chủ hệ thống.',
    );
  });

  it('API-10: registers a new customer (201) and rejects duplicate phone/email (409)', async () => {
    const resRegister = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Lê Minh Khôi',
        phone: '0901112233',
        email: 'khoilm@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
      });

    expect(resRegister.status).toBe(201);
    expect(resRegister.body.data.accessToken).toBeTruthy();
    expect(resRegister.body.data.expiresIn).toBe(900);
    expect(resRegister.body.data.user).toMatchObject({
      fullName: 'Lê Minh Khôi',
      phone: '0901112233',
      email: 'khoilm@example.com',
      role: 'CUSTOMER',
      branchId: null,
      memberTier: null,
      title: 'Hội viên',
    });
    expect(resRegister.body.data.user.code).toMatch(/^KH\d{6,}$/);

    const resDupPhone = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Người Khác',
        phone: '0901112233',
        email: 'other@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
      });
    expect(resDupPhone.status).toBe(409);
    expect(resDupPhone.body.error.code).toBe('PHONE_TAKEN');

    const resDupEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Người Khác',
        phone: '0901112244',
        email: 'KHOILM@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
      });
    expect(resDupEmail.status).toBe(409);
    expect(resDupEmail.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('R-07: locks account for 5 minutes after 5 failed attempts, resets counter, and unlocks after +5m', async () => {
    const phone = '0902223344';
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Phạm Thử Khóa',
        phone,
        email: 'locktest@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
      });
    expect(reg.status).toBe(201);

    for (let attempt = 1; attempt <= 4; attempt++) {
      const resFail = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ identity: phone, password: 'WrongPassword' });
      expect(resFail.status).toBe(401);
      expect(resFail.body.error.code).toBe('WRONG_PASSWORD');
      expect(resFail.body.error.details.remainingAttempts).toBe(5 - attempt);
    }

    const resFifth = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: phone, password: 'WrongPassword' });
    expect(resFifth.status).toBe(423);
    expect(resFifth.body.error.code).toBe('ACCOUNT_TEMP_LOCKED');
    expect(resFifth.body.error.details.lockedUntil).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);

    // R-07: FailedLoginCount must be reset to 0 when LockedUntil is set
    const exec = await txService.executor();
    const rowRes = await exec
      .request()
      .input('phone', sql.VarChar(10), phone)
      .query<{ FailedLoginCount: number; LockedUntil: Date | null }>(
        'SELECT FailedLoginCount, LockedUntil FROM dbo.Users WHERE Phone = @phone',
      );
    expect(rowRes.recordset[0]?.FailedLoginCount).toBe(0);
    expect(rowRes.recordset[0]?.LockedUntil).not.toBeNull();

    // Even correct password is blocked while within lock window
    const resWhileLocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: phone, password: 'Matkhau123' });
    expect(resWhileLocked.status).toBe(423);
    expect(resWhileLocked.body.error.code).toBe('ACCOUNT_TEMP_LOCKED');

    // Advance FakeClock +5 minutes -> unlocked without sleep
    fakeClock.advanceMinutes(5);

    const resUnlocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: phone, password: 'Matkhau123' });
    expect(resUnlocked.status).toBe(200);
    expect(resUnlocked.body.data.accessToken).toBeTruthy();
  });

  it('API-01, API-02, API-09: /auth/me, refresh token rotation, reuse rejection, and logout', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0912345678', password: 'An123456' });
    expect(loginRes.status).toBe(200);

    const accessToken = loginRes.body.data.accessToken as string;
    const cookie1 = getSetCookies(loginRes.headers)[0].split(';')[0];

    // API-01 without token -> 401
    const meNoAuth = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(meNoAuth.status).toBe(401);
    expect(meNoAuth.body.error.code).toBe('UNAUTHENTICATED');

    // API-01 with valid token -> 200
    const meOk = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meOk.status).toBe(200);
    expect(meOk.body.data.phone).toBe('0912345678');

    // API-02 missing cookie -> 401 REFRESH_INVALID
    const refreshMissing = await request(app.getHttpServer()).post('/api/v1/auth/refresh');
    expect(refreshMissing.status).toBe(401);
    expect(refreshMissing.body.error.code).toBe('REFRESH_INVALID');

    // API-02 rotation -> 200 + new cookie
    const refreshOk = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1);
    expect(refreshOk.status).toBe(200);
    expect(refreshOk.body.data.accessToken).toBeTruthy();
    const cookie2 = getSetCookies(refreshOk.headers)[0].split(';')[0];
    expect(cookie2).not.toBe(cookie1);

    // Reusing rotated cookie1 -> 401 REFRESH_INVALID
    const refreshReuse = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie1);
    expect(refreshReuse.status).toBe(401);
    expect(refreshReuse.body.error.code).toBe('REFRESH_INVALID');

    // API-09 logout -> 204 and revokes cookie2
    const logoutRes = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshOk.body.data.accessToken as string}`)
      .set('Cookie', cookie2);
    expect(logoutRes.status).toBe(204);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie2);
    expect(refreshAfterLogout.status).toBe(401);
    expect(refreshAfterLogout.body.error.code).toBe('REFRESH_INVALID');
  });

  it('revokeUserSessions invalidates active access tokens (401 TOKEN_REVOKED), revokes refresh tokens, and emits auth.revoked', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        fullName: 'Trần Thu Hồi',
        phone: '0903334455',
        email: 'revoke@example.com',
        password: 'Matkhau123',
        confirmPassword: 'Matkhau123',
      });
    expect(regRes.status).toBe(201);
    const userId = regRes.body.data.user.userId as number;
    const accessToken = regRes.body.data.user ? (regRes.body.data.accessToken as string) : '';
    const cookie = getSetCookies(regRes.headers)[0].split(';')[0];

    // Prime tokenVersionCache via /me
    const meBefore = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(meBefore.status).toBe(200);

    const flushed: DomainEvent[] = [];
    const origFlush = realtimeService.flush.bind(realtimeService);
    realtimeService.flush = (events: DomainEvent[]) => {
      flushed.push(...events);
      origFlush(events);
    };

    try {
      await txService.withTransaction(async (tx) => {
        await authService.revokeUserSessions(tx, userId, 'BRANCH_CHANGED');
      });

      expect(flushed).toContainEqual({
        rooms: [`user:${userId}`],
        event: 'auth.revoked',
        payload: { reason: 'BRANCH_CHANGED' },
      });

      const meAfter = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(meAfter.status).toBe(401);
      expect(meAfter.body.error.code).toBe('TOKEN_REVOKED');

      const refreshAfter = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie);
      expect(refreshAfter.status).toBe(401);
      expect(refreshAfter.body.error.code).toBe('REFRESH_INVALID');
    } finally {
      realtimeService.flush = origFlush;
    }
  });

  it('RolesGuard and BranchScopeGuard enforce role and branch isolation', async () => {
    const customerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0987654321', password: 'An123456' });
    const customerToken = customerLogin.body.data.accessToken as string;

    const staffLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0933445577', password: 'Nv123456' });
    const staffToken = staffLogin.body.data.accessToken as string;

    const ownerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ identity: '0900000001', password: 'Owner@123' });
    const ownerToken = ownerLogin.body.data.accessToken as string;

    // Customer hitting OWNER-only endpoint -> 403 FORBIDDEN
    const customerToOwner = await request(app.getHttpServer())
      .get('/api/v1/test-auth-guards/owner-only')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerToOwner.status).toBe(403);
    expect(customerToOwner.body.error.code).toBe('FORBIDDEN');

    // Staff CS01 hitting branchId=2 param -> 403 BRANCH_FORBIDDEN
    const staffOtherBranch = await request(app.getHttpServer())
      .get('/api/v1/test-auth-guards/branches/2/scoped')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffOtherBranch.status).toBe(403);
    expect(staffOtherBranch.body.error.code).toBe('BRANCH_FORBIDDEN');

    // Staff CS01 hitting branchId=1 param -> 200
    const staffOwnBranch = await request(app.getHttpServer())
      .get('/api/v1/test-auth-guards/branches/1/scoped')
      .set('Authorization', `Bearer ${staffToken}`);
    expect(staffOwnBranch.status).toBe(200);
    expect(staffOwnBranch.body.scopedBranchId).toBe(1);

    // Staff CS01 sending branchId=2 in query/body -> forced to 1
    const staffForcedScope = await request(app.getHttpServer())
      .post('/api/v1/test-auth-guards/scoped-body?branchId=2')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ branchId: 2 });
    expect(staffForcedScope.status).toBe(200);
    expect(staffForcedScope.body.data.scopedBranchId).toBe(1);

    // Owner sending branchId=2 -> 2; without branchId -> null
    const ownerSelectedBranch = await request(app.getHttpServer())
      .post('/api/v1/test-auth-guards/scoped-body?branchId=2')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(ownerSelectedBranch.status).toBe(200);
    expect(ownerSelectedBranch.body.data.scopedBranchId).toBe(2);

    const ownerAllBranches = await request(app.getHttpServer())
      .post('/api/v1/test-auth-guards/scoped-body')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({});
    expect(ownerAllBranches.status).toBe(200);
    expect(ownerAllBranches.body.data.scopedBranchId).toBeNull();
  });
});
