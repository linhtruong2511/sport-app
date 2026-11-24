import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../config/env.js';
import { FakeClock } from '../../core/clock.js';
import type { DbExecutor, DbTransactionService, TxContext } from '../../core/db/transaction.js';
import { AppError } from '../../core/errors.js';
import { RealtimeGateway } from '../../core/realtime/realtime.gateway.js';
import { RealtimeService } from '../../core/realtime/realtime.service.js';
import type { SettingsService } from '../../core/settings.service.js';
import { resolveUserTitle, toUserDto } from '../auth.mapper.js';
import type { AuthRepository, UserRow } from '../auth.repository.js';
import { loginSchema, registerSchema } from '../auth.schemas.js';
import { AuthService } from '../auth.service.js';
import { TokenVersionCacheService } from '../token-version-cache.service.js';

function makeUserRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    UserId: 15,
    Code: 'KH000001',
    FullName: 'Nguyễn Văn An',
    Phone: '0987654321',
    Email: 'an@sporthub.vn',
    PasswordHash: '$2b$10$hash',
    Role: 'CUSTOMER',
    BranchId: null,
    BranchName: null,
    MemberTier: null,
    Status: 'ACTIVE',
    FailedLoginCount: 0,
    LockedUntil: null,
    TokenVersion: 0,
    ...overrides,
  };
}

describe('auth.mapper', () => {
  it('resolves role titles and maps UserRow to UserDto', () => {
    expect(resolveUserTitle('OWNER', null)).toBe('Chủ hệ thống sân');
    expect(resolveUserTitle('STAFF', null)).toBe('Nhân viên thu ngân');
    expect(resolveUserTitle('CUSTOMER', null)).toBe('Hội viên');
    expect(resolveUserTitle('CUSTOMER', 'Hội viên thân thiết')).toBe('Hội viên thân thiết');

    const dto = toUserDto(
      makeUserRow({
        UserId: '42',
        Role: 'STAFF',
        BranchId: 1,
        BranchName: 'Cơ sở 01 - Quận 1',
      }),
    );
    expect(dto).toEqual({
      userId: 42,
      code: 'KH000001',
      fullName: 'Nguyễn Văn An',
      phone: '0987654321',
      email: 'an@sporthub.vn',
      role: 'STAFF',
      branchId: 1,
      branchName: 'Cơ sở 01 - Quận 1',
      memberTier: null,
      title: 'Nhân viên thu ngân',
    });
  });
});

describe('TokenVersionCacheService', () => {
  it('caches entries for 10 seconds and supports invalidate/clear', () => {
    const clock = new FakeClock(new Date('2026-11-25T10:00:00.000Z'));
    const cache = new TokenVersionCacheService(clock);

    expect(cache.get(1)).toBeNull();

    cache.set(1, { tokenVersion: 2, status: 'ACTIVE', role: 'CUSTOMER', branchId: null });
    cache.set(2, { tokenVersion: 0, status: 'ACTIVE', role: 'STAFF', branchId: 1 });

    clock.advanceSeconds(9);
    expect(cache.get(1)).toEqual({
      tokenVersion: 2,
      status: 'ACTIVE',
      role: 'CUSTOMER',
      branchId: null,
    });

    clock.advanceSeconds(1);
    expect(cache.get(1)).toBeNull();
    expect(cache.get(2)).toBeNull();

    cache.set(1, { tokenVersion: 3, status: 'ACTIVE', role: 'OWNER', branchId: null });
    cache.invalidate(1);
    expect(cache.get(1)).toBeNull();

    cache.set(1, { tokenVersion: 3, status: 'ACTIVE', role: 'OWNER', branchId: null });
    cache.clear();
    expect(cache.get(1)).toBeNull();
  });
});

describe('auth.schemas', () => {
  it('validates loginSchema and trims identity', () => {
    const ok = loginSchema.safeParse({ identity: '  0987654321  ', password: 'Matkhau123' });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.identity).toBe('0987654321');
    }

    const emptyId = loginSchema.safeParse({ identity: '   ', password: 'Matkhau123' });
    expect(emptyId.success).toBe(false);
    if (!emptyId.success) {
      expect(emptyId.error.issues[0]?.message).toBe('Vui lòng nhập số điện thoại hoặc email.');
    }

    const shortPw = loginSchema.safeParse({ identity: '0987654321', password: '123' });
    expect(shortPw.success).toBe(false);
    if (!shortPw.success) {
      expect(shortPw.error.issues[0]?.message).toBe('Mật khẩu phải có tối thiểu 6 ký tự.');
    }
  });

  it('validates registerSchema and password confirmation', () => {
    const mismatch = registerSchema.safeParse({
      fullName: 'Nguyễn Văn An',
      phone: '0912345678',
      email: 'an@example.com',
      password: 'Matkhau123',
      confirmPassword: 'KhacPassword',
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.issues[0]?.path).toEqual(['confirmPassword']);
      expect(mismatch.error.issues[0]?.message).toBe('Mật khẩu nhập lại không khớp.');
    }

    const missingEmail = registerSchema.safeParse({
      fullName: 'Nguyễn Văn An',
      phone: '0912345678',
      email: '',
      password: 'Matkhau123',
      confirmPassword: 'Matkhau123',
    });
    expect(missingEmail.success).toBe(false);
    if (!missingEmail.success) {
      expect(missingEmail.error.issues[0]?.message).toBe('Email là bắt buộc khi đăng ký hội viên.');
    }
  });
});

