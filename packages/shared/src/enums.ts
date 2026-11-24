export const USER_ROLES = ['OWNER', 'STAFF', 'CUSTOMER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'LOCKED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const BRANCH_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const COURT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type CourtStatus = (typeof COURT_STATUSES)[number];

export const DEPOSIT_TYPES = ['PERCENT', 'FIXED'] as const;
export type DepositType = (typeof DEPOSIT_TYPES)[number];

export const BLOCK_TYPES = ['MAINTENANCE', 'DECOMMISSION'] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BOOKING_STATUSES = [
  'PENDING_PAYMENT',
  'CONFIRMED',
  'IN_USE',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const PAYMENT_STATUSES = ['UNPAID', 'DEPOSITED', 'PAID'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_OPTIONS = ['FULL', 'DEPOSIT'] as const;
export type PaymentOption = (typeof PAYMENT_OPTIONS)[number];

export const BOOKING_CHANNELS = ['ONLINE', 'COUNTER'] as const;
export type BookingChannel = (typeof BOOKING_CHANNELS)[number];

export const CANCEL_TYPES = [
  'CUSTOMER_REQUEST',
  'NO_SHOW',
  'BY_FACILITY',
  'COUNTER_ABORT',
] as const;
export type CancelType = (typeof CANCEL_TYPES)[number];

export const PAYMENT_PURPOSES = ['DEPOSIT', 'FULL', 'REMAINING'] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_REQUEST_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELED'] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const BANK_MATCH_STATUSES = [
  'PENDING',
  'MATCHED',
  'NEEDS_REVIEW',
  'RESOLVED',
  'IGNORED',
] as const;
export type BankMatchStatus = (typeof BANK_MATCH_STATUSES)[number];

export const REFUND_STATUSES = ['PENDING', 'COMPLETED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const DISCOUNT_TYPES = ['PERCENT', 'FIXED'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const AUDIENCE_TYPES = ['ALL', 'SPECIFIC'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const PROMOTION_STATUSES = ['ACTIVE', 'PAUSED', 'DISCONTINUED'] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export const PROMOTION_NOTIFY_STATUSES = ['NONE', 'PENDING', 'SENT', 'FAILED'] as const;
export type PromotionNotifyStatus = (typeof PROMOTION_NOTIFY_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'PAYMENT_RESULT',
  'REMINDER',
  'PROMOTION',
  'SCHEDULE_CHANGE',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_LINK_TYPES = ['BOOKING', 'PROMOTION'] as const;
export type NotificationLinkType = (typeof NOTIFICATION_LINK_TYPES)[number];

export const ALLOWED_ACTIONS = [
  'PAY',
  'CANCEL',
  'SETTLE',
  'CHECK_IN',
  'COMPLETE',
  'NO_SHOW_CANCEL',
  'REASSIGN',
  'CLOSE_BY_FACILITY',
] as const;
export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export const AFFECTED_REASONS = [
  'COURT_BLOCK',
  'HOLIDAY',
  'OPENING_HOURS',
  'COURT_INACTIVE',
] as const;
export type AffectedReason = (typeof AFFECTED_REASONS)[number];

export const PROMO_REASON_CODES = [
  'PROMO_NOT_FOUND',
  'PROMO_INACTIVE',
  'PROMO_OUT_OF_DATE',
  'PROMO_OUT_OF_TIME',
  'PROMO_WRONG_BRANCH',
  'PROMO_WRONG_SPORT',
  'PROMO_WRONG_AUDIENCE',
  'PROMO_EXHAUSTED',
  'PROMO_WRONG_CHANNEL',
] as const;
export type PromoReasonCode = (typeof PROMO_REASON_CODES)[number];

export const RECONCILIATION_ISSUES = [
  'WRONG_AMOUNT',
  'UNKNOWN_CONTENT',
  'LATE_PAYMENT',
  'ACCOUNT_MISMATCH',
] as const;
export type ReconciliationIssue = (typeof RECONCILIATION_ISSUES)[number];

export type UiTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING_PAYMENT: 'Chờ thanh toán',
  CONFIRMED: 'Đã xác nhận',
  IN_USE: 'Đang sử dụng',
  COMPLETED: 'Hoàn thành',
  CANCELED: 'Đã hủy',
  EXPIRED: 'Quá hạn thanh toán',
};

export const BOOKING_STATUS_TONES: Record<BookingStatus, UiTone> = {
  PENDING_PAYMENT: 'warning',
  CONFIRMED: 'info',
  IN_USE: 'success',
  COMPLETED: 'neutral',
  CANCELED: 'danger',
  EXPIRED: 'neutral',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Chưa thanh toán',
  DEPOSITED: 'Đã đặt cọc',
  PAID: 'Đã thanh toán',
};

export const PAYMENT_STATUS_TONES: Record<PaymentStatus, UiTone> = {
  UNPAID: 'warning',
  DEPOSITED: 'info',
  PAID: 'success',
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Chủ hệ thống',
  STAFF: 'Nhân viên',
  CUSTOMER: 'Khách hàng',
};

export const USER_ROLE_TITLES: Record<UserRole, string> = {
  OWNER: 'Chủ hệ thống sân',
  STAFF: 'Nhân viên thu ngân',
  CUSTOMER: 'Hội viên',
};

export const CANCEL_TYPE_LABELS: Record<CancelType, string> = {
  CUSTOMER_REQUEST: 'Khách yêu cầu hủy',
  NO_SHOW: 'Khách không tới nhận sân',
  BY_FACILITY: 'Đóng đơn do cơ sở',
  COUNTER_ABORT: 'Hủy tạo đơn tại quầy',
};

export const PROMO_REASON_MESSAGES: Record<PromoReasonCode, string> = {
  PROMO_NOT_FOUND: 'Mã khuyến mãi không tồn tại.',
  PROMO_INACTIVE: 'Mã khuyến mãi đang tạm dừng hoặc đã ngừng áp dụng.',
  PROMO_OUT_OF_DATE: 'Ngày chơi nằm ngoài thời gian áp dụng mã.',
  PROMO_OUT_OF_TIME: 'Giờ chơi nằm ngoài khung giờ của mã.',
  PROMO_WRONG_BRANCH: 'Mã không áp dụng cho cơ sở này.',
  PROMO_WRONG_SPORT: 'Mã không áp dụng cho môn thể thao của sân.',
  PROMO_WRONG_AUDIENCE: 'Mã chỉ dành cho khách hàng được chỉ định.',
  PROMO_EXHAUSTED: 'Mã khuyến mãi đã hết lượt sử dụng.',
  PROMO_WRONG_CHANNEL: 'Mã chỉ áp dụng khi đặt tại quầy.',
};
