import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUS_LABELS,
  ERROR_CATALOG,
  PROMO_REASON_MESSAGES,
  courtDescriptionSchema,
  courtNameSchema,
  depositConfigSchema,
  discountConfigSchema,
  emailSchema,
  fullNameSchema,
  isoDateSchema,
  paginationSchema,
  passwordSchema,
  phoneSchema,
  promoCodeSchema,
  promoNameSchema,
  reasonSchema,
  timeHHmmSchema,
  uuidV4Schema,
} from '../index.js';

describe('@sporthub/shared validators & catalog', () => {
  it('validates Vietnamese phone numbers', () => {
    expect(phoneSchema.safeParse('0987654321').success).toBe(true);
    expect(phoneSchema.safeParse('1987654321').success).toBe(false);
    expect(phoneSchema.safeParse('098765432').success).toBe(false);
    expect(phoneSchema.safeParse('098765432a').success).toBe(false);
  });

  it('validates emails without whitespace', () => {
    expect(emailSchema.safeParse('user@sporthub.vn').success).toBe(true);
    expect(emailSchema.safeParse('user @sporthub.vn').success).toBe(false);
    expect(emailSchema.safeParse('invalid-email').success).toBe(false);
  });

  it('validates Unicode full names', () => {
    expect(fullNameSchema.safeParse('Nguyễn Văn An').success).toBe(true);
    expect(fullNameSchema.safeParse('A').success).toBe(false);
    expect(fullNameSchema.safeParse('Nguyễn Văn 123').success).toBe(false);
  });

  it('validates password length and no spaces', () => {
    expect(passwordSchema.safeParse('Matkhau123').success).toBe(true);
    expect(passwordSchema.safeParse('12345').success).toBe(false);
    expect(passwordSchema.safeParse('Mat khau123').success).toBe(false);
  });

  it('normalizes and validates promotion codes and names', () => {
    const parsed = promoCodeSchema.safeParse('sangvui20');
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe('SANGVUI20');

    expect(promoCodeSchema.safeParse('AB').success).toBe(false);
    expect(promoCodeSchema.safeParse('SANG_VUI').success).toBe(false);
    expect(promoNameSchema.safeParse('Sale').success).toBe(false);
    expect(promoNameSchema.safeParse('Ưu đãi sáng').success).toBe(true);
  });

  it('validates court, reason, date, time, uuid, and pagination', () => {
    expect(reasonSchema.safeParse('   ').success).toBe(false);
    expect(reasonSchema.safeParse('Bận việc').success).toBe(true);
    expect(courtNameSchema.safeParse('Sân Pickleball 01').success).toBe(true);
    expect(courtDescriptionSchema.safeParse('x'.repeat(501)).success).toBe(false);
    expect(isoDateSchema.safeParse('2026-11-25').success).toBe(true);
    expect(isoDateSchema.safeParse('25-11-2026').success).toBe(false);
    expect(timeHHmmSchema.safeParse('05:30').success).toBe(true);
    expect(timeHHmmSchema.safeParse('24:00').success).toBe(false);
    expect(uuidV4Schema.safeParse('550e8400-e29b-41d4-a716-446655440000').success).toBe(true);

    const pag = paginationSchema.parse({});
    expect(pag).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.safeParse({ page: 1, pageSize: 101 }).success).toBe(false);
  });

  it('validates deposit and discount configs', () => {
    expect(depositConfigSchema.safeParse({ depositType: 'PERCENT', depositValue: 30 }).success).toBe(true);
    expect(depositConfigSchema.safeParse({ depositType: 'PERCENT', depositValue: 5 }).success).toBe(false);
    expect(depositConfigSchema.safeParse({ depositType: 'FIXED', depositValue: 50000 }).success).toBe(true);
    expect(depositConfigSchema.safeParse({ depositType: 'FIXED', depositValue: 0 }).success).toBe(false);

    expect(discountConfigSchema.safeParse({ discountType: 'PERCENT', discountValue: 100 }).success).toBe(true);
    expect(discountConfigSchema.safeParse({ discountType: 'PERCENT', discountValue: 101 }).success).toBe(false);
    expect(discountConfigSchema.safeParse({ discountType: 'FIXED', discountValue: -1 }).success).toBe(false);
  });

  it('contains complete error catalog and enum labels', () => {
    expect(ERROR_CATALOG.SLOT_TAKEN.status).toBe(409);
    expect(ERROR_CATALOG.ACCOUNT_TEMP_LOCKED.status).toBe(423);
    expect(ERROR_CATALOG.DEPOSIT_NOT_ALLOWED.status).toBe(422);
    expect(BOOKING_STATUS_LABELS.PENDING_PAYMENT).toBe('Chờ thanh toán');
    expect(PROMO_REASON_MESSAGES.PROMO_WRONG_AUDIENCE).toContain('khách hàng');
  });
});
