import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditService } from './audit/audit.service.js';
import { CLOCK, SystemClock } from './clock.js';
import { DbTransactionService } from './db/transaction.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor.js';
import { AppLogger } from './logger.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { RealtimeService } from './realtime/realtime.service.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  providers: [
    SystemClock,
    { provide: CLOCK, useExisting: SystemClock },
    AppLogger,
    AuditService,
    RealtimeService,
    RealtimeGateway,
    DbTransactionService,
    SettingsService,
    IdempotencyInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
  ],
  exports: [
    CLOCK,
    SystemClock,
    AppLogger,
    AuditService,
    RealtimeService,
    DbTransactionService,
    SettingsService,
    IdempotencyInterceptor,
  ],
})
export class CoreModule {}
