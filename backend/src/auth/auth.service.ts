import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { UserRole } from '@sporthub/shared/enums';
import type { UserDto } from '@sporthub/shared/types';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { AuthenticatedUser, TokenVerifier } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { nextCode } from '../core/codes.js';
import { DbTransactionService, type TxContext } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import { addDays, addMinutes, fromSqlDateTime, toIsoVn } from '../core/time.js';
import { toUserDto } from './auth.mapper.js';
import { AuthRepository, type UserRow } from './auth.repository.js';
import type { LoginDto, RegisterDto } from './auth.schemas.js';
import { TokenVersionCacheService } from './token-version-cache.service.js';

export interface RequestMeta {
  userAgent: string | null;
  ipAddress: string | null;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: UserDto;
  rawRefreshToken: string;
}

export interface RefreshOrRegisterResult {
  accessToken: string;
  expiresIn: number;
  user: UserDto;
  rawRefreshToken: string;
}

interface JwtAccessPayload {
  sub?: number | string;
  role?: UserRole;
  branchId?: number | null;
  tv?: number;
}

function parseExpiresInSeconds(raw: string): number {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  const match = /^(\d+)([smhd])$/i.exec(trimmed);
  if (!match) {
    return 900;
  }
  const val = Number.parseInt(match[1], 10);
  switch (match[2].toLowerCase()) {
    case 's':
      return val;
    case 'm':
      return val * 60;
    case 'h':
      return val * 3600;
    case 'd':
      return val * 86_400;
    default:
      return 900;
  }
}

