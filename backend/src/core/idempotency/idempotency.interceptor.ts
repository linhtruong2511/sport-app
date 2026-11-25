import crypto from 'node:crypto';
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { catchError, from, type Observable, of, switchMap, throwError } from 'rxjs';
import { sql } from '../../config/database.js';
import { CLOCK, type Clock } from '../clock.js';
import { isSqlUniqueViolation } from '../db/sql-errors.js';
import { DbTransactionService } from '../db/transaction.js';
import { AppError } from '../errors.js';
import { addMinutes, toSqlDateTime } from '../time.js';

export const REQUIRE_IDEMPOTENCY_KEY = 'require_idempotency';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IN_PROGRESS_STATUS_CODE = 0;
const IN_PROGRESS_LOCK_MINUTES = 5;
const IN_PROGRESS_POLL_ATTEMPTS = 20;
const IN_PROGRESS_POLL_DELAY_MS = 50;

export const RequireIdempotency = () => SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => (item === undefined ? 'null' : stableStringify(item)));
    return `[${items.join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${stableStringify(v)}`);
  }
  return `{${parts.join(',')}}`;
}

interface IdempotencyRow {
  RequestHash: string;
  StatusCode: number;
  ResponseBody: string;
}

type AcquireOutcome =
  | { kind: 'ACQUIRED' }
  | { kind: 'REPLAY'; statusCode: number; responseBody: string };

