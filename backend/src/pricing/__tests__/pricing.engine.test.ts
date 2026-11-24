import { PROMO_REASON_MESSAGES } from '@sporthub/shared/enums';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../core/errors.js';
import { parseVnDateTime } from '../../core/time.js';
import {
  type PriceRuleInput,
  type PromotionEvalInput,
  assertPaymentOptionAllowed,
  calculateQuoteAmounts,
  calculateRefund,
  calculateRentalPrice,
  evaluatePromotion,
} from '../pricing.engine.js';

function makeRules(): PriceRuleInput[] {
  const effFrom = parseVnDateTime('2026-01-01', '00:00:00');
  return [
    {
      priceRuleId: 1,
      label: 'Giờ thường',
      dayOfWeekMask: 127,
      startTime: '05:00',
      endTime: '16:00',
      pricePerHour: 150_000,
      effectiveFrom: effFrom,
      effectiveTo: null,
    },
    {
      priceRuleId: 2,
      label: 'Giờ cao điểm',
      dayOfWeekMask: 127,
      startTime: '16:00',
      endTime: '23:00',
      pricePerHour: 250_000,
      effectiveFrom: effFrom,
      effectiveTo: null,
    },
  ];
}

function makePromoInput(overrides: Partial<PromotionEvalInput> = {}): PromotionEvalInput {
  return {
    code: 'TESTPROMO',
    promo: {
      promotionId: 1,
      code: 'TESTPROMO',
      name: 'Khuyến mãi test',
      status: 'ACTIVE',
      discountType: 'PERCENT',
      discountValue: 20,
      maxDiscountAmount: 100_000,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
      timeFrom: '06:00',
      timeTo: '11:00',
      allBranches: false,
      allSports: false,
      audienceType: 'SPECIFIC',
      maxUses: 10,
      usedCount: 2,
    },
    date: '2026-11-15',
    startTime: '07:00',
    endTime: '09:00',
    baseAmount: 600_000,
    isGuest: false,
    isBranchEligible: true,
    isSportEligible: true,
    isCustomerEligible: true,
    ...overrides,
  };
}