function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class AuthService implements TokenVerifier {
  private readonly accessExpiresInSeconds = parseExpiresInSeconds(env.jwtAccessExpiresIn);

  constructor(
    private readonly repo: AuthRepository,
    private readonly txService: DbTransactionService,
    private readonly settingsService: SettingsService,
    private readonly tokenVersionCache: TokenVersionCacheService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    let decoded: string | jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, env.jwtAccessSecret);
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new AppError('TOKEN_EXPIRED');
      }
      throw new AppError('UNAUTHENTICATED');
    }

    if (typeof decoded !== 'object' || decoded === null) {
      throw new AppError('UNAUTHENTICATED');
    }

    const payload = decoded as JwtAccessPayload;
    const userId = typeof payload.sub === 'string' ? Number(payload.sub) : payload.sub;
    if (
      typeof userId !== 'number' ||
      !Number.isInteger(userId) ||
      userId <= 0 ||
      typeof payload.tv !== 'number'
    ) {
      throw new AppError('UNAUTHENTICATED');
    }

    let cached = this.tokenVersionCache.get(userId);
    if (!cached) {
      const exec = await this.txService.executor();
      const authStatus = await this.repo.getAuthStatus(exec, userId);
      if (!authStatus) {
        throw new AppError('UNAUTHENTICATED');
      }
      cached = {
        tokenVersion: authStatus.TokenVersion,
        status: authStatus.Status,
        role: authStatus.Role,
        branchId: authStatus.BranchId,
      };
      this.tokenVersionCache.set(userId, cached);
    }

    if (cached.status === 'LOCKED') {
      throw new AppError('ACCOUNT_LOCKED');
    }

    if (payload.tv !== cached.tokenVersion) {
      throw new AppError('TOKEN_REVOKED');
    }

    return {
      userId,
      role: cached.role,
      branchId: cached.branchId,
      tv: cached.tokenVersion,
    };
  }

  // SDD API-06 & R-07
  async login(dto: LoginDto, meta: RequestMeta): Promise<LoginResult> {
    const [maxFailed, lockMinutes] = await Promise.all([
      this.settingsService.getInt('LOGIN_MAX_FAILED'),
      this.settingsService.getInt('LOGIN_LOCK_MINUTES'),
    ]);

    const now = this.clock.now();

    const txOutcome = await this.txService.withTransaction<
      { ok: true; data: LoginResult } | { ok: false; error: AppError }
    >(async (tx) => {
      const user = await this.repo.findByIdentity(tx, dto.identity);
      if (!user) {
        throw new AppError('ACCOUNT_NOT_FOUND');
      }

      if (user.Status === 'LOCKED') {
        throw new AppError('ACCOUNT_LOCKED');
      }

      if (user.LockedUntil !== null) {
        const lockedUntil = fromSqlDateTime(user.LockedUntil);
        if (lockedUntil.getTime() > now.getTime()) {
          throw new AppError('ACCOUNT_TEMP_LOCKED', {
            details: { lockedUntil: toIsoVn(lockedUntil) },
          });
        }
      }

      const match = await bcrypt.compare(dto.password, user.PasswordHash);
      const userId = Number(user.UserId);

      if (!match) {
        const nextCount = user.FailedLoginCount + 1;
        if (nextCount >= maxFailed) {
          // R-07: Đạt LOGIN_MAX_FAILED → LockedUntil = now + LOGIN_LOCK_MINUTES và đặt lại FailedLoginCount = 0
          const lockedUntil = addMinutes(now, lockMinutes);
          await this.repo.updateLoginFailure(tx, userId, 0, lockedUntil, now);
          return {
            ok: false,
            error: new AppError('ACCOUNT_TEMP_LOCKED', {
              message: `Bạn đã nhập sai mật khẩu quá ${maxFailed} lần liên tiếp. Tài khoản bị tạm khóa trong ${lockMinutes} phút.`,
              details: { lockedUntil: toIsoVn(lockedUntil) },
            }),
          };
        }

        await this.repo.updateLoginFailure(tx, userId, nextCount, null, now);
        return {
          ok: false,
          error: new AppError('WRONG_PASSWORD', {
            details: { remainingAttempts: maxFailed - nextCount },
          }),
        };
      }

      await this.repo.updateLoginSuccess(tx, userId, now);
      const issued = await this.issueTokenPair(tx, user, meta, now);

      return {
        ok: true,
        data: {
          accessToken: issued.accessToken,
          tokenType: 'Bearer',
          expiresIn: issued.expiresIn,
          user: issued.user,
          rawRefreshToken: issued.rawRefreshToken,
        },
      };
    });

    if (!txOutcome.ok) {
      throw txOutcome.error;
    }

    return txOutcome.data;
  }

  // SDD API-02
  async refresh(
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<RefreshOrRegisterResult> {
    if (!rawRefreshToken) {
      throw new AppError('REFRESH_INVALID');
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const row = await this.repo.findActiveRefreshToken(tx, tokenHash, now);
      if (!row) {
        throw new AppError('REFRESH_INVALID');
      }

      if (row.Status === 'LOCKED') {
        throw new AppError('ACCOUNT_LOCKED');
      }

      const revoked = await this.repo.revokeRefreshToken(tx, Number(row.TokenId), now);
      if (!revoked) {
        throw new AppError('REFRESH_INVALID');
      }

      return this.issueTokenPair(tx, row, meta, now);
    });
  }

  // SDD API-09
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    const tokenHash = hashRefreshToken(rawRefreshToken);
    const now = this.clock.now();

    await this.txService.withTransaction(async (tx) => {
      await this.repo.revokeRefreshTokenByHash(tx, tokenHash, now);
    });
  }

  // SDD API-01
  async me(userId: number): Promise<UserDto> {
    const exec = await this.txService.executor();
    const user = await this.repo.findById(exec, userId);
    if (!user) {
      throw new AppError('UNAUTHENTICATED');
    }
    if (user.Status === 'LOCKED') {
      throw new AppError('ACCOUNT_LOCKED');
    }
    return toUserDto(user);
  }

  // SDD API-10
  async register(dto: RegisterDto, meta: RequestMeta): Promise<RefreshOrRegisterResult> {
    const now = this.clock.now();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    return this.txService.withTransaction(async (tx) => {
      const code = await nextCode(tx, 'KH', null);
      const userId = await this.repo.createCustomer(tx, {
        code,
        fullName: dto.fullName,
        phone: dto.phone,
        email: dto.email,
        passwordHash,
        now,
      });

      const user = await this.repo.findById(tx, userId);
      if (!user) {
        throw new AppError('INTERNAL_ERROR');
      }

      return this.issueTokenPair(tx, user, meta, now);
    });
  }

  // SDD 5.7 & UC 016
  async revokeUserSessions(
    tx: TxContext,
    userId: number,
    reason: 'ACCOUNT_LOCKED' | 'BRANCH_CHANGED' | 'PASSWORD_CHANGED',
  ): Promise<void> {
    const now = this.clock.now();
    await this.repo.incrementTokenVersion(tx, userId, now);
    await this.repo.revokeAllUserRefreshTokens(tx, userId, now);
    this.tokenVersionCache.invalidate(userId);
    tx.events.push({
      rooms: [`user:${userId}`],
      event: 'auth.revoked',
      payload: { reason },
    });
  }

  private async issueTokenPair(
    tx: TxContext,
    user: UserRow,
    meta: RequestMeta,
    now: Date,
  ): Promise<RefreshOrRegisterResult> {
    const userId = Number(user.UserId);
    const accessToken = jwt.sign(
      {
        sub: userId,
        role: user.Role,
        branchId: user.BranchId,
        tv: user.TokenVersion,
      },
      env.jwtAccessSecret,
      { expiresIn: this.accessExpiresInSeconds },
    );

    const rawRefreshToken = crypto.randomBytes(48).toString('hex');
    const tokenHash = hashRefreshToken(rawRefreshToken);
    const expiresAt = addDays(now, env.refreshTokenDays);

    await this.repo.insertRefreshToken(tx, {
      userId,
      tokenHash,
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
      now,
    });

    return {
      accessToken,
      expiresIn: this.accessExpiresInSeconds,
      user: toUserDto(user),
      rawRefreshToken,
    };
  }
}
