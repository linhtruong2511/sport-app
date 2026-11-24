import { ERROR_CATALOG } from '@sporthub/shared/errors';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import {
  authRateLimitMiddleware,
  createRateLimitMiddleware,
} from '../http/rate-limit.middleware.js';
import { securityHeadersMiddleware } from '../http/security-headers.middleware.js';
import { traceIdMiddleware } from '../http/trace-id.middleware.js';

describe('core/http security hardening & rate limiting', () => {
  it('allows 10 requests and blocks the 11th with 429 TOO_MANY_REQUESTS, Retry-After, and traceId', async () => {
    const app = express();
    app.use(traceIdMiddleware);
    app.use('/api/v1/auth/login', authRateLimitMiddleware);
    app.post('/api/v1/auth/login', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    for (let i = 1; i <= 10; i += 1) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('x-forwarded-for', '198.51.100.10');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('10');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(10 - i));
      expect(Number(res.headers['x-ratelimit-reset'])).toBeGreaterThan(0);
    }

    const blocked = await request(app)
      .post('/api/v1/auth/login')
      .set('x-forwarded-for', '198.51.100.10')
      .set('x-trace-id', 'rate-trace-11');

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.headers['x-ratelimit-remaining']).toBe('0');
    expect(blocked.body).toEqual({
      error: {
        code: 'TOO_MANY_REQUESTS',
        message: ERROR_CATALOG.TOO_MANY_REQUESTS.defaultMessage,
        traceId: 'rate-trace-11',
      },
    });
  });

  it('tracks independent quotas for distinct x-forwarded-for IPs', async () => {
    const app = express();
    app.use(traceIdMiddleware);
    app.use(
      createRateLimitMiddleware({
        windowMs: 60_000,
        max: 2,
        keyPrefix: 'ip-isolation',
      }),
    );
    app.get('/ping', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/ping').set('x-forwarded-for', '203.0.113.1, 10.0.0.1').expect(200);
    await request(app).get('/ping').set('x-forwarded-for', '203.0.113.1, 10.0.0.2').expect(200);
    const blockedIp1 = await request(app).get('/ping').set('x-forwarded-for', '203.0.113.1');
    expect(blockedIp1.status).toBe(429);

    const allowedIp2 = await request(app).get('/ping').set('x-forwarded-for', '203.0.113.2');
    expect(allowedIp2.status).toBe(200);
    expect(allowedIp2.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('resets quota when advancing nowFn past windowMs', async () => {
    let now = 1_700_000_000_000;
    const app = express();
    app.use(
      createRateLimitMiddleware({
        windowMs: 60_000,
        max: 2,
        nowFn: () => now,
        keyPrefix: 'window-reset',
      }),
    );
    app.get('/ping', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    await request(app).get('/ping').set('x-forwarded-for', '192.0.2.5').expect(200);
    await request(app).get('/ping').set('x-forwarded-for', '192.0.2.5').expect(200);
    const blocked = await request(app).get('/ping').set('x-forwarded-for', '192.0.2.5');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.traceId).toBe('unknown');

    now += 60_001;

    const afterReset = await request(app).get('/ping').set('x-forwarded-for', '192.0.2.5');
    expect(afterReset.status).toBe(200);
    expect(afterReset.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('sets OWASP security headers and removes x-powered-by', async () => {
    const app = express();
    app.disable('x-powered-by');
    app.use((_req, res, next) => {
      res.setHeader('X-Powered-By', 'Express');
      next();
    });
    app.use(securityHeadersMiddleware);
    app.get('/health', (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['permissions-policy']).toBe('camera=(), microphone=(), geolocation=()');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
  });
});
