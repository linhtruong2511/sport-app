import { Injectable, Optional } from '@nestjs/common';
import type {
  BookingChannel,
  BookingStatus,
  CancelType,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '@sporthub/shared/enums';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { nextCode } from '../core/codes.js';
import {
  type DbExecutor,
  DbTransactionService,
  type TxContext,
} from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import type { BookingAccessChecker } from '../core/realtime/realtime.types.js';
import { buildBookingSlotStarts, toDateKey } from '../core/time.js';
import { type BookingRow, encodeRowVer } from './bookings.mapper.js';
import { BookingsRepository } from './bookings.repository.js';

export interface ApplyPaymentInput {
  purpose: PaymentPurpose;
  method: PaymentMethod;
  channel: BookingChannel;
  amount: number;
  requestId?: number | null;
  bankTxnId?: number | null;
  collectedBy?: number | null;
  paidAt: Date;
  expectedVersion?: Buffer;
  historyNote: string;
  historyChangedBy?: number | null;
}

export interface ApplyPaymentResult {
  paymentCode: string;
  previousStatus: BookingStatus;
  nextStatus: BookingStatus;
  previousPaymentStatus: PaymentStatus;
  nextPaymentStatus: PaymentStatus;
  paidAmount: number;
  remainingAmount: number;
  version: string;
}

@Injectable()
export class BookingStateService implements BookingAccessChecker {
  constructor(
    private readonly repo: BookingsRepository,
    @Optional() private readonly txService?: DbTransactionService,
  ) {}

  async canAccessBooking(bookingCode: string, caller: AuthenticatedUser): Promise<boolean> {
    if (!this.txService) {
      return false;
    }
    try {
      const exec = await this.txService.executor();
      await this.getBookingForAccess(exec, bookingCode, caller);
      return true;
    } catch (err) {
      if (
        err instanceof AppError &&
        (err.code === 'NOT_FOUND' ||
          err.code === 'BOOKING_FORBIDDEN' ||
          err.code === 'BRANCH_FORBIDDEN' ||
          err.code === 'FORBIDDEN')
      ) {
        return false;
      }
      throw err;
    }
  }

  assertBookingAccess(booking: BookingRow, caller: AuthenticatedUser): void {
    if (caller.role === 'CUSTOMER') {
      const ownerId = booking.CustomerUserId !== null ? Number(booking.CustomerUserId) : null;
      if (ownerId !== caller.userId) {
        throw new AppError('BOOKING_FORBIDDEN');
      }
      return;
    }

    if (caller.role === 'STAFF') {
      if (caller.branchId === null || Number(booking.BranchId) !== caller.branchId) {
        throw new AppError('BRANCH_FORBIDDEN');
      }
      return;
    }

    if (caller.role === 'OWNER') {
      return;
    }

    throw new AppError('FORBIDDEN');
  }

  async getBookingForAccess(
    exec: DbExecutor,
    bookingCode: string,
    caller: AuthenticatedUser,
  ): Promise<BookingRow> {
    const booking = await this.repo.findByCode(exec, bookingCode);
    if (!booking) {
      throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
    }
    this.assertBookingAccess(booking, caller);
    return booking;
  }

  async lockBookingByCode(tx: TxContext, bookingCode: string): Promise<BookingRow | null> {
    return this.repo.findByCodeForUpdate(tx, bookingCode);
  }

  /**
   * Single authoritative writer for Bookings.PaidAmount, RemainingAmount, PaymentStatus, and CONFIRMED transition.
   */
  async applyPaymentInTx(
    tx: TxContext,
    booking: BookingRow,
    input: ApplyPaymentInput,
  ): Promise<ApplyPaymentResult> {
    const totalAmount = Number(booking.TotalAmount);
    const currentPaid = Number(booking.PaidAmount);
    const nextPaid = currentPaid + input.amount;

    // L-1 / Bất biến 6: Không nhận thanh toán một phần — phải khớp đúng AmountDueNow (đơn chờ) hoặc RemainingAmount (tất toán)
    if (input.amount <= 0 || nextPaid > totalAmount) {
      throw new AppError('AMOUNT_MISMATCH');
    }
    if (booking.Status === 'PENDING_PAYMENT') {
      const expectedDueNow = Number(booking.AmountDueNow);
      if (input.amount !== expectedDueNow) {
        throw new AppError('AMOUNT_MISMATCH');
      }
    } else if (booking.Status === 'CONFIRMED' && booking.PaymentStatus === 'DEPOSITED') {
      const expectedRemaining = Number(booking.RemainingAmount);
      if (input.amount !== expectedRemaining) {
        throw new AppError('AMOUNT_MISMATCH');
      }
    } else {
      throw new AppError('BOOKING_NOT_PAYABLE');
    }

    const nextRemaining = totalAmount - nextPaid;
    const nextPaymentStatus: PaymentStatus =
      nextRemaining === 0 ? 'PAID' : nextPaid > 0 ? 'DEPOSITED' : 'UNPAID';
    const nextStatus: BookingStatus =
      booking.Status === 'PENDING_PAYMENT' ? 'CONFIRMED' : booking.Status;
    const nextHoldExpireAt = null;

    const paymentCode = await nextCode(tx, 'PT', toDateKey(input.paidAt));

    await this.repo.insertPaymentRecord(tx, {
      paymentCode,
      bookingId: Number(booking.BookingId),
      purpose: input.purpose,
      method: input.method,
      channel: input.channel,
      amount: input.amount,
      requestId: input.requestId ?? null,
      bankTxnId: input.bankTxnId ?? null,
      collectedBy: input.collectedBy ?? null,
      paidAt: input.paidAt,
    });

    const newRowVer = await this.repo.updateBookingPaymentAndStatus(tx, {
      bookingId: Number(booking.BookingId),
      paidAmount: nextPaid,
      remainingAmount: nextRemaining,
      status: nextStatus,
      paymentStatus: nextPaymentStatus,
      holdExpireAt: nextHoldExpireAt,
      now: input.paidAt,
      expectedVersion: input.expectedVersion,
    });

    await this.repo.insertStatusHistory(tx, {
      bookingId: Number(booking.BookingId),
      fromStatus: booking.Status,
      toStatus: nextStatus,
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: nextPaymentStatus,
      changedBy: input.historyChangedBy ?? null,
      changedAt: input.paidAt,
      note: input.historyNote,
    });

    return {
      paymentCode,
      previousStatus: booking.Status,
      nextStatus,
      previousPaymentStatus: booking.PaymentStatus,
      nextPaymentStatus,
      paidAmount: nextPaid,
      remainingAmount: nextRemaining,
      version: encodeRowVer(newRowVer),
    };
  }

  /**
   * Transitions PENDING_PAYMENT -> EXPIRED, releases slots, restores promo UsedCount, and logs history.
   */
  async expireBookingInTx(tx: TxContext, booking: BookingRow, now: Date): Promise<Buffer | null> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingExpired(tx, bookingId, now);
    if (!newRowVer) {
      return null;
    }

    await this.repo.deactivateBookingSlots(tx, bookingId);
    if (booking.PromotionCode) {
      await this.repo.decrementPromotionUsedCount(tx, booking.PromotionCode, now);
    }

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'EXPIRED',
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: null,
      changedAt: now,
      note: 'Job expireHolds – hết hạn giữ chỗ',
    });

    return newRowVer;
  }

  /**
   * Transitions PENDING_PAYMENT / CONFIRMED -> CANCELED, releases slots, restores unpaid promo UsedCount, and logs history.
   */
  async cancelBookingInTx(
    tx: TxContext,
    booking: BookingRow,
    input: {
      expectedVersion: Buffer;
      cancelType: CancelType;
      cancelReason: string;
      canceledBy: number | null;
      canceledAt: Date;
      refundRate: number | null;
      refundAmount: number | null;
      historyNote: string;
      restorePromoIfUnpaid: boolean;
    },
  ): Promise<Buffer> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingCanceled(tx, {
      bookingId,
      expectedVersion: input.expectedVersion,
      cancelType: input.cancelType,
      cancelReason: input.cancelReason,
      canceledBy: input.canceledBy,
      canceledAt: input.canceledAt,
      refundRate: input.refundRate,
      refundAmount: input.refundAmount,
    });

    await this.repo.deactivateBookingSlots(tx, bookingId);

    if (input.restorePromoIfUnpaid && booking.PromotionCode) {
      await this.repo.decrementPromotionUsedCount(tx, booking.PromotionCode, input.canceledAt);
    }

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: booking.Status,
      toStatus: 'CANCELED',
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: input.canceledBy,
      changedAt: input.canceledAt,
      note: input.historyNote,
    });

    return newRowVer;
  }

  /**
   * Transitions CONFIRMED -> IN_USE and records BookingStatusHistory.
   */
  async checkInInTx(
    tx: TxContext,
    booking: BookingRow,
    input: { expectedVersion: Buffer; changedBy: number; now: Date },
  ): Promise<Buffer> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingCheckedIn(tx, {
      bookingId,
      expectedVersion: input.expectedVersion,
      now: input.now,
    });

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: 'CONFIRMED',
      toStatus: 'IN_USE',
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: input.changedBy,
      changedAt: input.now,
      note: 'Nhận sân',
    });

    return newRowVer;
  }

  /**
   * Transitions IN_USE -> COMPLETED (early complete at POS), releases future slots, and logs history.
   */
  async completeBookingInTx(
    tx: TxContext,
    booking: BookingRow,
    input: { expectedVersion: Buffer; changedBy: number; now: Date; historyNote: string },
  ): Promise<{ newRowVer: Buffer; freedSlotStarts: Date[] }> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingCompleted(tx, {
      bookingId,
      expectedVersion: input.expectedVersion,
      now: input.now,
    });

    const freedSlotStarts = await this.repo.deactivateFutureSlots(tx, bookingId, input.now);

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: 'IN_USE',
      toStatus: 'COMPLETED',
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: input.changedBy,
      changedAt: input.now,
      note: input.historyNote,
    });

    return { newRowVer, freedSlotStarts };
  }

  /**
   * Job transition: IN_USE -> COMPLETED at EndAt.
   */
  async autoCompleteInTx(tx: TxContext, booking: BookingRow, now: Date): Promise<Buffer | null> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingAutoCompleted(tx, bookingId, now);
    if (!newRowVer) {
      return null;
    }

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: 'IN_USE',
      toStatus: 'COMPLETED',
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: null,
      changedAt: now,
      note: 'Job autoComplete – tự hoàn thành khi hết giờ',
    });

    return newRowVer;
  }

  /**
   * Job transition: CONFIRMED -> CANCELED (NO_SHOW) for DEPOSITED or PAID (R-04).
   */
  async cancelNoShowInTx(
    tx: TxContext,
    booking: BookingRow,
    input: {
      paymentStatus: 'DEPOSITED' | 'PAID';
      cancelReason: string;
      historyNote: string;
      now: Date;
    },
  ): Promise<Buffer | null> {
    const bookingId = Number(booking.BookingId);
    const newRowVer = await this.repo.updateBookingNoShowCanceled(tx, {
      bookingId,
      paymentStatus: input.paymentStatus,
      cancelReason: input.cancelReason,
      now: input.now,
    });
    if (!newRowVer) {
      return null;
    }

    await this.repo.deactivateBookingSlots(tx, bookingId);
    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: 'CONFIRMED',
      toStatus: 'CANCELED',
      fromPaymentStatus: input.paymentStatus,
      toPaymentStatus: input.paymentStatus,
      changedBy: null,
      changedAt: input.now,
      note: input.historyNote,
    });

    return newRowVer;
  }

  async markReminderSentInTx(tx: TxContext, bookingId: number, now: Date): Promise<boolean> {
    return this.repo.markBookingReminderSent(tx, bookingId, now);
  }

  /**
   * Reassigns court/time window for an affected booking without changing price/payment.
   */
  async reassignScheduleInTx(
    tx: TxContext,
    booking: BookingRow,
    input: {
      expectedVersion: Buffer;
      newCourtId: number;
      newStartAt: Date;
      newEndAt: Date;
      gridBlockMinutes: number;
      changedBy: number;
      historyNote: string;
      now: Date;
    },
  ): Promise<Buffer> {
    const bookingId = Number(booking.BookingId);
    await this.repo.deactivateBookingSlots(tx, bookingId);
    const newSlotStarts = buildBookingSlotStarts(
      input.newStartAt,
      input.newEndAt,
      input.gridBlockMinutes,
    );
    await this.repo.insertBookingSlots(tx, bookingId, input.newCourtId, newSlotStarts);

    const newRowVer = await this.repo.updateBookingScheduleForTransfer(tx, {
      bookingId,
      expectedVersion: input.expectedVersion,
      newCourtId: input.newCourtId,
      newStartAt: input.newStartAt,
      newEndAt: input.newEndAt,
      now: input.now,
    });

    await this.repo.insertStatusHistory(tx, {
      bookingId,
      fromStatus: booking.Status,
      toStatus: booking.Status,
      fromPaymentStatus: booking.PaymentStatus,
      toPaymentStatus: booking.PaymentStatus,
      changedBy: input.changedBy,
      changedAt: input.now,
      note: input.historyNote,
    });

    return newRowVer;
  }
}
