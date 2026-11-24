/**
 * Kiểu dữ liệu nội bộ của "CSDL giả" — bám theo SDD mục 3 (26 bảng),
 * gộp bớt các bảng nối/lịch sử vào trong bản ghi cha cho gọn.
 * Thời điểm lưu dạng ISO 8601 có múi giờ +07:00.
 */

export type Role = 'OWNER' | 'STAFF' | 'CUSTOMER';
export type BookingStatus = 'PENDING_PAYMENT' | 'CONFIRMED' | 'IN_USE' | 'COMPLETED' | 'CANCELED' | 'EXPIRED';
export type PaymentStatus = 'UNPAID' | 'DEPOSITED' | 'PAID';
export type PaymentOption = 'FULL' | 'DEPOSIT';
export type Channel = 'ONLINE' | 'COUNTER';
export type CancelType = 'CUSTOMER_REQUEST' | 'NO_SHOW' | 'BY_FACILITY' | 'COUNTER_ABORT';
export type AmountType = 'PERCENT' | 'FIXED';
export type Purpose = 'DEPOSIT' | 'FULL' | 'REMAINING';
export type PayMethod = 'CASH' | 'BANK_TRANSFER';
export type NotificationType = 'PAYMENT_RESULT' | 'REMINDER' | 'PROMOTION' | 'SCHEDULE_CHANGE';
export type MatchStatus = 'PENDING' | 'MATCHED' | 'NEEDS_REVIEW' | 'RESOLVED' | 'IGNORED';
export type TxnIssue = 'WRONG_AMOUNT' | 'UNKNOWN_CONTENT' | 'LATE_PAYMENT' | 'ACCOUNT_MISMATCH';

export interface OpeningHour {
  dayOfWeek: number; // 1 = Thứ 2 ... 7 = Chủ nhật
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
}

export interface Branch {
  branchId: number;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  description: string | null;
  bankBin: string | null;
  bankName: string | null;
  bankAccountNo: string | null;
  bankAccountName: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  openingHours: OpeningHour[];
}

export interface Sport {
  sportId: number;
  code: string;
  name: string;
  icon: string;
  /** Bước đặt (Sports.GridBlockMinutes) */
  gridBlockMinutes: number;
  /** Độ dài ô hiển thị trên lưới lịch (mục 5.8) */
  slotMinutes: number;
  sortOrder: number;
}

