import type { ApiErrorPayload, ApiErrorResponse, ErrorCode } from '@sporthub/shared';

let accessToken: string | null = null;
let serverTimeOffsetMs = 0;
let refreshPromise: Promise<string | null> | null = null;
const authRevokedListeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = null;
}

export function getServerNowMs(): number {
  return Date.now() + serverTimeOffsetMs;
}

export function onAuthRevoked(cb: () => void): () => void {
  authRevokedListeners.add(cb);
  return () => {
    authRevokedListeners.delete(cb);
  };
}

function notifyAuthRevoked(): void {
  for (const cb of authRevokedListeners) {
    try {
      cb();
    } catch {
      // Avoid breaking other auth listeners if one throws
    }
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details?: ApiErrorPayload['details'];
  readonly traceId?: string;

  constructor(
    status: number,
    code: ErrorCode | string,
    message: string,
    details?: ApiErrorPayload['details'],
    traceId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.traceId = traceId;
  }
}

export interface ApiFetchOptions extends RequestInit {
  idempotencyKey?: string;
  skipAuthRefresh?: boolean;
}

function resolveApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/api')) {
    return path;
  }
  return path.startsWith('/') ? `/api/v1${path}` : `/api/v1/${path}`;
}

function syncServerTime(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || !('meta' in payload)) {
    return;
  }
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object' || !('serverTime' in meta)) {
    return;
  }
  const serverTime = (meta as { serverTime?: unknown }).serverTime;
  if (typeof serverTime !== 'string') {
    return;
  }
  const parsed = Date.parse(serverTime);
  if (!Number.isNaN(parsed)) {
    serverTimeOffsetMs = parsed - Date.now();
  }
}

async function parseJsonSafely(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorPayload(body: unknown): Partial<ApiErrorPayload> | null {
  if (!body || typeof body !== 'object' || !('error' in body)) {
    return null;
  }
  const err = (body as Partial<ApiErrorResponse>).error;
  if (!err || typeof err !== 'object') {
    return null;
  }
  return err;
}

function extractAccessToken(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }
  if ('data' in body) {
    const data = (body as { data?: unknown }).data;
    if (data && typeof data === 'object' && 'accessToken' in data) {
      const token = (data as { accessToken?: unknown }).accessToken;
      if (typeof token === 'string' && token.length > 0) {
        return token;
      }
    }
  }
  if ('accessToken' in body) {
    const token = (body as { accessToken?: unknown }).accessToken;
    if (typeof token === 'string' && token.length > 0) {
      return token;
    }
  }
  return null;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
          },
        });
        const body = await parseJsonSafely(res);
        syncServerTime(body);

        if (!res.ok) {
          const errPayload = extractErrorPayload(body);
          clearAccessToken();
          notifyAuthRevoked();
          throw new ApiError(
            res.status,
            errPayload?.code ?? 'REFRESH_INVALID',
            errPayload?.message ?? 'Phiên làm mới không hợp lệ hoặc đã hết hạn.',
            errPayload?.details,
            errPayload?.traceId,
          );
        }

        const newToken = extractAccessToken(body);
        if (!newToken) {
          clearAccessToken();
          notifyAuthRevoked();
          throw new ApiError(401, 'REFRESH_INVALID', 'Phiên làm mới không hợp lệ hoặc đã hết hạn.');
        }

        setAccessToken(newToken);
        return newToken;
      } catch (err) {
        if (err instanceof ApiError) {
          throw err;
        }
        clearAccessToken();
        notifyAuthRevoked();
        throw new ApiError(
          0,
          'NETWORK_ERROR',
          err instanceof Error ? err.message : 'Không thể kết nối đến máy chủ.',
        );
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

function buildRequestInit(options?: ApiFetchOptions): RequestInit {
  const { idempotencyKey, skipAuthRefresh: _skipAuthRefresh, headers: rawHeaders, ...rest } = options ?? {};
  const headers = new Headers(rawHeaders);

  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const isFormData = typeof FormData !== 'undefined' && rest.body instanceof FormData;
  if (rest.body !== undefined && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (idempotencyKey) {
    headers.set('Idempotency-Key', idempotencyKey);
  }

  return {
    ...rest,
    credentials: 'include',
    headers,
  };
}

function toApiError(res: Response, body: unknown): ApiError {
  const errPayload = extractErrorPayload(body);
  const code = errPayload?.code ?? (res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL_ERROR');
  const message = errPayload?.message ?? (res.statusText || 'Đã xảy ra lỗi hệ thống.');
  return new ApiError(res.status, code, message, errPayload?.details, errPayload?.traceId);
}

export async function apiFetch<T>(path: string, options?: ApiFetchOptions): Promise<T> {
  const url = resolveApiUrl(path);
  const res = await fetch(url, buildRequestInit(options));

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await parseJsonSafely(res);
  syncServerTime(body);

  if (res.ok) {
    return body as T;
  }

  const initialError = toApiError(res, body);

  if (
    res.status === 401 &&
    initialError.code === 'TOKEN_EXPIRED' &&
    !options?.skipAuthRefresh &&
    !url.endsWith('/auth/refresh')
  ) {
    await refreshAccessToken();
    const retryRes = await fetch(url, buildRequestInit(options));

    if (retryRes.status === 204) {
      return undefined as T;
    }

    const retryBody = await parseJsonSafely(retryRes);
    syncServerTime(retryBody);

    if (retryRes.ok) {
      return retryBody as T;
    }

    const retryError = toApiError(retryRes, retryBody);
    if (retryRes.status === 401 && retryError.code === 'TOKEN_REVOKED') {
      clearAccessToken();
      notifyAuthRevoked();
    }
    throw retryError;
  }

  if (res.status === 401 && initialError.code === 'TOKEN_REVOKED') {
    clearAccessToken();
    notifyAuthRevoked();
  }

  throw initialError;
}
