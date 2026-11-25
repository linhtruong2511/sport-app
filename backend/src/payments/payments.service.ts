import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  BookingStatus,
  PaymentPurpose,
  PaymentRequestStatus,
  PaymentStatus,
  ReconciliationIssue,
} from '@sporthub/shared/enums';
import type { PaymentRequestDto } from '@sporthub/shared/types';
import { BookingStateService } from '../bookings/booking-state.service.js';
import { computeIsOverdue, encodeRowVer } from '../bookings/bookings.mapper.js';
import { BookingsRepository } from '../bookings/bookings.repository.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { isTransientDbError } from '../core/db/sql-errors.js';
import { DbTransactionService, type TxContext } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { AppLogger } from '../core/logger.js';
import { SettingsService } from '../core/settings.service.js';
import { addMinutes, formatDateVn, formatTimeVn, fromSqlDateTime, toIsoVn } from '../core/time.js';
import {
  BANK_GATEWAY,
  type BankGateway,
  type SepayIncomingTxn,
} from '../integrations/sepay/bank-gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { type PaymentRequestRow, PaymentsRepository } from './payments.repository.js';
import type { CreatePaymentRequestDto, SepayWebhookDto } from './payments.schemas.js';
import { verifySepayApiKeyHeader } from './sepay-webhook-auth.guard.js';
import { buildVietQrPayload } from './vietqr.js';

export interface CreatePaymentRequestInTxInput {
  bookingId: number;
  bookingCode: string;
  branchId: number;
  purpose: PaymentPurpose;
  amount: number;
  expiresAt: Date;
  createdBy: number | null;
}

export interface RecheckPaymentRequestResult {
  requestId: number;
  status: PaymentRequestStatus;
  message: string;
  booking?: {
    bookingCode: string;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    paidAmount: number;
    remainingAmount: number;
    version: string;
  };
}

function formatVnd(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function mapPaymentRequestRowToDto(row: PaymentRequestRow): PaymentRequestDto {
  return {
    requestId: Number(row.RequestId),
    bookingCode: row.BookingCode,
    purpose: row.Purpose,
    amount: Number(row.Amount),
    transferContent: row.TransferContent,
    qrPayload: row.QrPayload,
    expiresAt: toIsoVn(fromSqlDateTime(row.ExpiresAt)),
    status: row.Status,
    bank: {
      bin: row.BankBin ?? '',
      bankName: row.BankName ?? '',
      accountNo: row.BankAccountNo ?? '',
      accountName: row.BankAccountName ?? '',
    },
  };
}

function ensureValidJsonString(raw: string | undefined, fallbackObj: unknown): string {
  if (raw && raw.trim().length > 0) {
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      // Fall through to serialize parsed payload so CK_BankTransactions_RawPayload is always satisfied.
    }
  }
  return JSON.stringify(fallbackObj);
}

@Injectable()
export class PaymentsService {
  private readonly recheckLastCallMs = new Map<string, number>();

  constructor(
    private readonly txService: DbTransactionService,
    private readonly repo: PaymentsRepository,
    private readonly bookingState: BookingStateService,
    private readonly bookingsRepo: BookingsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly settingsService: SettingsService,
    @Inject(BANK_GATEWAY) private readonly bankGateway: BankGateway,
    @Inject(CLOCK) private readonly clock: Clock,
    @Optional() private readonly logger?: AppLogger,
  ) {}

  async createPaymentRequestInTx(
    tx: TxContext,
    input: CreatePaymentRequestInTxInput,
  ): Promise<PaymentRequestDto> {
    const bank = await this.repo.getBranchBankInfo(tx, input.branchId);
    const bankBin = bank?.BankBin?.trim() ?? '';
    const bankName = bank?.BankName?.trim() ?? '';
    const accountNo = bank?.BankAccountNo?.trim() ?? '';
    const accountName = bank?.BankAccountName?.trim() ?? '';

    if (!bankBin || !bankName || !accountNo || !accountName) {
      throw new AppError('BRANCH_BANK_NOT_CONFIGURED');
    }

    if (input.amount <= 0) {
      throw new AppError('NOTHING_TO_PAY');
    }

    // SDD 5.5 API-16: expire any existing PENDING request before inserting (UX_PaymentRequest_Booking_Pending)
    await this.repo.expirePendingRequestsByBookingId(tx, input.bookingId);

    const now = this.clock.now();
    const transferContent = `THANHTOAN ${input.bookingCode}`;
    const qrPayload = buildVietQrPayload({
      bankBin,
      accountNo,
      amount: input.amount,
      transferContent,
    });

    const requestId = await this.repo.insertPaymentRequest(tx, {
      bookingId: input.bookingId,
      purpose: input.purpose,
      amount: input.amount,
      transferContent,
      qrPayload,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
      createdAt: now,
    });

    return {
      requestId,
      bookingCode: input.bookingCode,
      purpose: input.purpose,
      amount: input.amount,
      transferContent,
      qrPayload,
      expiresAt: toIsoVn(input.expiresAt),
      status: 'PENDING',
      bank: {
        bin: bankBin,
        bankName,
        accountNo,
        accountName,
      },
    };
  }

