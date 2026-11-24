/**
 * Cấu hình bộ mock API SportHub.
 * Có thể ghi đè một số giá trị lúc chạy qua localStorage (xem README).
 */
export const MOCK_CONFIG = {
  /** Khớp mọi origin: http://localhost:5173/api/v1, http://localhost:3000/api/v1, ... */
  apiBase: '*/api/v1',
  /** Độ trễ giả lập (ms) [min, max]. Ghi đè: localStorage.sporthub_mock_latency = "0" */
  latency: [150, 450] as [number, number],
  /** Khóa lưu dữ liệu giả trong localStorage — tăng hậu tố khi đổi cấu trúc seed */
  storageKey: 'sporthub_mock_db_v1',
  /** Thay cho cookie refresh token sh_rt (HttpOnly) của backend thật */
  sessionKey: 'sporthub_mock_session',
  /** "Tôi đã hoàn tất chuyển khoản" / "Kiểm tra lại giao dịch" sẽ tự coi như đã nhận tiền */
  recheckAutoPay: true,
  /** Thời hạn access token (giây) — SDD mục 2.4: 15 phút */
  accessTokenTtlSec: 900,
  /** Chu kỳ chạy job nền (hết hạn giữ chỗ, no-show, tự hoàn thành...) */
  jobsIntervalMs: 15_000,
  /** SystemSettings (SDD mục 3.3f) */
  settings: {
    BOOKING_HOLD_MINUTES: 10,
    REMINDER_BEFORE_MINUTES: 60,
    NO_SHOW_GRACE_MINUTES: 30,
    REFUND_FULL_DAYS: 5,
    REFUND_HALF_DAYS: 2,
    REFUND_HALF_RATE: 50,
    LOGIN_MAX_FAILED: 5,
    LOGIN_LOCK_MINUTES: 5,
    QR_EXPIRE_MINUTES: 15,
  },
};

export type MockSettings = typeof MOCK_CONFIG.settings;
