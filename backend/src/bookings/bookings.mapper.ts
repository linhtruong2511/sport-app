import type {
  AllowedAction,
  BookingChannel,
  BookingStatus,
  CancelType,
  DepositType,
  PaymentMethod,
  PaymentOption,
  PaymentPurpose,
  PaymentStatus,
  RefundStatus,
  UserRole,
} from '@sporthub/shared/enums';
import type {
  BookingDetailDto,
  BookingPaymentItemDto,
  BookingPriceLineDto,
  BookingRefundSummaryDto,
  BookingStatusHistoryItemDto,
  BookingSummaryDto,
  BookingTransferItemDto,
} from '@sporthub/shared/types';
import { addMinutes, formatDateVn, formatTimeVn, fromSqlDateTime, toIsoVn } from '../core/time.js';

export interface BookingRow {
  BookingId: number | string;
  BookingCode: string;
  BranchId: number;
  BranchName: string;
  BranchAddress: string;
  CourtId: number;
  CourtCode: string;
  CourtName: string;
  SportCode: string;
  SportName: string;
  CustomerUserId: number | string | null;
  CustomerUserName: string | null;
  CustomerUserPhone: string | null;
  GuestName: string | null;
  GuestPhone: string | null;
  StartAt: Date | string;
  EndAt: Date | string;
  BaseAmount: number | string;
  DiscountAmount: number | string;
  TotalAmount: number | string;
  PaymentOption: PaymentOption;
  DepositType: DepositType | null;
  DepositValue: number | string | null;
  DepositAmount: number | string;
  AmountDueNow: number | string;
  PaidAmount: number | string;
  RemainingAmount: number | string;
  Status: BookingStatus;
  PaymentStatus: PaymentStatus;
  HoldExpireAt: Date | string | null;
  PromotionCode: string | null;
  CanceledBy: number | string | null;
  CanceledByName: string | null;
  CanceledAt: Date | string | null;
  CancelReason: string | null;
  CancelType: CancelType | null;
  RefundRate: number | string | null;
  RefundAmount: number | string | null;
  ReminderSentAt: Date | string | null;
  Note: string | null;
  CreatedBy: number | string | null;
  CreatedAt: Date | string;
  UpdatedAt: Date | string;
  RowVer: Buffer;
  CheckedInAt: Date | string | null;
  CheckedOutAt: Date | string | null;
  Channel: BookingChannel;
}

export interface BookingPriceLineRow {
  Label: string;
  StartAt: Date | string;
  EndAt: Date | string;
  PricePerHour: number | string;
  Amount: number | string;
}

export interface BookingPaymentRow {
  PaymentCode: string;
  Purpose: PaymentPurpose;
  Method: PaymentMethod;
  Channel: BookingChannel;
  Amount: number | string;
  PaidAt: Date | string;
  CollectedByName: string | null;
}

export interface BookingStatusHistoryRow {
  FromStatus: BookingStatus | null;
  ToStatus: BookingStatus;
  FromPaymentStatus: PaymentStatus | null;
  ToPaymentStatus: PaymentStatus | null;
  ChangedAt: Date | string;
  ChangedByName: string | null;
  Note: string | null;
}

export interface BookingTransferRow {
  OldCourtName: string;
  OldStartAt: Date | string;
  NewCourtName: string;
  NewStartAt: Date | string;
  PerformedByName: string;
  PerformedAt: Date | string;
  Note: string | null;
}

export interface BookingRefundRow {
  RefundId: number | string;
  Amount: number | string;
  Rate: number | string;
  Status: RefundStatus;
}

export function encodeRowVer(buf: Buffer): string {
  return buf.toString('base64');
}

export function decodeRowVer(version: string): Buffer | null {
  try {
    const trimmed = version.trim();
    const buf = Buffer.from(trimmed, 'base64');
    if (buf.length !== 8 || buf.toString('base64') !== trimmed) {
      return null;
    }
    return buf;
  } catch {
    return null;
  }
}

