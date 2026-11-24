import {
  Body,
  Controller,
  Get,
  type INestApplication,
  Module,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { FakeClock } from '../clock.js';
import { AppError, AppExceptionsFilter } from '../errors.js';
import { ok, okList } from '../http/envelope.js';
import { traceIdMiddleware } from '../http/trace-id.middleware.js';
import { AppLogger, redactSensitive } from '../logger.js';
import { ZodValidationPipe } from '../validation/zod-validation.pipe.js';

const sampleSchema = z.object({
  phone: z.string().regex(/^0\d{9}$/, 'Số điện thoại không hợp lệ.'),
});

@Controller('test-errors')
class TestErrorsController {
  @Get('app-error')
  throwAppError() {
    throw new AppError('SLOT_TAKEN', { details: { slotStart: '18:00' } });
  }

  @Get('unknown')
  throwUnknown() {
    throw new Error('SELECT * FROM Users WHERE PasswordHash = secret_sql_leak');
  }

  @Get('unavailable')
  throwUnavailable() {
    throw new ServiceUnavailableException('DB down');
  }

  @Post('validate')
  validate(@Body(new ZodValidationPipe(sampleSchema)) body: { phone: string }) {
    return ok(body, new FakeClock(new Date('2026-11-25T10:00:00+07:00')));
  }
}

@Module({
  controllers: [TestErrorsController],
  providers: [AppLogger],
})
class TestErrorsModule {}

describe('core/errors, logger, envelope & validation pipe', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(TestErrorsModule, new ExpressAdapter(), { logger: false });
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('formats AppError with ERROR_CATALOG status, Vietnamese message, details, and traceId', async () => {
    const res = await request(app.getHttpServer())
      .get('/test-errors/app-error')
      .set('x-trace-id', 'trace-123');

    expect(res.status).toBe(409);
    expect(res.headers['x-trace-id']).toBe('trace-123');
    expect(res.body).toEqual({
      error: {
        code: 'SLOT_TAKEN',
        message: 'Khung giờ vừa chọn đã có người đặt, vui lòng chọn khung giờ khác.',
        details: { slotStart: '18:00' },
        traceId: 'trace-123',
      },
    });
  });

  it('maps unknown errors to 500 INTERNAL_ERROR without leaking message or stack', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await request(app.getHttpServer()).get('/test-errors/unknown');

      expect(res.status).toBe(500);
      expect(res.headers['x-trace-id']).toMatch(/^[0-9a-f]{16}$/);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.traceId).toBe(res.headers['x-trace-id']);
      expect(JSON.stringify(res.body)).not.toContain('secret_sql_leak');
      expect(errorSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('maps Nest 404 to NOT_FOUND and 503 HttpException cleanly', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res404 = await request(app.getHttpServer()).get('/does-not-exist');
      expect(res404.status).toBe(404);
      expect(res404.body.error.code).toBe('NOT_FOUND');

      const res503 = await request(app.getHttpServer()).get('/test-errors/unavailable');
      expect(res503.status).toBe(503);
      expect(res503.body.error.code).toBe('INTERNAL_ERROR');
      expect(res503.body.error.message).toBe('DB down');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('converts ZodError issues to VALIDATION_ERROR with field details', async () => {
    const res = await request(app.getHttpServer())
      .post('/test-errors/validate')
      .send({ phone: '123' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      { field: 'phone', message: 'Số điện thoại không hợp lệ.' },
    ]);
  });

  it('redacts sensitive fields in AppLogger', () => {
    const redacted = redactSensitive({
      userId: 1,
      password: '123',
      nested: {
        accessToken: 'jwt',
        authorization: 'Bearer abc',
        apiKey: 'sepay-key',
        cookieSecret: 'sec',
        safe: 'ok',
      },
    });
    expect(redacted).toEqual({
      userId: 1,
      password: '[REDACTED]',
      nested: {
        accessToken: '[REDACTED]',
        authorization: '[REDACTED]',
        apiKey: '[REDACTED]',
        cookieSecret: '[REDACTED]',
        safe: 'ok',
      },
    });
  });

  it('builds ok and okList envelopes with serverTime', () => {
    const clock = new FakeClock(new Date('2026-11-25T10:00:00+07:00'));
    expect(ok({ id: 1 }, clock, { custom: true })).toEqual({
      data: { id: 1 },
      meta: { custom: true, serverTime: '2026-11-25T10:00:00+07:00' },
    });

    expect(okList(['a', 'b'], { page: 1, pageSize: 20, totalItems: 42 }, clock)).toEqual({
      data: ['a', 'b'],
      meta: {
        page: 1,
        pageSize: 20,
        totalItems: 42,
        totalPages: 3,
        serverTime: '2026-11-25T10:00:00+07:00',
      },
    });
  });
});
