# Báo cáo tiến độ triển khai dự án SportHub

**Ngày cập nhật:** 25/11/2026  
**Trạng thái tổng thể:** Hoàn tất triển khai lộ trình **M0 – M9** (100% Backend 73 API + Webhook + 8 Job nền + Realtime Socket.IO + 12 màn hình Frontend nối API thật + Cứng hóa M9).

---

## 1. Những gì đã làm

### A. Hạ tầng & CSDL (M0)
- Thiết lập monorepo npm workspaces (`packages/shared`, `backend`, `app`, `e2e`), ESLint/oxlint, Prettier, Vitest (unit + integration), `docker-compose.yml` cho SQL Server.
- Xây dựng `@sporthub/shared`: toàn bộ enum, nhãn tiếng Việt, mã lỗi chuẩn (`ERROR_CATALOG`), DTO types và Zod validators dùng chung FE/BE.
- Khởi tạo `database/sporthub_init.sql` cùng 3 migration (`001_idempotency_keys.sql`, `002_sports_display_block.sql`, `003_branch_holidays_group_key.sql`) và script `db:reset` / `db:migrate`.
- Xây dựng lõi Backend (`backend/src/core/`): transaction pool SQL Server (`poolMax = 20`, retry deadlock 1205, đẩy Socket.IO sau commit), xử lý múi giờ VN `DATETIME2(0)` + ISO `+07:00`, tiền nguyên VNĐ, `SettingsService`, `usp_NextCode`, `IdempotencyInterceptor`, `AuditService`, `AppExceptionsFilter` kèm `traceId`.

### B. Backend — Đủ 73/73 API, SePay Webhook & 8 Job nền (M1 – M8)
- **M1 — Xác thực & Phân quyền (API 01, 02, 06, 09, 10):** JWT + refresh token rotation (`sh_rt` HttpOnly cookie), khóa tạm R-07 (5 lần sai / 5 phút), guard phân quyền (`OWNER`/`STAFF`/`CUSTOMER`) & phạm vi cơ sở (`BranchScopeGuard`), thu hồi phiên tức thì (`auth.revoked`).
- **M2 — Danh mục, Lưới lịch & Báo giá (API 03, 04, 07, 08, 11, 12, 24):** API cơ sở, bộ môn, khuyến mãi công khai, lưới lịch ưu tiên `LOCKED > MINE > HELD > BOOKED > PAST > FREE`, bộ máy tính giá thuần `pricing.engine.ts` (bảo lưu giá R-10, 8 bước KM, cọc R-09, hoàn tiền R-04).
- **M3 & M5 — Đặt sân online, Thanh toán VietQR & Thông báo (API 05, 13–23, Webhook SePay):** Tạo đơn chống trùng lịch bằng unique index `UX_BookingSlots_Court_Slot` (`409 SLOT_TAKEN`), sinh mã VietQR EMVCo + CRC16-CCITT, `recheck` qua `BankGateway` (giới hạn 1 lần/5 giây), webhook SePay idempotent (khớp chính xác hoặc chuyển `NEEDS_REVIEW`), hủy đơn với `RowVer`, hệ thống thông báo in-app + `StubOutboundNotifier`.
- **M4 — POS tại quầy & Job vòng đời (API 25–35):** Lưới lịch quầy, tra cứu hội viên, tạo đơn & thu tiền mặt/QR, `COUNTER_ABORT`, phiếu thu gần nhất, danh sách đơn theo tab (`AFFECTED`), tất toán (kiểm tra `COURT_IN_USE` trước thu tiền), nhận sân, kết thúc sớm.
- **M6 — Quản trị sân, lịch & Đơn bị ảnh hưởng (API 36–39, 47–58):** Chuyển sân giữ nguyên tiền (`BookingTransfers`), đóng đơn `BY_FACILITY` hoàn 100% kể cả cọc, CRUD sân + bảng giá bảo lưu FR 06, khóa sân/giờ mở cửa/ngày nghỉ hỗ trợ `?dryRun=true` và `GroupKey`, ghi `AuditLogs`.
- **M7 — Quản trị nhân viên & Khuyến mãi (API 42–46, 59–65):** CRUD nhân viên (`usp_NextCode('NV')`), khóa/mở khóa & đổi chi nhánh tự thu hồi phiên, lịch sử thu tiền; CRUD khuyến mãi (ràng buộc `CUSTOMER_NOT_FOUND`, `PROMO_CODE_LOCKED`, xóa mềm `DISCONTINUED` khi `UsedCount > 0`), gửi/thử lại thông báo ưu đãi.
- **M8 — Dashboard, Báo cáo & Đối soát (API 40, 41, 66, 67–73):** Dashboard ngày & drilldown KPI, báo cáo doanh thu thực thu theo SDD 3.5f + Q-14 (loại `BY_FACILITY`), công suất sân, đối soát giao dịch ngân hàng (khớp thủ công đúng số tiền / hoàn khách / bỏ qua) và xử lý hoàn tiền cho OWNER.
- **8 Job nền (`node-cron` + `sp_getapplock`):** `expireHolds`, `expireQr`, `cancelNoShows`, `closePaidNoShows` (R-04), `autoComplete`, `sendReminders`, `retryPromoNotify`, `cleanupIdempotencyKeys`.