export function computeIsOverdue(
  status: BookingStatus,
  checkedInAt: Date | null,
  startAt: Date,
  now: Date,
  noShowGraceMinutes: number,
): boolean {
  if (status !== 'CONFIRMED' || checkedInAt !== null) {
    return false;
  }
  return now.getTime() >= addMinutes(startAt, noShowGraceMinutes).getTime();
}

export function computeAllowedActions(params: {
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  paymentOption: PaymentOption;
  remainingAmount: number;
  holdExpireAt: Date | null;
  startAt: Date;
  endAt: Date;
  checkedInAt: Date | null;
  customerUserId: number | null;
  callerRole: UserRole;
  callerUserId: number;
  now: Date;
  noShowGraceMinutes: number;
  isAffected?: boolean;
}): AllowedAction[] {
  const {
    status,
    paymentStatus,
    remainingAmount,
    holdExpireAt,
    startAt,
    endAt,
    customerUserId,
    callerRole,
    callerUserId,
    now,
    noShowGraceMinutes,
    isAffected,
  } = params;

  if (status === 'COMPLETED' || status === 'CANCELED' || status === 'EXPIRED') {
    return [];
  }

  const isStaffPlus = callerRole === 'STAFF' || callerRole === 'OWNER';
  const isOwnerCustomer = callerRole === 'CUSTOMER' && customerUserId === callerUserId;

  if (status === 'PENDING_PAYMENT') {
    if (!isStaffPlus && !isOwnerCustomer) {
      return [];
    }
    const actions: AllowedAction[] = [];
    if (holdExpireAt === null || now.getTime() <= holdExpireAt.getTime()) {
      actions.push('PAY');
    }
    actions.push('CANCEL');
    if (isStaffPlus && isAffected) {
      actions.push('REASSIGN', 'CLOSE_BY_FACILITY');
    }
    return actions;
  }

  if (status === 'CONFIRMED') {
    if (callerRole === 'CUSTOMER') {
      if (!isOwnerCustomer) return [];
      return now.getTime() < startAt.getTime() ? ['CANCEL'] : [];
    }

    if (!isStaffPlus) return [];

    const actions: AllowedAction[] = [];
    if (remainingAmount > 0) {
      actions.push('SETTLE');
    } else {
      const sameDay = formatDateVn(now) === formatDateVn(startAt);
      const earliestCheckIn = addMinutes(startAt, -15);
      if (sameDay && now.getTime() >= earliestCheckIn.getTime()) {
        actions.push('CHECK_IN');
      }
    }

    if (now.getTime() < startAt.getTime()) {
      actions.push('CANCEL');
    }

    if (
      paymentStatus === 'DEPOSITED' &&
      now.getTime() >= addMinutes(startAt, noShowGraceMinutes).getTime()
    ) {
      actions.push('NO_SHOW_CANCEL');
    } else if (paymentStatus === 'PAID' && now.getTime() >= endAt.getTime()) {
      actions.push('NO_SHOW_CANCEL');
    }

    if (isAffected) {
      actions.push('REASSIGN', 'CLOSE_BY_FACILITY');
    }

    return actions;
  }

  if (status === 'IN_USE') {
    return isStaffPlus ? ['COMPLETE'] : [];
  }

  return [];
}

function mapCancelInfo(row: BookingRow): BookingSummaryDto['cancel'] {
  if (row.Status !== 'CANCELED' || !row.CancelType || !row.CancelReason || !row.CanceledAt) {
    return null;
  }
  const paidAmount = Number(row.PaidAmount);
  const depositAmount = Number(row.DepositAmount);
  const refundAmount = row.RefundAmount !== null ? Number(row.RefundAmount) : null;
  const depositKept =
    row.CancelType === 'BY_FACILITY'
      ? 0
      : row.PaymentOption === 'DEPOSIT'
        ? Math.min(paidAmount, depositAmount)
        : 0;

  return {
    cancelType: row.CancelType,
    reason: row.CancelReason,
    canceledAt: toIsoVn(fromSqlDateTime(row.CanceledAt)),
    canceledByName: row.CanceledByName ?? null,
    refundRate: row.RefundRate !== null ? Number(row.RefundRate) : null,
    refundAmount,
    depositKept,
  };
}

