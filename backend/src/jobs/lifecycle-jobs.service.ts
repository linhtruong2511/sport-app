import { Inject, Injectable, Optional } from '@nestjs/common';
import { BookingStateService } from '../bookings/booking-state.service.js';
import { encodeRowVer } from '../bookings/bookings.mapper.js';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService, type TxContext } from '../core/db/transaction.js';
import { AppLogger } from '../core/logger.js';
import { SettingsService } from '../core/settings.service.js';
import {
  addMinutes,
  formatDateVn,
  formatTimeVn,
  fromSqlDateTime,
} from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class LifecycleJobsService {
  constructor(
    private readonly bookingsRepo: BookingsRepository,
    private readonly bookingState: BookingStateService,
    private readonly paymentsService: PaymentsService,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  // SDD 2.8: cancel CONFIRMED + DEPOSITED bookings past StartAt + NO_SHOW_GRACE_MINUTES
  async cancelDepositedNoShows(limit = 200): Promise<number> {
    const now = this.clock.now();
    const graceMinutes = await this.readSettingInt('NO_SHOW_GRACE_MINUTES', 30);
    const cutoff = addMinutes(now, -graceMinutes);

    return this.cancelNoShowBatch({
      paymentStatus: 'DEPOSITED',
      timeColumn: 'StartAt',
      cutoff,
      now,
      limit,
      cancelReason: 'Khách không đến nhận sân',
      historyNote: 'Job cancelNoShows – quá giờ nhận sân',
      jobName: 'cancelDepositedNoShows',
    });
  }

  // R-04: hold CONFIRMED + PAID bookings until EndAt before closing as NO_SHOW
  async closePaidNoShows(limit = 200): Promise<number> {
    const now = this.clock.now();

    return this.cancelNoShowBatch({
      paymentStatus: 'PAID',
      timeColumn: 'EndAt',
      cutoff: now,
      now,
      limit,
      cancelReason: 'Khách không tới nhận sân',
      historyNote: 'Job closePaidNoShows – khách không tới nhận sân đến hết giờ',
      jobName: 'closePaidNoShows',
    });
  }

  // SDD 2.8: auto-complete IN_USE bookings once EndAt is reached
  async autoCompleteBookings(limit = 200): Promise<number> {
    const now = this.clock.now();
    const exec = await this.txService.executor();
    const codes = await this.bookingsRepo.findAutoCompleteCandidateCodes(exec, now, limit);

    let count = 0;

    for (const code of codes) {
      try {
        const processed = await this.txService.withTransaction(async (tx) => {
          const row = await this.bookingsRepo.findByCodeForUpdate(tx, code);
          if (!row || row.Status !== 'IN_USE') {
            return false;
          }
          if (fromSqlDateTime(row.EndAt).getTime() > now.getTime()) {
            return false;
          }

          const newRowVer = await this.bookingState.autoCompleteInTx(tx, row, now);
          if (!newRowVer) {
            return false;
          }

          this.pushBookingAndSlotFreeEvents(tx, {
            bookingCode: row.BookingCode,
            branchId: Number(row.BranchId),
            courtId: Number(row.CourtId),
            customerUserId: row.CustomerUserId !== null ? Number(row.CustomerUserId) : null,
            startAt: fromSqlDateTime(row.StartAt),
            endAt: fromSqlDateTime(row.EndAt),
            status: 'COMPLETED',
            paymentStatus: row.PaymentStatus,
            paidAmount: Number(row.PaidAmount),
            remainingAmount: Number(row.RemainingAmount),
            rowVer: newRowVer,
          });

          return true;
        });

        if (processed) {
          count += 1;
        }
      } catch (err) {
        this.logger?.error('autoCompleteBookings item failed', {
          context: 'LifecycleJobsService',
          bookingCode: code,
          error: err,
        });
      }
    }

    return count;
  }

  // SDD 2.8, UC 026: send REMINDER notifications before StartAt
  async sendBookingReminders(limit = 200): Promise<number> {
    const now = this.clock.now();
    const reminderMinutes = await this.readSettingInt('REMINDER_BEFORE_MINUTES', 60);
    const windowEnd = addMinutes(now, reminderMinutes);

    const exec = await this.txService.executor();
    const codes = await this.bookingsRepo.findReminderCandidateCodes(exec, now, windowEnd, limit);

    let count = 0;

    for (const code of codes) {
      try {
        const processed = await this.txService.withTransaction(async (tx) => {
          const row = await this.bookingsRepo.findByCodeForUpdate(tx, code);
          if (!row || row.Status !== 'CONFIRMED' || row.ReminderSentAt !== null) {
            return false;
          }

          const startAt = fromSqlDateTime(row.StartAt);
          if (startAt.getTime() <= now.getTime() || startAt.getTime() > windowEnd.getTime()) {
            return false;
          }

          const bookingId = Number(row.BookingId);
          const marked = await this.bookingState.markReminderSentInTx(tx, bookingId, now);
          if (!marked) {
            return false;
          }

          if (row.CustomerUserId !== null) {
            const endAt = fromSqlDateTime(row.EndAt);
            const startTime = formatTimeVn(startAt);
            const endTime = formatTimeVn(endAt);
            const remainingAmount = `${Number(row.RemainingAmount).toLocaleString('vi-VN')} VNĐ`;
            const body = `Đơn ${row.BookingCode}: ${row.CourtName} tại ${row.BranchName} (${row.BranchAddress}) lúc ${startTime}–${endTime}. Số tiền còn thiếu: ${remainingAmount}.`;

            await this.notificationsService.createNotificationInTx(tx, {
              userId: Number(row.CustomerUserId),
              type: 'REMINDER',
              title: '⏰ Nhắc lịch chơi sắp bắt đầu',
              body,
              linkType: 'BOOKING',
              linkRef: String(bookingId),
              bookingCode: row.BookingCode,
              promotionCode: null,
            });
          }

          return true;
        });

        if (processed) {
          count += 1;
        }
      } catch (err) {
        this.logger?.error('sendBookingReminders item failed', {
          context: 'LifecycleJobsService',
          bookingCode: code,
          error: err,
        });
      }
    }

    return count;
  }

  private async cancelNoShowBatch(opts: {
    paymentStatus: 'DEPOSITED' | 'PAID';
    timeColumn: 'StartAt' | 'EndAt';
    cutoff: Date;
    now: Date;
    limit: number;
    cancelReason: string;
    historyNote: string;
    jobName: string;
  }): Promise<number> {
    const exec = await this.txService.executor();
    const codes = await this.bookingsRepo.findNoShowCandidateCodes(
      exec,
      opts.paymentStatus,
      opts.timeColumn,
      opts.cutoff,
      opts.limit,
    );

    let count = 0;

    for (const code of codes) {
      try {
        const processed = await this.txService.withTransaction(async (tx) => {
          const row = await this.bookingsRepo.findByCodeForUpdate(tx, code);
          if (
            !row ||
            row.Status !== 'CONFIRMED' ||
            row.PaymentStatus !== opts.paymentStatus ||
            row.CheckedInAt !== null
          ) {
            return false;
          }

          const targetTime = fromSqlDateTime(
            opts.timeColumn === 'StartAt' ? row.StartAt : row.EndAt,
          );
          if (targetTime.getTime() > opts.cutoff.getTime()) {
            return false;
          }

          const newRowVer = await this.bookingState.cancelNoShowInTx(tx, row, {
            paymentStatus: opts.paymentStatus,
            cancelReason: opts.cancelReason,
            historyNote: opts.historyNote,
            now: opts.now,
          });
          if (!newRowVer) {
            return false;
          }

          await this.paymentsService.cancelPendingRequestsInTx(tx, Number(row.BookingId));

          // L-3: Emit RemainingAmount matching DB column (Total - Paid).
          this.pushBookingAndSlotFreeEvents(tx, {
            bookingCode: row.BookingCode,
            branchId: Number(row.BranchId),
            courtId: Number(row.CourtId),
            customerUserId: row.CustomerUserId !== null ? Number(row.CustomerUserId) : null,
            startAt: fromSqlDateTime(row.StartAt),
            endAt: fromSqlDateTime(row.EndAt),
            status: 'CANCELED',
            paymentStatus: opts.paymentStatus,
            paidAmount: Number(row.PaidAmount),
            remainingAmount: Number(row.RemainingAmount),
            rowVer: newRowVer,
          });

          return true;
        });

        if (processed) {
          count += 1;
        }
      } catch (err) {
        this.logger?.error(`${opts.jobName} item failed`, {
          context: 'LifecycleJobsService',
          bookingCode: code,
          error: err,
        });
      }
    }

    return count;
  }

  private async readSettingInt(key: string, defaultValue: number): Promise<number> {
    try {
      return await this.settingsService.getInt(key);
    } catch {
      return defaultValue;
    }
  }

  private pushBookingAndSlotFreeEvents(
    tx: TxContext,
    params: {
      bookingCode: string;
      branchId: number;
      courtId: number;
      customerUserId: number | null;
      startAt: Date;
      endAt: Date;
      status: 'CANCELED' | 'COMPLETED';
      paymentStatus: 'UNPAID' | 'DEPOSITED' | 'PAID';
      paidAmount: number;
      remainingAmount: number;
      rowVer: Buffer;
    },
  ): void {
    const date = formatDateVn(params.startAt);
    const startTime = formatTimeVn(params.startAt);
    const endTime = formatTimeVn(params.endAt);

    const bookingRooms = [`booking:${params.bookingCode}`, `branch:${params.branchId}`];
    if (params.customerUserId !== null) {
      bookingRooms.push(`user:${params.customerUserId}`);
    }

    tx.events.push({
      rooms: bookingRooms,
      event: 'booking.updated',
      payload: {
        bookingCode: params.bookingCode,
        status: params.status,
        paymentStatus: params.paymentStatus,
        paidAmount: params.paidAmount,
        remainingAmount: params.remainingAmount,
        isOverdue: false,
        version: encodeRowVer(params.rowVer),
      },
    });

    tx.events.push({
      rooms: [`availability:${params.branchId}:${date}`, `branch:${params.branchId}`],
      event: 'slot.updated',
      payload: {
        branchId: params.branchId,
        courtId: params.courtId,
        date,
        startTime,
        endTime,
        state: 'FREE',
      },
    });
  }
}