type RequestWithUser = Request & { user?: { userId?: number } };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<RequestWithUser>();
    const res = http.getResponse<Response>();

    const rawKey = req.header('idempotency-key')?.trim();
    if (!rawKey || !UUID_V4_REGEX.test(rawKey)) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    }

    const key = rawKey.toLowerCase();
    const userId = req.user?.userId ?? 0;
    const method = req.method.toUpperCase();
    const requestPath = (req.originalUrl ?? req.url).slice(0, 200);
    // M-1: Include Method + Path + canonical body in RequestHash so same key cannot replay across endpoints.
    const requestHash = crypto
      .createHash('sha256')
      .update(`${method}:${requestPath}:${stableStringify(req.body ?? {})}`)
      .digest('hex');

    const now = this.clock.now();

    return from(
      this.acquireOrReplay({
        key,
        userId,
        method,
        path: requestPath,
        requestHash,
        now,
      }),
    ).pipe(
      switchMap((outcome) => {
        if (outcome.kind === 'REPLAY') {
          res.status(outcome.statusCode);
          if (outcome.statusCode === 204 || outcome.responseBody === '') {
            return of(undefined);
          }
          return of(JSON.parse(outcome.responseBody) as unknown);
        }

        return next.handle().pipe(
          switchMap(async (body) => {
            const explicitHttpCode = this.reflector.get<number>(
              '__httpCode__',
              context.getHandler(),
            );
            const statusCode =
              res.statusCode !== 200
                ? res.statusCode
                : (explicitHttpCode ?? (method === 'POST' ? 201 : 200));

            if (statusCode >= 200 && statusCode < 300) {
              const responseBody = body === undefined ? '' : JSON.stringify(body);
              const expiresAt = toSqlDateTime(addMinutes(this.clock.now(), 24 * 60));
              await this.completeLock({
                key,
                userId,
                statusCode,
                responseBody,
                expiresAt,
              });
            } else {
              await this.releaseLock(key, userId);
            }

            return body;
          }),
          catchError((err: unknown) =>
            from(this.releaseLock(key, userId).catch(() => undefined)).pipe(
              switchMap(() => throwError(() => err)),
            ),
          ),
        );
      }),
    );
  }

  async cleanupExpiredKeys(limit = 500): Promise<number> {
    const exec = await this.db.executor();
    const result = await exec
      .request()
      .input('limit', sql.Int, limit)
      .input('now', sql.DateTime2(0), toSqlDateTime(this.clock.now()))
      .query(`
        DELETE TOP (@limit)
        FROM dbo.IdempotencyKeys
        WHERE ExpiresAt <= @now
      `);
    return result.rowsAffected[0] ?? 0;
  }

  private async acquireOrReplay(params: {
    key: string;
    userId: number;
    method: string;
    path: string;
    requestHash: string;
    now: Date;
  }): Promise<AcquireOutcome> {
    const sqlNow = toSqlDateTime(params.now);
    const lockExpiresAt = toSqlDateTime(addMinutes(params.now, IN_PROGRESS_LOCK_MINUTES));
    const exec = await this.db.executor();

    for (let attempt = 0; attempt < 3; attempt++) {
      await exec
        .request()
        .input('key', sql.UniqueIdentifier, params.key)
        .input('userId', sql.BigInt, params.userId)
        .input('now', sql.DateTime2(0), sqlNow)
        .query(`
          DELETE FROM dbo.IdempotencyKeys
          WHERE IdempotencyKey = @key AND UserId = @userId AND ExpiresAt <= @now
        `);

      try {
        await exec
          .request()
          .input('key', sql.UniqueIdentifier, params.key)
          .input('userId', sql.BigInt, params.userId)
          .input('method', sql.VarChar(10), params.method)
          .input('path', sql.VarChar(200), params.path)
          .input('requestHash', sql.Char(64), params.requestHash)
          .input('statusCode', sql.Int, IN_PROGRESS_STATUS_CODE)
          .input('responseBody', sql.NVarChar(sql.MAX), '')
          .input('createdAt', sql.DateTime2(0), sqlNow)
          .input('expiresAt', sql.DateTime2(0), lockExpiresAt)
          .query(`
            INSERT INTO dbo.IdempotencyKeys
              (IdempotencyKey, UserId, Method, Path, RequestHash, StatusCode, ResponseBody, CreatedAt, ExpiresAt)
            VALUES
              (@key, @userId, @method, @path, @requestHash, @statusCode, @responseBody, @createdAt, @expiresAt)
          `);
        return { kind: 'ACQUIRED' };
      } catch (err) {
        if (!isSqlUniqueViolation(err)) {
          throw err;
        }
      }

      let existing = await this.findActiveRecord(params.key, params.userId, sqlNow);
      if (!existing) {
        continue;
      }
      if (existing.RequestHash !== params.requestHash) {
        throw new AppError('IDEMPOTENCY_CONFLICT');
      }
      if (existing.StatusCode !== IN_PROGRESS_STATUS_CODE) {
        return {
          kind: 'REPLAY',
          statusCode: existing.StatusCode,
          responseBody: existing.ResponseBody,
        };
      }

      // Concurrent duplicate request while first request is IN_PROGRESS: wait briefly for completion.
      for (let poll = 0; poll < IN_PROGRESS_POLL_ATTEMPTS; poll++) {
        await sleep(IN_PROGRESS_POLL_DELAY_MS);
        existing = await this.findActiveRecord(
          params.key,
          params.userId,
          toSqlDateTime(this.clock.now()),
        );
        if (!existing) {
          break;
        }
        if (existing.RequestHash !== params.requestHash) {
          throw new AppError('IDEMPOTENCY_CONFLICT');
        }
        if (existing.StatusCode !== IN_PROGRESS_STATUS_CODE) {
          return {
            kind: 'REPLAY',
            statusCode: existing.StatusCode,
            responseBody: existing.ResponseBody,
          };
        }
      }

      if (existing && existing.StatusCode === IN_PROGRESS_STATUS_CODE) {
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          message: 'Yêu cầu trước đó đang được xử lý, vui lòng thử lại sau.',
        });
      }
    }

    throw new AppError('IDEMPOTENCY_CONFLICT', {
      message: 'Yêu cầu trước đó đang được xử lý, vui lòng thử lại sau.',
    });
  }

  private async findActiveRecord(
    key: string,
    userId: number,
    sqlNow: Date,
  ): Promise<IdempotencyRow | undefined> {
    const exec = await this.db.executor();
    const result = await exec
      .request()
      .input('key', sql.UniqueIdentifier, key)
      .input('userId', sql.BigInt, userId)
      .input('now', sql.DateTime2(0), sqlNow)
      .query<IdempotencyRow>(`
        SELECT RequestHash, StatusCode, ResponseBody
        FROM dbo.IdempotencyKeys
        WHERE IdempotencyKey = @key AND UserId = @userId AND ExpiresAt > @now
      `);
    return result.recordset[0];
  }

  private async completeLock(params: {
    key: string;
    userId: number;
    statusCode: number;
    responseBody: string;
    expiresAt: Date;
  }): Promise<void> {
    const exec = await this.db.executor();
    await exec
      .request()
      .input('key', sql.UniqueIdentifier, params.key)
      .input('userId', sql.BigInt, params.userId)
      .input('statusCode', sql.Int, params.statusCode)
      .input('responseBody', sql.NVarChar(sql.MAX), params.responseBody)
      .input('expiresAt', sql.DateTime2(0), params.expiresAt)
      .query(`
        UPDATE dbo.IdempotencyKeys
        SET StatusCode = @statusCode,
            ResponseBody = @responseBody,
            ExpiresAt = @expiresAt
        WHERE IdempotencyKey = @key
          AND UserId = @userId
          AND StatusCode = ${IN_PROGRESS_STATUS_CODE}
      `);
  }

  private async releaseLock(key: string, userId: number): Promise<void> {
    const exec = await this.db.executor();
    await exec
      .request()
      .input('key', sql.UniqueIdentifier, key)
      .input('userId', sql.BigInt, userId)
      .query(`
        DELETE FROM dbo.IdempotencyKeys
        WHERE IdempotencyKey = @key
          AND UserId = @userId
          AND StatusCode = ${IN_PROGRESS_STATUS_CODE}
      `);
  }
}