  async cancelPendingRequestsInTx(tx: TxContext, bookingId: number): Promise<void> {
    await this.repo.cancelPendingRequestsByBookingId(tx, bookingId);
  }

  async expirePendingRequestsInTx(tx: TxContext, bookingId: number): Promise<void> {
    await this.repo.expirePendingRequestsByBookingId(tx, bookingId);
  }

  /**
   * API-15: Active PENDING payment request for a booking.
   */
  async getActivePaymentRequest(
    bookingCode: string,
    caller: AuthenticatedUser,
  ): Promise<PaymentRequestDto> {
    const exec = await this.txService.executor();
    const booking = await this.bookingState.getBookingForAccess(exec, bookingCode, caller);
    const pending = await this.repo.findPendingRequestByBookingId(exec, Number(booking.BookingId));
    if (!pending) {
      throw new AppError('NOT_FOUND', {
        message: 'Không có yêu cầu thanh toán QR đang hiệu lực.',
      });
    }
    return mapPaymentRequestRowToDto(pending);
  }

  /**
   * API-16: Create or regenerate VietQR payment request.
   */
  async createOrRegeneratePaymentRequest(
    bookingCode: string,
    dto: CreatePaymentRequestDto,
    caller: AuthenticatedUser,
  ): Promise<PaymentRequestDto> {
    const qrExpireMinutes = await this.settingsService.getInt('QR_EXPIRE_MINUTES');
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const booking = await this.bookingState.lockBookingByCode(tx, bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', { message: 'Không tìm thấy đơn đặt sân.' });
      }
      this.bookingState.assertBookingAccess(booking, caller);

      if (
        booking.Status === 'COMPLETED' ||
        booking.Status === 'CANCELED' ||
        booking.Status === 'EXPIRED'
      ) {
        throw new AppError('BOOKING_NOT_PAYABLE');
      }

      const remainingAmount = Number(booking.RemainingAmount);
      if (remainingAmount <= 0) {
        throw new AppError('NOTHING_TO_PAY');
      }

      if (booking.Status === 'IN_USE') {
        throw new AppError('BOOKING_NOT_PAYABLE');
      }

      let purpose: PaymentPurpose;
      let amount: number;
      let expiresAt: Date;

      if (booking.Status === 'PENDING_PAYMENT') {
        const holdExpireAt =
          booking.HoldExpireAt !== null ? fromSqlDateTime(booking.HoldExpireAt) : null;
        if (holdExpireAt && now.getTime() > holdExpireAt.getTime()) {
          throw new AppError('HOLD_EXPIRED');
        }

        purpose = booking.PaymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL';
        if (dto.purpose && dto.purpose !== purpose) {
          throw new AppError('VALIDATION_ERROR', {
            message: 'Mục đích thanh toán không phù hợp với trạng thái đơn.',
          });
        }
        amount = Number(booking.AmountDueNow);

        const candidateExpiry = addMinutes(now, qrExpireMinutes);
        if (booking.Channel === 'ONLINE' && holdExpireAt) {
          expiresAt = holdExpireAt;
        } else if (holdExpireAt && holdExpireAt.getTime() < candidateExpiry.getTime()) {
          expiresAt = holdExpireAt;
        } else {
          expiresAt = candidateExpiry;
        }
      } else if (booking.Status === 'CONFIRMED') {
        purpose = 'REMAINING';
        if (dto.purpose && dto.purpose !== purpose) {
          throw new AppError('VALIDATION_ERROR', {
            message: 'Mục đích thanh toán không phù hợp với trạng thái đơn.',
          });
        }
        amount = remainingAmount;
        expiresAt = addMinutes(now, qrExpireMinutes);
      } else {
        throw new AppError('BOOKING_NOT_PAYABLE');
      }

      return this.createPaymentRequestInTx(tx, {
        bookingId: Number(booking.BookingId),
        bookingCode: booking.BookingCode,
        branchId: Number(booking.BranchId),
        purpose,
        amount,
        expiresAt,
        createdBy: caller.userId,
      });
    });
  }

  /**
   * SDD 5.6: SePay Webhook handler.
   */
  async handleSepayWebhook(
    _provider: 'sepay',
    authHeader: string | undefined,
    rawBody: string | undefined,
    parsedBody: SepayWebhookDto,
  ): Promise<{ success: true }> {
    verifySepayApiKeyHeader(authHeader);

    const rawPayloadStr = ensureValidJsonString(rawBody, parsedBody);
    await this.processIncomingBankTransaction('SEPAY', parsedBody, rawPayloadStr);
    return { success: true };
  }

  /**
   * Shared bank transaction ingestion & matching pipeline (SDD 5.6, UC 005, UC 012, API-17).
   * C-4 / Bất biến 9: Tx 1 commits BankTransactions first so matching errors never lose the raw txn.
   */
  async processIncomingBankTransaction(
    provider: string,
    payload: SepayIncomingTxn | SepayWebhookDto,
    rawPayloadStr: string,
  ): Promise<{ duplicated: boolean; matched: boolean }> {
    const now = this.clock.now();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');

    let transactionAt = now;
    if (payload.transactionDate) {
      try {
        transactionAt = fromSqlDateTime(payload.transactionDate);
      } catch {
        transactionAt = now;
      }
    }

    const safeRawPayload = ensureValidJsonString(rawPayloadStr, payload);

    // Transaction 1: Persist BankTransactions first; duplicate (Provider, ProviderTxnId) -> idempotent 200.
    const insertRes = await this.txService.withTransaction((tx) =>
      this.repo.insertBankTransaction(tx, {
        provider,
        providerTxnId: String(payload.id),
        accountNo: payload.accountNumber,
        amount: Math.round(payload.transferAmount),
        content: payload.content ?? null,
        transactionAt,
        rawPayload: safeRawPayload,
        receivedAt: now,
      }),
    );

    let bankTxnId: number;
    if (insertRes.duplicated || insertRes.bankTxnId === null) {
      // Retry of a delivery whose matching step never finished (crash / transient DB error → 5xx):
      // resume matching while the txn is still PENDING; any other status means it was already handled.
      const exec = await this.txService.executor();
      const existing = await this.repo.findBankTransactionByProviderTxn(
        exec,
        provider,
        String(payload.id),
      );
      if (!existing || existing.matchStatus !== 'PENDING') {
        return { duplicated: true, matched: false };
      }
      bankTxnId = existing.bankTxnId;
    } else {
      bankTxnId = insertRes.bankTxnId;
    }

    const pushNeedsReviewEvent = (
      tx: TxContext,
      issue: ReconciliationIssue,
      eventBranchId: number | null,
      bookingCodeForEvent: string | null,
    ) => {
      if (eventBranchId !== null) {
        tx.events.push({
          rooms: [`branch:${eventBranchId}`],
          event: 'reconciliation.created',
          payload: {
            bankTxnId,
            issue,
            amount: payload.transferAmount,
            bookingCode: bookingCodeForEvent,
          },
        });
      }
    };

    try {
      // Transaction 2: Match and apply payment (or classify as IGNORED / NEEDS_REVIEW).
      return await this.txService.withTransaction(async (tx) => {
        // Serialize concurrent deliveries of the same txn: only one may leave PENDING.
        if (!(await this.repo.lockPendingBankTransaction(tx, bankTxnId))) {
          return { duplicated: true, matched: false };
        }

        if (payload.transferType.toLowerCase() === 'out') {
          await this.repo.updateBankTransactionStatus(tx, bankTxnId, {
            matchStatus: 'IGNORED',
            matchedBookingId: null,
          });
          return { duplicated: false, matched: false };
        }

        const markNeedsReview = async (
          issue: ReconciliationIssue,
          matchedBookingId: number | null,
          eventBranchId: number | null,
          bookingCodeForEvent: string | null,
        ) => {
          await this.repo.updateBankTransactionStatus(tx, bankTxnId, {
            matchStatus: 'NEEDS_REVIEW',
            matchedBookingId,
          });
          pushNeedsReviewEvent(tx, issue, eventBranchId, bookingCodeForEvent);
          return { duplicated: false, matched: false };
        };

        const normalizedContent = (payload.content ?? '').replace(/\s+/g, '').toUpperCase();
        const codeMatch = /BK\d{10,}/.exec(normalizedContent);
        const matchedCode = codeMatch && codeMatch[0].length <= 20 ? codeMatch[0] : null;

        const branchByAccount = await this.repo.findBranchByBankAccountNo(tx, payload.accountNumber);
        const fallbackBranchId = branchByAccount ? Number(branchByAccount.BranchId) : null;

        if (!matchedCode) {
          return markNeedsReview('UNKNOWN_CONTENT', null, fallbackBranchId, null);
        }

        const booking = await this.bookingState.lockBookingByCode(tx, matchedCode);
        if (!booking) {
          return markNeedsReview('UNKNOWN_CONTENT', null, fallbackBranchId, null);
        }

        const bookingId = Number(booking.BookingId);
        const bookingBranchId = Number(booking.BranchId);
        const bookingBranchBank = await this.repo.getBranchBankInfo(tx, bookingBranchId);

        if (
          !bookingBranchBank?.BankAccountNo ||
          bookingBranchBank.BankAccountNo !== payload.accountNumber
        ) {
          return markNeedsReview('ACCOUNT_MISMATCH', bookingId, bookingBranchId, booking.BookingCode);
        }

        let purpose: PaymentPurpose;
        let historyNote: string;

        if (booking.Status === 'PENDING_PAYMENT') {
          const holdExpireAt =
            booking.HoldExpireAt !== null ? fromSqlDateTime(booking.HoldExpireAt) : null;
          if (holdExpireAt && now.getTime() > holdExpireAt.getTime()) {
            return markNeedsReview('LATE_PAYMENT', bookingId, bookingBranchId, booking.BookingCode);
          }
          if (payload.transferAmount !== Number(booking.AmountDueNow)) {
            return markNeedsReview('WRONG_AMOUNT', bookingId, bookingBranchId, booking.BookingCode);
          }
          purpose = booking.PaymentOption === 'DEPOSIT' ? 'DEPOSIT' : 'FULL';
          historyNote =
            purpose === 'DEPOSIT'
              ? 'Webhook SEPAY – nhận tiền cọc'
              : 'Webhook SEPAY – khớp giao dịch';
        } else if (booking.Status === 'CONFIRMED' && booking.PaymentStatus === 'DEPOSITED') {
          if (payload.transferAmount !== Number(booking.RemainingAmount)) {
            return markNeedsReview('WRONG_AMOUNT', bookingId, bookingBranchId, booking.BookingCode);
          }
          purpose = 'REMAINING';
          historyNote = 'Webhook SEPAY – khớp giao dịch tất toán';
        } else if (booking.Status === 'EXPIRED' || booking.Status === 'CANCELED') {
          return markNeedsReview('LATE_PAYMENT', bookingId, bookingBranchId, booking.BookingCode);
        } else {
          return markNeedsReview('WRONG_AMOUNT', bookingId, bookingBranchId, booking.BookingCode);
        }

        const pendingReq = await this.repo.findPendingRequestByBookingId(tx, bookingId);
        if (pendingReq) {
          await this.repo.markRequestPaid(tx, Number(pendingReq.RequestId));
        }

        const paymentResult = await this.bookingState.applyPaymentInTx(tx, booking, {
          purpose,
          method: 'BANK_TRANSFER',
          channel: booking.Channel,
          amount: payload.transferAmount,
          requestId: pendingReq ? Number(pendingReq.RequestId) : null,
          bankTxnId,
          collectedBy: null,
          paidAt: now,
          historyNote,
        });

        await this.repo.updateBankTransactionStatus(tx, bankTxnId, {
          matchStatus: 'MATCHED',
          matchedBookingId: bookingId,
        });

        const customerUserId =
          booking.CustomerUserId !== null ? Number(booking.CustomerUserId) : null;

        if (customerUserId !== null) {
          const formattedAmount = formatVnd(payload.transferAmount);
          const title =
            purpose === 'DEPOSIT'
              ? 'Đã nhận tiền cọc đặt sân'
              : purpose === 'REMAINING'
                ? 'Thanh toán phần còn lại thành công'
                : 'Thanh toán đặt sân thành công';
          const body =
            purpose === 'DEPOSIT'
              ? `Đơn ${booking.BookingCode} đã được xác nhận đặt cọc ${formattedAmount}đ.`
              : purpose === 'REMAINING'
                ? `Đơn ${booking.BookingCode} đã tất toán ${formattedAmount}đ.`
                : `Đơn ${booking.BookingCode} đã được xác nhận thanh toán đủ ${formattedAmount}đ.`;

          await this.notificationsService.createNotificationInTx(tx, {
            userId: customerUserId,
            type: 'PAYMENT_RESULT',
            title,
            body,
            linkType: 'BOOKING',
            linkRef: String(bookingId),
            bookingCode: booking.BookingCode,
          });
        }

        const targetRooms = [
          `booking:${booking.BookingCode}`,
          `branch:${bookingBranchId}`,
          ...(customerUserId !== null ? [`user:${customerUserId}`] : []),
        ];

        tx.events.push({
          rooms: targetRooms,
          event: 'booking.paid',
          payload: {
            bookingCode: booking.BookingCode,
            paymentCode: paymentResult.paymentCode,
            purpose,
            method: 'BANK_TRANSFER',
            amount: payload.transferAmount,
            status: paymentResult.nextStatus,
            paymentStatus: paymentResult.nextPaymentStatus,
          },
        });

        const startAtDate = fromSqlDateTime(booking.StartAt);
        const endAtDate = fromSqlDateTime(booking.EndAt);
        const isOverdue = computeIsOverdue(
          paymentResult.nextStatus,
          booking.CheckedInAt !== null ? fromSqlDateTime(booking.CheckedInAt) : null,
          startAtDate,
          now,
          noShowGraceMinutes,
        );

        tx.events.push({
          rooms: targetRooms,
          event: 'booking.updated',
          payload: {
            bookingCode: booking.BookingCode,
            status: paymentResult.nextStatus,
            paymentStatus: paymentResult.nextPaymentStatus,
            paidAmount: paymentResult.paidAmount,
            remainingAmount: paymentResult.remainingAmount,
            isOverdue,
            version: paymentResult.version,
          },
        });

        if (
          paymentResult.previousStatus === 'PENDING_PAYMENT' &&
          paymentResult.nextStatus === 'CONFIRMED'
        ) {
          const slotDate = formatDateVn(startAtDate);
          tx.events.push({
            rooms: [`availability:${bookingBranchId}:${slotDate}`, `branch:${bookingBranchId}`],
            event: 'slot.updated',
            payload: {
              branchId: bookingBranchId,
              courtId: Number(booking.CourtId),
              date: slotDate,
              startTime: formatTimeVn(startAtDate),
              endTime: formatTimeVn(endAtDate),
              state: 'BOOKED',
            },
          });
        }

        return { duplicated: false, matched: true };
      });
    } catch (err) {
      // Transient DB failures (deadlock after retries, timeout, lost connection): keep the txn PENDING and
      // return 5xx so SePay redelivers and matching is resumed, instead of forcing a manual review.
      if (isTransientDbError(err)) {
        this.logger?.error('Bank transaction matching hit a transient DB error; leaving PENDING for retry', {
          context: 'PaymentsService',
          bankTxnId,
          error: err,
        });
        throw err;
      }

      this.logger?.error('Bank transaction matching failed; routing to NEEDS_REVIEW', {
        context: 'PaymentsService',
        bankTxnId,
        error: err,
      });

      await this.txService.withTransaction(async (tx) => {
        const branchByAccount = await this.repo.findBranchByBankAccountNo(tx, payload.accountNumber);
        const fallbackBranchId = branchByAccount ? Number(branchByAccount.BranchId) : null;
        await this.repo.updateBankTransactionStatus(tx, bankTxnId, {
          matchStatus: 'NEEDS_REVIEW',
          matchedBookingId: null,
        });
        pushNeedsReviewEvent(tx, 'UNKNOWN_CONTENT', fallbackBranchId, null);
      });

      return { duplicated: false, matched: false };
    }
  }

  /**
   * API-17: Fallback recheck against SePay API (rate limited 1 req / 5s per bookingCode).
   */
  async recheckPaymentRequest(
    requestId: number,
    caller: AuthenticatedUser,
  ): Promise<RecheckPaymentRequestResult> {
    const exec = await this.txService.executor();
    const reqRow = await this.repo.findRequestById(exec, requestId);
    if (!reqRow) {
      throw new AppError('NOT_FOUND', { message: 'Không tìm thấy yêu cầu thanh toán.' });
    }

    const booking = await this.bookingState.getBookingForAccess(exec, reqRow.BookingCode, caller);

    const nowMs = this.clock.now().getTime();
    const lastMs = this.recheckLastCallMs.get(reqRow.BookingCode);
    if (lastMs !== undefined && nowMs - lastMs < 5_000) {
      const retryAfterSeconds = Math.max(1, Math.ceil((5_000 - (nowMs - lastMs)) / 1_000));
      throw new AppError('TOO_MANY_REQUESTS', {
        details: { retryAfterSeconds },
      });
    }
    this.recheckLastCallMs.set(reqRow.BookingCode, nowMs);

    if (reqRow.Status === 'PAID') {
      return this.buildPaidRecheckResult(reqRow.RequestId, reqRow.Amount, booking);
    }

    const accountNumber = reqRow.BankAccountNo?.trim() ?? '';
    if (!accountNumber) {
      throw new AppError('BRANCH_BANK_NOT_CONFIGURED');
    }

    let transactions: SepayIncomingTxn[];
    try {
      transactions = await this.bankGateway.findTransactions({ accountNumber });
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError('PAYMENT_GATEWAY_ERROR', { cause: err });
    }

    for (const txn of transactions) {
      await this.processIncomingBankTransaction('SEPAY', txn, JSON.stringify(txn));
    }

    const refreshedReq = await this.repo.findRequestById(exec, requestId);
    if (refreshedReq && refreshedReq.Status === 'PAID') {
      const refreshedBooking = await this.bookingsRepo.findByCode(exec, reqRow.BookingCode);
      if (refreshedBooking) {
        return this.buildPaidRecheckResult(
          refreshedReq.RequestId,
          refreshedReq.Amount,
          refreshedBooking,
        );
      }
    }

    return {
      requestId: Number(refreshedReq?.RequestId ?? reqRow.RequestId),
      status: refreshedReq?.Status ?? reqRow.Status,
      message: 'Chưa nhận được giao dịch báo có. Vui lòng kiểm tra lại sau ít giây.',
    };
  }

  private buildPaidRecheckResult(
    requestId: number | string,
    amount: number | string,
    booking: {
      BookingCode: string;
      Status: BookingStatus;
      PaymentStatus: PaymentStatus;
      PaidAmount: number | string;
      RemainingAmount: number | string;
      RowVer: Buffer;
    },
  ): RecheckPaymentRequestResult {
    return {
      requestId: Number(requestId),
      status: 'PAID',
      message: `Đã nhận giao dịch ${formatVnd(Number(amount))} VNĐ đúng số tiền & nội dung.`,
      booking: {
        bookingCode: booking.BookingCode,
        status: booking.Status,
        paymentStatus: booking.PaymentStatus,
        paidAmount: Number(booking.PaidAmount),
        remainingAmount: Number(booking.RemainingAmount),
        version: encodeRowVer(booking.RowVer),
      },
    };
  }

  /**
   * Background job helper (`expireQr`): marks expired PENDING QR requests and emits socket events.
   */
  async expirePendingQrRequests(limit = 200): Promise<number> {
    const now = this.clock.now();
    const exec = await this.txService.executor();
    const expired = await this.repo.findExpiredPendingRequests(exec, now, limit);

    let count = 0;
    for (const row of expired) {
      const requestId = Number(row.RequestId);
      try {
        const updated = await this.txService.withTransaction(async (tx) => {
          const affected = await this.repo.markRequestExpiredById(tx, requestId);
          if (!affected) {
            return false;
          }
          tx.events.push({
            rooms: [`booking:${row.BookingCode}`],
            event: 'payment_request.expired',
            payload: {
              requestId,
              bookingCode: row.BookingCode,
            },
          });
          return true;
        });

        if (updated) {
          count += 1;
        }
      } catch (err) {
        this.logger?.error('expirePendingQrRequests item failed', {
          context: 'PaymentsService',
          requestId,
          bookingCode: row.BookingCode,
          error: err,
        });
      }
    }

    return count;
  }
}
