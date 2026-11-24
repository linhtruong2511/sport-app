import { ERROR_CATALOG } from '@sporthub/shared/errors';
import type { ApiErrorResponse } from '@sporthub/shared/types';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { RequestWithTraceId } from './trace-id.middleware.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  nowFn?: () => number;
  keyPrefix?: string;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const MAX_STORE_ENTRIES = 10_000;

function extractClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const first = forwarded.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    const first = forwarded[0]?.split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }

  if (typeof req.ip === 'string' && req.ip.trim().length > 0) {
    return req.ip.trim();
  }

  return 'unknown';
}

function pruneExpired(entries: Map<string, RateLimitEntry>, now: number): void {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key);
    }
  }
}

export function createRateLimitMiddleware(options: RateLimitOptions): RequestHandler {
  const { windowMs, max, nowFn = Date.now, keyPrefix } = options;
  const entries = new Map<string, RateLimitEntry>();

  const cleanupIntervalMs = Math.min(Math.max(windowMs, 1_000), 60_000);
  const cleanupTimer = setInterval(() => {
    pruneExpired(entries, nowFn());
  }, cleanupIntervalMs);
  cleanupTimer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = nowFn();
    const ip = extractClientIp(req);
    const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;

    let entry = entries.get(key);
    if (!entry || entry.resetAt <= now) {
      if (!entry && entries.size >= MAX_STORE_ENTRIES) {
        pruneExpired(entries, now);
        while (entries.size >= MAX_STORE_ENTRIES) {
          const oldestKey = entries.keys().next().value;
          if (oldestKey === undefined) {
            break;
          }
          entries.delete(oldestKey);
        }
      }
      entry = { count: 0, resetAt: now + windowMs };
      entries.set(key, entry);
    }

    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetEpochSeconds = Math.ceil(entry.resetAt / 1000);

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(resetEpochSeconds));

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      const traceId = (req as RequestWithTraceId).traceId ?? 'unknown';
      const payload: ApiErrorResponse = {
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: ERROR_CATALOG.TOO_MANY_REQUESTS.defaultMessage,
          traceId,
        },
      };

      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(ERROR_CATALOG.TOO_MANY_REQUESTS.status).json(payload);
      return;
    }

    next();
  };
}

// SDD 2.2 / roadmap M9: 10 req/min/IP on auth login & register endpoints
export const authRateLimitMiddleware: RequestHandler = createRateLimitMiddleware({
  windowMs: 60_000,
  max: 10,
  keyPrefix: 'auth',
});
