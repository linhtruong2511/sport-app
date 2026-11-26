import type {
  AllowedAction,
  BookingChannel,
  BookingStatus,
  BranchStatus,
  CancelType,
  DepositType,
  PaymentMethod,
  PaymentOption,
  PaymentPurpose,
  PaymentRequestStatus,
  PaymentStatus,
  RefundStatus,
  UserRole,
} from './enums.js';
import type { ErrorCode } from './errors.js';

export interface ApiMeta {
  serverTime: string;
  [key: string]: unknown;
}

export interface ApiListMeta extends ApiMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiListSuccess<T> {
  data: T[];
  meta: ApiListMeta;
}

export interface ApiErrorDetail {
  field?: string;
  message: string;
}

export interface ApiErrorPayload {
  code: ErrorCode;
  message: string;
  details?: ApiErrorDetail[] | Record<string, unknown>;
  traceId: string;
}

export interface ApiErrorResponse {
  error: ApiErrorPayload;
}

export interface UserDto {
  userId: number;
  code: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: UserRole;
  branchId: number | null;
  branchName: string | null;
  memberTier: string | null;
  title: string;
}

export interface BranchDto {
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
  status: BranchStatus;
}

export interface SportDto {
  sportId: number;
  code: string;
  name: string;
  icon: string | null;
  gridBlockMinutes: number;
  displayBlockMinutes: number;
  sortOrder: number;
}

export interface BookingCancelInfoDto {
  cancelType: CancelType;
  reason: string;
  canceledAt: string;
  canceledByName: string | null;
  refundRate: number | null;
  refundAmount: number | null;
  depositKept: number;
}

export interface BookingDepositDto {
  type: DepositType | null;
  value: number | null;
  amount: number;
}

export interface BookingSummaryDto {
  bookingCode: string;
  channel: BookingChannel;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  isOverdue: boolean;
  branchId: number;
  branchName: string;
  courtId: number;
  courtName: string;
  sportCode: string;
  sportName: string;
  customerUserId: number | null;
  customerName: string;
  customerPhone: string;
  isGuest: boolean;
  date: string;
  startTime: string;
  endTime: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  baseAmount: number;
  promotionCode: string | null;
  discountAmount: number;
  totalAmount: number;
  paymentOption: PaymentOption;
  deposit: BookingDepositDto;
  amountDueNow: number;
  paidAmount: number;
  remainingAmount: number;
  holdExpireAt: string | null;
  cancel: BookingCancelInfoDto | null;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  allowedActions: AllowedAction[];
  version: string;
  createdAt: string;
}

export interface BookingPriceLineDto {
  label: string;
  startTime: string;
  endTime: string;
  pricePerHour: number;
  amount: number;
}

export interface BookingPaymentItemDto {
  paymentCode: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  channel: BookingChannel;
  amount: number;
  paidAt: string;
  collectedByName: string | null;
}

export interface BookingStatusHistoryItemDto {
  fromStatus: BookingStatus | null;
  toStatus: BookingStatus;
  fromPaymentStatus: PaymentStatus | null;
  toPaymentStatus: PaymentStatus | null;
  changedAt: string;
  changedByName: string | null;
  note: string | null;
}

export interface BookingTransferItemDto {
  oldCourtName: string;
  oldStartAt: string;
  newCourtName: string;
  newStartAt: string;
  performedByName: string;
  performedAt: string;
  note: string | null;
}

export interface BookingRefundSummaryDto {
  refundId: number;
  amount: number;
  rate: number;
  status: RefundStatus;
}

export interface BookingDetailDto extends Omit<
  BookingSummaryDto,
  | 'branchId'
  | 'branchName'
  | 'courtId'
  | 'courtName'
  | 'sportCode'
  | 'sportName'
  | 'customerUserId'
  | 'customerName'
  | 'customerPhone'
  | 'isGuest'
> {
  branch: {
    branchId: number;
    name: string;
    address: string;
  };
  court: {
    courtId: number;
    code: string;
    name: string;
    sportCode: string;
    sportName: string;
  };
  customer: {
    userId: number | null;
    fullName: string;
    phone: string;
    isGuest: boolean;
  };
  note: string | null;
  priceLines: BookingPriceLineDto[];
  payments: BookingPaymentItemDto[];
  statusHistory: BookingStatusHistoryItemDto[];
  transfers: BookingTransferItemDto[];
  refund: BookingRefundSummaryDto | null;
}

export interface PaymentRequestDto {
  requestId: number;
  bookingCode: string;
  purpose: PaymentPurpose;
  amount: number;
  transferContent: string;
  qrPayload: string;
  expiresAt: string;
  status: PaymentRequestStatus;
  bank: {
    bin: string;
    bankName: string;
    accountNo: string;
    accountName: string;
  };
}

export interface ReceiptDto {
  paymentCode: string;
  bookingCode: string;
  purpose: PaymentPurpose;
  method: PaymentMethod;
  channel: BookingChannel;
  amount: number;
  paidAt: string;
  collectedByName: string | null;
  branchName: string;
  courtName: string;
  customerName: string;
  customerPhone: string;
  startAt: string;
  endAt: string;
}

// R-17 · EXT-01..04: cơ sở trong màn quản trị của Chủ sân (kèm thông tin ngân hàng + số liệu ràng buộc).
export interface AdminBranchDto extends BranchDto {
  courtCount: number;
  activeStaffCount: number;
  /** Đơn PENDING_PAYMENT / CONFIRMED / IN_USE — > 0 thì không ngừng hoạt động được. */
  activeBookingCount: number;
  /** Yêu cầu QR còn PENDING và chưa hết hạn — đổi STK lúc này thì tiền vào STK cũ sẽ cần đối soát tay. */
  pendingPaymentRequestCount: number;
  createdAt: string;
  updatedAt: string;
}

// R-17 · EXT-05/06
export interface SystemSettingDto {
  key: string;
  value: number;
  description: string | null;
  updatedAt: string;
}