describe('AuthService unit tests', () => {
  function createServiceHarness() {
    const clock = new FakeClock(new Date('2026-11-25T10:00:00.000Z'));
    const cache = new TokenVersionCacheService(clock);
    const tx: TxContext = {
      request: vi.fn() as unknown as TxContext['request'],
      events: [],
      isTransaction: true,
    };
    const exec: DbExecutor = {
      request: vi.fn() as unknown as DbExecutor['request'],
    };

    const repo = {
      findByIdentity: vi.fn(),
      findById: vi.fn(),
      getAuthStatus: vi.fn(),
      updateLoginFailure: vi.fn(),
      updateLoginSuccess: vi.fn(),
      createCustomer: vi.fn(),
      insertRefreshToken: vi.fn(),
      findActiveRefreshToken: vi.fn(),
      revokeRefreshToken: vi.fn(),
      revokeRefreshTokenByHash: vi.fn(),
      revokeAllUserRefreshTokens: vi.fn(),
      incrementTokenVersion: vi.fn(),
    } as unknown as AuthRepository;

    const txService = {
      executor: vi.fn().mockResolvedValue(exec),
      withTransaction: vi.fn(async (fn: (ctx: TxContext) => Promise<unknown>) => fn(tx)),
    } as unknown as DbTransactionService;

    const settingsService = {
      getInt: vi.fn(async (key: string) => {
        if (key === 'LOGIN_MAX_FAILED') return 5;
        if (key === 'LOGIN_LOCK_MINUTES') return 5;
        throw new Error(`Unexpected key ${key}`);
      }),
    } as unknown as SettingsService;

    const service = new AuthService(repo, txService, settingsService, cache, clock);
    return { service, repo, txService, cache, clock, tx };
  }

  it('verifyAccessToken handles expired, invalid, cached, locked, and revoked tokens', async () => {
    const { service, repo } = createServiceHarness();

    const expiredToken = jwt.sign({ sub: 10, role: 'CUSTOMER', branchId: null, tv: 0 }, env.jwtAccessSecret, {
      expiresIn: -10,
    });
    await expect(service.verifyAccessToken(expiredToken)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
      status: 401,
    });

    await expect(service.verifyAccessToken('not-a-jwt')).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });

    (repo.getAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      UserId: 10,
      Role: 'STAFF',
      BranchId: 2,
      Status: 'ACTIVE',
      TokenVersion: 1,
    });

    const validToken = jwt.sign({ sub: 10, role: 'STAFF', branchId: 2, tv: 1 }, env.jwtAccessSecret, {
      expiresIn: 900,
    });

    const first = await service.verifyAccessToken(validToken);
    expect(first).toEqual({ userId: 10, role: 'STAFF', branchId: 2, tv: 1 });
    // Second call uses cache (getAuthStatus called only once)
    await service.verifyAccessToken(validToken);
    expect(repo.getAuthStatus).toHaveBeenCalledTimes(1);

    const staleToken = jwt.sign({ sub: 10, role: 'STAFF', branchId: 2, tv: 0 }, env.jwtAccessSecret, {
      expiresIn: 900,
    });
    await expect(service.verifyAccessToken(staleToken)).rejects.toMatchObject({
      code: 'TOKEN_REVOKED',
      status: 401,
    });
  });

  it('verifyAccessToken throws ACCOUNT_LOCKED when status is LOCKED', async () => {
    const { service, repo } = createServiceHarness();
    (repo.getAuthStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      UserId: 11,
      Role: 'STAFF',
      BranchId: 1,
      Status: 'LOCKED',
      TokenVersion: 1,
    });

    const token = jwt.sign({ sub: 11, role: 'STAFF', branchId: 1, tv: 1 }, env.jwtAccessSecret, {
      expiresIn: 900,
    });
    await expect(service.verifyAccessToken(token)).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      status: 403,
    });
  });

  it('revokeUserSessions increments tokenVersion, revokes tokens, invalidates cache, and queues auth.revoked', async () => {
    const { service, repo, cache, tx } = createServiceHarness();
    cache.set(10, { tokenVersion: 0, status: 'ACTIVE', role: 'STAFF', branchId: 1 });

    await service.revokeUserSessions(tx, 10, 'BRANCH_CHANGED');

    expect(repo.incrementTokenVersion).toHaveBeenCalledWith(tx, 10, expect.any(Date));
    expect(repo.revokeAllUserRefreshTokens).toHaveBeenCalledWith(tx, 10, expect.any(Date));
    expect(cache.get(10)).toBeNull();
    expect(tx.events).toEqual([
      {
        rooms: ['user:10'],
        event: 'auth.revoked',
        payload: { reason: 'BRANCH_CHANGED' },
      },
    ]);
  });

  it('login returns AppError without rolling back transaction on wrong password', async () => {
    const { service, repo, txService } = createServiceHarness();
    // PasswordHash for 'WrongCompare' won't match 'Matkhau123'
    (repo.findByIdentity as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeUserRow({
        UserId: 20,
        FailedLoginCount: 4,
        PasswordHash: '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      }),
    );

    let thrownFromCallback = false;
    (txService.withTransaction as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (fn: (ctx: TxContext) => Promise<unknown>) => {
        try {
          return await fn({
            request: vi.fn() as unknown as TxContext['request'],
            events: [],
            isTransaction: true,
          });
        } catch (err) {
          thrownFromCallback = true;
          throw err;
        }
      },
    );

    await expect(
      service.login({ identity: '0987654321', password: 'WrongPassword' }, { userAgent: null, ipAddress: null }),
    ).rejects.toBeInstanceOf(AppError);

    expect(thrownFromCallback).toBe(false);
    expect(repo.updateLoginFailure).toHaveBeenCalledWith(
      expect.anything(),
      20,
      0,
      expect.any(Date),
      expect.any(Date),
    );
  });
});

