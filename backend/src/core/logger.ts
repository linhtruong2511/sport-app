import { Injectable } from '@nestjs/common';

const SENSITIVE_KEY_PATTERN = /password|token|authorization|apikey|secret|cookie/i;

function sanitizeValue(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (depth > 8) return '[Truncated]';

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = sanitizeValue(val, seen, depth + 1);
    }
  }
  return out;
}

export function redactSensitive<T>(input: T): T {
  return sanitizeValue(input, new WeakSet<object>()) as T;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogContext {
  traceId?: string;
  context?: string;
  [key: string]: unknown;
}

@Injectable()
export class AppLogger {
  info(message: string, meta?: LogContext, traceId?: string): void {
    this.write('info', message, meta, traceId);
  }

  warn(message: string, meta?: LogContext, traceId?: string): void {
    this.write('warn', message, meta, traceId);
  }

  error(message: string, meta?: LogContext, traceId?: string): void {
    this.write('error', message, meta, traceId);
  }

  private write(level: LogLevel, message: string, meta?: LogContext, traceId?: string): void {
    const resolvedTraceId = traceId ?? meta?.traceId;
    const sanitizedMeta = meta ? redactSensitive(meta) : undefined;
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(resolvedTraceId ? { traceId: resolvedTraceId } : {}),
      ...(sanitizedMeta ?? {}),
    };

    const line = JSON.stringify(entry);
    if (level === 'error') {
      console.error(line);
    } else if (level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}