### C. Frontend — Nối API thật toàn bộ 12 màn hình (MH.01 – MH.14)
- Gỡ bỏ hoàn toàn dữ liệu giả và logic tính toán cục bộ (`store.tsx`, `data.ts`, `domain/*`) cùng các nút mô phỏng demo.
- Nối 100% 12 màn hình (`Login`, `Home`, `Booking`, `Payment`, `MyBookings`, `StaffBooking`, `StaffOrders`, `StaffStats`, `OwnerStaff`, `OwnerCourts`, `OwnerReports`, `Reconciliation`) sang REST API + TanStack Query + `AuthContext` + `RealtimeBridge` (Socket.IO) + `VietQrBox` (`qrcode.react`) + đồng hồ đồng bộ server (`getServerNowMs()`).

### D. Cứng hóa & Vận hành (M9)
- Rate limit `10 req/phút/IP` (`429 TOO_MANY_REQUESTS` + `Retry-After`) cho `/auth/login`, `/auth/register` và middleware OWASP security headers.
- Cấu hình triển khai: `deploy/nginx.conf`, `ecosystem.config.cjs` (PM2 1 instance, `TZ=Asia/Ho_Chi_Minh`, `UV_THREADPOOL_SIZE=32`), `database/scripts/backup.ps1` & `restore.ps1`, tài liệu `deploy/README.md`.
- Kiểm thử tải đồng thời (`concurrency.int.test.ts`): 15 request trùng slot (1 thành công, 14 `SLOT_TAKEN`), 8 request tranh mã `MaxUses=1` (1 thành công, 7 `PROMO_EXHAUSTED`), 5 request đua hủy cùng `RowVer` (1 thành công, 4 từ chối).

### E. Kết quả kiểm chứng
- `npm run build` (`shared`, `backend`, `app`): **Pass**
- `npm run lint` (`eslint` + `oxlint`): **0 errors, 0 warnings**
- `npm run typecheck`: **Pass**
- `npm test` (unit): **51/51 passed** (9 file)
- `npm run test:int` (SQL Server `SportHub_Test`): **85/85 passed** (19 file)

---

## 2. Những gì chưa làm / Hạng mục còn lại trước khi Go-Live

| Hạng mục | Mô tả công việc | Ghi chú |
| --- | --- | --- |
| **Cập nhật bộ kiểm thử E2E (`e2e/`)** | Bộ test Playwright trong `e2e/` được viết cho bản prototype dùng `store.tsx` / nút đăng nhập nhanh & khôi phục dữ liệu mẫu. Cần viết lại fixture để chạy trực tiếp với Backend + SQL Server thật (`SportHub_Test`). | Chưa chạy lại `e2e` sau khi gỡ prototype. |
| **Cấu hình môi trường Production thật** | Điền danh sách IP allowlist thật của SePay, chứng chỉ SSL/TLS và domain trong `deploy/nginx.conf`; cấu hình `backend/.env` production (`SEPAY_API_KEY`, JWT secret, thông tin DB). | Đang dùng placeholder an toàn. |
| **Chốt chính thức các câu hỏi mở `Q-01..Q-15`** | Hiện hệ thống chạy theo phương án đề xuất mặc định trong `docs/decisions.md` (vd. Q-01 `mssql` + raw SQL, Q-03 PM2 1 instance, Q-08 stub notifier, Q-14 hoàn tiền theo `CanceledAt`). Cần chủ dự án xác nhận nếu có thay đổi. | Có thể nâng cấp không phá cấu trúc. |
| **Tích hợp kênh gửi ngoài thật (ngoài phạm vi giai đoạn 1)** | Thay `StubOutboundNotifier` bằng nhà cung cấp Email (SMTP/SendGrid), SMS hoặc Zalo OA thật khi đưa vào vận hành mở rộng. | Hiện log ra console/file theo đúng phạm vi Q-08. |
| **Tối ưu code-splitting Frontend (khuyến nghị)** | Chunk JS sau build hiện ~708 kB (gzip ~192 kB); có thể tách `React.lazy` theo cụm route Customer / Staff / Owner để giảm tải lần đầu. | Không ảnh hưởng chức năng. |