describe('pricing.engine — rental price (Tiền)', () => {
  it('splits 15:00–17:00 across 2 price rules -> 2 lines, Base = 400,000', () => {
    const now = parseVnDateTime('2026-11-10', '10:00:00');
    const result = calculateRentalPrice({
      date: '2026-11-12',
      startTime: '15:00',
      endTime: '17:00',
      now,
      rules: makeRules(),
    });

    expect(result.baseAmount).toBe(400_000);
    expect(result.priceLines).toEqual([
      {
        priceRuleId: 1,
        label: 'Giờ thường',
        startTime: '15:00',
        endTime: '16:00',
        pricePerHour: 150_000,
        amount: 150_000,
      },
      {
        priceRuleId: 2,
        label: 'Giờ cao điểm',
        startTime: '16:00',
        endTime: '17:00',
        pricePerHour: 250_000,
        amount: 250_000,
      },
    ]);
  });

  it('throws PRICE_NOT_CONFIGURED when a segment has no price coverage', () => {
    const now = parseVnDateTime('2026-11-10', '10:00:00');
    const effFrom = parseVnDateTime('2026-01-01', '00:00:00');

    // Gap in the middle (12:00-14:00 missing)
    const rulesWithGap: PriceRuleInput[] = [
      {
        priceRuleId: 1,
        label: 'Sáng',
        dayOfWeekMask: 127,
        startTime: '05:00',
        endTime: '12:00',
        pricePerHour: 150_000,
        effectiveFrom: effFrom,
        effectiveTo: null,
      },
      {
        priceRuleId: 2,
        label: 'Chiều',
        dayOfWeekMask: 127,
        startTime: '14:00',
        endTime: '23:00',
        pricePerHour: 200_000,
        effectiveFrom: effFrom,
        effectiveTo: null,
      },
    ];

    expect(() =>
      calculateRentalPrice({
        date: '2026-11-12',
        startTime: '11:00',
        endTime: '15:00',
        now,
        rules: rulesWithGap,
      }),
    ).toThrowError(AppError);

    try {
      calculateRentalPrice({
        date: '2026-11-12',
        startTime: '11:00',
        endTime: '15:00',
        now,
        rules: rulesWithGap,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('PRICE_NOT_CONFIGURED');
    }

    // Empty rules
    expect(() =>
      calculateRentalPrice({
        date: '2026-11-12',
        startTime: '08:00',
        endTime: '10:00',
        now,
        rules: [],
      }),
    ).toThrowError(AppError);

    // Day-of-week mismatch (2026-11-29 is Sunday -> bit 64; mask 63 = Mon..Sat)
    expect(() =>
      calculateRentalPrice({
        date: '2026-11-29',
        startTime: '08:00',
        endTime: '10:00',
        now,
        rules: makeRules().map((r) => ({ ...r, dayOfWeekMask: 63 })),
      }),
    ).toThrowError(AppError);
  });

  it('selects price rule active at booking creation time now (R-10), not play date', () => {
    const switchAt = parseVnDateTime('2026-11-01', '00:00:00');
    const rules: PriceRuleInput[] = [
      {
        priceRuleId: 10,
        label: 'Giờ cao điểm',
        dayOfWeekMask: 127,
        startTime: '16:00',
        endTime: '23:00',
        pricePerHour: 600_000,
        effectiveFrom: parseVnDateTime('2026-01-01', '00:00:00'),
        effectiveTo: switchAt,
      },
      {
        priceRuleId: 11,
        label: 'Giờ cao điểm',
        dayOfWeekMask: 127,
        startTime: '16:00',
        endTime: '23:00',
        pricePerHour: 650_000,
        effectiveFrom: switchAt,
        effectiveTo: null,
      },
    ];

    // Play date is 2026-11-05, but booked before 2026-11-01 -> 600k
    const beforeSwitch = parseVnDateTime('2026-10-31', '23:59:59');
    const resBefore = calculateRentalPrice({
      date: '2026-11-05',
      startTime: '18:00',
      endTime: '19:00',
      now: beforeSwitch,
      rules,
    });
    expect(resBefore.baseAmount).toBe(600_000);
    expect(resBefore.priceLines[0]?.priceRuleId).toBe(10);

    // Booked exactly at 2026-11-01 00:00:00 -> 650k (EffectiveFrom <= now < EffectiveTo)
    const atSwitch = parseVnDateTime('2026-11-01', '00:00:00');
    const resAt = calculateRentalPrice({
      date: '2026-11-05',
      startTime: '18:00',
      endTime: '19:00',
      now: atSwitch,
      rules,
    });
    expect(resAt.baseAmount).toBe(650_000);
    expect(resAt.priceLines[0]?.priceRuleId).toBe(11);
  });
});

describe('pricing.engine — deposit & quote amounts (Tiền & Cọc)', () => {
  it('handles all 4 deposit examples from business-rules section 6 and fractional 50.5%', () => {
    // 1. Mini football 09:00-10:30 (450k), SANGVUI20 -20% (-90k) => total 360k, DEPOSIT 30%
    expect(
      calculateQuoteAmounts({
        baseAmount: 450_000,
        discountAmount: 90_000,
        paymentOption: 'DEPOSIT',
        depositType: 'PERCENT',
        depositValue: 30,
      }),
    ).toEqual({
      totalAmount: 360_000,
      depositAmount: 108_000,
      amountDueNow: 108_000,
      remainingOnArrival: 252_000,
      fullPaymentRequired: false,
    });

    // 2. Badminton 120k, DEPOSIT FIXED 50k
    expect(
      calculateQuoteAmounts({
        baseAmount: 120_000,
        discountAmount: 0,
        paymentOption: 'DEPOSIT',
        depositType: 'FIXED',
        depositValue: 50_000,
      }),
    ).toEqual({
      totalAmount: 120_000,
      depositAmount: 50_000,
      amountDueNow: 50_000,
      remainingOnArrival: 70_000,
      fullPaymentRequired: false,
    });

    // 3. Badminton total 30k after discount, FIXED 50k => fullPaymentRequired = true, DEPOSIT blocked
    const fullReqResult = calculateQuoteAmounts({
      baseAmount: 80_000,
      discountAmount: 50_000,
      paymentOption: 'DEPOSIT',
      depositType: 'FIXED',
      depositValue: 50_000,
    });
    expect(fullReqResult).toEqual({
      totalAmount: 30_000,
      depositAmount: 0,
      amountDueNow: 30_000,
      remainingOnArrival: 0,
      fullPaymentRequired: true,
    });
    expect(() => assertPaymentOptionAllowed('DEPOSIT', fullReqResult.fullPaymentRequired)).toThrowError(
      AppError,
    );
    try {
      assertPaymentOptionAllowed('DEPOSIT', true);
    } catch (err) {
      expect((err as AppError).code).toBe('DEPOSIT_NOT_ALLOWED');
    }
    expect(() => assertPaymentOptionAllowed('FULL', true)).not.toThrow();

    // 4. Pickleball 500k, FULL, 30% rule
    expect(
      calculateQuoteAmounts({
        baseAmount: 500_000,
        discountAmount: 0,
        paymentOption: 'FULL',
        depositType: 'PERCENT',
        depositValue: 30,
      }),
    ).toEqual({
      totalAmount: 500_000,
      depositAmount: 0,
      amountDueNow: 500_000,
      remainingOnArrival: 0,
      fullPaymentRequired: false,
    });

    // 5. Fractional depositValue 50.5% rounds half-up
    expect(
      calculateQuoteAmounts({
        baseAmount: 100_001,
        discountAmount: 0,
        paymentOption: 'DEPOSIT',
        depositType: 'PERCENT',
        depositValue: 50.5,
      }),
    ).toEqual({
      totalAmount: 100_001,
      depositAmount: 50_501,
      amountDueNow: 50_501,
      remainingOnArrival: 49_500,
      fullPaymentRequired: false,
    });
  });

  it('caps PERCENT discount and clamps FIXED > Base to Total = 0', () => {
    const capped = evaluatePromotion(
      makePromoInput({
        baseAmount: 600_000,
      }),
    );
    expect(capped.applied).toBe(true);
    expect(capped.discountAmount).toBe(100_000);

    const fixedOverBase = evaluatePromotion(
      makePromoInput({
        baseAmount: 80_000,
        promo: {
          ...makePromoInput().promo!,
          discountType: 'FIXED',
          discountValue: 100_000,
          maxDiscountAmount: null,
        },
      }),
    );
    expect(fixedOverBase.applied).toBe(true);
    expect(fixedOverBase.discountAmount).toBe(80_000);

    const zeroTotalAmounts = calculateQuoteAmounts({
      baseAmount: 80_000,
      discountAmount: fixedOverBase.discountAmount,
      paymentOption: 'FULL',
      depositType: 'PERCENT',
      depositValue: 30,
    });
    expect(zeroTotalAmounts).toEqual({
      totalAmount: 0,
      depositAmount: 0,
      amountDueNow: 0,
      remainingOnArrival: 0,
      fullPaymentRequired: true,
    });
  });
});

describe('pricing.engine — promotion 8-step evaluation & priority', () => {
  it('returns each of the 8 reasonCodes', () => {
    // 1. PROMO_NOT_FOUND
    const r1 = evaluatePromotion(makePromoInput({ promo: null }));
    expect(r1).toEqual({
      applied: false,
      reasonCode: 'PROMO_NOT_FOUND',
      discountAmount: 0,
      message: PROMO_REASON_MESSAGES.PROMO_NOT_FOUND,
    });

    // 2. PROMO_INACTIVE
    const r2 = evaluatePromotion(
      makePromoInput({ promo: { ...makePromoInput().promo!, status: 'PAUSED' } }),
    );
    expect(r2.reasonCode).toBe('PROMO_INACTIVE');

    // 3. PROMO_OUT_OF_DATE
    const r3 = evaluatePromotion(makePromoInput({ date: '2026-12-01' }));
    expect(r3.reasonCode).toBe('PROMO_OUT_OF_DATE');

    // 4. PROMO_OUT_OF_TIME
    const r4 = evaluatePromotion(makePromoInput({ startTime: '05:30', endTime: '07:30' }));
    expect(r4.reasonCode).toBe('PROMO_OUT_OF_TIME');
    const r4b = evaluatePromotion(makePromoInput({ startTime: '10:00', endTime: '11:30' }));
    expect(r4b.reasonCode).toBe('PROMO_OUT_OF_TIME');

    // 5. PROMO_WRONG_BRANCH
    const r5 = evaluatePromotion(makePromoInput({ isBranchEligible: false }));
    expect(r5.reasonCode).toBe('PROMO_WRONG_BRANCH');

    // 6. PROMO_WRONG_SPORT
    const r6 = evaluatePromotion(makePromoInput({ isSportEligible: false }));
    expect(r6.reasonCode).toBe('PROMO_WRONG_SPORT');

    // 7. PROMO_WRONG_AUDIENCE (guest on SPECIFIC, or non-eligible registered customer)
    const r7Guest = evaluatePromotion(makePromoInput({ isGuest: true, isCustomerEligible: false }));
    expect(r7Guest.reasonCode).toBe('PROMO_WRONG_AUDIENCE');
    const r7Other = evaluatePromotion(makePromoInput({ isGuest: false, isCustomerEligible: false }));
    expect(r7Other.reasonCode).toBe('PROMO_WRONG_AUDIENCE');

    // 8. PROMO_EXHAUSTED
    const r8 = evaluatePromotion(
      makePromoInput({ promo: { ...makePromoInput().promo!, usedCount: 10, maxUses: 10 } }),
    );
    expect(r8.reasonCode).toBe('PROMO_EXHAUSTED');
  });

  it('enforces exact priority order when multiple conditions fail simultaneously', () => {
    const basePromo = makePromoInput().promo!;

    // Condition 2 (INACTIVE) beats 3..8
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, status: 'DISCONTINUED', usedCount: 10 },
          date: '2026-12-10',
          startTime: '18:00',
          endTime: '20:00',
          isBranchEligible: false,
          isSportEligible: false,
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_INACTIVE');

    // Condition 3 (OUT_OF_DATE) beats 4..8
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, usedCount: 10 },
          date: '2026-12-10',
          startTime: '18:00',
          endTime: '20:00',
          isBranchEligible: false,
          isSportEligible: false,
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_OUT_OF_DATE');

    // Condition 4 (OUT_OF_TIME) beats 5..8
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, usedCount: 10 },
          startTime: '18:00',
          endTime: '20:00',
          isBranchEligible: false,
          isSportEligible: false,
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_OUT_OF_TIME');

    // Condition 5 (WRONG_BRANCH) beats 6..8
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, usedCount: 10 },
          isBranchEligible: false,
          isSportEligible: false,
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_WRONG_BRANCH');

    // Condition 6 (WRONG_SPORT) beats 7..8
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, usedCount: 10 },
          isSportEligible: false,
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_WRONG_SPORT');

    // Condition 7 (WRONG_AUDIENCE) beats 8 (EXHAUSTED)
    expect(
      evaluatePromotion(
        makePromoInput({
          promo: { ...basePromo, usedCount: 10 },
          isGuest: true,
        }),
      ).reasonCode,
    ).toBe('PROMO_WRONG_AUDIENCE');
  });
});

