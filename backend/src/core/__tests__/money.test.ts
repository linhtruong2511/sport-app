import { describe, expect, it } from 'vitest';
import {
  assertIntVnd,
  calcDeposit,
  calcDiscount,
  calcSegmentAmount,
  percentOf,
  roundVnd,
} from '../money.js';

describe('core/money', () => {
  it('validates non-negative safe integers for VND', () => {
    expect(assertIntVnd(0)).toBe(0);
    expect(assertIntVnd(150_000)).toBe(150_000);
    expect(() => assertIntVnd(-1)).toThrow();
    expect(() => assertIntVnd(100.5)).toThrow();
    expect(() => assertIntVnd(Number.NaN)).toThrow();
  });

  it('rounds and calculates segment amounts accurately', () => {
    expect(roundVnd(100.5)).toBe(101);
    expect(roundVnd(-0)).toBe(0);
    expect(percentOf(360_000, 30)).toBe(108_000);

    // 15:00-16:00 @ 150k + 16:00-17:00 @ 250k = 400k
    expect(calcSegmentAmount(150_000, 60) + calcSegmentAmount(250_000, 60)).toBe(400_000);
    // 90 mins @ 300k/h = 450k
    expect(calcSegmentAmount(300_000, 90)).toBe(450_000);
  });

  it('calculates percentage and fixed discounts with cap and floor', () => {
    // 20% of 600,000 capped at 100,000 -> 100,000
    expect(calcDiscount(600_000, 'PERCENT', 20, 100_000)).toBe(100_000);
    // 20% of 450,000 no cap -> 90,000
    expect(calcDiscount(450_000, 'PERCENT', 20, null)).toBe(90_000);
    // Fixed larger than base -> capped at base (Total = 0)
    expect(calcDiscount(80_000, 'FIXED', 100_000)).toBe(80_000);
  });

  it('matches all deposit calculation rules including R-09', () => {
    // 1. Mini football 360k, 30% deposit
    expect(calcDeposit(360_000, 'DEPOSIT', 'PERCENT', 30)).toEqual({
      depositAmount: 108_000,
      amountDueNow: 108_000,
      fullPaymentRequired: false,
    });

    // 2. Badminton 120k, fixed 50k deposit
    expect(calcDeposit(120_000, 'DEPOSIT', 'FIXED', 50_000)).toEqual({
      depositAmount: 50_000,
      amountDueNow: 50_000,
      fullPaymentRequired: false,
    });

    // 3. Badminton 30k after discount, fixed 50k deposit -> fullPaymentRequired = true (R-09)
    expect(calcDeposit(30_000, 'FULL', 'FIXED', 50_000)).toEqual({
      depositAmount: 0,
      amountDueNow: 30_000,
      fullPaymentRequired: true,
    });

    // 4. Pickleball 500k, FULL option with 30% rule
    expect(calcDeposit(500_000, 'FULL', 'PERCENT', 30)).toEqual({
      depositAmount: 0,
      amountDueNow: 500_000,
      fullPaymentRequired: false,
    });

    // 5. Fractional percentage (50.5%) rounds half-up via Math.round
    expect(calcDeposit(100_001, 'DEPOSIT', 'PERCENT', 50.5)).toEqual({
      depositAmount: 50_501,
      amountDueNow: 50_501,
      fullPaymentRequired: false,
    });

    // 6. Zero total -> fullPaymentRequired = true
    expect(calcDeposit(0, 'FULL', 'PERCENT', 30)).toEqual({
      depositAmount: 0,
      amountDueNow: 0,
      fullPaymentRequired: true,
    });
  });
});
