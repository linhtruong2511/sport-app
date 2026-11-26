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

export const SYSTEM_SETTING_GROUP_DESCRIPTIONS: Record<SystemSettingGroup, string> = {
  BOOKING: 'Thời gian khách có để thanh toán và thời điểm hệ thống nhắc lịch.',
  CHECKIN: 'Quy định về giờ nhận sân và khi nào khách bị tính là không đến.',
  REFUND: 'Khách hủy đơn sớm hay muộn sẽ được hoàn bao nhiêu tiền. Tiền cọc không được hoàn.',
  SECURITY: 'Giới hạn đăng nhập sai để chống dò mật khẩu.',
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
    label: 'Thời gian giữ chỗ chờ thanh toán',
    hint: 'Khách phải thanh toán trong thời gian này. Quá hạn, đơn tự hủy và sân được mở lại cho người khác đặt. Chỉ áp dụng cho đơn đặt sau khi lưu.',
    unit: 'phút',
    min: 5,
    max: 60,
  },
  {
    key: 'QR_EXPIRE_MINUTES',
    group: 'BOOKING',
    label: 'Thời gian hiệu lực của mã QR',
    hint: 'Sau thời gian này mã QR chuyển khoản hết hạn và khách cần tạo mã mới. Không được dài hơn thời gian giữ chỗ.',
    unit: 'phút',
    min: 1,
    max: 60,
  },
  {
    key: 'REMINDER_BEFORE_MINUTES',
    group: 'BOOKING',
    label: 'Nhắc lịch trước giờ chơi',
    hint: 'Hệ thống gửi thông báo nhắc khách trước giờ bắt đầu chơi khoảng thời gian này.',
    unit: 'phút',
    min: 15,
    max: 1440,
  },
  {
    key: 'CHECKIN_EARLY_MINUTES',
    group: 'CHECKIN',
    label: 'Cho nhận sân sớm tối đa',
    hint: 'Nhân viên chỉ được cho khách nhận sân sớm hơn giờ đặt trong khoảng thời gian này. Nhập 0 nếu chỉ cho nhận sân từ đúng giờ bắt đầu.',
    unit: 'phút',
    min: 0,
    max: 120,
  },
  {
    key: 'NO_SHOW_GRACE_MINUTES',
    group: 'CHECKIN',
    label: 'Chờ khách trước khi tính không đến',
    hint: 'Quá giờ bắt đầu khoảng thời gian này mà khách vẫn chưa nhận sân thì đơn bị tính là khách không đến.',
    unit: 'phút',
    min: 5,
    max: 240,
  },
  {
    key: 'REFUND_FULL_DAYS',
    group: 'REFUND',
    label: 'Hoàn toàn bộ nếu hủy trước giờ chơi',
    hint: 'Khách hủy sớm hơn giờ chơi từ số ngày này trở lên được hoàn 100% số tiền đã trả (trừ tiền cọc).',
    unit: 'ngày',
    min: 1,
    max: 60,
  },
  {
    key: 'REFUND_HALF_DAYS',
    group: 'REFUND',
    label: 'Hoàn một phần nếu hủy trước giờ chơi',
    hint: 'Hủy trong khoảng từ mốc này đến mốc hoàn toàn bộ thì được hoàn một phần. Hủy muộn hơn mốc này không được hoàn tiền. Phải nhỏ hơn mốc hoàn toàn bộ.',
    unit: 'ngày',
    min: 0,
    max: 59,
  },
  {
    key: 'REFUND_HALF_RATE',
    group: 'REFUND',
    label: 'Tỷ lệ hoàn một phần',
    hint: 'Phần trăm số tiền đã trả (trừ tiền cọc) được hoàn khi khách hủy trong khoảng giữa hai mốc trên.',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'LOGIN_MAX_FAILED',
    group: 'SECURITY',
    label: 'Số lần nhập sai mật khẩu tối đa',
    hint: 'Nhập sai liên tiếp quá số lần này thì tài khoản bị khóa tạm thời.',
    unit: 'lần',
    min: 3,
    max: 20,
  },
  {
    key: 'LOGIN_LOCK_MINUTES',
    group: 'SECURITY',
    label: 'Thời gian khóa tạm tài khoản',
    hint: 'Sau thời gian này tài khoản tự động được mở khóa để đăng nhập lại.',
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
      message: 'Thời gian hiệu lực của mã QR không được dài hơn thời gian giữ chỗ.',
    });
  }
  const full = values.REFUND_FULL_DAYS;
  const half = values.REFUND_HALF_DAYS;
  if (full !== undefined && half !== undefined && half >= full) {
    out.push({
      field: 'REFUND_HALF_DAYS',
      message: 'Mốc hoàn một phần phải nhỏ hơn mốc hoàn toàn bộ.',
    });
  }
  return out;
}
