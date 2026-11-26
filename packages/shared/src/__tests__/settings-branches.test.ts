import { describe, expect, it } from 'vitest';
import {
  SYSTEM_SETTING_DEFS,
  SYSTEM_SETTING_KEYS,
  createBranchSchema,
  updateBranchSchema,
  updateSettingsSchema,
  validateSettingsCrossRules,
} from '../index.js';

describe('SystemSettings (R-17)', () => {
  it('mỗi khóa SystemSettings có đúng một định nghĩa', () => {
    expect(SYSTEM_SETTING_DEFS.map((d) => d.key).sort()).toEqual([...SYSTEM_SETTING_KEYS].sort());
  });

  it('nhận giá trị nằm trong biên min/max', () => {
    const r = updateSettingsSchema.safeParse({
      values: { BOOKING_HOLD_MINUTES: 5, REFUND_HALF_RATE: 100, CHECKIN_EARLY_MINUTES: 0 },
    });
    expect(r.success).toBe(true);
  });

  it('từ chối giá trị ngoài biên, số lẻ và khóa không được phép', () => {
    expect(updateSettingsSchema.safeParse({ values: { BOOKING_HOLD_MINUTES: 4 } }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ values: { REFUND_HALF_RATE: 101 } }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ values: { NO_SHOW_GRACE_MINUTES: 30.5 } }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ values: { SOMETHING_ELSE: 1 } }).success).toBe(false);
    expect(updateSettingsSchema.safeParse({ values: {} }).success).toBe(false);
  });

  it('hiệu lực QR vượt thời hạn giữ chỗ → lỗi tại QR_EXPIRE_MINUTES (UC 012)', () => {
    expect(validateSettingsCrossRules({ BOOKING_HOLD_MINUTES: 10, QR_EXPIRE_MINUTES: 11 })).toEqual([
      expect.objectContaining({ field: 'QR_EXPIRE_MINUTES' }),
    ]);
    expect(validateSettingsCrossRules({ BOOKING_HOLD_MINUTES: 10, QR_EXPIRE_MINUTES: 10 })).toEqual([]);
  });

  it('mốc hoàn một phần ≥ mốc hoàn 100% → lỗi tại REFUND_HALF_DAYS (FR 12)', () => {
    expect(validateSettingsCrossRules({ REFUND_FULL_DAYS: 5, REFUND_HALF_DAYS: 5 })).toEqual([
      expect.objectContaining({ field: 'REFUND_HALF_DAYS' }),
    ]);
    expect(validateSettingsCrossRules({ REFUND_FULL_DAYS: 5, REFUND_HALF_DAYS: 4 })).toEqual([]);
  });
});

describe('Branch schemas (R-17)', () => {
  const base = {
    code: 'cs03',
    name: 'Cơ sở 3 - Long Biên',
    address: 'Số 1 Nguyễn Văn Cừ, Long Biên, Hà Nội',
  };

  it('chuẩn hóa mã cơ sở về chữ in hoa, cho phép bỏ trống cả nhóm ngân hàng', () => {
    const r = createBranchSchema.parse({ ...base, phone: '', bankBin: '', bankAccountNo: '' });
    expect(r.code).toBe('CS03');
    expect(r.phone).toBeNull();
    expect(r.bankAccountNo).toBeNull();
  });

  it('nhóm ngân hàng phải đủ cả 4 trường', () => {
    const r = createBranchSchema.safeParse({ ...base, bankBin: '970436', bankAccountNo: '1012345678' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = r.error.issues.map((i) => i.path.join('.')).sort();
      expect(fields).toEqual(['bankAccountName', 'bankName']);
    }
  });

  it('chuẩn hóa STK (bỏ khoảng trắng) và tên chủ TK (in hoa), từ chối BIN sai', () => {
    const ok = updateBranchSchema.parse({
      name: base.name,
      address: base.address,
      bankBin: '970436',
      bankName: 'Vietcombank',
      bankAccountNo: '1012 3456 78',
      bankAccountName: 'cong ty sporthub cs3',
    });
    expect(ok.bankAccountNo).toBe('1012345678');
    expect(ok.bankAccountName).toBe('CONG TY SPORTHUB CS3');

    const badBin = updateBranchSchema.safeParse({
      name: base.name,
      address: base.address,
      bankBin: '97043',
      bankName: 'X',
      bankAccountNo: '1012345678',
      bankAccountName: 'ABC',
    });
    expect(badBin.success).toBe(false);
  });
});
