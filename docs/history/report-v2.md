# Báo cáo tiến độ triển khai dự án SportHub

**Phiên bản:** v2 (lưu trữ các phiên bản tại `docs/history/`) · **Ngày cập nhật:** 25/11/2026  
**Trạng thái tổng thể:** Hoàn tất triển khai lộ trình **M0 – M9** và xử lý toàn bộ phát hiện kiểm tra mã nguồn (`C-1..C-4`, `M-1..M-9`, `L-1..L-10`, dọn mã chết, cập nhật E2E full-stack thật và đồng bộ tài liệu).

---

## 1. Những gì đã làm

### A. Hạ tầng & CSDL (M0)
- Thiết lập monorepo npm workspaces (`packages/shared`, `backend`, `app`, `e2e`), ESLint/oxlint, Prettier, Vitest (unit + integration), `docker-compose.yml` cho SQL Server.
- Xây dựng `@sporthub/shared`: toàn bộ enum, nhãn tiếng Việt, mã lỗi chuẩn (`ERROR_CATALOG`), DTO types và Zod validators dùng chung FE/BE.
- Khởi tạo `database/sporthub_init.sql` (kèm chốt chặn `@AllowReset` chống xóa DB nhầm) cùng 4 migration (`001_idempotency_keys.sql`, `002_sports_display_block.sql`, `003_branch_holidays_group_key.sql`, `004_checkin_early_minutes.sql`) và script `db:reset` / `db:migrate` (từ chối `production` / DB non-dev nếu thiếu `--force-i-know`).
- Xây dựng lõi Backend (`backend/src/core/`): transaction pool SQL Server (`poolMax = 20`, retry deadlock 1205, đẩy Socket.IO và `afterCommit` hook sau commit), xử lý múi giờ VN (`useUTC: true` + `core/time.ts`, chốt `R-11`), tiền nguyên VNĐ, `SettingsService`, `usp_NextCode`, `IdempotencyInterceptor` (khóa `IN_PROGRESS` + hash theo `method:path:body`), `AuditService`, `AppExceptionsFilter` kèm `traceId`.

### B. Backend — Đủ 73/73 API, SePay Webhook & 8 Job nền (M1 – M8)
- **M1 — Xác thực & Phân quyền (API 01, 02, 06, 09, 10):** JWT + refresh token rotation (`sh_rt` HttpOnly cookie), khóa tạm R-07 (5 lần sai / 5 phút), guard phân quyền (`OWNER`/`STAFF`/`CUSTOMER`) & phạm vi cơ sở (`BranchScopeGuard` gắn đầy đủ kể cả `DashboardController`), thu hồi phiên tức thì (`auth.revoked`), `tokenVersionCache.invalidate` chạy trong `tx.afterCommit`, `bcrypt.compare` ngoài transaction.
- **M2 — Danh mục, Lưới lịch & Báo giá (API 03, 04, 07, 08, 11, 12, 24):** API cơ sở (kèm `meta.totalCourts`), bộ môn, khuyến mãi công khai, lưới lịch ưu tiên `LOCKED > MINE > HELD > BOOKED > PAST > FREE`, bộ máy tính giá thuần `pricing.engine.ts` (bảo lưu giá R-10, 8 bước KM, cọc R-09, hoàn tiền R-04).
- **M3 & M5 — Đặt sân online, Thanh toán VietQR & Thông báo (API 05, 13–23, Webhook SePay):** Tạo đơn chống trùng lịch bằng unique index `UX_BookingSlots_Court_Slot` (`409 SLOT_TAKEN`), sinh mã VietQR EMVCo + CRC16-CCITT, `recheck` qua `BankGateway` (giới hạn 1 lần/5 giây), webhook SePay bảo vệ bằng `SepayWebhookAuthGuard` trước validate, lưu `BankTransactions` nguyên văn `RawPayload` trong Tx 1 rồi xử lý khớp trong Tx 2 (khóa `UPDLOCK` dòng giao dịch; lỗi nghiệp vụ → `NEEDS_REVIEW`; lỗi DB tạm thời → giữ `PENDING` + `5xx` để SePay gửi lại và khớp tiếp), thu tiền chặt đúng `AmountDueNow` / `RemainingAmount`, hủy đơn với `RowVer`, hệ thống thông báo in-app + `StubOutboundNotifier`.
- **M4 — POS tại quầy & Job vòng đời (API 25–35):** Tách mô-đun POS thành `pos-schedule.service.ts`, `pos-booking.service.ts`, `pos-lifecycle.service.ts` sau facade `PosService`; gom toàn bộ chuyển trạng thái booking và truy vấn job về `BookingStateService` / `BookingsRepository`; đọc `CHECKIN_EARLY_MINUTES` từ `SystemSettings` (`R-12`).
- **M6 — Quản trị sân, lịch & Đơn bị ảnh hưởng (API 36–39, 47–58):** Chuyển sân giữ nguyên tiền (`BookingTransfers`), đóng đơn `BY_FACILITY` hoàn 100% kể cả cọc, CRUD sân + bảng giá bảo lưu FR 06, khóa sân/giờ mở cửa/ngày nghỉ hỗ trợ `?dryRun=true` và `GroupKey`, ghi `AuditLogs`.
- **M7 — Quản trị nhân viên & Khuyến mãi (API 42–46, 59–65):** CRUD nhân viên (`usp_NextCode('NV')`), khóa/mở khóa & đổi chi nhánh tự thu hồi phiên, lịch sử thu tiền; CRUD khuyến mãi (`CUSTOMER_NOT_FOUND`, `PROMO_CODE_LOCKED`, xóa mềm `DISCONTINUED` khi `UsedCount > 0`), gửi/thử lại thông báo ưu đãi.
- **M8 — Dashboard, Báo cáo & Đối soát (API 40, 41, 66, 67–73):** Dashboard ngày & drilldown KPI, báo cáo doanh thu thực thu theo SDD 3.5f + Q-14 (loại `BY_FACILITY`, Backend tính sẵn `bankTransferPct`), công suất sân, đối soát giao dịch ngân hàng và xử lý hoàn tiền cho OWNER (trả `meta.total` và `meta.totalAmount`).
- **8 Job nền (`node-cron` + `sp_getapplock`) & Realtime:** `expireHolds`, `expireQr` cô lập lỗi theo từng item; `cancelNoShows`, `closePaidNoShows` (R-04), `autoComplete`, `sendReminders`, `retryPromoNotify`, `cleanupIdempotencyKeys`; `RealtimeGateway` kiểm tra quyền truy cập phòng `booking:*` (`BOOKING_ACCESS_CHECKER`), chuẩn hóa CORS và định dạng ngày `YYYY-MM-DD`.