describe('RealtimeGateway', () => {
  function makeMockSocket(token?: string) {
    const joined = new Set<string>();
    const left = new Set<string>();
    const emitted: Array<{ event: string; payload: unknown }> = [];
    const socket = {
      handshake: { auth: token !== undefined ? { token } : {} },
      data: {} as Record<string, unknown>,
      join: vi.fn(async (room: string) => {
        joined.add(room);
      }),
      leave: vi.fn(async (room: string) => {
        left.add(room);
      }),
      emit: vi.fn((event: string, payload: unknown) => {
        emitted.push({ event, payload });
      }),
      disconnect: vi.fn(),
      joined,
      left,
      emitted,
    };
    return socket;
  }

  it('allows guest connection and restricts subscribe to availability', async () => {
    const gateway = new RealtimeGateway(new RealtimeService());
    const client = makeMockSocket();

    await gateway.handleConnection(client as never);
    expect(client.disconnect).not.toHaveBeenCalled();

    gateway.handleSubscribe(client as never, { channel: 'availability', branchId: 1, date: '2026-11-25' });
    gateway.handleSubscribe(client as never, { channel: 'branch', branchId: 1 });
    gateway.handleSubscribe(client as never, { channel: 'booking', bookingCode: 'BK2026112501' });

    expect([...client.joined]).toEqual(['availability:1:2026-11-25']);
  });

  it('joins user and branch rooms for authenticated STAFF and enforces branch scope', async () => {
    const verifier = {
      verifyAccessToken: vi.fn().mockResolvedValue({
        userId: 5,
        role: 'STAFF',
        branchId: 2,
        tv: 0,
      }),
    };
    const gateway = new RealtimeGateway(new RealtimeService(), verifier);
    const client = makeMockSocket('valid-token');

    await gateway.handleConnection(client as never);
    expect(client.joined.has('user:5')).toBe(true);
    expect(client.joined.has('branch:2')).toBe(true);

    gateway.handleSubscribe(client as never, { channel: 'branch', branchId: 1 });
    expect(client.joined.has('branch:1')).toBe(false);

    gateway.handleSubscribe(client as never, { channel: 'booking', bookingCode: 'BK2026112501' });
    expect(client.joined.has('booking:BK2026112501')).toBe(true);
  });

  it('emits auth_error and disconnects when token verification fails', async () => {
    const verifier = {
      verifyAccessToken: vi.fn().mockRejectedValue(new AppError('TOKEN_EXPIRED')),
    };
    const gateway = new RealtimeGateway(new RealtimeService(), verifier);
    const client = makeMockSocket('expired-token');

    await gateway.handleConnection(client as never);
    expect(client.emitted).toEqual([
      {
        event: 'auth_error',
        payload: { code: 'TOKEN_EXPIRED', message: 'Phiên đăng nhập đã hết hạn.' },
      },
    ]);
    expect(client.disconnect).toHaveBeenCalledWith(true);
  });
});
