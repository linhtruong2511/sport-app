export interface ErrorCatalogEntry {
  readonly status: number;
  readonly defaultMessage: string;
}

export const ERROR_CATALOG = {
  // 400
  VALIDATION_ERROR: {
    status: 400,
    defaultMessage: 'Dữ liệu không hợp lệ.',
  },
  INVALID_DATE_RANGE: {
    status: 400,
    defaultMessage:
      'Khoảng thời gian tra cứu không hợp lệ (Từ ngày phải trước hoặc bằng Đến ngày).',
  },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    defaultMessage: 'Thiếu hoặc sai định dạng Idempotency-Key.',
  },
  SPORT_IMMUTABLE: {
    status: 400,
    defaultMessage: 'Không được đổi bộ môn của sân.',
  },

  // 401
  UNAUTHENTICATED: {
    status: 401,
    defaultMessage: 'Vui lòng đăng nhập để tiếp tục.',
  },
  TOKEN_EXPIRED: {
    status: 401,
    defaultMessage: 'Phiên đăng nhập đã hết hạn.',
  },
  TOKEN_REVOKED: {
    status: 401,
    defaultMessage: 'Phiên đăng nhập đã bị thu hồi, vui lòng đăng nhập lại.',
  },
  REFRESH_INVALID: {
    status: 401,
    defaultMessage: 'Phiên làm mới không hợp lệ hoặc đã hết hạn.',
  },
  ACCOUNT_NOT_FOUND: {
    status: 401,
    defaultMessage: 'Không tìm thấy tài khoản với thông tin này.',
  },
  WRONG_PASSWORD: {
    status: 401,
    defaultMessage: 'Mật khẩu không chính xác.',
  },

  // 403
  FORBIDDEN: {
    status: 403,
    defaultMessage: 'Bạn không có quyền thực hiện thao tác này.',
  },
  BRANCH_FORBIDDEN: {
    status: 403,
    defaultMessage: 'Bạn không có quyền thao tác dữ liệu của cơ sở khác.',
  },
  BOOKING_FORBIDDEN: {
    status: 403,
    defaultMessage: 'Bạn không có quyền truy cập đơn đặt sân này.',
  },
  ACCOUNT_LOCKED: {
    status: 403,
    defaultMessage: 'Tài khoản nhân viên đã bị khóa, vui lòng liên hệ chủ hệ thống.',
  },

  // 404
  NOT_FOUND: {
    status: 404,
    defaultMessage: 'Không tìm thấy tài nguyên yêu cầu.',
  },
  PROMO_NOT_FOUND: {
    status: 404,
    defaultMessage: 'Mã khuyến mãi không tồn tại.',
  },

  // 409
  SLOT_TAKEN: {
    status: 409,
    defaultMessage: 'Khung giờ vừa chọn đã có người đặt, vui lòng chọn khung giờ khác.',
  },
  BOOKING_STATE_CHANGED: {
    status: 409,
    defaultMessage: 'Trạng thái đơn đã thay đổi, vui lòng tải lại.',
  },
  COURT_IN_USE: {
    status: 409,
    defaultMessage: 'Sân đang có đơn khác đang sử dụng, chưa thể nhận sân.',
  },
  PHONE_TAKEN: {
    status: 409,
    defaultMessage: 'Số điện thoại này đã được sử dụng. Vui lòng đăng nhập hoặc dùng số khác.',
  },
  EMAIL_TAKEN: {
    status: 409,
    defaultMessage: 'Email này đã được sử dụng. Vui lòng đăng nhập hoặc dùng email khác.',
  },
  COURT_NAME_DUPLICATE: {
    status: 409,
    defaultMessage: 'Tên sân đã tồn tại trong cơ sở này.',
  },
  PROMO_CODE_DUPLICATE: {
    status: 409,
    defaultMessage: 'Mã khuyến mãi đã tồn tại.',
  },
  PROMO_EXHAUSTED: {
    status: 409,
    defaultMessage: 'Mã khuyến mãi đã hết lượt sử dụng.',
  },
  IDEMPOTENCY_CONFLICT: {
    status: 409,
    defaultMessage: 'Idempotency-Key đã được sử dụng cho một yêu cầu khác.',
  },
  COURT_HAS_OPEN_BOOKINGS: {
    status: 409,
    defaultMessage:
      'Sân đang có đơn đặt chưa hoàn thành, không thể đổi chi nhánh. Vui lòng xử lý các đơn hiện có trước.',
  },
  BLOCK_OVERLAP: {
    status: 409,
    defaultMessage: 'Sân đã có khóa chồng thời gian.',
  },

  // 422
  COURT_UNAVAILABLE: {
    status: 422,
    defaultMessage: 'Sân hiện không khả dụng hoặc đang tạm khóa trong khung giờ này.',
  },
  BRANCH_CLOSED: {
    status: 422,
    defaultMessage: 'Cơ sở không hoạt động vào ngày đã chọn.',
  },
  OUTSIDE_OPENING_HOURS: {
    status: 422,
    defaultMessage: 'Khung giờ đặt nằm ngoài giờ mở cửa của cơ sở.',
  },
  BOOKING_IN_PAST: {
    status: 422,
    defaultMessage: 'Không thể đặt khung giờ trong quá khứ.',
  },
  INVALID_TIME_STEP: {
    status: 422,
    defaultMessage: 'Giờ bắt đầu và thời lượng phải là bội số bước lịch của bộ môn.',
  },
  PRICE_NOT_CONFIGURED: {
    status: 422,
    defaultMessage: 'Chưa có bảng giá cho toàn bộ khung giờ đã chọn.',
  },
  PROMO_INVALID: {
    status: 422,
    defaultMessage: 'Mã khuyến mãi không hợp lệ.',
  },
  DEPOSIT_NOT_ALLOWED: {
    status: 422,
    defaultMessage: 'Sân này yêu cầu cọc 100% tiền thuê — vui lòng chọn Thanh toán đủ.',
  },
  HOLD_EXPIRED: {
    status: 422,
    defaultMessage: 'Đơn đã hết thời hạn giữ chỗ, không thể tạo mã QR mới.',
  },
  NOTHING_TO_PAY: {
    status: 422,
    defaultMessage: 'Đơn không còn khoản phải thu.',
  },
  BOOKING_NOT_PAYABLE: {
    status: 422,
    defaultMessage: 'Đơn ở trạng thái không thể thanh toán.',
  },
  PAYMENT_INCOMPLETE: {
    status: 422,
    defaultMessage: 'Vui lòng thu đủ 100% tiền sân trước khi nhận sân.',
  },
  MEMBER_NOT_FOUND: {
    status: 422,
    defaultMessage: 'Chưa xác định được hội viên — hãy bấm Tra cứu hoặc chuyển sang Khách vãng lai.',
  },
  BOOKING_NOT_IN_USE: {
    status: 422,
    defaultMessage: 'Đơn không ở trạng thái Đang sử dụng.',
  },
  DURATION_MISMATCH: {
    status: 422,
    defaultMessage: 'Khung giờ mới khác thời lượng đơn gốc.',
  },
  INVALID_TARGET_COURT: {
    status: 422,
    defaultMessage: 'Sân đích khác chi nhánh/bộ môn hoặc đang khóa.',
  },
  INVALID_PRICE_RULE: {
    status: 422,
    defaultMessage: 'Quy tắc bảng giá không hợp lệ.',
  },
  INVALID_DEPOSIT: {
    status: 422,
    defaultMessage: 'Mức đặt cọc không hợp lệ.',
  },
  INVALID_OPENING_HOURS: {
    status: 422,
    defaultMessage: 'Giờ đóng cửa phải lớn hơn giờ mở cửa.',
  },
  HOLIDAY_IN_PAST: {
    status: 422,
    defaultMessage: 'Không thể thêm ngày nghỉ trong quá khứ.',
  },
  AMOUNT_MISMATCH: {
    status: 422,
    defaultMessage: 'Số tiền thanh toán không khớp với số tiền cần thu.',
  },
  NO_SHOW_NOT_ELIGIBLE: {
    status: 422,
    defaultMessage:
      "Chưa quá giờ nhận sân quy định (30 phút) — không thể chọn 'Khách không đến nhận sân'.",
  },
  BOOKING_NOT_CANCELABLE: {
    status: 422,
    defaultMessage: 'Chỉ hủy được đơn Chờ thanh toán hoặc Đã xác nhận, trước giờ chơi.',
  },
  BRANCH_BANK_NOT_CONFIGURED: {
    status: 422,
    defaultMessage: 'Cơ sở chưa cấu hình tài khoản ngân hàng nhận tiền.',
  },
  PRICE_RULE_OVERLAP: {
    status: 422,
    defaultMessage: 'Khung giờ bảng giá bị chồng lấn với quy tắc giá hiện có.',
  },
  PROMO_CODE_LOCKED: {
    status: 422,
    defaultMessage: 'Mã khuyến mãi đã phát sinh lượt sử dụng, không thể sửa mã.',
  },
  INVALID_STATE_TRANSITION: {
    status: 422,
    defaultMessage: 'Không thể chuyển trạng thái đơn đặt sân theo thao tác này.',
  },
  CHECK_IN_TOO_EARLY: {
    status: 422,
    defaultMessage: 'Chưa đến thời gian cho phép nhận sân.',
  },
  BOOKING_NOT_AFFECTED: {
    status: 422,
    defaultMessage: 'Đơn đặt sân không thuộc danh sách đơn bị ảnh hưởng.',
  },
  REASSIGN_INVALID: {
    status: 422,
    defaultMessage: 'Sân hoặc khung giờ chuyển đến không hợp lệ.',
  },
  BANK_TXN_ALREADY_RESOLVED: {
    status: 422,
    defaultMessage: 'Giao dịch ngân hàng đã được xử lý trước đó.',
  },
  REFUND_ALREADY_PROCESSED: {
    status: 422,
    defaultMessage: 'Khoản hoàn tiền đã được xử lý trước đó.',
  },
  CUSTOMER_NOT_FOUND: {
    status: 422,
    defaultMessage: 'Không tìm thấy khách hàng theo số điện thoại đã nhập.',
  },
  MAX_USES_TOO_LOW: {
    status: 422,
    defaultMessage: 'Tổng lượt sử dụng tối đa không được nhỏ hơn số lượt đã dùng.',
  },
  PROMO_DISCONTINUED: {
    status: 422,
    defaultMessage: 'Chương trình khuyến mãi đã ngừng áp dụng, không thể chỉnh sửa.',
  },

  // 423
  ACCOUNT_TEMP_LOCKED: {
    status: 423,
    defaultMessage:
      'Bạn đã nhập sai mật khẩu quá 5 lần liên tiếp. Tài khoản bị tạm khóa trong 5 phút.',
  },

  // 429
  TOO_MANY_REQUESTS: {
    status: 429,
    defaultMessage: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.',
  },

  // 502 / 500
  PAYMENT_GATEWAY_ERROR: {
    status: 502,
    defaultMessage: 'Không thể kết nối cổng thanh toán, vui lòng thử lại sau.',
  },
  INTERNAL_ERROR: {
    status: 500,
    defaultMessage: 'Đã xảy ra lỗi hệ thống, vui lòng thử lại sau.',
  },
} as const satisfies Record<string, ErrorCatalogEntry>;

export type ErrorCode = keyof typeof ERROR_CATALOG;
