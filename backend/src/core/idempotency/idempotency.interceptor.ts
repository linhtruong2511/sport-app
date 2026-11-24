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
import { from, type Observable, of, switchMap } from 'rxjs';
import { sql } from '../../config/database.js';
import { CLOCK, type Clock } from '../clock.js';
import { isSqlUniqueViolation } from '../db/sql-errors.js';
import { DbTransactionService } from '../db/transaction.js';
import { AppError } from '../errors.js';
import { addMinutes, toSqlDateTime } from '../time.js';

export const REQUIRE_IDEMPOTENCY_KEY = 'require_idempotency';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

type RequestWithUser = Request & { user?: { userId?: number } };

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
    const requestHash = crypto
      .createHash('sha256')
      .update(stableStringify(req.body ?? {}))
      .digest('hex');

    const now = this.clock.now();
    const sqlNow = toSqlDateTime(now);

    return from(this.findActiveRecord(key, userId, sqlNow)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.RequestHash !== requestHash) {
            throw new AppError('IDEMPOTENCY_CONFLICT');
          }
          res.status(existing.StatusCode);
          if (existing.StatusCode === 204 || existing.ResponseBody === '') {
            return of(undefined);
          }
          return of(JSON.parse(existing.ResponseBody) as unknown);
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
                : (explicitHttpCode ?? (req.method === 'POST' ? 201 : 200));

            if (statusCode >= 200 && statusCode < 300) {
              const responseBody = body === undefined ? '' : JSON.stringify(body);
              const expiresAt = toSqlDateTime(addMinutes(this.clock.now(), 24 * 60));
              const stored = await this.saveRecord({
                key,
                userId,
                method: req.method,
                path: (req.originalUrl ?? req.url).slice(0, 200),
                requestHash,
                statusCode,
                responseBody,
                createdAt: sqlNow,
                expiresAt,
              });

              if (stored.conflict) {
                throw new AppError('IDEMPOTENCY_CONFLICT');
              }
              if (stored.replayedBody !== undefined) {
                res.status(stored.replayedStatus ?? statusCode);
                return stored.replayedBody;
              }
            }

            return body;
          }),
        );
      }),
    );
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

  private async saveRecord(params: {
    key: string;
    userId: number;
    method: string;
    path: string;
    requestHash: string;
    statusCode: number;
    responseBody: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<{ conflict?: boolean; replayedStatus?: number; replayedBody?: unknown }> {
    const exec = await this.db.executor();
    try {
      await exec
        .request()
        .input('key', sql.UniqueIdentifier, params.key)
        .input('userId', sql.BigInt, params.userId)
        .input('now', sql.DateTime2(0), params.createdAt)
        .query(`
          DELETE FROM dbo.IdempotencyKeys
          WHERE IdempotencyKey = @key AND UserId = @userId AND ExpiresAt <= @now
        `);

      await exec
        .request()
        .input('key', sql.UniqueIdentifier, params.key)
        .input('userId', sql.BigInt, params.userId)
        .input('method', sql.VarChar(10), params.method)
        .input('path', sql.VarChar(200), params.path)
        .input('requestHash', sql.Char(64), params.requestHash)
        .input('statusCode', sql.Int, params.statusCode)
        .input('responseBody', sql.NVarChar(sql.MAX), params.responseBody)
        .input('createdAt', sql.DateTime2(0), params.createdAt)
        .input('expiresAt', sql.DateTime2(0), params.expiresAt)
        .query(`
          INSERT INTO dbo.IdempotencyKeys
            (IdempotencyKey, UserId, Method, Path, RequestHash, StatusCode, ResponseBody, CreatedAt, ExpiresAt)
          VALUES
            (@key, @userId, @method, @path, @requestHash, @statusCode, @responseBody, @createdAt, @expiresAt)
        `);
      return {};
    } catch (err) {
      if (!isSqlUniqueViolation(err)) {
        throw err;
      }

      const existing = await this.findActiveRecord(params.key, params.userId, params.createdAt);
      if (!existing) {
        return {};
      }
      if (existing.RequestHash !== params.requestHash) {
        return { conflict: true };
      }
      return {
        replayedStatus: existing.StatusCode,
        replayedBody:
          existing.StatusCode === 204 || existing.ResponseBody === ''
            ? undefined
            : (JSON.parse(existing.ResponseBody) as unknown),
      };
    }
  }
}
