import { Inject, Injectable } from '@nestjs/common';
import type {
  BankMatchStatus,
  BookingStatus,
  CancelType,
  PaymentPurpose,
  PaymentStatus,
  ReconciliationIssue,
  RefundStatus,
} from '@sporthub/shared/enums';
import { BookingStateService } from '../bookings/booking-state.service.js';
import { computeIsOverdue } from '../bookings/bookings.mapper.js';
import { AuditService } from '../core/audit/audit.service.js';
import type { AuthenticatedUser } from '../core/auth/auth.types.js';
import { CLOCK, type Clock } from '../core/clock.js';
import { DbTransactionService } from '../core/db/transaction.js';
import { AppError } from '../core/errors.js';
import { SettingsService } from '../core/settings.service.js';
import { formatDateVn, formatTimeVn, fromSqlDateTime, toIsoVn } from '../core/time.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  type BankTransactionRow,
  type ParsedBookingLookupRow,
  ReconciliationRepository,
} from './reconciliation.repository.js';
import type {
  CompleteRefundDto,
  FailRefundDto,
  IgnoreBankTransactionDto,
  ListBankTransactionsQuery,
  ListCandidatesQuery,
  ListRefundsQuery,
  MatchBankTransactionDto,
  RefundToCustomerDto,
} from './reconciliation.schemas.js';

export interface ReconciliationItemDto {
  bankTxnId: number;
  provider: string;
  providerTxnId: string;
  bankName: string | null;
  accountNo: string;
  branchId: number | null;
  branchName: string | null;
  branch: { branchId: number; name: string } | null;
  amount: number;
  content: string | null;
  parsedBookingCode: string | null;
  transactionAt: string;
  receivedAt: string;
  matchStatus: BankMatchStatus;
  issue: ReconciliationIssue | null;
  expectedAmount: number | null;
  matchedBooking: {
    bookingCode: string;
    status: BookingStatus;
    paymentStatus: PaymentStatus;
    customerName: string;
  } | null;
  resolution: {
    action: 'MATCHED' | 'REFUNDED' | 'IGNORED';
    note: string | null;
    resolvedByName: string | null;
    resolvedAt: string | null;
  } | null;
}

export interface ReconciliationCandidateDto {
  bookingCode: string;
  customerName: string;
  customerPhone: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  amountDue: number;
  amountMatches: boolean;
  startAt: string;
  courtName: string;
}

export interface RefundItemDto {
  refundId: number;
  bookingCode: string;
  branchId: number;
  branchName: string;
  courtId: number;
  courtName: string;
  customerName: string;
  customerPhone: string;
  amount: number;
  rate: number;
  cancelType: CancelType | null;
  reason: string | null;
  status: RefundStatus;
  createdAt: string;
  processedAt: string | null;
  processedByName: string | null;
  note: string | null;
}

function parseBookingCodeFromContent(content: string | null): string | null {
  if (!content) {
    return null;
  }
  const normalized = content.replace(/\s+/g, '').toUpperCase();
  const match = /BK\d{10,}/.exec(normalized);
  return match && match[0].length <= 20 ? match[0] : null;
}

