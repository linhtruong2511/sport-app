import { z } from 'zod';

/**
 * R-17: Tham số nghiệp vụ trong dbo.SystemSettings mà Chủ sân được chỉnh qua giao diện.
 * Định nghĩa một lần, dùng chung cho validate phía server (EXT-06) và form phía client.
 */
export const SYSTEM_SETTING_GROUPS = ['BOOKING', 'CHECKIN', 'REFUND', 'SECURITY'] as const;
export type SystemSettingGroup = (typeof SYSTEM_SETTING_GROUPS)[number];

export const SYSTEM_SETTING_GROUP_LABELS: Record<SystemSettingGroup, string> = {
  BOOKING: 'Đặt sân & thanh toán',
  CHECKIN: 'Nhận sân',
  REFUND: 'Hoàn tiền khi hủy',
  SECURITY: 'Bảo mật đăng nhập',
};

export const SYSTEM_SETTING_KEYS = [
  'BOOKING_HOLD_MINUTES',
  'QR_EXPIRE_MINUTES',
  'REMINDER_BEFORE_MINUTES',
  'CHECKIN_EARLY_MINUTES',
  'NO_SHOW_GRACE_MINUTES',
  'REFUND_FULL_DAYS',
  'REFUND_HALF_DAYS',
  'REFUND_HALF_RATE',
  'LOGIN_MAX_FAILED',
  'LOGIN_LOCK_MINUTES',
] as const;
export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

export interface SystemSettingDef {
  readonly key: SystemSettingKey;
  readonly group: SystemSettingGroup;
  readonly label: string;
  readonly hint: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
}

export const SYSTEM_SETTING_DEFS: readonly SystemSettingDef[] = [
  {
    key: 'BOOKING_HOLD_MINUTES',
    group: 'BOOKING',
    label: 'Thời hạn giữ chỗ chờ thanh toán',
    hint: 'Đơn Chờ thanh toán quá thời hạn này sẽ tự hủy và nhả sân (UC 004). Áp dụng cho đơn tạo sau khi lưu.',
    unit: 'phút',
    min: 5,
    max: 60,
  },
  {
    key: 'QR_EXPIRE_MINUTES',
    group: 'BOOKING',
    label: 'Hiệu lực mã QR tại quầy',
    hint: 'Không được vượt quá thời hạn giữ chỗ (UC 012).',
    unit: 'phút',
    min: 1,
    max: 60,
  },
  {
    key: 'REMINDER_BEFORE_MINUTES',
    group: 'BOOKING',
    label: 'Gửi nhắc lịch trước giờ chơi',
    hint: 'Thông báo nhắc lịch gửi tới khách trước giờ bắt đầu (FR 11).',
    unit: 'phút',
    min: 15,
    max: 1440,
  },
  {
    key: 'CHECKIN_EARLY_MINUTES',
    group: 'CHECKIN',
    label: 'Cho phép nhận sân sớm',
    hint: 'Nhân viên được nhận sân sớm nhất trước giờ chơi bao nhiêu phút (R-12).',
    unit: 'phút',
    min: 0,
    max: 120,
  },
  {
    key: 'NO_SHOW_GRACE_MINUTES',
    group: 'CHECKIN',
    label: 'Thời gian chờ trước khi tính không đến',
    hint: 'Quá giờ bắt đầu bao nhiêu phút mà khách chưa nhận sân thì xử lý no-show (UC 007, R-04).',
    unit: 'phút',
    min: 5,
    max: 240,
  },
  {
    key: 'REFUND_FULL_DAYS',
    group: 'REFUND',
    label: 'Hủy trước từ N ngày: hoàn 100%',
    hint: 'Hủy trước giờ chơi từ số ngày này trở lên được hoàn toàn bộ phần đã trả trừ tiền cọc (FR 12).',
    unit: 'ngày',
    min: 1,
    max: 60,
  },
  {
    key: 'REFUND_HALF_DAYS',
    group: 'REFUND',
    label: 'Hủy trước từ N ngày: hoàn một phần',
    hint: 'Phải nhỏ hơn mốc hoàn 100%. Hủy muộn hơn mốc này không được hoàn (FR 12).',
    unit: 'ngày',
    min: 0,
    max: 59,
  },
  {
    key: 'REFUND_HALF_RATE',
    group: 'REFUND',
    label: 'Tỷ lệ hoàn ở mốc hoàn một phần',
    hint: 'Phần trăm được hoàn khi hủy trong khoảng giữa hai mốc (FR 12).',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'LOGIN_MAX_FAILED',
    group: 'SECURITY',
    label: 'Số lần sai mật khẩu liên tiếp tối đa',
    hint: 'Vượt quá số lần này tài khoản bị khóa tạm (UC 001 luồng 2b).',
    unit: 'lần',
    min: 3,
    max: 20,
  },
  {
    key: 'LOGIN_LOCK_MINUTES',
    group: 'SECURITY',
    label: 'Thời gian khóa tạm tài khoản',
    hint: 'Thời gian tài khoản bị khóa sau khi sai mật khẩu quá số lần cho phép (UC 001 luồng 2b).',
    unit: 'phút',
    min: 1,
    max: 1440,
  },
];

