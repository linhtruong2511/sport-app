/**
 * Ánh xạ bản ghi nội bộ → đối tượng API dùng chung (SDD mục 5.3).
 */
import { MOCK_CONFIG } from '../config';
import { db } from '../db/store';
import type { Booking, Court, Payment, PaymentRequest, Promotion, User } from '../db/types';
import { activeRules } from './pricing';
import { activeBlockNow, affectedReasons, blockEnd, currentBlocks, findBranch, findCourt, findSport, findUser } from './schedule';
import { dateOf, endTimeOf, ms, nowMs, timeOf, today } from './time';

export interface Viewer {
  userId: number;
  role: User['role'];
  branchId: number | null;
}

const TITLES: Record<User['role'], string> = {
  CUSTOMER: 'Hội viên',
  STAFF: 'Nhân viên thu ngân',
  OWNER: 'Chủ hệ thống sân',
};

export function userView(u: User) {
  return {
    userId: u.userId,
    code: u.code,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    role: u.role,
    branchId: u.branchId,
    branchName: u.branchId ? findBranch(u.branchId)?.name ?? null : null,
    memberTier: u.memberTier,
    title: u.role === 'CUSTOMER' ? u.memberTier ?? 'Hội viên mới' : TITLES[u.role],
  };
}

/** RowVer dạng base64 8 byte, ví dụ "AAAAAAAAB9E=" */
export function versionOf(b: Booking): string {
  const bytes = new Array<number>(8).fill(0);
  let n = b.rowVer + 2000;
  for (let i = 7; i >= 0 && n > 0; i--) {
    bytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  return btoa(String.fromCharCode(...bytes));
}

export const remainingOf = (b: Booking) =>
  b.status === 'CANCELED' || b.status === 'EXPIRED' ? 0 : Math.max(b.totalAmount - b.paidAmount, 0);

export function isOverdue(b: Booking): boolean {
  return (
    b.status === 'CONFIRMED' &&
    !b.checkedInAt &&
    nowMs() >= ms(b.startAt) + MOCK_CONFIG.settings.NO_SHOW_GRACE_MINUTES * 60_000
  );
}

export function allowedActions(b: Booking, viewer: Viewer | null): string[] {
  if (!viewer) return [];
  const now = nowMs();
  const beforeStart = now < ms(b.startAt);
  const isToday = dateOf(b.startAt) === today();
  const out: string[] = [];
  if (viewer.role === 'CUSTOMER') {
    if (b.customerUserId !== viewer.userId) return [];
    if (b.status === 'PENDING_PAYMENT') {
      if (b.holdExpireAt && ms(b.holdExpireAt) > now) out.push('PAY');
      if (beforeStart) out.push('CANCEL');
    }
    if (b.status === 'CONFIRMED' && beforeStart) out.push('CANCEL');
    return out;
  }
  const remaining = remainingOf(b);
  const affected = affectedReasons(b).length > 0;
  if (b.status === 'PENDING_PAYMENT') {
    out.push('PAY');
    if (beforeStart) out.push('CANCEL');
  }
  if (b.status === 'CONFIRMED') {
    if (isToday && remaining > 0) out.push('SETTLE');
    if (isToday && remaining === 0) out.push('CHECK_IN');
    if (beforeStart) out.push('CANCEL');
    if (isOverdue(b)) out.push('NO_SHOW_CANCEL');
  }
  if (b.status === 'IN_USE') out.push('COMPLETE');
  if (affected) out.push('REASSIGN', 'CLOSE_BY_FACILITY');
  return out;
}

function cancelView(b: Booking) {
  if (b.status !== 'CANCELED' || !b.cancelType) return null;
  const by = findUser(b.canceledBy);
  const depositKept =
    b.cancelType === 'BY_FACILITY' ? 0 : b.paymentOption === 'DEPOSIT' ? Math.min(b.paidAmount, b.depositAmount) : 0;
  return {
    cancelType: b.cancelType,
    reason: b.cancelReason,
    canceledAt: b.canceledAt,
    canceledByName: by?.fullName ?? null,
    refundRate: b.refundRate,
    refundAmount: b.refundAmount ?? 0,
    depositKept,
  };
}

function customerOf(b: Booking) {
  const u = findUser(b.customerUserId);
  return u
    ? { userId: u.userId, fullName: u.fullName, phone: u.phone, isGuest: false }
    : { userId: null, fullName: b.guestName ?? 'Khách vãng lai', phone: b.guestPhone ?? '', isGuest: true };
}

function core(b: Booking, viewer: Viewer | null) {
  const durationMinutes = Math.round((ms(b.endAt) - ms(b.startAt)) / 60_000);
  return {
    bookingCode: b.bookingCode,
    channel: b.channel,
    status: b.status,
    paymentStatus: b.paymentStatus,
    isOverdue: isOverdue(b),
    date: dateOf(b.startAt),
    startTime: timeOf(b.startAt),
    endTime: endTimeOf(b.startAt, b.endAt),
    startAt: b.startAt,
    endAt: b.endAt,
    durationMinutes,
    baseAmount: b.baseAmount,
    promotionCode: b.promotionCode,
    discountAmount: b.discountAmount,
    totalAmount: b.totalAmount,
    paymentOption: b.paymentOption,
    deposit: { type: b.depositType, value: b.depositValue, amount: b.depositAmount },
    amountDueNow: b.amountDueNow,
    paidAmount: b.paidAmount,
    remainingAmount: remainingOf(b),
    holdExpireAt: b.status === 'PENDING_PAYMENT' ? b.holdExpireAt : null,
    cancel: cancelView(b),
    checkedInAt: b.checkedInAt,
    checkedOutAt: b.checkedOutAt,
    allowedActions: allowedActions(b, viewer),
    version: versionOf(b),
    createdAt: b.createdAt,
  };
}

/** BookingSummary — dạng phẳng dùng trong danh sách */
export function bookingSummary(b: Booking, viewer: Viewer | null) {
  const branch = findBranch(b.branchId);
  const court = findCourt(b.courtId);
  const sport = court ? findSport(court.sportId) : undefined;
  const c = customerOf(b);
  return {
    ...core(b, viewer),
    branchId: b.branchId,
    branchName: branch?.name ?? '',
    courtId: b.courtId,
    courtName: court?.name ?? '',
    sportId: sport?.sportId ?? null,
    sportName: sport?.name ?? '',
    customerName: c.fullName,
    customerPhone: c.phone,
    isGuest: c.isGuest,
  };
}

export const withAffected = (b: Booking, viewer: Viewer | null) => ({
  ...bookingSummary(b, viewer),
  affectedReasons: affectedReasons(b),
});

/** BookingDetail — dạng lồng + giá, thanh toán, lịch sử */
export function bookingDetail(b: Booking, viewer: Viewer | null) {
  const s = db();
  const branch = findBranch(b.branchId);
  const court = findCourt(b.courtId);
  const sport = court ? findSport(court.sportId) : undefined;
  const refund = s.refunds.find((r) => r.bookingCode === b.bookingCode);
  return {
    ...core(b, viewer),
    branch: { branchId: b.branchId, name: branch?.name ?? '', address: branch?.address ?? '' },
    court: {
      courtId: b.courtId,
      code: court?.code ?? '',
      name: court?.name ?? '',
      sportCode: sport?.code ?? '',
      sportName: sport?.name ?? '',
    },
    customer: customerOf(b),
    note: b.note,
    priceLines: b.priceLines.map(({ label, startTime, endTime, pricePerHour, amount }) => ({
      label,
      startTime,
      endTime,
      pricePerHour,
      amount,
    })),
    payments: s.payments
      .filter((p) => p.bookingCode === b.bookingCode)
      .map((p) => ({
        paymentCode: p.paymentCode,
        purpose: p.purpose,
        method: p.method,
        channel: p.channel,
        amount: p.amount,
        paidAt: p.paidAt,
        collectedByName: findUser(p.collectedBy)?.fullName ?? null,
      })),
    statusHistory: b.statusHistory.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      fromPaymentStatus: h.fromPaymentStatus,
      toPaymentStatus: h.toPaymentStatus,
      changedAt: h.changedAt,
      changedByName: findUser(h.changedBy)?.fullName ?? null,
      note: h.note,
    })),
    transfers: b.transfers.map((t) => ({
      oldCourtName: findCourt(t.oldCourtId)?.name ?? '',
      oldStartAt: t.oldStartAt,
      newCourtName: findCourt(t.newCourtId)?.name ?? '',
      newStartAt: t.newStartAt,
      performedByName: findUser(t.performedBy)?.fullName ?? null,
      performedAt: t.performedAt,
      note: t.note,
    })),
    refund: refund ? { refundId: refund.refundId, amount: refund.amount, rate: refund.rate, status: refund.status } : null,
  };
}

