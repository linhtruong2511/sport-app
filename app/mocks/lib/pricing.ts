/**
 * Quy tắc tính tiền — SDD mục 3.5 (tiền sân, khuyến mãi, tiền cọc, hoàn tiền).
 * Các hàm ở đây thuần (không đọc/ghi CSDL) để dùng lại cho báo giá, tạo đơn, seed.
 */
import { MOCK_CONFIG } from '../config';
import type { AmountType, Booking, CancelType, Court, PriceLine, Promotion } from '../db/types';
import { E } from './errors';
import { dateOf, dow, fromMin, ms, timeOf, toMin } from './time';

export const fmtVnd = (n: number) => n.toLocaleString('vi-VN');

export const activeRules = (court: Court) => court.priceRules.filter((r) => !r.effectiveTo);

/** 3.5a — tách đơn theo khung giá, mỗi đoạn một dòng */
export function calcPriceLines(court: Court, date: string, startTime: string, endTime: string): PriceLine[] {
  const bit = 1 << (dow(date) - 1);
  const s = toMin(startTime);
  const e = toMin(endTime);
  const parts = activeRules(court)
    .filter((r) => (r.dayOfWeekMask & bit) !== 0)
    .map((r) => ({ r, a: Math.max(s, toMin(r.startTime)), b: Math.min(e, toMin(r.endTime)) }))
    .filter((x) => x.a < x.b)
    .sort((x, y) => x.a - y.a);
  const covered = parts.reduce((sum, x) => sum + (x.b - x.a), 0);
  if (covered < e - s) {
    throw E.rule('PRICE_NOT_CONFIGURED', 'Chưa có bảng giá cho toàn bộ khung giờ đã chọn.');
  }
  return parts.map(({ r, a, b }) => ({
    priceRuleId: r.priceRuleId,
    label: r.label,
    startTime: fromMin(a),
    endTime: fromMin(b),
    pricePerHour: r.pricePerHour,
    amount: Math.round((r.pricePerHour * (b - a)) / 60),
  }));
}

export function tryPrice(court: Court, date: string, startTime: string, endTime: string): number | null {
  try {
    return calcPriceLines(court, date, startTime, endTime).reduce((s, l) => s + l.amount, 0);
  } catch {
    return null;
  }
}

/** Nhãn khung giá tại một thời điểm (dùng cho cột lưới lịch) */
export function ruleLabelAt(court: Court, date: string, hhmm: string): string | null {
  const bit = 1 << (dow(date) - 1);
  const m = toMin(hhmm);
  const r = activeRules(court).find(
    (x) => (x.dayOfWeekMask & bit) !== 0 && toMin(x.startTime) <= m && m < toMin(x.endTime),
  );
  return r?.label ?? null;
}

export function priceHint(court: Court): string {
  return activeRules(court)
    .map((r) => `${r.label} ${r.startTime.slice(0, 2)}h–${r.endTime.slice(0, 2)}h: ${Math.round(r.pricePerHour / 1000)}k/h`)
    .join(' • ');
}

/** 3.5d — tiền cọc */
export function depositFor(type: AmountType, value: number, total: number): number {
  if (type === 'PERCENT') return Math.round((total * value) / 100);
  return Math.min(value, total);
}

/** Bảng reasonCode — SDD mục 5.2 */
export const PROMO_REASONS: Record<string, string> = {
  PROMO_NOT_FOUND: 'Mã khuyến mãi không tồn tại.',
  PROMO_INACTIVE: 'Mã khuyến mãi đang tạm dừng hoặc đã ngừng áp dụng.',
  PROMO_OUT_OF_DATE: 'Ngày chơi nằm ngoài thời gian áp dụng mã.',
  PROMO_OUT_OF_TIME: 'Giờ chơi nằm ngoài khung giờ của mã.',
  PROMO_WRONG_BRANCH: 'Mã không áp dụng cho cơ sở này.',
  PROMO_WRONG_SPORT: 'Mã không áp dụng cho môn thể thao của sân.',
  PROMO_WRONG_AUDIENCE: 'Mã chỉ dành cho khách hàng được chỉ định.',
  PROMO_EXHAUSTED: 'Mã khuyến mãi đã hết lượt sử dụng.',
};

export interface PromoCtx {
  branchId: number;
  sportId: number;
  date: string;
  startTime: string;
  endTime: string;
  customerUserId: number | null;
}

export interface PromoResult {
  code: string;
  applied: boolean;
  reasonCode: string | null;
  discountAmount: number;
  message: string | null;
}

export const describeDiscount = (p: Pick<Promotion, 'discountType' | 'discountValue' | 'maxDiscountAmount'>) =>
  p.discountType === 'PERCENT'
    ? `Giảm ${p.discountValue}% tiền thuê sân${p.maxDiscountAmount ? ` (tối đa ${fmtVnd(p.maxDiscountAmount)}đ)` : ''}`
    : `Giảm ${fmtVnd(p.discountValue)}đ tiền thuê sân`;

