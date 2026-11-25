import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiErrorResponse,
  ApiListSuccess,
  ApiSuccess,
  BookingDetailDto,
  BookingSummaryDto,
  BranchDto,
  CancelType,
  PaymentOption,
  PaymentRequestDto,
  SportDto,
  UserDto,
} from '@sporthub/shared';
import { ACCOUNTS } from './test-data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.resolve(__dirname, '..', '.auth');
export const API_BASE_URL = process.env.E2E_API_BASE_URL || 'http://localhost:3000/api/v1';

export type ApiRoleKey = 'customer' | 'customer2' | 'staff' | 'staffCs2' | 'owner';

export interface LoginSession {
  accessToken: string;
  user: UserDto;
  refreshTokenCookie: string | null;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(`${status} ${code}: ${message}`);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const sessionCache = new Map<string, LoginSession>();
let lastAuthRateLimitResetEpochSec = 0;
let lastAuthRateLimitRemaining = 10;

export function getAuthStorageStatePath(role: 'customer' | 'customer2' | 'staff' | 'owner'): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

function credsForRole(role: ApiRoleKey): { identity: string; password: string } {
  switch (role) {
    case 'customer':
      return { identity: ACCOUNTS.customer.phone, password: ACCOUNTS.customer.password };
    case 'customer2':
      return { identity: ACCOUNTS.customer2.phone, password: ACCOUNTS.customer2.password };
    case 'staff':
      return { identity: ACCOUNTS.staffCs1.phone, password: ACCOUNTS.staffCs1.password };
    case 'staffCs2':
      return { identity: ACCOUNTS.staffCs2.phone, password: ACCOUNTS.staffCs2.password };
    case 'owner':
      return { identity: ACCOUNTS.owner.phone, password: ACCOUNTS.owner.password };
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForAuthRateLimitIfNeeded(minRemainingNeeded = 1): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    lastAuthRateLimitRemaining < minRemainingNeeded &&
    lastAuthRateLimitResetEpochSec >= nowSec
  ) {
    const waitMs = Math.max(500, (lastAuthRateLimitResetEpochSec - nowSec) * 1000 + 800);
    await sleep(waitMs);
    lastAuthRateLimitRemaining = 10;
  }
}

function recordAuthRateLimitHeaders(res: Response): void {
  const rem = res.headers.get('x-ratelimit-remaining');
  const rst = res.headers.get('x-ratelimit-reset');
  if (rem !== null) {
    const n = Number(rem);
    if (!Number.isNaN(n)) lastAuthRateLimitRemaining = n;
  }
  if (rst !== null) {
    const n = Number(rst);
    if (!Number.isNaN(n)) lastAuthRateLimitResetEpochSec = n;
  }
}

function extractCookieValue(res: Response, name: string): string | null {
  const setCookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const raw of setCookies) {
    const part = raw.split(';')[0]?.trim();
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq) === name) {
      return part.slice(eq + 1);
    }
  }
  return null;
}