export function receiptView(p: Payment) {
  return {
    paymentCode: p.paymentCode,
    bookingCode: p.bookingCode,
    purpose: p.purpose,
    method: p.method,
    amount: p.amount,
    collectedByName: findUser(p.collectedBy)?.fullName ?? null,
    paidAt: p.paidAt,
  };
}

export function paymentRequestView(pr: PaymentRequest) {
  const b = db().bookings.find((x) => x.bookingCode === pr.bookingCode);
  const branch = b ? findBranch(b.branchId) : undefined;
  return {
    requestId: pr.requestId,
    bookingCode: pr.bookingCode,
    purpose: pr.purpose,
    amount: pr.amount,
    transferContent: pr.transferContent,
    qrPayload: pr.qrPayload,
    expiresAt: pr.expiresAt,
    status: pr.status,
    bank: {
      bin: branch?.bankBin ?? null,
      bankName: branch?.bankName ?? null,
      accountNo: branch?.bankAccountNo ?? null,
      accountName: branch?.bankAccountName ?? null,
    },
  };
}

export function courtDisplayStatus(c: Court): 'ACTIVE' | 'MAINTENANCE' | 'DECOMMISSIONED' | 'INACTIVE' {
  if (c.status === 'INACTIVE') return 'INACTIVE';
  const blk = activeBlockNow(c.courtId);
  if (blk) return blk.blockType === 'DECOMMISSION' ? 'DECOMMISSIONED' : 'MAINTENANCE';
  return 'ACTIVE';
}

