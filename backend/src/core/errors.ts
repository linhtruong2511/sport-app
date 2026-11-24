import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ERROR_CATALOG, type ErrorCode } from '@sporthub/shared/errors';
import type { ApiErrorResponse } from '@sporthub/shared/types';
import type { Request, Response } from 'express';
import { AppLogger } from './logger.js';

export interface AppErrorOptions {
  message?: string;
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, options?: AppErrorOptions | string) {
    const entry = ERROR_CATALOG[code];
    const resolvedOptions: AppErrorOptions =
      typeof options === 'string' ? { message: options } : (options ?? {});
    const message = resolvedOptions.message ?? entry.defaultMessage;

    super(message, resolvedOptions.cause !== undefined ? { cause: resolvedOptions.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = entry.status;
    this.details = resolvedOptions.details;
  }
}

type RequestWithTrace = Request & { traceId?: string };

function mapStatusToErrorCode(status: number): ErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'VALIDATION_ERROR';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'BOOKING_STATE_CHANGED';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_ERROR';
    case HttpStatus.LOCKED:
      return 'ACCOUNT_TEMP_LOCKED';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    case HttpStatus.BAD_GATEWAY:
      return 'PAYMENT_GATEWAY_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CATALOG;
}

@Catch()
export class AppExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger = new AppLogger()) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithTrace>();
    const res = ctx.getResponse<Response>();
    const traceId = req.traceId ?? 'unknown';

    if (exception instanceof AppError) {
      const payload: ApiErrorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details !== undefined
            ? { details: exception.details as ApiErrorResponse['error']['details'] }
            : {}),
          traceId,
        },
      };
      res.status(exception.status).json(payload);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const bodyObj = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;

      const code: ErrorCode = isErrorCode(bodyObj?.code) ? bodyObj.code : mapStatusToErrorCode(status);

      let message: string;
      if (status === HttpStatus.NOT_FOUND && bodyObj && typeof bodyObj.error === 'string') {
        message = ERROR_CATALOG.NOT_FOUND.defaultMessage;
      } else if (typeof body === 'string') {
        message = body;
      } else if (bodyObj && typeof bodyObj.message === 'string') {
        message = bodyObj.message;
      } else if (bodyObj && Array.isArray(bodyObj.message)) {
        message = ERROR_CATALOG[code].defaultMessage;
      } else {
        message = ERROR_CATALOG[code].defaultMessage;
      }

      const details =
        bodyObj && bodyObj.details !== undefined
          ? (bodyObj.details as ApiErrorResponse['error']['details'])
          : undefined;

      if (status >= 500) {
        this.logger.error('HTTP 5xx exception', {
          context: 'AppExceptionsFilter',
          status,
          code,
          method: req.method,
          path: req.originalUrl ?? req.url,
          err: exception,
        }, traceId);
      }

      const payload: ApiErrorResponse = {
        error: {
          code,
          message,
          ...(details !== undefined ? { details } : {}),
          traceId,
        },
      };
      res.status(status).json(payload);
      return;
    }

    this.logger.error(
      'Unhandled exception',
      {
        context: 'AppExceptionsFilter',
        method: req.method,
        path: req.originalUrl ?? req.url,
        err: exception,
      },
      traceId,
    );

    const payload: ApiErrorResponse = {
      error: {
        code: 'INTERNAL_ERROR',
        message: ERROR_CATALOG.INTERNAL_ERROR.defaultMessage,
        traceId,
      },
    };
    res.status(ERROR_CATALOG.INTERNAL_ERROR.status).json(payload);
  }
}
