import crypto from 'node:crypto';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';

export function verifySepayApiKeyHeader(authHeader: string | undefined): void {
  if (!authHeader) {
    throw new AppError('UNAUTHENTICATED', { message: 'Thiếu xác thực webhook.' });
  }
  const match = /^Apikey\s+(.+)$/i.exec(authHeader.trim());
  if (!match) {
    throw new AppError('UNAUTHENTICATED', { message: 'Định dạng xác thực webhook không hợp lệ.' });
  }
  const provided = Buffer.from(match[1].trim(), 'utf8');
  const expected = Buffer.from(env.sepayWebhookApiKey, 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new AppError('UNAUTHENTICATED', { message: 'API key webhook không chính xác.' });
  }
}

@Injectable()
export class SepayWebhookAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    verifySepayApiKeyHeader(req.header('authorization'));
    return true;
  }
}