export function courtAdminView(c: Court) {
  const branch = findBranch(c.branchId);
  const sport = findSport(c.sportId);
  const blk = currentBlocks(c.courtId).sort((a, b) => ms(a.startAt) - ms(b.startAt))[0];
  return {
    courtId: c.courtId,
    code: c.code,
    name: c.name,
    branch: { branchId: c.branchId, name: branch?.name ?? '' },
    sport: { sportId: c.sportId, code: sport?.code ?? '', name: sport?.name ?? '' },
    courtType: c.courtType,
    description: c.description,
    depositType: c.depositType,
    depositValue: c.depositValue,
    status: c.status,
    displayStatus: courtDisplayStatus(c),
    priceRules: activeRules(c).map((r) => ({
      priceRuleId: r.priceRuleId,
      label: r.label,
      dayOfWeekMask: r.dayOfWeekMask,
      startTime: r.startTime,
      endTime: r.endTime,
      pricePerHour: r.pricePerHour,
    })),
    activeBlock: blk
      ? { blockId: blk.blockId, blockType: blk.blockType, startAt: blk.startAt, endAt: blockEnd(blk), reason: blk.reason }
      : null,
  };
}

export function promoScopeText(p: Promotion): string {
  const s = db();
  const branches = p.allBranches
    ? 'Tất cả cơ sở'
    : p.branchIds.map((id) => s.branches.find((b) => b.branchId === id)?.name ?? `#${id}`).join(', ');
  const sports = p.allSports ? '' : ` • ${p.sportIds.map((id) => s.sports.find((x) => x.sportId === id)?.name ?? `#${id}`).join(', ')}`;
  return branches + sports;
}

export function promoAdminView(p: Promotion) {
  const s = db();
  return {
    promotionId: p.promotionId,
    code: p.code,
    name: p.name,
    description: p.description,
    discountType: p.discountType,
    discountValue: p.discountValue,
    maxDiscountAmount: p.maxDiscountAmount,
    allBranches: p.allBranches,
    branches: p.branchIds.map((id) => ({ branchId: id, name: s.branches.find((b) => b.branchId === id)?.name ?? '' })),
    allSports: p.allSports,
    sports: p.sportIds.map((id) => ({ sportId: id, name: s.sports.find((x) => x.sportId === id)?.name ?? '' })),
    timeFrom: p.timeFrom,
    timeTo: p.timeTo,
    startDate: p.startDate,
    endDate: p.endDate,
    audienceType: p.audienceType,
    customerCount: p.customerIds.length,
    maxUses: p.maxUses,
    usedCount: p.usedCount,
    status: p.status,
    notifyStatus: p.notifyStatus,
    createdAt: p.createdAt,
  };
}

export function staffView(u: User) {
  const s = db();
  const mine = s.payments.filter((p) => p.collectedBy === u.userId);
  return {
    userId: u.userId,
    code: u.code,
    fullName: u.fullName,
    phone: u.phone,
    email: u.email,
    branch: { branchId: u.branchId, name: u.branchId ? findBranch(u.branchId)?.name ?? '' : '' },
    status: u.status,
    counterBookingCount: new Set(mine.map((p) => p.bookingCode)).size,
    collectedAmount: mine.reduce((sum, p) => sum + p.amount, 0),
    lastLoginAt: u.lastLoginAt,
  };
}
