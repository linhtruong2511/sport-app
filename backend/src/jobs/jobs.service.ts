import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import cron, { type ScheduledTask } from 'node-cron';
import { AdminPromotionsService } from '../admin/promotions/admin-promotions.service.js';
import { BookingsService } from '../bookings/bookings.service.js';
import { sql } from '../config/database.js';
import { env } from '../config/env.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppLogger } from '../core/logger.js';
import { toSqlDateTime } from '../core/time.js';
import { PaymentsService } from '../payments/payments.service.js';
import { JobLockService } from './job-lock.service.js';
import { LifecycleJobsService } from './lifecycle-jobs.service.js';

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private tasks: ScheduledTask[] = [];

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly paymentsService: PaymentsService,
    private readonly lifecycleJobsService: LifecycleJobsService,
    private readonly adminPromotionsService: AdminPromotionsService,
    private readonly jobLockService: JobLockService,
    private readonly db: DbTransactionService,
    private readonly logger: AppLogger,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (env.nodeEnv === 'test') {
      return;
    }

    this.tasks.push(
      cron.schedule(
        '*/30 * * * * *',
        () => void this.safeRun('expireHolds', () => this.runExpireHolds()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '* * * * *',
        () => void this.safeRun('expireQr', () => this.runExpireQr()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '* * * * *',
        () => void this.safeRun('cancelNoShows', () => this.runCancelNoShows()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '* * * * *',
        () => void this.safeRun('closePaidNoShows', () => this.runClosePaidNoShows()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '* * * * *',
        () => void this.safeRun('autoComplete', () => this.runAutoComplete()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '* * * * *',
        () => void this.safeRun('sendReminders', () => this.runSendReminders()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '*/15 * * * *',
        () => void this.safeRun('retryPromoNotify', () => this.runRetryPromoNotify()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
      cron.schedule(
        '0 * * * *',
        () => void this.safeRun('cleanupIdempotencyKeys', () => this.runCleanupIdempotencyKeys()),
        { timezone: 'Asia/Ho_Chi_Minh' },
      ),
    );
  }

  onModuleDestroy(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }

  // SDD 2.8: batch expire unpaid online holds
  async runExpireHolds(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-expireHolds', async () => {
      count = await this.bookingsService.expireHolds(200);
    });
    return count;
  }

  // SDD 2.8: batch expire pending QR payment requests
  async runExpireQr(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-expireQr', async () => {
      count = await this.paymentsService.expirePendingQrRequests(200);
    });
    return count;
  }

  // SDD 2.8: batch cancel DEPOSITED no-shows after grace period
  async runCancelNoShows(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-cancelNoShows', async () => {
      count = await this.lifecycleJobsService.cancelDepositedNoShows(200);
    });
    return count;
  }

  // R-04: batch close PAID no-shows after EndAt
  async runClosePaidNoShows(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-closePaidNoShows', async () => {
      count = await this.lifecycleJobsService.closePaidNoShows(200);
    });
    return count;
  }

  // SDD 2.8: batch auto-complete IN_USE bookings at EndAt
  async runAutoComplete(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-autoComplete', async () => {
      count = await this.lifecycleJobsService.autoCompleteBookings(200);
    });
    return count;
  }

  // SDD 2.8, UC 026: batch send REMINDER notifications
  async runSendReminders(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-sendReminders', async () => {
      count = await this.lifecycleJobsService.sendBookingReminders(200);
    });
    return count;
  }

  // SDD 2.8, M7: retry failed/pending promotion fan-out notifications
  async runRetryPromoNotify(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-retryPromoNotify', async () => {
      count = await this.adminPromotionsService.retryFailedPromoNotifications(20);
    });
    return count;
  }

  // Q-02: clean up expired 24h idempotency records in bounded batches
  async runCleanupIdempotencyKeys(): Promise<number> {
    let count = 0;
    await this.jobLockService.withLock('sporthub-job-cleanupIdempotency', async () => {
      const exec = await this.db.executor();
      const result = await exec
        .request()
        .input('now', sql.DateTime2(0), toSqlDateTime(this.clock.now()))
        .query(`
          DELETE TOP (500)
          FROM dbo.IdempotencyKeys
          WHERE ExpiresAt <= @now
        `);
      count = result.rowsAffected[0] ?? 0;
    });
    return count;
  }

  private async safeRun(jobName: string, fn: () => Promise<number>): Promise<void> {
    try {
      const affected = await fn();
      if (affected > 0) {
        this.logger.info('Background job completed', {
          context: 'JobsService',
          job: jobName,
          affected,
        });
      }
    } catch (err) {
      this.logger.error('Background job failed', {
        context: 'JobsService',
        job: jobName,
        error: err,
      });
    }
  }
}