export interface PriceRule {
  priceRuleId: number;
  label: string;
  dayOfWeekMask: number;
  startTime: string;
  endTime: string;
  pricePerHour: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface Court {
  courtId: number;
  code: string;
  branchId: number;
  sportId: number;
  name: string;
  courtType: string | null;
  description: string | null;
  depositType: AmountType;
  depositValue: number;
  status: 'ACTIVE' | 'INACTIVE';
  priceRules: PriceRule[];
  createdAt: string;
}

export interface CourtBlock {
  blockId: number;
  courtId: number;
  blockType: 'MAINTENANCE' | 'DECOMMISSION';
  startAt: string;
  endAt: string | null;
  reason: string;
  createdBy: number;
  createdAt: string;
  releasedAt: string | null;
  releasedBy: number | null;
}

export interface Holiday {
  holidayId: number;
  branchId: number;
  startDate: string;
  endDate: string;
  reason: string;
  groupKey: string;
  createdBy: number;
  createdAt: string;
}

export interface User {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  /** Mock: lưu mật khẩu thô cho tiện demo */
  password: string;
  role: Role;
  branchId: number | null;
  memberTier: string | null;
  status: 'ACTIVE' | 'LOCKED';
  failedLoginCount: number;
  lockedUntil: string | null;
  tokenVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface PriceLine {
  priceRuleId: number;
  label: string;
  startTime: string;
  endTime: string;
  pricePerHour: number;
  amount: number;
}

export interface StatusHistory {
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  fromPaymentStatus: PaymentStatus | null;
  toPaymentStatus: PaymentStatus | null;
  changedBy: number | null;
  changedAt: string;
  note: string | null;
}

export interface Transfer {
  transferId: number;
  oldCourtId: number;
  oldStartAt: string;
  oldEndAt: string;
  newCourtId: number;
  newStartAt: string;
  newEndAt: string;
  performedBy: number;
  performedAt: string;
  note: string | null;
}

export interface Booking {
  bookingId: number;
  bookingCode: string;
  branchId: number;
  courtId: number;
  customerUserId: number | null;
  guestName: string | null;
  guestPhone: string | null;
  startAt: string;
  endAt: string;
  baseAmount: number;
  discountAmount: number;
  totalAmount: number;
  paymentOption: PaymentOption;
  depositType: AmountType | null;
  depositValue: number | null;
  depositAmount: number;
  amountDueNow: number;
  paidAmount: number;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  holdExpireAt: string | null;
  promotionCode: string | null;
  canceledBy: number | null;
  canceledAt: string | null;
  cancelReason: string | null;
  cancelType: CancelType | null;
  refundRate: number | null;
  refundAmount: number | null;
  reminderSentAt: string | null;
  note: string | null;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
  rowVer: number;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  channel: Channel;
  priceLines: PriceLine[];
  statusHistory: StatusHistory[];
  transfers: Transfer[];
}

export interface PaymentRequest {
  requestId: number;
  bookingCode: string;
  purpose: Purpose;
  amount: number;
  transferContent: string;
  qrPayload: string;
  expiresAt: string;
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELED';
  createdBy: number | null;
  createdAt: string;
}

export interface Payment {
  paymentId: number;
  paymentCode: string;
  bookingCode: string;
  purpose: Purpose;
  method: PayMethod;
  channel: Channel;
  amount: number;
  requestId: number | null;
  bankTxnId: number | null;
  collectedBy: number | null;
  paidAt: string;
}

export interface BankTxn {
  bankTxnId: number;
  provider: string;
  providerTxnId: string;
  bankName: string | null;
  accountNo: string;
  amount: number;
  content: string;
  transactionAt: string;
  receivedAt: string;
  matchStatus: MatchStatus;
  issue: TxnIssue | null;
  expectedAmount: number | null;
  matchedBookingCode: string | null;
  resolution: { action: 'MATCHED' | 'REFUNDED' | 'IGNORED'; note: string | null; resolvedBy: number; resolvedAt: string } | null;
  rawPayload: unknown;
}

export interface Refund {
  refundId: number;
  bookingCode: string;
  amount: number;
  rate: number;
  reason: string | null;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  processedBy: number | null;
  processedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface Promotion {
  promotionId: number;
  code: string;
  name: string;
  description: string | null;
  discountType: AmountType;
  discountValue: number;
  maxDiscountAmount: number | null;
  allBranches: boolean;
  branchIds: number[];
  allSports: boolean;
  sportIds: number[];
  timeFrom: string | null;
  timeTo: string | null;
  startDate: string;
  endDate: string;
  audienceType: 'ALL' | 'SPECIFIC';
  customerIds: number[];
  maxUses: number;
  usedCount: number;
  status: 'ACTIVE' | 'PAUSED' | 'DISCONTINUED';
  notifyStatus: 'NONE' | 'PENDING' | 'SENT' | 'FAILED';
  createdBy: number;
  createdAt: string;
}

export interface Notification {
  notificationId: number;
  userId: number;
  type: NotificationType;
  title: string;
  body: string;
  linkType: 'BOOKING' | 'PROMOTION' | null;
  bookingCode: string | null;
  promotionCode: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface IdemRecord {
  hash: string;
  status: number;
  body: unknown;
  createdAt: string;
}

export interface DbState {
  version: number;
  seededAt: string;
  branches: Branch[];
  sports: Sport[];
  courts: Court[];
  blocks: CourtBlock[];
  holidays: Holiday[];
  users: User[];
  bookings: Booking[];
  paymentRequests: PaymentRequest[];
  payments: Payment[];
  bankTxns: BankTxn[];
  refunds: Refund[];
  promotions: Promotion[];
  notifications: Notification[];
  /** CodeSequences: khóa = Prefix + DateKey */
  seq: Record<string, number>;
  /** Bộ đếm khóa chính theo bảng */
  ids: Record<string, number>;
  idem: Record<string, IdemRecord>;
  lastRecheck: Record<string, number>;
}