export const SYSTEM_SETTING_DEF_MAP: Readonly<Record<SystemSettingKey, SystemSettingDef>> =
  Object.fromEntries(SYSTEM_SETTING_DEFS.map((d) => [d.key, d])) as Record<
    SystemSettingKey,
    SystemSettingDef
  >;

function settingValueSchema(def: SystemSettingDef) {
  const rangeMsg = `${def.label} phải là số nguyên từ ${def.min} đến ${def.max} ${def.unit}.`;
  return z
    .number({ required_error: rangeMsg, invalid_type_error: rangeMsg })
    .int(rangeMsg)
    .min(def.min, rangeMsg)
    .max(def.max, rangeMsg);
}

const settingValuesShape = Object.fromEntries(
  SYSTEM_SETTING_DEFS.map((d) => [d.key, settingValueSchema(d).optional()]),
) as Record<SystemSettingKey, z.ZodOptional<z.ZodNumber>>;

// EXT-06: chỉ gửi các khóa cần đổi; khóa lạ bị từ chối.
export const updateSettingsSchema = z.object({
  values: z
    .object(settingValuesShape)
    .strict('Có tham số không được phép chỉnh sửa.')
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Chưa có tham số nào thay đổi.'),
});
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export interface SettingRuleViolation {
  field: SystemSettingKey;
  message: string;
}

/**
 * Ràng buộc chéo giữa các tham số (R-17), kiểm tra trên bộ giá trị SAU KHI gộp.
 * - QR_EXPIRE_MINUTES ≤ BOOKING_HOLD_MINUTES (UC 012: QR không vượt hạn giữ chỗ)
 * - REFUND_HALF_DAYS < REFUND_FULL_DAYS (FR 12: hai mốc hoàn tiền phải tách biệt)
 */
export function validateSettingsCrossRules(
  values: Partial<Record<SystemSettingKey, number>>,
): SettingRuleViolation[] {
  const out: SettingRuleViolation[] = [];
  const hold = values.BOOKING_HOLD_MINUTES;
  const qr = values.QR_EXPIRE_MINUTES;
  if (hold !== undefined && qr !== undefined && qr > hold) {
    out.push({
      field: 'QR_EXPIRE_MINUTES',
      message: 'Hiệu lực mã QR tại quầy không được vượt quá thời hạn giữ chỗ.',
    });
  }
  const full = values.REFUND_FULL_DAYS;
  const half = values.REFUND_HALF_DAYS;
  if (full !== undefined && half !== undefined && half >= full) {
    out.push({
      field: 'REFUND_HALF_DAYS',
      message: 'Mốc hoàn một phần phải nhỏ hơn mốc hoàn 100%.',
    });
  }
  return out;
}
