import { Injectable } from '@nestjs/common';
import type {
  BookingChannel,
  BookingStatus,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
} from '@sporthub/shared/enums';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { nextCode } from '../core/codes.js';
import { type DbExecutor, type TxContext } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { toDateKey } from '../core/time.js';
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
export class BookingStateService {
  constructor(private readonly repo: BookingsRepository) {}

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

    if (input.amount <= 0 || nextPaid > totalAmount) {
      throw new AppError('AMOUNT_MISMATCH');
    }

    const nextRemaining = totalAmount - nextPaid;
    const nextPaymentStatus: PaymentStatus =
      nextRemaining === 0 ? 'PAID' : nextPaid > 0 ? 'DEPOSITED' : 'UNPAID';
    const nextStatus: BookingStatus =
      booking.Status === 'PENDING_PAYMENT' ? 'CONFIRMED' : booking.Status;
    const nextHoldExpireAt = nextStatus === 'CONFIRMED' ? null : null;

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
}