export function toBookingSummaryDto(
  row: BookingRow,
  ctx: {
    callerRole: UserRole;
    callerUserId: number;
    now: Date;
    noShowGraceMinutes: number;
    isAffected?: boolean;
  },
): BookingSummaryDto {
  const startAt = fromSqlDateTime(row.StartAt);
  const endAt = fromSqlDateTime(row.EndAt);
  const holdExpireAt = row.HoldExpireAt !== null ? fromSqlDateTime(row.HoldExpireAt) : null;
  const checkedInAt = row.CheckedInAt !== null ? fromSqlDateTime(row.CheckedInAt) : null;
  const checkedOutAt = row.CheckedOutAt !== null ? fromSqlDateTime(row.CheckedOutAt) : null;
  const createdAt = fromSqlDateTime(row.CreatedAt);
  const customerUserId = row.CustomerUserId !== null ? Number(row.CustomerUserId) : null;
  const isGuest = customerUserId === null;
  const dbRemaining = Number(row.RemainingAmount);
  const displayRemaining =
    row.Status === 'CANCELED' || row.Status === 'EXPIRED' ? 0 : dbRemaining;

  return {
    bookingCode: row.BookingCode,
    channel: row.Channel,
    status: row.Status,
    paymentStatus: row.PaymentStatus,
    isOverdue: computeIsOverdue(
      row.Status,
      checkedInAt,
      startAt,
      ctx.now,
      ctx.noShowGraceMinutes,
    ),
    branchId: Number(row.BranchId),
    branchName: row.BranchName,
    courtId: Number(row.CourtId),
    courtName: row.CourtName,
    sportCode: row.SportCode,
    sportName: row.SportName,
    customerUserId,
    customerName: isGuest ? (row.GuestName ?? '') : (row.CustomerUserName ?? ''),
    customerPhone: isGuest ? (row.GuestPhone ?? '') : (row.CustomerUserPhone ?? ''),
    isGuest,
    date: formatDateVn(startAt),
    startTime: formatTimeVn(startAt),
    endTime: formatTimeVn(endAt),
    startAt: toIsoVn(startAt),
    endAt: toIsoVn(endAt),
    durationMinutes: Math.round((endAt.getTime() - startAt.getTime()) / 60_000),
    baseAmount: Number(row.BaseAmount),
    promotionCode: row.PromotionCode ?? null,
    discountAmount: Number(row.DiscountAmount),
    totalAmount: Number(row.TotalAmount),
    paymentOption: row.PaymentOption,
    deposit: {
      type: row.DepositType,
      value: row.DepositValue !== null ? Number(row.DepositValue) : null,
      amount: Number(row.DepositAmount),
    },
    amountDueNow: Number(row.AmountDueNow),
    paidAmount: Number(row.PaidAmount),
    remainingAmount: displayRemaining,
    holdExpireAt: holdExpireAt ? toIsoVn(holdExpireAt) : null,
    cancel: mapCancelInfo(row),
    checkedInAt: checkedInAt ? toIsoVn(checkedInAt) : null,
    checkedOutAt: checkedOutAt ? toIsoVn(checkedOutAt) : null,
    allowedActions: computeAllowedActions({
      status: row.Status,
      paymentStatus: row.PaymentStatus,
      paymentOption: row.PaymentOption,
      remainingAmount: dbRemaining,
      holdExpireAt,
      startAt,
      endAt,
      checkedInAt,
      customerUserId,
      callerRole: ctx.callerRole,
      callerUserId: ctx.callerUserId,
      now: ctx.now,
      noShowGraceMinutes: ctx.noShowGraceMinutes,
      isAffected: ctx.isAffected,
    }),
    version: encodeRowVer(row.RowVer),
    createdAt: toIsoVn(createdAt),
  };
}

