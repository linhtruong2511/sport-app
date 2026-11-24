/**
 * Lớp "middleware" của mock: độ trễ, nạp/lưu CSDL, chạy job, xác thực JWT giả,
 * phân quyền, chuẩn hóa response { data, meta } / { error } theo SDD mục 5.2.
 */
import { HttpResponse, delay } from 'msw';
import { MOCK_CONFIG } from '../config';
import { db, load, save } from '../db/store';
import type { Role, User } from '../db/types';
import { runJobs } from '../jobs';
import { ApiError, E } from './errors';
import { nowIso, nowMs, toIso } from './time';

/* ---------------------------------------------------------------- token */

interface Claims {
  sub: number;
  role: Role;
  branchId: number | null;
  tv: number;
  exp: number;
}

const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

/** Access token dạng "mock.<payload>.sig" — frontend vẫn decode được như JWT */
export function issueAccessToken(u: User): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const claims: Claims = {
    sub: u.userId,
    role: u.role,
    branchId: u.branchId,
    tv: u.tokenVersion,
    exp: Math.floor(nowMs() / 1000) + MOCK_CONFIG.accessTokenTtlSec,
  };
  return `${header}.${b64url(JSON.stringify(claims))}.mock-signature`;
}

function parseToken(token: string): Claims | null {
  try {
    return JSON.parse(unb64url(token.split('.')[1])) as Claims;
  } catch {
    return null;
  }
}

/** Phiên refresh (thay cho cookie sh_rt HttpOnly) */
export const session = {
  set(u: User) {
    try {
      localStorage.setItem(MOCK_CONFIG.sessionKey, JSON.stringify({ userId: u.userId, tv: u.tokenVersion, exp: nowMs() + 7 * 86_400_000 }));
    } catch {
      /* ignore */
    }
  },
  get(): { userId: number; tv: number; exp: number } | null {
    try {
      const raw = localStorage.getItem(MOCK_CONFIG.sessionKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  clear() {
    try {
      localStorage.removeItem(MOCK_CONFIG.sessionKey);
    } catch {
      /* ignore */
    }
  },
};

/* ---------------------------------------------------------------- context */

export type RoleSpec = Role | 'STAFF+' | 'AUTH';

export interface Ctx {
  request: Request;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Người gọi nếu có token hợp lệ (PUBLIC*) */
  viewer: User | null;
  /** Bắt buộc đăng nhập + đúng vai trò */
  auth(...roles: RoleSpec[]): User;
  body<T = Record<string, any>>(): Promise<T>;
  q(name: string): string | null;
  qNum(name: string): number | null;
  p(name: string): string;
}

function resolveUser(request: Request, strict: boolean): User | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    if (strict) throw E.unauthenticated();
    return null;
  }
  const claims = parseToken(header.slice(7));
  const user = claims ? db().users.find((u) => u.userId === claims.sub) : undefined;
  if (!claims || !user) {
    if (strict) throw E.unauthenticated();
    return null;
  }
  if (claims.exp * 1000 < nowMs()) {
    if (strict) throw new ApiError(401, 'TOKEN_EXPIRED', 'Phiên đăng nhập đã hết hạn.');
    return null;
  }
  if (claims.tv !== user.tokenVersion || user.status === 'LOCKED') {
    if (strict) throw new ApiError(401, 'TOKEN_REVOKED', 'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại.');
    return null;
  }
  return user;
}

const cache = new WeakMap<Request, Promise<unknown>>();

function makeCtx(request: Request, rawParams: Record<string, unknown>): Ctx {
  const url = new URL(request.url);
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams)) params[k] = Array.isArray(v) ? String(v[0]) : String(v ?? '');
  const viewer = resolveUser(request, false);
  return {
    request,
    params,
    query: url.searchParams,
    viewer,
    auth(...roles) {
      const u = resolveUser(request, true)!;
      if (!roles.length || roles.includes('AUTH')) return u;
      const ok = roles.some((r) => (r === 'STAFF+' ? u.role === 'STAFF' || u.role === 'OWNER' : u.role === r));
      if (!ok) throw E.forbidden();
      return u;
    },
    async body<T>() {
      if (!cache.has(request)) cache.set(request, request.clone().json().catch(() => ({})));
      return (await cache.get(request)) as T;
    },
    q: (name) => {
      const v = url.searchParams.get(name);
      return v === null || v === '' ? null : v;
    },
    qNum: (name) => {
      const v = url.searchParams.get(name);
      if (v === null || v === '' || v === 'all') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    },
    p: (name) => params[name],
  };
}

