import crypto from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface RequestWithTraceId extends Request {
  traceId?: string;
}

export function traceIdMiddleware(
  req: RequestWithTraceId,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-trace-id')?.trim();
  const traceId = incoming && incoming.length > 0 ? incoming : crypto.randomBytes(8).toString('hex');
  req.traceId = traceId;
  res.setHeader('x-trace-id', traceId);
  next();
}

@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: RequestWithTraceId, res: Response, next: NextFunction): void {
    traceIdMiddleware(req, res, next);
  }
}