export function toBookingDetailDto(
  row: BookingRow,
  relations: {
    priceLines: BookingPriceLineRow[];
    payments: BookingPaymentRow[];
    statusHistory: BookingStatusHistoryRow[];
    transfers: BookingTransferRow[];
    refund: BookingRefundRow | null;
  },
  ctx: {
    callerRole: UserRole;
    callerUserId: number;
    now: Date;
    noShowGraceMinutes: number;
    isAffected?: boolean;
  },
): BookingDetailDto {
  const summary = toBookingSummaryDto(row, ctx);

  const priceLines: BookingPriceLineDto[] = relations.priceLines.map((line) => ({
    label: line.Label,
    startTime: formatTimeVn(fromSqlDateTime(line.StartAt)),
    endTime: formatTimeVn(fromSqlDateTime(line.EndAt)),
    pricePerHour: Number(line.PricePerHour),
    amount: Number(line.Amount),
  }));

  const payments: BookingPaymentItemDto[] = relations.payments.map((p) => ({
    paymentCode: p.PaymentCode,
    purpose: p.Purpose,
    method: p.Method,
    channel: p.Channel,
    amount: Number(p.Amount),
    paidAt: toIsoVn(fromSqlDateTime(p.PaidAt)),
    collectedByName: p.CollectedByName ?? null,
  }));

  const statusHistory: BookingStatusHistoryItemDto[] = relations.statusHistory.map((h) => ({
    fromStatus: h.FromStatus,
    toStatus: h.ToStatus,
    fromPaymentStatus: h.FromPaymentStatus,
    toPaymentStatus: h.ToPaymentStatus,
    changedAt: toIsoVn(fromSqlDateTime(h.ChangedAt)),
    changedByName: h.ChangedByName ?? null,
    note: h.Note ?? null,
  }));

  const transfers: BookingTransferItemDto[] = relations.transfers.map((t) => ({
    oldCourtName: t.OldCourtName,
    oldStartAt: toIsoVn(fromSqlDateTime(t.OldStartAt)),
    newCourtName: t.NewCourtName,
    newStartAt: toIsoVn(fromSqlDateTime(t.NewStartAt)),
    performedByName: t.PerformedByName,
    performedAt: toIsoVn(fromSqlDateTime(t.PerformedAt)),
    note: t.Note ?? null,
  }));

  const refund: BookingRefundSummaryDto | null = relations.refund
    ? {
        refundId: Number(relations.refund.RefundId),
        amount: Number(relations.refund.Amount),
        rate: Number(relations.refund.Rate),
        status: relations.refund.Status,
      }
    : null;

  return {
    bookingCode: summary.bookingCode,
    channel: summary.channel,
    status: summary.status,
    paymentStatus: summary.paymentStatus,
    isOverdue: summary.isOverdue,
    branch: {
      branchId: summary.branchId,
      name: summary.branchName,
      address: row.BranchAddress,
    },
    court: {
      courtId: summary.courtId,
      code: row.CourtCode,
      name: summary.courtName,
      sportCode: summary.sportCode,
      sportName: summary.sportName,
    },
    customer: {
      userId: summary.customerUserId,
      fullName: summary.customerName,
      phone: summary.customerPhone,
      isGuest: summary.isGuest,
    },
    date: summary.date,
    startTime: summary.startTime,
    endTime: summary.endTime,
    startAt: summary.startAt,
    endAt: summary.endAt,
    durationMinutes: summary.durationMinutes,
    baseAmount: summary.baseAmount,
    promotionCode: summary.promotionCode,
    discountAmount: summary.discountAmount,
    totalAmount: summary.totalAmount,
    paymentOption: summary.paymentOption,
    deposit: summary.deposit,
    amountDueNow: summary.amountDueNow,
    paidAmount: summary.paidAmount,
    remainingAmount: summary.remainingAmount,
    holdExpireAt: summary.holdExpireAt,
    cancel: summary.cancel,
    checkedInAt: summary.checkedInAt,
    checkedOutAt: summary.checkedOutAt,
    note: row.Note ?? null,
    allowedActions: summary.allowedActions,
    version: summary.version,
    createdAt: summary.createdAt,
    priceLines,
    payments,
    statusHistory,
    transfers,
    refund,
  };
}
