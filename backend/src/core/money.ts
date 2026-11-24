import type { DepositType, DiscountType, PaymentOption } from '@sporthub/shared/enums';

export function assertIntVnd(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Invalid VND amount: ${n}`);
  }
  return n;
}

export function roundVnd(x: number): number {
  const rounded = Math.round(x);
  return rounded === 0 ? 0 : rounded;
}

export function percentOf(amount: number, rate: number): number {
  return roundVnd((amount * rate) / 100);
}

export function calcSegmentAmount(pricePerHour: number, minutes: number): number {
  return roundVnd((pricePerHour * minutes) / 60);
}

export function calcDiscount(
  baseAmount: number,
  type: DiscountType,
  value: number,
  maxDiscountAmount?: number | null,
): number {
  assertIntVnd(baseAmount);
  const raw = type === 'PERCENT' ? percentOf(baseAmount, value) : roundVnd(value);
  const capped = maxDiscountAmount != null ? Math.min(raw, roundVnd(maxDiscountAmount)) : raw;
  return Math.max(0, Math.min(capped, baseAmount));
}

export interface CalcDepositResult {
  depositAmount: number;
  amountDueNow: number;
  fullPaymentRequired: boolean;
}

export function calcDeposit(
  totalAmount: number,
  option: PaymentOption,
  depositType: DepositType | null,
  depositValue: number | null,
): CalcDepositResult {
  assertIntVnd(totalAmount);

  // R-09: if computed raw deposit >= totalAmount (or no deposit rule configured), full payment is required.
  let rawDeposit: number;
  if (depositType === 'PERCENT' && depositValue !== null) {
    rawDeposit = percentOf(totalAmount, depositValue);
  } else if (depositType === 'FIXED' && depositValue !== null) {
    rawDeposit = Math.min(roundVnd(depositValue), totalAmount);
  } else {
    rawDeposit = totalAmount;
  }

  const fullPaymentRequired = rawDeposit >= totalAmount;

  if (option === 'FULL') {
    return {
      depositAmount: 0,
      amountDueNow: totalAmount,
      fullPaymentRequired,
    };
  }

  return {
    depositAmount: rawDeposit,
    amountDueNow: rawDeposit,
    fullPaymentRequired,
  };
}