function formatVnd(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function computeBookingExpectedAmount(booking: {
  Status: BookingStatus;
  PaymentStatus: PaymentStatus;
  AmountDueNow: number | string;
  RemainingAmount: number | string;
}): number {
  if (booking.Status === 'CONFIRMED' && booking.PaymentStatus === 'DEPOSITED') {
    return Number(booking.RemainingAmount);
  }
  if (
    booking.Status === 'PENDING_PAYMENT' ||
    booking.Status === 'EXPIRED' ||
    booking.PaymentStatus === 'UNPAID'
  ) {
    return Number(booking.AmountDueNow);
  }
  return Number(booking.RemainingAmount);
}

function deriveIssue(
  row: BankTransactionRow,
  booking: {
    BranchId: number;
    Status: BookingStatus;
    PaymentStatus: PaymentStatus;
    HoldExpireAt: Date | string | null;
  } | null,
): ReconciliationIssue | null {
  if (row.MatchStatus !== 'NEEDS_REVIEW') {
    return null;
  }
  if (!booking) {
    return 'UNKNOWN_CONTENT';
  }
  if (row.BranchId === null || Number(booking.BranchId) !== Number(row.BranchId)) {
    return 'ACCOUNT_MISMATCH';
  }
  if (booking.Status === 'EXPIRED' || booking.Status === 'CANCELED') {
    return 'LATE_PAYMENT';
  }
  if (booking.Status === 'PENDING_PAYMENT' && booking.HoldExpireAt !== null) {
    const holdExpireMs = fromSqlDateTime(booking.HoldExpireAt).getTime();
    const receivedMs = fromSqlDateTime(row.ReceivedAt).getTime();
    const txnMs = fromSqlDateTime(row.TransactionAt).getTime();
    if (receivedMs > holdExpireMs || txnMs > holdExpireMs) {
      return 'LATE_PAYMENT';
    }
  }
  return 'WRONG_AMOUNT';
}

function assertDateRangeValid(from?: string, to?: string): void {
  if (from && to && from > to) {
    throw new AppError('INVALID_DATE_RANGE');
  }
}

function assertTxnBranchScope(
  caller: AuthenticatedUser,
  txnBranchId: number | null,
): void {
  if (caller.role === 'STAFF') {
    if (caller.branchId === null || txnBranchId === null || txnBranchId !== caller.branchId) {
      throw new AppError('BRANCH_FORBIDDEN');
    }
  }
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly repo: ReconciliationRepository,
    private readonly bookingState: BookingStateService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
    private readonly settingsService: SettingsService,
    private readonly txService: DbTransactionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * API-67: List bank transactions for reconciliation.
   */
  async listTransactions(
    query: ListBankTransactionsQuery,
    scopedBranchId: number | null | undefined,
    caller: AuthenticatedUser,
  ): Promise<{
    items: ReconciliationItemDto[];
    totalItems: number;
    countByStatus: Record<BankMatchStatus, number>;
  }> {
    assertDateRangeValid(query.from, query.to);

    const effectiveBranchId =
      caller.role === 'STAFF'
        ? caller.branchId
        : (scopedBranchId ?? query.branchId ?? null);

    if (caller.role === 'STAFF' && effectiveBranchId === null) {
      throw new AppError('BRANCH_FORBIDDEN');
    }

    const exec = await this.txService.executor();
    const { rows, totalItems, countByStatus } = await this.repo.listBankTransactions(exec, {
      branchId: effectiveBranchId,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });

    const parsedCodesByTxnId = new Map<number, string | null>();
    const missingCodes = new Set<string>();
    for (const row of rows) {
      const bankTxnId = Number(row.BankTxnId);
      const parsedCode = parseBookingCodeFromContent(row.Content);
      parsedCodesByTxnId.set(bankTxnId, parsedCode);
      if (row.MatchedBookingId === null && parsedCode !== null) {
        missingCodes.add(parsedCode);
      }
    }

    const fallbackBookings: Map<string, ParsedBookingLookupRow> =
      missingCodes.size > 0
        ? await this.repo.findBookingsByCodes(exec, [...missingCodes])
        : new Map();

    const items: ReconciliationItemDto[] = rows.map((row) => {
      const bankTxnId = Number(row.BankTxnId);
      const parsedBookingCode = parsedCodesByTxnId.get(bankTxnId) ?? null;

      const resolvedBooking =
        row.MatchedBookingId !== null && row.MatchedBookingCode !== null && row.MatchedBookingStatus !== null
          ? {
              bookingCode: row.MatchedBookingCode,
              BranchId: Number(row.MatchedBookingBranchId),
              Status: row.MatchedBookingStatus,
              PaymentStatus: row.MatchedBookingPaymentStatus ?? ('UNPAID' as PaymentStatus),
              AmountDueNow: row.MatchedBookingAmountDueNow ?? 0,
              RemainingAmount: row.MatchedBookingRemainingAmount ?? 0,
              HoldExpireAt: row.MatchedBookingHoldExpireAt,
              customerName: row.MatchedBookingCustomerName ?? '',
            }
          : parsedBookingCode !== null
            ? (() => {
                const found = fallbackBookings.get(parsedBookingCode);
                if (!found) return null;
                return {
                  bookingCode: found.BookingCode,
                  BranchId: Number(found.BranchId),
                  Status: found.Status,
                  PaymentStatus: found.PaymentStatus,
                  AmountDueNow: found.AmountDueNow,
                  RemainingAmount: found.RemainingAmount,
                  HoldExpireAt: found.HoldExpireAt,
                  customerName: found.CustomerName,
                };
              })()
            : null;

      const issue = deriveIssue(row, resolvedBooking);
      const expectedAmount = resolvedBooking ? computeBookingExpectedAmount(resolvedBooking) : null;

      let resolution: ReconciliationItemDto['resolution'] = null;
      if (row.MatchStatus === 'IGNORED') {
        resolution = {
          action: 'IGNORED',
          note: row.ResolveNote,
          resolvedByName: row.ResolvedByName,
          resolvedAt: row.ResolvedAt !== null ? toIsoVn(fromSqlDateTime(row.ResolvedAt)) : null,
        };
      } else if (row.MatchStatus === 'RESOLVED') {
        resolution = {
          action: row.PaymentId !== null ? 'MATCHED' : 'REFUNDED',
          note: row.ResolveNote,
          resolvedByName: row.ResolvedByName,
          resolvedAt: row.ResolvedAt !== null ? toIsoVn(fromSqlDateTime(row.ResolvedAt)) : null,
        };
      }

      return {
        bankTxnId,
        provider: row.Provider,
        providerTxnId: row.ProviderTxnId,
        bankName: row.BankName,
        accountNo: row.AccountNo,
        branchId: row.BranchId,
        branchName: row.BranchName,
        branch:
          row.BranchId !== null && row.BranchName !== null
            ? { branchId: row.BranchId, name: row.BranchName }
            : null,
        amount: Number(row.Amount),
        content: row.Content,
        parsedBookingCode,
        transactionAt: toIsoVn(fromSqlDateTime(row.TransactionAt)),
        receivedAt: toIsoVn(fromSqlDateTime(row.ReceivedAt)),
        matchStatus: row.MatchStatus,
        issue,
        expectedAmount,
        matchedBooking: resolvedBooking
          ? {
              bookingCode: resolvedBooking.bookingCode,
              status: resolvedBooking.Status,
              paymentStatus: resolvedBooking.PaymentStatus,
              customerName: resolvedBooking.customerName,
            }
          : null,
        resolution,
      };
    });

    return {
      items,
      totalItems,
      countByStatus,
    };
  }

  /**
   * API-68: List candidate bookings in the transaction's branch that can receive payment.
   */
  async listCandidates(
    bankTxnId: number,
    query: ListCandidatesQuery,
    caller: AuthenticatedUser,
  ): Promise<ReconciliationCandidateDto[]> {
    const exec = await this.txService.executor();
    const txn = await this.repo.findBankTxnById(exec, bankTxnId);
    if (!txn) {
      throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch ngân hàng.');
    }

    assertTxnBranchScope(caller, txn.BranchId);

    if (txn.BranchId === null) {
      return [];
    }

    const txnAmount = Number(txn.Amount);
    const rows = await this.repo.findCandidateBookings(exec, txn.BranchId, txnAmount, query.q);

    return rows.map((row) => {
      const amountDue =
        row.Status === 'PENDING_PAYMENT'
          ? Number(row.AmountDueNow)
          : Number(row.RemainingAmount);
      return {
        bookingCode: row.BookingCode,
        customerName: row.CustomerName,
        customerPhone: row.CustomerPhone,
        status: row.Status,
        paymentStatus: row.PaymentStatus,
        amountDue,
        amountMatches: amountDue === txnAmount,
        startAt: toIsoVn(fromSqlDateTime(row.StartAt)),
        courtName: row.CourtName,
      };
    });
  }

  /**
   * API-69: Manually match a NEEDS_REVIEW bank transaction to a payable booking (strict exact amount).
   */
  async matchTransaction(
    bankTxnId: number,
    dto: MatchBankTransactionDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();
    const noShowGraceMinutes = await this.settingsService.getInt('NO_SHOW_GRACE_MINUTES');

    return this.txService.withTransaction(async (tx) => {
      const txn = await this.repo.lockBankTxnById(tx, bankTxnId);
      if (!txn) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch ngân hàng.');
      }

      assertTxnBranchScope(caller, txn.BranchId);

      if (txn.MatchStatus !== 'NEEDS_REVIEW') {
        throw new AppError('BANK_TXN_ALREADY_RESOLVED');
      }

      const booking = await this.bookingState.lockBookingByCode(tx, dto.bookingCode);
      if (!booking) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
      }

      const bookingBranchId = Number(booking.BranchId);
      if (caller.role === 'STAFF' && bookingBranchId !== caller.branchId) {
        throw new AppError('BRANCH_FORBIDDEN');
      }
      if (txn.BranchId === null || bookingBranchId !== txn.BranchId) {
        throw new AppError('BRANCH_FORBIDDEN');
      }

      const isPendingPayable = booking.Status === 'PENDING_PAYMENT';
      const isDepositSettlementPayable =
        booking.Status === 'CONFIRMED' && booking.PaymentStatus === 'DEPOSITED';

      if (!isPendingPayable && !isDepositSettlementPayable) {
        throw new AppError(
          'BOOKING_NOT_PAYABLE',
          `Đơn #${booking.BookingCode} không còn ở trạng thái Chờ thanh toán — hãy hoàn tiền lại cho khách.`,
        );
      }

      // Invariant #6: exact amount match only, no partial payments
      const expectedAmount = isPendingPayable
        ? Number(booking.AmountDueNow)
        : Number(booking.RemainingAmount);
      const txnAmount = Number(txn.Amount);

      if (txnAmount !== expectedAmount) {
        throw new AppError(
          'AMOUNT_MISMATCH',
          'Số tiền giao dịch khác số tiền cần thu — xử lý bằng "Hoàn lại khách".',
        );
      }

      const bookingId = Number(booking.BookingId);
      const pendingRequestId = await this.repo.findPendingPaymentRequestId(tx, bookingId);
      if (pendingRequestId !== null) {
        await this.repo.markPaymentRequestPaid(tx, pendingRequestId);
      }

      const purpose: PaymentPurpose = isPendingPayable
        ? booking.PaymentOption === 'DEPOSIT'
          ? 'DEPOSIT'
          : 'FULL'
        : 'REMAINING';

      const baseHistoryNote = isPendingPayable
        ? 'Đối soát tay – khớp giao dịch ngân hàng'
        : 'Đối soát tay – khớp giao dịch tất toán';
      const cleanNote = dto.note?.trim() || null;
      const paidAt = fromSqlDateTime(txn.TransactionAt);

      const paymentResult = await this.bookingState.applyPaymentInTx(tx, booking, {
        purpose,
        method: 'BANK_TRANSFER',
        channel: booking.Channel,
        amount: txnAmount,
        requestId: pendingRequestId,
        bankTxnId,
        collectedBy: caller.userId,
        paidAt,
        historyNote: cleanNote ? `${baseHistoryNote}: ${cleanNote}` : baseHistoryNote,
        historyChangedBy: caller.userId,
      });

      await this.repo.updateBankTransactionResolution(tx, bankTxnId, {
        matchStatus: 'RESOLVED',
        matchedBookingId: bookingId,
        resolvedBy: caller.userId,
        resolvedAt: now,
        resolveNote: cleanNote,
      });

      const customerUserId =
        booking.CustomerUserId !== null ? Number(booking.CustomerUserId) : null;
      if (customerUserId !== null) {
        const formattedAmount = formatVnd(txnAmount);
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

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'MATCH_BANK_TXN',
        entityType: 'BankTransactions',
        entityId: bankTxnId,
        oldValue: {
          matchStatus: txn.MatchStatus,
          matchedBookingId:
            txn.MatchedBookingId !== null ? Number(txn.MatchedBookingId) : null,
        },
        newValue: {
          matchStatus: 'RESOLVED',
          matchedBookingId: bookingId,
          bookingCode: booking.BookingCode,
          paymentCode: paymentResult.paymentCode,
          amount: txnAmount,
          note: cleanNote,
        },
        ipAddress,
      });

      const collectedByName = await this.repo.findUserFullNameById(tx, caller.userId);

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
          amount: txnAmount,
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

      return {
        bankTxnId,
        matchStatus: 'RESOLVED' as const,
        booking: {
          bookingCode: booking.BookingCode,
          status: paymentResult.nextStatus,
          paymentStatus: paymentResult.nextPaymentStatus,
          paidAmount: paymentResult.paidAmount,
          remainingAmount: paymentResult.remainingAmount,
          version: paymentResult.version,
        },
        receipt: {
          paymentCode: paymentResult.paymentCode,
          bookingCode: booking.BookingCode,
          purpose,
          method: 'BANK_TRANSFER' as const,
          amount: txnAmount,
          collectedByName,
          paidAt: toIsoVn(paidAt),
        },
      };
    });
  }

  /**
   * API-70: Mark a NEEDS_REVIEW bank transaction as refunded back to the customer offline.
   */
  async refundToCustomer(
    bankTxnId: number,
    dto: RefundToCustomerDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const txn = await this.repo.lockBankTxnById(tx, bankTxnId);
      if (!txn) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch ngân hàng.');
      }

      assertTxnBranchScope(caller, txn.BranchId);

      if (txn.MatchStatus !== 'NEEDS_REVIEW') {
        throw new AppError('BANK_TXN_ALREADY_RESOLVED');
      }

      const cleanNote = dto.note.trim();

      await this.repo.updateBankTransactionResolution(tx, bankTxnId, {
        matchStatus: 'RESOLVED',
        resolvedBy: caller.userId,
        resolvedAt: now,
        resolveNote: cleanNote,
      });

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'REFUND_BANK_TXN',
        entityType: 'BankTransactions',
        entityId: bankTxnId,
        oldValue: { matchStatus: txn.MatchStatus },
        newValue: { matchStatus: 'RESOLVED', action: 'REFUNDED', note: cleanNote },
        ipAddress,
      });

      const resolvedByName = await this.repo.findUserFullNameById(tx, caller.userId);

      return {
        bankTxnId,
        matchStatus: 'RESOLVED' as const,
        resolution: {
          action: 'REFUNDED' as const,
          note: cleanNote,
          resolvedByName,
          resolvedAt: toIsoVn(now),
        },
      };
    });
  }

  /**
   * API-71: Ignore a NEEDS_REVIEW bank transaction unrelated to any booking.
   */
  async ignoreTransaction(
    bankTxnId: number,
    dto: IgnoreBankTransactionDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const txn = await this.repo.lockBankTxnById(tx, bankTxnId);
      if (!txn) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy giao dịch ngân hàng.');
      }

      assertTxnBranchScope(caller, txn.BranchId);

      if (txn.MatchStatus !== 'NEEDS_REVIEW') {
        throw new AppError('BANK_TXN_ALREADY_RESOLVED');
      }

      const cleanNote = dto.note?.trim() || null;

      await this.repo.updateBankTransactionResolution(tx, bankTxnId, {
        matchStatus: 'IGNORED',
        resolvedBy: caller.userId,
        resolvedAt: now,
        resolveNote: cleanNote,
      });

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: 'IGNORE_BANK_TXN',
        entityType: 'BankTransactions',
        entityId: bankTxnId,
        oldValue: { matchStatus: txn.MatchStatus },
        newValue: { matchStatus: 'IGNORED', note: cleanNote },
        ipAddress,
      });

      return {
        bankTxnId,
        matchStatus: 'IGNORED' as const,
      };
    });
  }

  /**
   * API-72: List refunds (OWNER only).
   */
  async listRefunds(query: ListRefundsQuery): Promise<{
    items: RefundItemDto[];
    totalItems: number;
    totalAmount: number;
    countByStatus: Record<RefundStatus, number>;
  }> {
    assertDateRangeValid(query.from, query.to);

    const exec = await this.txService.executor();
    const { rows, totalItems, totalAmount, countByStatus } = await this.repo.listRefunds(exec, {
      branchId: query.branchId,
      status: query.status,
      from: query.from,
      to: query.to,
      page: query.page,
      pageSize: query.pageSize,
    });

    const items: RefundItemDto[] = rows.map((row) => ({
      refundId: Number(row.RefundId),
      bookingCode: row.BookingCode,
      branchId: row.BranchId,
      branchName: row.BranchName,
      courtId: row.CourtId,
      courtName: row.CourtName,
      customerName: row.CustomerName,
      customerPhone: row.CustomerPhone,
      amount: Number(row.Amount),
      rate: Number(row.Rate),
      cancelType: row.CancelType,
      reason: row.Reason,
      status: row.Status,
      createdAt: toIsoVn(fromSqlDateTime(row.CreatedAt)),
      processedAt: row.ProcessedAt !== null ? toIsoVn(fromSqlDateTime(row.ProcessedAt)) : null,
      processedByName: row.ProcessedByName,
      note: row.Note,
    }));

    return {
      items,
      totalItems,
      totalAmount,
      countByStatus,
    };
  }

  /**
   * API-73: Mark refund as COMPLETED (OWNER only).
   */
  async completeRefund(
    refundId: number,
    dto: CompleteRefundDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    return this.processRefund(refundId, 'COMPLETED', dto.note?.trim() || null, caller, ipAddress);
  }

  /**
   * API-73: Mark refund as FAILED (OWNER only).
   */
  async failRefund(
    refundId: number,
    dto: FailRefundDto,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    return this.processRefund(refundId, 'FAILED', dto.note.trim(), caller, ipAddress);
  }

  private async processRefund(
    refundId: number,
    nextStatus: 'COMPLETED' | 'FAILED',
    cleanNote: string | null,
    caller: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const now = this.clock.now();

    return this.txService.withTransaction(async (tx) => {
      const refund = await this.repo.lockRefundById(tx, refundId);
      if (!refund) {
        throw new AppError('NOT_FOUND', 'Không tìm thấy khoản hoàn tiền.');
      }

      if (refund.Status !== 'PENDING') {
        throw new AppError('REFUND_ALREADY_PROCESSED');
      }

      await this.repo.updateRefundStatus(tx, refundId, {
        status: nextStatus,
        processedBy: caller.userId,
        processedAt: now,
        note: cleanNote,
      });

      await this.auditService.writeInTx(tx, {
        userId: caller.userId,
        action: nextStatus === 'COMPLETED' ? 'COMPLETE_REFUND' : 'FAIL_REFUND',
        entityType: 'Refunds',
        entityId: refundId,
        oldValue: { status: refund.Status, note: refund.Note },
        newValue: { status: nextStatus, note: cleanNote },
        ipAddress,
      });

      const customerUserId =
        refund.CustomerUserId !== null ? Number(refund.CustomerUserId) : null;
      if (nextStatus === 'COMPLETED' && customerUserId !== null) {
        const formattedAmount = formatVnd(Number(refund.Amount));
        await this.notificationsService.createNotificationInTx(tx, {
          userId: customerUserId,
          type: 'PAYMENT_RESULT',
          title: 'Đã hoàn tiền đặt sân',
          body: `Khoản hoàn tiền ${formattedAmount}đ cho đơn ${refund.BookingCode} đã được chuyển khoản thành công.`,
          linkType: 'BOOKING',
          linkRef: String(Number(refund.BookingId)),
          bookingCode: refund.BookingCode,
        });
      }

      const processedByName = await this.repo.findUserFullNameById(tx, caller.userId);

      return {
        refundId,
        status: nextStatus,
        processedAt: toIsoVn(now),
        processedByName,
        note: cleanNote,
      };
    });
  }
}
