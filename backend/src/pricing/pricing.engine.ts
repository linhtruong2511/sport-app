import {
  type AudienceType,
  type BookingStatus,
  type CancelType,
  type DepositType,
  type DiscountType,
  PROMO_REASON_MESSAGES,
  type PaymentOption,
  type PromoReasonCode,
  type PromotionStatus,
} from '@sporthub/shared/enums';
import { AppError } from '../core/errors.js';
import { assertIntVnd, calcDeposit, calcDiscount, calcSegmentAmount, percentOf } from '../core/money.js';
import {
  dayOfWeekBit,
  diffSeconds,
  minutesToTime,
  parseTimeToMinutes,
  vnDayOfWeek,
} from '../core/time.js';

export interface PriceRuleInput {
  priceRuleId: number;
  label: string;
  dayOfWeekMask: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface ComputedPriceLine {
  priceRuleId: number;
  label: string;
  startTime: string;
  endTime: string;
  pricePerHour: number;
  amount: number;
}

interface SegmentCandidate {
  priceRuleId: number;
  label: string;
  segStart: number;
  segEnd: number;
  pricePerHour: number;
}

/**
 * Pure rental price calculator (SDD 3.5a, R-10).
 * Selects rules active at `now`, matching `date`'s Vietnam day of week,
 * and verifies contiguous coverage over `[startTime, endTime)`.
 */
export function calculateRentalPrice(input: {
  date: string;
  startTime: string;
  endTime: string;
  now: Date;
  rules: PriceRuleInput[];
}): { priceLines: ComputedPriceLine[]; baseAmount: number } {
  const reqStart = parseTimeToMinutes(input.startTime);
  const reqEnd = parseTimeToMinutes(input.endTime);
  if (reqStart >= reqEnd) {
    throw new AppError('PRICE_NOT_CONFIGURED');
  }

  const nowMs = input.now.getTime();
  const dowBit = dayOfWeekBit(vnDayOfWeek(input.date));

  const segments: SegmentCandidate[] = [];
  for (const rule of input.rules) {
    // R-10: effective at booking creation time (now), not play date.
    const effectiveFromMs = rule.effectiveFrom.getTime();
    const effectiveToMs = rule.effectiveTo ? rule.effectiveTo.getTime() : null;
    if (!(effectiveFromMs <= nowMs && (effectiveToMs === null || nowMs < effectiveToMs))) {
      continue;
    }

    if ((rule.dayOfWeekMask & dowBit) === 0) {
      continue;
    }

    const ruleStart = parseTimeToMinutes(rule.startTime);
    const ruleEnd = parseTimeToMinutes(rule.endTime);
    const segStart = Math.max(reqStart, ruleStart);
    const segEnd = Math.min(reqEnd, ruleEnd);
    if (segStart < segEnd) {
      segments.push({
        priceRuleId: rule.priceRuleId,
        label: rule.label,
        segStart,
        segEnd,
        pricePerHour: rule.pricePerHour,
      });
    }
  }

  if (segments.length === 0) {
    throw new AppError('PRICE_NOT_CONFIGURED');
  }

  segments.sort((a, b) => a.segStart - b.segStart || a.segEnd - b.segEnd);

  let cursor = reqStart;
  const priceLines: ComputedPriceLine[] = [];
  let baseAmount = 0;

  for (const seg of segments) {
    if (seg.segStart > cursor) {
      throw new AppError('PRICE_NOT_CONFIGURED');
    }
    const effectiveStart = Math.max(seg.segStart, cursor);
    if (effectiveStart >= seg.segEnd) {
      continue;
    }
    const amount = calcSegmentAmount(seg.pricePerHour, seg.segEnd - effectiveStart);
    priceLines.push({
      priceRuleId: seg.priceRuleId,
      label: seg.label,
      startTime: minutesToTime(effectiveStart),
      endTime: minutesToTime(seg.segEnd),
      pricePerHour: seg.pricePerHour,
      amount,
    });
    baseAmount += amount;
    cursor = seg.segEnd;
  }

  if (cursor < reqEnd) {
    throw new AppError('PRICE_NOT_CONFIGURED');
  }

  return { priceLines, baseAmount };
}

export interface PromotionEvalInput {
  code: string;
  promo: {
    promotionId: number;
    code: string;
    name: string;
    status: PromotionStatus;
    discountType: DiscountType;
    discountValue: number;
    maxDiscountAmount: number | null;
    startDate: string;
    endDate: string;
    timeFrom: string | null;
    timeTo: string | null;
    allBranches: boolean;
    allSports: boolean;
    audienceType: AudienceType;
    maxUses: number;
    usedCount: number;
  } | null;
  date: string;
  startTime: string;
  endTime: string;
  baseAmount: number;
  isGuest: boolean;
  isBranchEligible: boolean;
  isSportEligible: boolean;
  isCustomerEligible: boolean;
}

export interface PromotionEvalResult {
  applied: boolean;
  reasonCode: PromoReasonCode | null;
  discountAmount: number;
  message: string;
}

function failPromo(reasonCode: PromoReasonCode): PromotionEvalResult {
  return {
    applied: false,
    reasonCode,
    discountAmount: 0,
    message: PROMO_REASON_MESSAGES[reasonCode],
  };
}

/**
 * Evaluates a promotion code against the exact 8-step priority order (SDD 3.5b-c, UC 008).
 */
export function evaluatePromotion(input: PromotionEvalInput): PromotionEvalResult {
  const { promo, date, startTime, endTime, baseAmount, isGuest } = input;

  // 1. Code exists
  if (!promo) {
    return failPromo('PROMO_NOT_FOUND');
  }

  // 2. Status = ACTIVE
  if (promo.status !== 'ACTIVE') {
    return failPromo('PROMO_INACTIVE');
  }

  // 3. StartDate <= play date <= EndDate
  if (date < promo.startDate || date > promo.endDate) {
    return failPromo('PROMO_OUT_OF_DATE');
  }

  // 4. TimeFrom <= startTime and endTime <= TimeTo (skip when null)
  if ((promo.timeFrom && startTime < promo.timeFrom) || (promo.timeTo && endTime > promo.timeTo)) {
    return failPromo('PROMO_OUT_OF_TIME');
  }

  // 5. AllBranches or branch in PromotionBranches
  if (!promo.allBranches && !input.isBranchEligible) {
    return failPromo('PROMO_WRONG_BRANCH');
  }

  // 6. AllSports or sport in PromotionSports
  if (!promo.allSports && !input.isSportEligible) {
    return failPromo('PROMO_WRONG_SPORT');
  }

  // 7. AudienceType = ALL or customer in PromotionCustomers (guests cannot use SPECIFIC)
  if (promo.audienceType === 'SPECIFIC' && (isGuest || !input.isCustomerEligible)) {
    return failPromo('PROMO_WRONG_AUDIENCE');
  }

  // 8. UsedCount < MaxUses
  if (promo.usedCount >= promo.maxUses) {
    return failPromo('PROMO_EXHAUSTED');
  }

  const discountAmount = calcDiscount(
    baseAmount,
    promo.discountType,
    promo.discountValue,
    promo.maxDiscountAmount,
  );

  const discountDesc =
    promo.discountType === 'PERCENT'
      ? `${promo.discountValue}%`
      : `${promo.discountValue.toLocaleString('vi-VN')}đ`;

  return {
    applied: true,
    reasonCode: null,
    discountAmount,
    message: `Đã áp dụng mã ${promo.code}: Giảm ${discountDesc} tiền thuê sân.`,
  };
}

export interface QuoteAmountsResult {
  totalAmount: number;
  depositAmount: number;
  amountDueNow: number;
  remainingOnArrival: number;
  fullPaymentRequired: boolean;
}

/**
 * Computes total, deposit, immediate payment, and remaining amount (SDD 3.5d, R-09).
 */
export function calculateQuoteAmounts(input: {
  baseAmount: number;
  discountAmount: number;
  paymentOption: PaymentOption;
  depositType: DepositType | null;
  depositValue: number | null;
}): QuoteAmountsResult {
  assertIntVnd(input.baseAmount);
  assertIntVnd(input.discountAmount);
  const totalAmount = assertIntVnd(input.baseAmount - input.discountAmount);

  const dep = calcDeposit(totalAmount, input.paymentOption, input.depositType, input.depositValue);
  if (dep.fullPaymentRequired) {
    return {
      totalAmount,
      depositAmount: 0,
      amountDueNow: totalAmount,
      remainingOnArrival: 0,
      fullPaymentRequired: true,
    };
  }

  return {
    totalAmount,
    depositAmount: dep.depositAmount,
    amountDueNow: dep.amountDueNow,
    remainingOnArrival: totalAmount - dep.amountDueNow,
    fullPaymentRequired: false,
  };
}

/**
 * Guards booking creation against DEPOSIT when fullPaymentRequired is true (R-09).
 */
export function assertPaymentOptionAllowed(
  paymentOption: PaymentOption,
  fullPaymentRequired: boolean,
): void {
  if (paymentOption === 'DEPOSIT' && fullPaymentRequired) {
    throw new AppError('DEPOSIT_NOT_ALLOWED');
  }
}

export interface RefundCalculationResult {
  refundRate: number | null;
  refundAmount: number | null;
  depositKept: number;
  refundableBase: number;
}

/**
 * Pure refund calculation shared between cancel-preview and cancel execution (SDD 3.5e, UC 009).
 */
export function calculateRefund(input: {
  startAt: Date;
  canceledAt: Date;
  status: BookingStatus;
  paymentOption: PaymentOption;
  paidAmount: number;
  depositAmount: number;
  cancelType: CancelType;
  settings: {
    refundFullDays: number;
    refundHalfDays: number;
    refundHalfRate: number;
  };
}): RefundCalculationResult {
  if (input.cancelType === 'BY_FACILITY') {
    return {
      refundRate: 100,
      refundAmount: input.paidAmount,
      depositKept: 0,
      refundableBase: input.paidAmount,
    };
  }

  if (input.status === 'PENDING_PAYMENT' || input.cancelType === 'COUNTER_ABORT') {
    return {
      refundRate: null,
      refundAmount: null,
      depositKept: 0,
      refundableBase: 0,
    };
  }

  const depositKept =
    input.paymentOption === 'DEPOSIT' ? Math.min(input.paidAmount, input.depositAmount) : 0;
  const refundableBase = Math.max(input.paidAmount - input.depositAmount, 0);

  if (input.cancelType === 'NO_SHOW') {
    return {
      refundRate: 0,
      refundAmount: 0,
      depositKept,
      refundableBase,
    };
  }

  const tDays = diffSeconds(input.startAt, input.canceledAt) / 86_400;
  const refundRate =
    tDays >= input.settings.refundFullDays
      ? 100
      : tDays >= input.settings.refundHalfDays
        ? input.settings.refundHalfRate
        : 0;
  const refundAmount = percentOf(refundableBase, refundRate);

  return {
    refundRate,
    refundAmount,
    depositKept,
    refundableBase,
  };
}
