# Review repo SportHub — v2 (đối chiếu kết quả sửa lỗi với review v1)

**Phiên bản:** v2 · **Ngày:** 25/11/2026 · **Nền so sánh:** commit `e8457fc` + thay đổi sửa lỗi theo [review v1](docs/history/review-v1.md)
**Lưu trữ:** [docs/history/](docs/history/README.md)

## 1. Kết luận

Toàn bộ 4 phát hiện mức Cao (C-1..C-4), 9 mức Trung bình (M-1..M-9) và các mục Thấp của v1 đã được sửa. Vòng review v2 tìm thêm 5 điểm còn sót; **4 điểm đã sửa**, 1 điểm cần chủ dự án quyết định.

## 2. Kết quả đối chiếu v1

| Mục v1 | Kết quả |
| --- | --- |
| C-1 realtime phòng `booking:*` | Đã sửa: `canAccessBooking` qua `BOOKING_ACCESS_CHECKER`, CORS theo env, kiểm định dạng `date`; có `realtime.int.test.ts` |
| C-2 bí mật mặc định | Đã sửa: `validateProductionEnv` chặn khởi động production |
| C-3 `db:reset` / file init | Đã sửa: whitelist DB + `--force-i-know`; file init có chốt `@AllowReset` |
| C-4 webhook | Đã sửa (xem mục 3, điểm 1): guard trước pipe, `rawBody` nguyên văn, Tx1/Tx2 |
| M-1 idempotency | Đã sửa: khóa `IN_PROGRESS`, hash theo method + path + body, test song song |
| M-2 `expireHolds`/`expireQr` | Đã sửa: `try/catch` từng đơn, có test |
| M-3 chuyển trạng thái phân tán | Đã sửa: `UPDATE dbo.Bookings` chỉ còn ở `bookings.repository.ts`; `BookingStateService` giữ các hàm chuyển trạng thái; POS tách 3 service |
| M-4 số 15 phút | Đã sửa: `CHECKIN_EARLY_MINUTES` (migration 004); v2 bỏ cả fallback `15` |
| M-5 rate limit | Đã sửa: `trust proxy = 1` + `req.ip` |
| M-6 múi giờ | Đã sửa: R-11, ép `TZ=Asia/Ho_Chi_Minh` khi khởi động |
| M-7 nền tảng triển khai | Đã sửa: R-13 (Linux), `msnodesqlv8` optional, `backup.sh`/`restore.sh` |
| M-8 phiên/mật khẩu | Đã sửa: hủy cache sau commit (`afterCommit`), bcrypt ngoài transaction |
| M-9 test | Đã bổ sung; §14 của `business-rules.md` đã tick 31/31 |
| L-1..L-10 | Đã sửa (L-5 là rủi ro chấp nhận theo SDD, ghi trong `decisions.md`) |

## 3. Điểm còn sót phát hiện ở v2 và xử lý

1. **Webhook (trung bình) — đã sửa.** `catch` cũ chuyển mọi lỗi thành `NEEDS_REVIEW` và trả 200, nên lỗi tạm thời không được SePay gửi lại; nếu tiến trình chết giữa Tx1 và Tx2 thì lần gửi lại bị coi là trùng và giao dịch kẹt `PENDING`.
   Cách sửa: lỗi tạm thời (`isTransientDbError`: deadlock 1205, `ETIMEOUT`, `ECONNCLOSED`, `ESOCKET`…) giữ `PENDING` và trả 5xx; lần gửi lại thấy bản ghi còn `PENDING` thì khớp tiếp; Tx2 khóa dòng `BankTransactions` bằng `UPDLOCK` để các lần gửi song song không xử lý đôi. Có unit test (`sql-errors.test.ts`) và integration test (`payments.int.test.ts`).
2. **M-4 — đã sửa.** `getCheckInEarlyMinutes` không còn `catch { return 15 }`; thiếu key sẽ báo lỗi rõ ràng.
3. **L-3 — đã sửa.** Sự kiện socket khi cơ sở đóng đơn (`affected-bookings.service.ts`) phát `remainingAmount` đúng với cột DB thay vì `0`.
4. **Nhỏ — đã sửa.** `e2e/fixtures/srs.ts` hết nhắc "prototype".
5. **Quy trình — chờ chủ dự án.** R-11 (`useUTC: true`), R-12 (15 phút) và R-13 (Linux) do agent ghi vào `decisions.md`; `CLAUDE.md` yêu cầu hỏi người dùng trước khi chốt. Đã đánh dấu "chờ chủ dự án xác nhận" trong `decisions.md` và `report.md` §2.

## 4. Kiểm chứng

| Lệnh | Kết quả |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` | 58/58 (8 shared + 50 backend, 11 file) |
| `npm run test:int` (SQL Server `SportHub_Test`) | **91/91** (20 file) |
| E2E Playwright | Không chạy lại ở v2 (số liệu 4/4 lấy từ `report.md`) |

## 5. Ghi nhận còn lại (không chặn Go-Live)

- Request idempotency thứ hai chỉ chờ tối đa ~1 giây rồi trả `409 IDEMPOTENCY_CONFLICT`; nghiệp vụ chạy lâu hơn thế sẽ không được phát lại kết quả.
- Tên DB mặc định là `SportHub` (không thuộc whitelist `db:reset`): dev phải dùng DB `*_Test`/`*_Dev` hoặc thêm `--force-i-know`.