/** 3.5b + 3.5c — kiểm tra 8 điều kiện theo thứ tự, dừng ở điều kiện đầu tiên không đạt */
export function evalPromo(p: Promotion | undefined, code: string, ctx: PromoCtx, baseAmount: number): PromoResult {
  const fail = (reasonCode: string): PromoResult => ({
    code,
    applied: false,
    reasonCode,
    discountAmount: 0,
    message: PROMO_REASONS[reasonCode],
  });
  if (!p) return fail('PROMO_NOT_FOUND');
  if (p.status !== 'ACTIVE') return fail('PROMO_INACTIVE');
  if (ctx.date < p.startDate || ctx.date > p.endDate) return fail('PROMO_OUT_OF_DATE');
  if (p.timeFrom && p.timeTo && (toMin(ctx.startTime) < toMin(p.timeFrom) || toMin(ctx.endTime) > toMin(p.timeTo))) {
    return fail('PROMO_OUT_OF_TIME');
  }
  if (!p.allBranches && !p.branchIds.includes(ctx.branchId)) return fail('PROMO_WRONG_BRANCH');
  if (!p.allSports && !p.sportIds.includes(ctx.sportId)) return fail('PROMO_WRONG_SPORT');
  if (p.audienceType === 'SPECIFIC' && (ctx.customerUserId == null || !p.customerIds.includes(ctx.customerUserId))) {
    return fail('PROMO_WRONG_AUDIENCE');
  }
  if (p.usedCount >= p.maxUses) return fail('PROMO_EXHAUSTED');

  const raw = p.discountType === 'PERCENT' ? Math.round((baseAmount * p.discountValue) / 100) : p.discountValue;
  const discountAmount = Math.min(raw, p.maxDiscountAmount ?? Number.POSITIVE_INFINITY, baseAmount);
  return {
    code,
    applied: true,
    reasonCode: null,
    discountAmount,
    message: `Đã áp dụng mã ${code}: ${describeDiscount(p)}.`,
  };
}

export interface RefundPreview {
  cancelType: CancelType;
  canCancel: boolean;
  reasonIfNot: string | null;
  daysBeforeStart: number;
  paidAmount: number;
  depositKept: number;
  refundableBase: number;
  refundRate: number | null;
  refundAmount: number;
  retainedAmount: number;
  policyText: string;
}

/** 3.5e — hoàn tiền khi hủy */
export function refundPreview(b: Booking, cancelType: CancelType, atIso: string): RefundPreview {
  const st = MOCK_CONFIG.settings;
  const daysBeforeStart = Math.round(((ms(b.startAt) - ms(atIso)) / 86_400_000) * 100) / 100;
  let canCancel = true;
  let reasonIfNot: string | null = null;

  if (b.status !== 'PENDING_PAYMENT' && b.status !== 'CONFIRMED') {
    canCancel = false;
    reasonIfNot = 'Chỉ hủy được đơn Chờ thanh toán hoặc Đã xác nhận, trước giờ chơi.';
  } else if (cancelType === 'NO_SHOW') {
    if (b.status !== 'CONFIRMED' || ms(atIso) < ms(b.startAt) + st.NO_SHOW_GRACE_MINUTES * 60_000) {
      canCancel = false;
      reasonIfNot = `Chưa quá giờ nhận sân quy định (${st.NO_SHOW_GRACE_MINUTES} phút) — không thể chọn ‘Khách không đến nhận sân’.`;
    }
  } else if (cancelType === 'CUSTOMER_REQUEST' && ms(atIso) >= ms(b.startAt)) {
    canCancel = false;
    reasonIfNot = 'Chỉ hủy được đơn Chờ thanh toán hoặc Đã xác nhận, trước giờ chơi.';
  }

  const paid = b.paidAmount;
  const depositKept = b.paymentOption === 'DEPOSIT' ? Math.min(paid, b.depositAmount) : 0;
  const refundableBase = Math.max(paid - (b.paymentOption === 'DEPOSIT' ? b.depositAmount : 0), 0);

  let refundRate: number | null;
  let policyText: string;
  if (cancelType === 'BY_FACILITY') {
    refundRate = 100;
    policyText = 'cơ sở đóng đơn — hoàn toàn bộ';
  } else if (b.status === 'PENDING_PAYMENT' || paid === 0) {
    refundRate = null;
    policyText = 'đơn chưa thanh toán';
  } else if (cancelType === 'NO_SHOW') {
    refundRate = 0;
    policyText = 'khách không đến nhận sân';
  } else if (daysBeforeStart >= st.REFUND_FULL_DAYS) {
    refundRate = 100;
    policyText = `hủy trước từ ${st.REFUND_FULL_DAYS} ngày`;
  } else if (daysBeforeStart >= st.REFUND_HALF_DAYS) {
    refundRate = st.REFUND_HALF_RATE;
    policyText = `hủy trước ${st.REFUND_HALF_DAYS}–${st.REFUND_FULL_DAYS} ngày`;
  } else {
    refundRate = 0;
    policyText = `hủy dưới ${st.REFUND_HALF_DAYS} ngày`;
  }

  const refundAmount =
    cancelType === 'BY_FACILITY' ? paid : Math.round((refundableBase * (refundRate ?? 0)) / 100);

  return {
    cancelType,
    canCancel,
    reasonIfNot,
    daysBeforeStart,
    paidAmount: paid,
    depositKept: cancelType === 'BY_FACILITY' ? 0 : depositKept,
    refundableBase,
    refundRate,
    refundAmount,
    retainedAmount: paid - refundAmount,
    policyText,
  };
}

export const bookingDate = (b: Booking) => dateOf(b.startAt);
export const bookingStart = (b: Booking) => timeOf(b.startAt);