describe('pricing.engine — refund calculation (Hủy & hoàn)', () => {
  const settings = { refundFullDays: 5, refundHalfDays: 2, refundHalfRate: 50 };
  const startAt = parseVnDateTime('2026-11-20', '10:00:00');

  it('evaluates exact day boundaries: 5d -> 100%, 4d23:59:59 -> 50%, 2d -> 50%, 1.99d -> 0%', () => {
    // T = exactly 5 days -> 100%
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-15', '10:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'FULL',
        paidAmount: 400_000,
        depositAmount: 0,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 100,
      refundAmount: 400_000,
      depositKept: 0,
      refundableBase: 400_000,
    });

    // T = 4 days 23:59:59 -> 50%
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-15', '10:00:01'),
        status: 'CONFIRMED',
        paymentOption: 'FULL',
        paidAmount: 400_000,
        depositAmount: 0,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 50,
      refundAmount: 200_000,
      depositKept: 0,
      refundableBase: 400_000,
    });

    // T = exactly 2 days -> 50%
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-18', '10:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'FULL',
        paidAmount: 400_000,
        depositAmount: 0,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 50,
      refundAmount: 200_000,
      depositKept: 0,
      refundableBase: 400_000,
    });

    // T = 1.99 days (1 second under 2 days) -> 0%
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-18', '10:00:01'),
        status: 'CONFIRMED',
        paymentOption: 'FULL',
        paidAmount: 400_000,
        depositAmount: 0,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 0,
      refundAmount: 0,
      depositKept: 0,
      refundableBase: 400_000,
    });
  });

  it('handles FULL vs unsettled DEPOSIT vs settled DEPOSIT, NO_SHOW, BY_FACILITY, and PENDING_PAYMENT', () => {
    // FULL 400k canceled 10 days before -> refund 400k
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-10', '10:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'FULL',
        paidAmount: 400_000,
        depositAmount: 0,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 100,
      refundAmount: 400_000,
      depositKept: 0,
      refundableBase: 400_000,
    });

    // DEPOSIT unsettled (Paid 108k == Deposit 108k) canceled 10 days before -> refund 0, keep deposit
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-10', '10:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'DEPOSIT',
        paidAmount: 108_000,
        depositAmount: 108_000,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 100,
      refundAmount: 0,
      depositKept: 108_000,
      refundableBase: 0,
    });

    // DEPOSIT settled (Paid = Total = 360k, Deposit = 108k) canceled 3 days before -> 50% of (360k - 108k) = 126k
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-17', '10:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'DEPOSIT',
        paidAmount: 360_000,
        depositAmount: 108_000,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: 50,
      refundAmount: 126_000,
      depositKept: 108_000,
      refundableBase: 252_000,
    });

    // NO_SHOW on DEPOSITED -> 0 refund, keeps deposit
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-20', '10:30:00'),
        status: 'CONFIRMED',
        paymentOption: 'DEPOSIT',
        paidAmount: 108_000,
        depositAmount: 108_000,
        cancelType: 'NO_SHOW',
        settings,
      }),
    ).toEqual({
      refundRate: 0,
      refundAmount: 0,
      depositKept: 108_000,
      refundableBase: 0,
    });

    // NO_SHOW on PAID (with DEPOSIT option) -> 0 refund, keeps deposit
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-20', '12:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'DEPOSIT',
        paidAmount: 360_000,
        depositAmount: 108_000,
        cancelType: 'NO_SHOW',
        settings,
      }),
    ).toEqual({
      refundRate: 0,
      refundAmount: 0,
      depositKept: 108_000,
      refundableBase: 252_000,
    });

    // BY_FACILITY -> 100% of paidAmount including deposit
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-20', '09:00:00'),
        status: 'CONFIRMED',
        paymentOption: 'DEPOSIT',
        paidAmount: 108_000,
        depositAmount: 108_000,
        cancelType: 'BY_FACILITY',
        settings,
      }),
    ).toEqual({
      refundRate: 100,
      refundAmount: 108_000,
      depositKept: 0,
      refundableBase: 108_000,
    });

    // PENDING_PAYMENT or COUNTER_ABORT -> null rates/amounts
    expect(
      calculateRefund({
        startAt,
        canceledAt: parseVnDateTime('2026-11-19', '10:00:00'),
        status: 'PENDING_PAYMENT',
        paymentOption: 'DEPOSIT',
        paidAmount: 0,
        depositAmount: 108_000,
        cancelType: 'CUSTOMER_REQUEST',
        settings,
      }),
    ).toEqual({
      refundRate: null,
      refundAmount: null,
      depositKept: 0,
      refundableBase: 0,
    });
  });
});
