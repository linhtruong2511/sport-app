import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { closePool, sql } from '../../config/database.js';
import { env } from '../../config/env.js';
import { nextCode } from '../codes.js';
import { DbTransactionService } from '../db/transaction.js';
import { AppExceptionsFilter } from '../errors.js';
import { traceIdMiddleware } from '../http/trace-id.middleware.js';
import { AppLogger } from '../logger.js';
import { type DomainEvent, RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings.service.js';
import {
  fromSqlDate,
  fromSqlDateTime,
  fromSqlTime,
  parseVnDateTime,
  toSqlDate,
  toSqlDateTime,
  toSqlTimeString,
} from '../time.js';

describe('core/database integration', () => {
  let app: INestApplication;
  let txService: DbTransactionService;
  let settingsService: SettingsService;
  let realtimeService: RealtimeService;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, new ExpressAdapter(), { logger: false });
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.use(traceIdMiddleware);
    app.useGlobalFilters(new AppExceptionsFilter(app.get(AppLogger)));
    await app.init();

    txService = app.get(DbTransactionService);
    settingsService = app.get(SettingsService);
    realtimeService = app.get(RealtimeService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await closePool();
  });

  it('commits rows and flushes events only on commit, and discards both on rollback', async () => {
    const flushed: DomainEvent[] = [];
    const origFlush = realtimeService.flush.bind(realtimeService);
    realtimeService.flush = (events: DomainEvent[]) => {
      flushed.push(...events);
      origFlush(events);
    };

    try {
      // Rollback case
      await expect(
        txService.withTransaction(async (tx) => {
          await tx
            .request()
            .input('key', sql.VarChar(100), 'TEST_ROLLBACK_KEY')
            .input('val', sql.NVarChar(500), 'should_rollback')
            .query(`
              INSERT INTO dbo.SystemSettings (SettingKey, SettingValue)
              VALUES (@key, @val)
            `);
          tx.events.push({ rooms: ['availability:1:2026-11-25'], event: 'slot.updated', payload: {} });
          throw new Error('force rollback');
        }),
      ).rejects.toThrow('force rollback');

      expect(flushed).toHaveLength(0);
      const exec = await txService.executor();
      const afterRollback = await exec
        .request()
        .input('key', sql.VarChar(100), 'TEST_ROLLBACK_KEY')
        .query<{ SettingKey: string }>(
          'SELECT SettingKey FROM dbo.SystemSettings WHERE SettingKey = @key',
        );
      expect(afterRollback.recordset).toHaveLength(0);

      // Commit case
      await txService.withTransaction(async (tx) => {
        await tx
          .request()
          .input('key', sql.VarChar(100), 'TEST_COMMIT_KEY')
          .input('val', sql.NVarChar(500), 'committed')
          .query(`
            INSERT INTO dbo.SystemSettings (SettingKey, SettingValue)
            VALUES (@key, @val)
          `);
        tx.events.push({
          rooms: ['availability:1:2026-11-25'],
          event: 'slot.updated',
          payload: { ok: true },
        });
      });

      expect(flushed).toHaveLength(1);
      const afterCommit = await exec
        .request()
        .input('key', sql.VarChar(100), 'TEST_COMMIT_KEY')
        .query<{ SettingValue: string }>(
          'SELECT SettingValue FROM dbo.SystemSettings WHERE SettingKey = @key',
        );
      expect(afterCommit.recordset[0]?.SettingValue).toBe('committed');

      await exec
        .request()
        .input('key', sql.VarChar(100), 'TEST_COMMIT_KEY')
        .query('DELETE FROM dbo.SystemSettings WHERE SettingKey = @key');
    } finally {
      realtimeService.flush = origFlush;
    }
  });

  it('round-trips DATETIME2(0), DATE, and TIME(0) on SQL Server with zero second drift', async () => {
    const dt = parseVnDateTime('2026-11-25', '18:30:45');
    const exec = await txService.executor();
    const res = await exec
      .request()
      .input('dt', sql.DateTime2(0), toSqlDateTime(dt))
      .input('d', sql.Date, toSqlDate('2026-11-25'))
      .input('t', sql.VarChar(8), toSqlTimeString('05:30'))
      .query<{ dt: Date; d: Date; t: Date }>(`
        SELECT
          @dt AS dt,
          @d AS d,
          CAST(@t AS TIME(0)) AS t
      `);

    const row = res.recordset[0];
    expect(fromSqlDateTime(row.dt).getTime()).toBe(dt.getTime());
    expect(fromSqlDate(row.d)).toBe('2026-11-25');
    expect(fromSqlTime(row.t)).toBe('05:30');
  });

  it('generates BK and KH codes via dbo.usp_NextCode', async () => {
    const codes = await txService.withTransaction(async (tx) => {
      const bk = await nextCode(tx, 'BK', '20261125');
      const kh = await nextCode(tx, 'KH', null);
      return { bk, kh };
    });

    expect(codes.bk).toMatch(/^BK20261125\d{2,}$/);
    expect(codes.kh).toMatch(/^KH\d{6,}$/);
  });

  it('reads all 9 seeded keys from dbo.SystemSettings', async () => {
    settingsService.invalidate();
    const all = await settingsService.getAll();
    const expectedKeys = [
      'BOOKING_HOLD_MINUTES',
      'REMINDER_BEFORE_MINUTES',
      'NO_SHOW_GRACE_MINUTES',
      'REFUND_FULL_DAYS',
      'REFUND_HALF_DAYS',
      'REFUND_HALF_RATE',
      'LOGIN_MAX_FAILED',
      'LOGIN_LOCK_MINUTES',
      'QR_EXPIRE_MINUTES',
    ];
    for (const key of expectedKeys) {
      expect(all[key]).toBeDefined();
    }
    expect(await settingsService.getInt('BOOKING_HOLD_MINUTES')).toBe(10);
  });

  it('serves GET /api/v1/health and GET /api/v1/health/db with envelope and serverTime', async () => {
    const resHealth = await request(app.getHttpServer()).get('/api/v1/health');
    expect(resHealth.status).toBe(200);
    expect(resHealth.headers['x-trace-id']).toBeTruthy();
    expect(resHealth.body.data.status).toBe('ok');
    expect(resHealth.body.meta.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);

    const resDb = await request(app.getHttpServer()).get('/api/v1/health/db');
    expect(resDb.status).toBe(200);
    expect(resDb.body.data.status).toBe('connected');
    expect(resDb.body.data.database).toBe(env.db.testDatabase);
    expect(resDb.body.meta.serverTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+07:00$/);
  });
});