### C. Frontend — Nối API thật 12 màn hình, tách bundle & dọn mã chết
- Nối 100% 12 màn hình (`Login`, `Home`, `Booking`, `Payment`, `MyBookings`, `StaffBooking`, `StaffOrders`, `StaffStats`, `OwnerStaff`, `OwnerCourts`, `OwnerReports`, `Reconciliation`) sang REST API + TanStack Query + `AuthContext` + `RealtimeBridge` (Socket.IO) + `VietQrBox` (`qrcode.react`) + đồng hồ đồng bộ server (`getServerNowMs()`).
- Gỡ bỏ `app/mocks/` (~27 file prototype MSW) và `docs/sporthub_init.sql` trùng; tách code-splitting `React.lazy` theo route (chunk JS chính giảm từ ~`709 kB` xuống `343.47 kB` / gzip `100.85 kB`).

### D. Cứng hóa, Chuẩn hóa Linux & Kiểm thử E2E (M9)
- Rate limit `10 req/phút/IP` dùng `expressApp.set('trust proxy', 1)` + `req.ip` cho `/auth/login`, `/auth/register`, `validateProductionEnv()` chặn secret/key mặc định khi `NODE_ENV=production`, kiểm tra lệch `TZ=Asia/Ho_Chi_Minh` khi khởi động.
- Chuẩn hóa triển khai production trên Linux (`R-13`, `R-14`): đưa `msnodesqlv8` vào `optionalDependencies`, bổ sung `database/scripts/backup.sh` & `restore.sh` (`sqlcmd`), cập nhật `deploy/nginx.conf`, `ecosystem.config.cjs`, `deploy/README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/*`.
- Cập nhật bộ `e2e/` Playwright chạy trực tiếp với NestJS Backend + Vite + SQL Server `SportHub_Test` (4 kịch bản E2E xác thực/RBAC, đăng ký, đặt sân VietQR, điều hướng POS/Owner).

### E. Kết quả kiểm chứng
- `npm run typecheck`: **Pass** (`@sporthub/shared`, `sportapp-backend`, `app`)
- `npm run lint` (`eslint` + `oxlint`): **0 errors, 0 warnings**
- `npm run build` (`@sporthub/shared`, `sportapp-backend`, `app`): **Pass** (chunk chính `343.47 kB` / gzip `100.85 kB`)
- `npm test` (unit): **58/58 passed** (11 file: `8/8` `@sporthub/shared`, `50/50` `backend`)
- `npm run test:int` (SQL Server `SportHub_Test`): **91/91 passed** (20 file)
- `npm test -w sporthub-ui-e2e` (Playwright E2E full-stack với `SportHub_Test`): **4/4 passed**

---

## 2. Những gì chưa làm / Hạng mục còn lại trước khi Go-Live

| Hạng mục | Mô tả công việc | Ghi chú |
| --- | --- | --- |
| **Cấu hình môi trường Production trên Linux** | Điền danh sách IP allowlist thật của SePay, chứng chỉ SSL/TLS và domain trong `deploy/nginx.conf`; thiết lập `backend/.env` production (`NODE_ENV=production`, `JWT_ACCESS_SECRET` ≥ 32 ký tự, `SEPAY_WEBHOOK_API_KEY`, thông tin SQL Login) và cron backup `database/scripts/backup.sh`. | Đang dùng placeholder an toàn và cơ chế tự chặn khởi động nếu thiếu secret thật. |
| **Xác nhận quyết định kiến trúc** | Chủ dự án xác nhận `R-11` (`useUTC: true` + `core/time.ts`), `R-12` (nhận sân sớm 15 phút) và `R-13` (triển khai Linux) trong `docs/decisions.md`. | Đang áp dụng tạm theo đề xuất, đã ghi rõ trạng thái "chờ xác nhận". |
| **Tích hợp kênh gửi ngoài thật (ngoài phạm vi giai đoạn 1)** | Thay `StubOutboundNotifier` bằng nhà cung cấp Email (SMTP/SendGrid), SMS hoặc Zalo OA thật khi đưa vào vận hành mở rộng. | Hiện ghi log JSON theo đúng phạm vi `Q-08`. |
| **Mở rộng E2E nghiệp vụ nâng cao (khuyến nghị)** | Bộ E2E hiện phủ 4 luồng cốt lõi/smoke trên Backend + `SportHub_Test`; có thể bổ sung thêm E2E giả lập webhook SePay, hủy đơn và đối soát qua giao diện trước Go-Live. | Các quy tắc tiền/trạng thái/đồng thời đã có 91 integration test phủ. |