export async function apiRequest<T>(
  urlPath: string,
  options?: {
    method?: string;
    token?: string;
    body?: unknown;
    idempotencyKey?: string;
    headers?: Record<string, string>;
    cookie?: string;
  },
): Promise<{ status: number; data: T; headers: Headers; rawRes: Response }> {
  const url = urlPath.startsWith('http')
    ? urlPath
    : `${API_BASE_URL}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options?.headers,
  };
  if (options?.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  if (options?.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }
  if (options?.cookie) {
    headers.Cookie = options.cookie;
  }
  let bodyStr: string | undefined;
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyStr = JSON.stringify(options.body);
  }

  const res = await fetch(url, {
    method: options?.method ?? 'GET',
    headers,
    body: bodyStr,
  });

  if (url.includes('/auth/login') || url.includes('/auth/register')) {
    recordAuthRateLimitHeaders(res);
  }

  if (res.status === 204) {
    return { status: 204, data: undefined as T, headers: res.headers, rawRes: res };
  }

  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const errBody = parsed as Partial<ApiErrorResponse> | null;
    const err = errBody?.error;
    throw new ApiClientError(
      res.status,
      err?.code ?? 'HTTP_ERROR',
      err?.message ?? res.statusText,
      err?.details,
    );
  }

  return { status: res.status, data: parsed as T, headers: res.headers, rawRes: res };
}

export async function apiLogin(
  roleOrCreds: ApiRoleKey | { identity: string; password: string },
  opts?: { forceFresh?: boolean },
): Promise<LoginSession> {
  const creds = typeof roleOrCreds === 'string' ? credsForRole(roleOrCreds) : roleOrCreds;
  const cacheKey = typeof roleOrCreds === 'string' ? roleOrCreds : creds.identity.toLowerCase();

  if (!opts?.forceFresh) {
    const cached = sessionCache.get(cacheKey);
    if (cached?.refreshTokenCookie) {
      try {
        const refreshed = await apiRequest<
          ApiSuccess<{ accessToken: string; user: UserDto }>
        >('/auth/refresh', {
          method: 'POST',
          cookie: `sh_rt=${cached.refreshTokenCookie}`,
        });
        const nextCookie =
          extractCookieValue(refreshed.rawRes, 'sh_rt') ?? cached.refreshTokenCookie;
        const nextSession: LoginSession = {
          accessToken: refreshed.data.data.accessToken,
          user: refreshed.data.data.user,
          refreshTokenCookie: nextCookie,
        };
        sessionCache.set(cacheKey, nextSession);
        return nextSession;
      } catch {
        sessionCache.delete(cacheKey);
      }
    }
  }

  await waitForAuthRateLimitIfNeeded(1);
  try {
    const res = await apiRequest<ApiSuccess<{ accessToken: string; user: UserDto }>>(
      '/auth/login',
      {
        method: 'POST',
        body: creds,
      },
    );
    const session: LoginSession = {
      accessToken: res.data.data.accessToken,
      user: res.data.data.user,
      refreshTokenCookie: extractCookieValue(res.rawRes, 'sh_rt'),
    };
    sessionCache.set(cacheKey, session);
    return session;
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 429) {
      await waitForAuthRateLimitIfNeeded(1);
      const retry = await apiRequest<ApiSuccess<{ accessToken: string; user: UserDto }>>(
        '/auth/login',
        {
          method: 'POST',
          body: creds,
        },
      );
      const session: LoginSession = {
        accessToken: retry.data.data.accessToken,
        user: retry.data.data.user,
        refreshTokenCookie: extractCookieValue(retry.rawRes, 'sh_rt'),
      };
      sessionCache.set(cacheKey, session);
      return session;
    }
    throw err;
  }
}

export function clearApiSessionCache(role?: ApiRoleKey): void {
  if (role) {
    sessionCache.delete(role);
  } else {
    sessionCache.clear();
  }
}

export async function apiRegisterCustomer(input: {
  fullName: string;
  phone: string;
  email: string;
  password: string;
}): Promise<LoginSession> {
  await waitForAuthRateLimitIfNeeded(1);
  const res = await apiRequest<ApiSuccess<{ accessToken: string; user: UserDto }>>(
    '/auth/register',
    {
      method: 'POST',
      body: {
        ...input,
        confirmPassword: input.password,
      },
    },
  );
  return {
    accessToken: res.data.data.accessToken,
    user: res.data.data.user,
    refreshTokenCookie: extractCookieValue(res.rawRes, 'sh_rt'),
  };
}

export async function apiGetBranches(): Promise<BranchDto[]> {
  const res = await apiRequest<ApiSuccess<BranchDto[]>>('/branches');
  return res.data.data;
}

export async function apiGetSports(branchId?: number): Promise<SportDto[]> {
  const qs = branchId ? `?branchId=${branchId}` : '';
  const res = await apiRequest<ApiSuccess<SportDto[]>>(`/sports${qs}`);
  return res.data.data;
}

export interface AdminCourtDto {
  courtId: number;
  code: string;
  name: string;
  branch: { branchId: number; name: string };
  sport: { sportId: number; code: string; name: string };
  depositType: 'PERCENT' | 'FIXED';
  depositValue: number;
  status: 'ACTIVE' | 'INACTIVE';
  priceRules: Array<{
    priceRuleId: number;
    label: string;
    dayOfWeekMask: number;
    startTime: string;
    endTime: string;
    pricePerHour: number;
  }>;
}

export async function apiGetAdminCourts(
  token?: string,
  params?: { branchId?: number; sportId?: number },
): Promise<AdminCourtDto[]> {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const search = new URLSearchParams();
  if (params?.branchId) search.set('branchId', String(params.branchId));
  if (params?.sportId) search.set('sportId', String(params.sportId));
  const qs = search.toString();
  const res = await apiRequest<ApiSuccess<AdminCourtDto[]>>(
    qs ? `/admin/courts?${qs}` : '/admin/courts',
    { token: tok },
  );
  return res.data.data;
}

export async function apiFindCourtByCode(courtCode: string, token?: string): Promise<AdminCourtDto> {
  const courts = await apiGetAdminCourts(token);
  const found = courts.find((c) => c.code === courtCode);
  if (!found) {
    throw new Error(`Không tìm thấy sân theo mã: ${courtCode}`);
  }
  return found;
}

export async function apiFindBranchByCode(branchCode: string): Promise<BranchDto> {
  const branches = await apiGetBranches();
  const found = branches.find((b) => b.code === branchCode);
  if (!found) {
    throw new Error(`Không tìm thấy cơ sở theo mã: ${branchCode}`);
  }
  return found;
}

export async function apiFindSportByCode(sportCode: string, branchId?: number): Promise<SportDto> {
  const sports = await apiGetSports(branchId);
  const found = sports.find((s) => s.code === sportCode);
  if (!found) {
    throw new Error(`Không tìm thấy bộ môn theo mã: ${sportCode}`);
  }
  return found;
}

export async function apiGetAvailability(params: {
  branchId: number;
  sportId: number;
  date: string;
  token?: string;
}) {
  const search = new URLSearchParams({
    branchId: String(params.branchId),
    sportId: String(params.sportId),
    date: params.date,
  });
  const res = await apiRequest<
    ApiSuccess<{
      date: string;
      branch: { branchId: number; name: string; openTime: string; closeTime: string; isClosed: boolean };
      holiday: { holidayId?: number; name: string; reason?: string } | null;
      slotMinutes: number;
      slots: Array<{ start: string; end: string; priceLabel: string }>;
      courts: Array<{
        courtId: number;
        code: string;
        name: string;
        state: string;
        cells: Array<{ start: string; end: string; state: string; price?: number }>;
      }>;
    }>
  >(`/availability?${search.toString()}`, { token: params.token });
  return res.data.data;
}

export async function apiQuote(
  params: {
    courtCode?: string;
    courtId?: number;
    date: string;
    startTime: string;
    endTime: string;
    paymentOption?: PaymentOption;
    promoCode?: string;
    channel?: 'ONLINE' | 'COUNTER';
    customerPhone?: string;
  },
  token?: string,
) {
  const courtId =
    params.courtId ?? (await apiFindCourtByCode(params.courtCode!)).courtId;
  const res = await apiRequest<
    ApiSuccess<{
      slotAvailable: boolean;
      baseAmount: number;
      discountAmount: number;
      totalAmount: number;
      amountDueNow: number;
      remainingOnArrival: number;
      deposit: { type: string | null; value: number | null; amount: number; fullPaymentRequired: boolean };
      promotion: { code: string; applied: boolean; reasonCode: string | null; message: string | null } | null;
      priceLines: Array<{ label: string; startTime: string; endTime: string; pricePerHour: number; amount: number }>;
    }>
  >('/bookings/quote', {
    method: 'POST',
    token,
    body: {
      courtId,
      date: params.date,
      startTime: params.startTime,
      endTime: params.endTime,
      paymentOption: params.paymentOption ?? 'FULL',
      promotionCode: params.promoCode ?? undefined,
      channel: params.channel ?? 'ONLINE',
      customerPhone: params.customerPhone,
    },
  });
  return res.data.data;
}

export async function apiCreateBooking(
  params: {
    courtCode?: string;
    courtId?: number;
    date: string;
    start: string;
    end: string;
    paymentOption?: PaymentOption;
    promoCode?: string | null;
    note?: string | null;
  },
  token?: string,
  idempotencyKey = crypto.randomUUID(),
): Promise<{ booking: BookingSummaryDto; paymentRequest: PaymentRequestDto | null }> {
  const tok = token ?? (await apiLogin('customer')).accessToken;
  const courtId =
    params.courtId ?? (await apiFindCourtByCode(params.courtCode!)).courtId;
  const res = await apiRequest<
    ApiSuccess<{ booking: BookingSummaryDto; paymentRequest: PaymentRequestDto | null }>
  >('/bookings', {
    method: 'POST',
    token: tok,
    idempotencyKey,
    body: {
      courtId,
      date: params.date,
      startTime: params.start,
      endTime: params.end,
      paymentOption: params.paymentOption ?? 'FULL',
      promotionCode: params.promoCode ?? null,
      note: params.note ?? null,
    },
  });
  return res.data.data;
}

export async function apiGetBookingDetail(
  bookingCode: string,
  token?: string,
): Promise<BookingDetailDto> {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<ApiSuccess<BookingDetailDto>>(
    `/bookings/${encodeURIComponent(bookingCode)}`,
    { token: tok },
  );
  return res.data.data;
}

export async function apiGetMyBookings(
  params: { from: string; to: string; status?: string; page?: number; pageSize?: number },
  token?: string,
) {
  const tok = token ?? (await apiLogin('customer')).accessToken;
  const search = new URLSearchParams({ from: params.from, to: params.to });
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const res = await apiRequest<ApiListSuccess<BookingSummaryDto>>(
    `/me/bookings?${search.toString()}`,
    { token: tok },
  );
  return res.data;
}

export async function apiCancel(
  bookingCode: string,
  opts: { cancelType?: CancelType; reason?: string; version?: string } = {},
  token?: string,
) {
  const tok = token ?? (await apiLogin('customer')).accessToken;
  const version =
    opts.version ?? (await apiGetBookingDetail(bookingCode, tok)).version;
  const res = await apiRequest<ApiSuccess<{ booking: BookingSummaryDto; refund: unknown }>>(
    `/bookings/${encodeURIComponent(bookingCode)}/cancel`,
    {
      method: 'POST',
      token: tok,
      body: {
        cancelType: opts.cancelType ?? 'CUSTOMER_REQUEST',
        reason: opts.reason ?? 'Hủy qua API E2E',
        version,
      },
    },
  );
  return res.data.data;
}

export async function apiCreatePosBooking(
  params: {
    branchCode?: string;
    branchId?: number;
    courtCode?: string;
    courtId?: number;
    date: string;
    start: string;
    end: string;
    paymentOption?: PaymentOption;
    cashAmount?: number | null;
    customer?: { type: 'GUEST' | 'MEMBER'; userId?: number | null; phone: string; fullName: string };
    promoCode?: string | null;
  },
  token?: string,
) {
  const tok = token ?? (await apiLogin('staff')).accessToken;
  const court = params.courtId
    ? null
    : await apiFindCourtByCode(params.courtCode!);
  const courtId = params.courtId ?? court!.courtId;
  const branchId =
    params.branchId ??
    (params.branchCode ? (await apiFindBranchByCode(params.branchCode)).branchId : court!.branch.branchId);
  const res = await apiRequest<ApiSuccess<{ booking: BookingSummaryDto; receipt: unknown }>>(
    '/pos/bookings',
    {
      method: 'POST',
      token: tok,
      idempotencyKey: crypto.randomUUID(),
      body: {
        branchId,
        courtId,
        date: params.date,
        startTime: params.start,
        endTime: params.end,
        customer: params.customer ?? {
          type: 'GUEST',
          phone: '0909888777',
          fullName: 'Khách E2E POS',
        },
        promotionCode: params.promoCode ?? null,
        paymentOption: params.paymentOption ?? 'FULL',
        payment:
          typeof params.cashAmount === 'number'
            ? { method: 'CASH', amount: params.cashAmount }
            : null,
      },
    },
  );
  return res.data.data;
}

export async function apiPosCheckIn(bookingCode: string, token?: string) {
  const tok = token ?? (await apiLogin('staff')).accessToken;
  const detail = await apiGetBookingDetail(bookingCode, tok);
  const res = await apiRequest<ApiSuccess<{ booking: BookingSummaryDto }>>(
    `/pos/bookings/${encodeURIComponent(bookingCode)}/check-in`,
    {
      method: 'POST',
      token: tok,
      body: { version: detail.version },
    },
  );
  return res.data.data;
}

export async function apiCreatePromotion(
  input: {
    name: string;
    code: string;
    discountType: 'PERCENT' | 'FIXED';
    discountValue: number;
    maxDiscountAmount?: number | null;
    allBranches?: boolean;
    branchIds?: number[];
    allSports?: boolean;
    sportIds?: number[];
    timeFrom?: string | null;
    timeTo?: string | null;
    startDate: string;
    endDate: string;
    maxUses?: number;
    audienceType?: 'ALL' | 'SPECIFIC';
    customerPhones?: string[];
    notifyCustomers?: boolean;
  },
  token?: string,
) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<ApiSuccess<{ promotionId: number; code: string }>>(
    '/admin/promotions',
    {
      method: 'POST',
      token: tok,
      body: {
        name: input.name,
        code: input.code.toUpperCase(),
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxDiscountAmount: input.maxDiscountAmount ?? null,
        allBranches: input.allBranches ?? true,
        branchIds: input.branchIds ?? [],
        allSports: input.allSports ?? true,
        sportIds: input.sportIds ?? [],
        timeFrom: input.timeFrom ?? null,
        timeTo: input.timeTo ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        maxUses: input.maxUses ?? 100,
        audienceType: input.audienceType ?? 'ALL',
        customerPhones: input.customerPhones ?? [],
        notifyCustomers: input.notifyCustomers ?? false,
      },
    },
  );
  return res.data.data;
}

export async function apiDeletePromotion(promotionId: number, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  await apiRequest(`/admin/promotions/${promotionId}`, {
    method: 'DELETE',
    token: tok,
  });
}

export async function apiCreateStaff(
  input: {
    fullName: string;
    phone: string;
    email?: string | null;
    branchId: number;
    password: string;
    status?: 'ACTIVE' | 'LOCKED';
  },
  token?: string,
) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<ApiSuccess<{ userId: number; code: string; phone: string }>>(
    '/admin/staff',
    {
      method: 'POST',
      token: tok,
      body: {
        ...input,
        status: input.status ?? 'ACTIVE',
      },
    },
  );
  return res.data.data;
}

export async function apiLockStaff(userId: number, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  await apiRequest(`/admin/staff/${userId}/lock`, { method: 'POST', token: tok });
}

export async function apiUnlockStaff(userId: number, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  await apiRequest(`/admin/staff/${userId}/unlock`, { method: 'POST', token: tok });
}

export async function apiUpdateCourt(
  courtId: number,
  body: Record<string, unknown>,
  token?: string,
) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<ApiSuccess<{ court: AdminCourtDto; affectedCount: number }>>(
    `/admin/courts/${courtId}`,
    {
      method: 'PUT',
      token: tok,
      body,
    },
  );
  return res.data.data;
}

export async function apiReleaseCourtBlock(blockId: number, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  await apiRequest(`/admin/court-blocks/${blockId}/release`, {
    method: 'POST',
    token: tok,
  });
}

export async function apiDeleteHoliday(holidayId: number, group = true, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  await apiRequest(`/admin/holidays/${holidayId}?group=${group}`, {
    method: 'DELETE',
    token: tok,
  });
}

export async function apiGetOpeningHours(branchId: number, token?: string) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<
    ApiSuccess<{
      branchId: number;
      days: Array<{ dayOfWeek: number; openTime: string | null; closeTime: string | null; isClosed: boolean }>;
    }>
  >(`/admin/branches/${branchId}/opening-hours`, { token: tok });
  return res.data.data;
}

export async function apiUpdateOpeningHours(
  branchId: number,
  days: Array<{ dayOfWeek: number; openTime: string | null; closeTime: string | null; isClosed: boolean }>,
  token?: string,
) {
  const tok = token ?? (await apiLogin('owner')).accessToken;
  const res = await apiRequest<ApiSuccess<unknown>>(
    `/admin/branches/${branchId}/opening-hours?dryRun=false`,
    {
      method: 'PUT',
      token: tok,
      body: { days },
    },
  );
  return res.data.data;
}

export function writeStorageStateFromLogin(
  role: 'customer' | 'customer2' | 'staff' | 'owner',
  session: LoginSession,
): void {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const statePath = getAuthStorageStatePath(role);
  const cookies = session.refreshTokenCookie
    ? [
        {
          name: 'sh_rt',
          value: session.refreshTokenCookie,
          domain: 'localhost',
          path: '/api/v1/auth',
          expires: Math.floor(Date.now() / 1000) + 7 * 86_400,
          httpOnly: true,
          secure: false,
          sameSite: 'Strict' as const,
        },
      ]
    : [];
  fs.writeFileSync(statePath, JSON.stringify({ cookies, origins: [] }, null, 2), 'utf8');
}