/* ---------------------------------------------------------------- responses */

export function ok(data: unknown, opts: { status?: number; meta?: Record<string, unknown> } = {}) {
  return HttpResponse.json({ data, meta: { ...(opts.meta ?? {}), serverTime: nowIso() } }, { status: opts.status ?? 200 });
}

export const created = (data: unknown, meta?: Record<string, unknown>) => ok(data, { status: 201, meta });
export const noContent = () => new HttpResponse(null, { status: 204 });

export function errorResponse(e: ApiError, headers?: Record<string, string>) {
  return HttpResponse.json(
    {
      error: {
        code: e.code,
        message: e.message,
        ...(e.details !== undefined ? { details: e.details } : {}),
        traceId: Math.random().toString(16).slice(2, 12),
      },
    },
    { status: e.status, headers },
  );
}

export function paginate<T>(items: T[], query: URLSearchParams, defaultSize = 20) {
  const page = Math.max(1, Number(query.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.get('pageSize')) || defaultSize));
  const totalItems = items.length;
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    meta: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) },
  };
}

/* ---------------------------------------------------------------- idempotency */

export async function idempotent(ctx: Ctx, run: () => Promise<Response> | Response): Promise<Response> {
  const key = ctx.request.headers.get('idempotency-key');
  if (!key) return run();
  const s = db();
  const body = await ctx.body();
  const hash = `${ctx.request.method} ${new URL(ctx.request.url).pathname} ${JSON.stringify(body)}`;
  const rec = s.idem[key];
  if (rec) {
    if (rec.hash !== hash) {
      throw E.conflict('IDEMPOTENCY_CONFLICT', 'Idempotency-Key đã dùng cho một yêu cầu khác.');
    }
    return HttpResponse.json(rec.body as Record<string, unknown>, { status: rec.status });
  }
  const res = await run();
  if (res.status < 300) {
    s.idem[key] = { hash, status: res.status, body: await res.clone().json(), createdAt: nowIso() };
    const cutoff = nowMs() - 86_400_000;
    for (const [k, v] of Object.entries(s.idem)) if (new Date(v.createdAt).getTime() < cutoff) delete s.idem[k];
  }
  return res;
}

/* ---------------------------------------------------------------- wrapper */

function latency(): number {
  try {
    const v = localStorage.getItem('sporthub_mock_latency');
    if (v !== null && v !== '') return Number(v) || 0;
  } catch {
    /* ignore */
  }
  const [a, b] = MOCK_CONFIG.latency;
  return a + Math.random() * (b - a);
}

type Resolver = (ctx: Ctx) => Promise<Response> | Response;

/** Bọc một handler: trễ mạng → nạp CSDL → job nền → xử lý → lưu → chuẩn hóa lỗi */
export function route(fn: Resolver) {
  return async ({ request, params }: { request: Request; params: Record<string, unknown> }) => {
    await delay(latency());
    load();
    runJobs();
    try {
      const ctx = makeCtx(request, params);
      const res = await fn(ctx);
      save();
      return res;
    } catch (e) {
      save();
      if (e instanceof ApiError) {
        return errorResponse(e, e.status === 429 ? { 'Retry-After': '5' } : undefined);
      }
      console.error('[mock-api]', e);
      return errorResponse(new ApiError(500, 'INTERNAL_ERROR', 'Lỗi hệ thống (mock).'));
    }
  };
}

/* ---------------------------------------------------------------- misc */

/** STAFF bị ép theo chi nhánh của mình (middleware branchScope) */
export function scopeBranch(user: User, requested: number | null, opts: { strict?: boolean } = {}): number | null {
  if (user.role === 'STAFF') {
    if (opts.strict && requested != null && requested !== user.branchId) throw E.branchForbidden();
    return user.branchId;
  }
  return requested;
}

export function assertBranchAccess(user: User, branchId: number) {
  if (user.role === 'STAFF' && user.branchId !== branchId) throw E.branchForbidden();
}

export const isoNow = () => toIso(new Date());
