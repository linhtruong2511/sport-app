# Lộ trình triển khai

Mỗi giai đoạn kết thúc khi đạt **Definition of Done** chung + DoD riêng. Không bắt đầu giai đoạn sau khi giai đoạn trước
còn test đỏ. Đánh dấu `[x]` khi xong và ghi ngày.

**DoD chung:** lint + typecheck xanh · test của giai đoạn xanh (unit + integration trên SQL Server thật) · mọi mã lỗi trong
đặc tả SDD của các API thuộc giai đoạn có test · không TODO treo trong code nghiệp vụ · cập nhật `decisions.md` nếu phát sinh chốt mới.

---

## M0 — Nền móng *(Hoàn tất 25/11/2026)*
Chốt trước: **Q-01** (data access), **Q-13** (stack: `backend/` đang dùng NestJS 12), **Q-02** (idempotency).
- [x] Chuẩn hóa npm workspaces cho các thư mục hiện có: `backend/`, `app/`, `e2e/` và thêm `packages/shared`; tsconfig strict; lint (`oxlint` ở `app/`, ESLint ở `backend/`) + Prettier; Vitest. *(25/11/2026)*
- [x] `docker-compose.yml` SQL Server; script `db:reset` chạy `database/sporthub_init.sql`; migration runner đơn giản
      (bảng `SchemaMigrations`, chạy file `database/migrations/*.sql` theo thứ tự). *(25/11/2026)*
- [x] `backend/src/core/`: db pool + `withTransaction`, `AppError` + error filter/middleware + envelope, `Clock`, `time`, `money`,
      `SettingsService`, `codes` (usp_NextCode), logger có `traceId`, `realtime` emitter thu sự kiện sau commit. *(25/11/2026)*
- [x] `packages/shared`: enum + nhãn tiếng Việt, mã lỗi, zod validators dùng chung (mục 11 business-rules). *(25/11/2026)*
- [x] FE (`app/`): đã có 12 màn hình prototype + bộ test `e2e/` Playwright; bổ sung API client (bearer, refresh 1 lần, Idempotency-Key), TanStack Query và đồng bộ route/proxy `/api` → `backend/`. *(25/11/2026)*
- DoD: `backend/` và `app/` cùng chạy; `GET /api/v1/health` (tại `backend/src/health/health.controller.ts`) đọc được DB; test integration mẫu tạo/rollback transaction. *(Đạt 25/11/2026)*

## M1 — Xác thực & phân quyền *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 01, 02, 06, 09, 10 · guard `JwtAuthGuard`, `OptionalJwtAuthGuard`, `RolesGuard`, `BranchScopeGuard` · socket handshake + `auth.revoked`. *(25/11/2026)*
- [x] FE API layer (`app/src/api/auth.ts`, `app/src/auth/AuthContext.tsx`) & nối UI thật MH.01, MH.03 (`Login.tsx`, `layouts.tsx`), bỏ công cụ demo. *(25/11/2026)*
- DoD: các ca phân quyền + khóa tạm ở business-rules mục 14. *(Đạt 25/11/2026 — 7/7 integration + 11/11 unit)*

## M2 — Danh mục, lưới lịch, báo giá *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 03, 04, 07, 08, 11, 12, 24 · module `catalog`, `availability`, `pricing` (hàm thuần, phủ test cao nhất), `promotions` (public). *(25/11/2026)*
- [x] FE API hooks & nối UI MH.02, MH.04 (`Home.tsx`, `Booking.tsx` đọc lưới/giá/KM hoàn toàn từ API + Socket.IO `availability`). *(25/11/2026)*
- DoD: toàn bộ ca "Tiền" và "Khuyến mãi" (trừ ca tranh lượt) xanh. *(Đạt 25/11/2026 — 9/9 engine unit + 16/16 integration)*

## M3 — Đặt online & thanh toán QR *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 13, 14, 15, 16, 17, 18, 19, 20, webhook SePay · VietQR EMVCo payload · job `expireHolds`, `expireQr` (`sp_getapplock`) · socket `slot.updated`, `booking.*`, `payment_request.expired`. *(25/11/2026)*
- [x] FE API clients & nối UI MH.04–MH.06 (`Booking.tsx`, `Payment.tsx` dùng `QRCodeSVG` + đồng hồ server `getServerNowMs()`, `MyBookings.tsx` dùng `allowedActions` & API-20 cancel-preview), bỏ nút mô phỏng demo. *(25/11/2026)*
- DoD: ca "Trùng lịch & đồng thời", "Thanh toán", "Hủy & hoàn" xanh. *(Đạt 25/11/2026 — 2/2 VietQR unit + 13/13 bookings/payments integration)*

## M4 — POS tại quầy *(Hoàn tất BE + Jobs + FE 25/11/2026)*
- [x] API 25–35 (`pos` module) · job `cancelNoShows`, `closePaidNoShows` (R-04), `autoComplete`, `sendReminders`. *(25/11/2026)*
- [x] FE API client & nối UI MH.07–MH.08 (`StaffBooking.tsx`, `StaffOrders.tsx`). *(25/11/2026)*
- DoD: ca "Nhận sân" + no-show 2 nhánh (R-04) xanh. *(Đạt 25/11/2026 — 4/4 pos + 3/3 jobs integration)*

## M5 — Thông báo *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 05, 21, 22, 23 · thông báo `PAYMENT_RESULT`, `REMINDER`, `SCHEDULE_CHANGE` · `notification.created` · `StubOutboundNotifier`. *(25/11/2026)*
- [x] FE API client & nối UI chuông thông báo (`layouts.tsx`, `NotificationInbox.tsx`, `RealtimeBridge.tsx`). *(25/11/2026)*

## M6 — Quản trị sân & lịch *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 36–39 (`affected-bookings`), API 47–58 (`admin/courts`) · chuyển sân, đóng đơn `BY_FACILITY`, `?dryRun=true`, `GroupKey`, bảo lưu giá FR 06 · `AuditLogs`. *(25/11/2026)*
- [x] FE API clients & nối UI MH.11 (`OwnerCourts.tsx`) & `AffectedBookingsModal.tsx`. *(25/11/2026)*

## M7 — Nhân viên & khuyến mãi *(Hoàn tất BE + Job + FE 25/11/2026)*
- [x] API 42–46 (`admin/staff`), API 59–65 (`admin/promotions`) · job `retryPromoNotify` · khóa/mở khóa & đổi cơ sở thu hồi phiên (`auth.revoked`), `CUSTOMER_NOT_FOUND` trả `details.phones`, xóa mềm `DISCONTINUED` khi `UsedCount > 0`. *(25/11/2026)*
- [x] FE API clients & nối UI MH.10, MH.12 (`OwnerStaff.tsx`, tab Khuyến mãi ở `OwnerReports.tsx`). *(25/11/2026)*
- DoD: các ca phân quyền nhân viên, thu hồi phiên, gửi/thử lại thông báo KM xanh. *(Đạt 25/11/2026 — 10/10 integration)*

## M8 — Dashboard, báo cáo, đối soát *(Hoàn tất BE + FE 25/11/2026)*
- [x] API 40, 41 (`dashboard`), API 66 (`reports`), API 67–73 (`reconciliation` & `refunds`) · công thức doanh thu SDD 3.5f + Q-14 loại `BY_FACILITY`, đối soát khớp đơn / hoàn / bỏ qua, xử lý hoàn tiền OWNER. *(25/11/2026)*
- [x] FE API clients & nối UI MH.09, MH.13, MH.14 (`StaffStats.tsx`, `OwnerReports.tsx`, `Reconciliation.tsx`). *(25/11/2026)*
- DoD: số liệu khớp tính tay trên bộ seed (ca "Doanh thu"). *(Đạt 25/11/2026 — 11/11 integration)*

## M9 — Cứng hóa
Rate limit, cấu hình Nginx, PM2, log, sao lưu DB, kiểm tra bảo mật (OWASP cơ bản), test tải tạo đơn đồng thời.

---

## API đã xong

| API | Trạng thái | Ghi chú |
| --- | --- | --- |
| API-01 `GET /auth/me` | [x] Xong (25/11/2026) | `auth` module |
| API-02 `POST /auth/refresh` | [x] Xong (25/11/2026) | Xoay vòng cookie `sh_rt` |
| API-03 `GET /branches` | [x] Xong (25/11/2026) | `catalog` module (ẩn thông tin NH, `ALL` chỉ OWNER) |
| API-04 `GET /sports` | [x] Xong (25/11/2026) | `catalog` module |
| API-05 `GET /me/notifications/unread-count` | [x] Xong (25/11/2026) | `notifications` module |
| API-06 `POST /auth/login` | [x] Xong (25/11/2026) | R-07 khóa tạm 5 lần / 5 phút |
| API-07 `GET /promotions/public` | [x] Xong (25/11/2026) | `promotions` module |
| API-08 `GET /branches/:branchId/sport-summary` | [x] Xong (25/11/2026) | Dùng chung `AvailabilityService` |
| API-09 `POST /auth/logout` | [x] Xong (25/11/2026) | Thu hồi refresh token, 204 |
| API-10 `POST /auth/register` | [x] Xong (25/11/2026) | `usp_NextCode('KH')`, 201 |
| API-11 `GET /availability` | [x] Xong (25/11/2026) | `DisplayBlockMinutes`, ưu tiên LOCKED>MINE>HELD>BOOKED>PAST>FREE |
| API-12 `POST /bookings/quote` | [x] Xong (25/11/2026) | Pure `pricing.engine` (giá, 8 bước KM, R-09 cọc, hoàn tiền) |
| API-13 `POST /bookings` | [x] Xong (25/11/2026) | `bookings` module, Idempotency-Key, chống trùng `UX_BookingSlots_Court_Slot` |
| API-14 `GET /bookings/:bookingCode` | [x] Xong (25/11/2026) | `BookingDetailDto` đầy đủ, phân quyền CUSTOMER/STAFF/OWNER |
| API-15 `GET /bookings/:bookingCode/payment-request` | [x] Xong (25/11/2026) | `payments` module |
| API-16 `POST /bookings/:bookingCode/payment-requests` | [x] Xong (25/11/2026) | VietQR EMVCo + CRC16, Idempotency-Key |
| API-17 `POST /payment-requests/:requestId/recheck` | [x] Xong (25/11/2026) | `BankGateway`, rate limit 1/5s/đơn (`429`), `502` |
| API-18 `POST /bookings/:bookingCode/cancel` | [x] Xong (25/11/2026) | `RowVer`, hoàn tiền, R-04 `NO_SHOW` DEPOSITED/PAID, `UsedCount - 1` |
| API-19 `GET /me/bookings` | [x] Xong (25/11/2026) | `statusCounts`, `INVALID_DATE_RANGE` |
| API-20 `GET /bookings/:bookingCode/cancel-preview` | [x] Xong (25/11/2026) | Dùng chung `calculateRefund` |
| API-21 `GET /me/notifications` | [x] Xong (25/11/2026) | `notifications` module, `unreadCount` |
| API-22 `PATCH /me/notifications/:notificationId` | [x] Xong (25/11/2026) | Đánh dấu đã đọc |
| API-23 `POST /me/notifications/read-all` | [x] Xong (25/11/2026) | Đánh dấu tất cả đã đọc |
| API-24 `GET /promotions/public/:code` | [x] Xong (25/11/2026) | `PROMO_NOT_FOUND` 404 / `usable` 200 |
| API-25 `GET /pos/schedule` | [x] Xong (25/11/2026) | `pos` module, lưới quầy kèm booking & `isOverdue` |
| API-26 `GET /pos/customers` | [x] Xong (25/11/2026) | Tra cứu hội viên theo SĐT |
| API-27 `GET /pos/promotions` | [x] Xong (25/11/2026) | Mã áp dụng được tại quầy |
| API-28 `POST /pos/bookings` | [x] Xong (25/11/2026) | Idempotency-Key, tạo đơn + thu tiền mặt / QR |
| API-29 `POST /pos/bookings/:bookingCode/payments` | [x] Xong (25/11/2026) | Idempotency-Key, thu tiền mặt đơn chờ |
| API-30 `POST /pos/bookings/:bookingCode/abort` | [x] Xong (25/11/2026) | `COUNTER_ABORT`, trả slot & `UsedCount` |
| API-31 `GET /pos/receipts/latest` | [x] Xong (25/11/2026) | Phiếu thu gần nhất tại quầy |
| API-32 `GET /pos/bookings` | [x] Xong (25/11/2026) | `tabCounts` + `AFFECTED` |
| API-33 `POST /pos/bookings/:bookingCode/settle` | [x] Xong (25/11/2026) | Idempotency-Key, `COURT_IN_USE` kiểm trước thu tiền |
| API-34 `POST /pos/bookings/:bookingCode/check-in` | [x] Xong (25/11/2026) | `PAYMENT_INCOMPLETE`, Q-15 `-15'`, `COURT_IN_USE` |
| API-35 `POST /pos/bookings/:bookingCode/complete` | [x] Xong (25/11/2026) | Kết thúc sớm & mở slot tương lai |
| API-36 `GET /affected-bookings` | [x] Xong (25/11/2026) | Tính trực tiếp 4 lý do |
| API-37 `GET /affected-bookings/:bookingCode/reassign-options` | [x] Xong (25/11/2026) | Cùng cơ sở/môn/thời lượng |
| API-38 `POST /affected-bookings/:bookingCode/reassign` | [x] Xong (25/11/2026) | Giữ nguyên tiền, `BookingTransfers`, `SCHEDULE_CHANGE` |
| API-39 `POST /affected-bookings/:bookingCode/close` | [x] Xong (25/11/2026) | `BY_FACILITY` hoàn 100% kể cả cọc |
| API-40 `GET /dashboard/daily` | [x] Xong (25/11/2026) | `dashboard` module, KPI + sơ đồ sân + `affectedCount` |
| API-41 `GET /dashboard/daily/bookings` | [x] Xong (25/11/2026) | Drilldown theo KPI, `retainedAmount` |
| API-42 `GET /admin/staff` | [x] Xong (25/11/2026) | `admin/staff` module, thống kê thu tiền & đơn quầy |
| API-43 `POST /admin/staff` | [x] Xong (25/11/2026) | `usp_NextCode('NV')`, `PHONE_TAKEN`/`EMAIL_TAKEN` + `takenByRole` |
| API-44 `PUT /admin/staff/:userId` | [x] Xong (25/11/2026) | Thu hồi phiên khi đổi cơ sở hoặc đổi mật khẩu |
| API-45 `POST /admin/staff/:userId/lock` & `/unlock` | [x] Xong (25/11/2026) | Thu hồi phiên ngay + giữ nguyên lịch sử thu tiền |
| API-46 `GET /admin/staff/:userId/payments` | [x] Xong (25/11/2026) | Lịch sử phiếu thu của nhân viên |
| API-47 `GET /admin/courts` | [x] Xong (25/11/2026) | `admin/courts`, `displayStatus` |
| API-48 `GET /admin/courts/:courtId` | [x] Xong (25/11/2026) | Kèm `hasOpenBookings` |
| API-49 `POST /admin/courts` | [x] Xong (25/11/2026) | R-06 `SAN_{abbr}_{NN}`, `PRICE_RULE_OVERLAP` |
| API-50 `PUT /admin/courts/:courtId` | [x] Xong (25/11/2026) | Bảo lưu giá FR 06, `SPORT_IMMUTABLE`, `AuditLogs` |
| API-51 `GET /admin/court-blocks` | [x] Xong (25/11/2026) | Khóa sân đang hiệu lực |
| API-52 `POST /admin/court-blocks` | [x] Xong (25/11/2026) | `?dryRun=true`, `BLOCK_OVERLAP`, `slot.updated` |
| API-53 `POST /admin/court-blocks/:blockId/release` | [x] Xong (25/11/2026) | Giữ lịch sử `ReleasedAt`, `slot.updated` |
| API-54 `GET /admin/branches/:branchId/opening-hours` | [x] Xong (25/11/2026) | 7 ngày |
| API-55 `PUT /admin/branches/:branchId/opening-hours` | [x] Xong (25/11/2026) | `?dryRun=true`, `INVALID_OPENING_HOURS`, `AuditLogs` |
| API-56 `GET /admin/holidays` | [x] Xong (25/11/2026) | Q-06 `groupKey` |
| API-57 `POST /admin/holidays` | [x] Xong (25/11/2026) | `?dryRun=true`, `HOLIDAY_IN_PAST`, `scope=ALL` `GroupKey` |
| API-58 `DELETE /admin/holidays/:holidayId` | [x] Xong (25/11/2026) | `?group=true` xóa theo `GroupKey` |
| API-59 `GET /admin/promotions` | [x] Xong (25/11/2026) | `admin/promotions`, lọc trạng thái/đối tượng |
| API-60 `GET /admin/promotions/:promotionId` | [x] Xong (25/11/2026) | Chi tiết kèm `customers[]` |
| API-61 `POST /admin/promotions` | [x] Xong (25/11/2026) | `CUSTOMER_NOT_FOUND` (`details.phones`), fan-out thông báo |
| API-62 `PUT /admin/promotions/:promotionId` | [x] Xong (25/11/2026) | `PROMO_CODE_LOCKED`, `MAX_USES_TOO_LOW`, `PROMO_DISCONTINUED` |
| API-63 `POST /admin/promotions/:promotionId/pause` & `/resume` | [x] Xong (25/11/2026) | Tạm dừng / mở lại mã |
| API-64 `DELETE /admin/promotions/:promotionId` | [x] Xong (25/11/2026) | 204 xóa cứng nếu `UsedCount=0`, 200 `DISCONTINUED` nếu >0 |
| API-65 `POST /admin/promotions/:promotionId/notify` | [x] Xong (25/11/2026) | 202 gửi lại thông báo KM + job `retryPromoNotify` |
| API-66 `GET /reports/revenue` | [x] Xong (25/11/2026) | `reports` module, SDD 3.5f + Q-14, công suất & KM |
| API-67 `GET /reconciliation/transactions` | [x] Xong (25/11/2026) | `reconciliation` module, phạm vi cơ sở STAFF |
| API-68 `GET /reconciliation/transactions/:bankTxnId/candidates` | [x] Xong (25/11/2026) | Gợi ý đơn khớp |
| API-69 `POST /reconciliation/transactions/:bankTxnId/match` | [x] Xong (25/11/2026) | Khớp chính xác số tiền, `applyPaymentInTx`, socket + TB |
| API-70 `POST /reconciliation/transactions/:bankTxnId/refund-to-customer` | [x] Xong (25/11/2026) | Đánh dấu hoàn tiền khách kèm ghi chú |
| API-71 `POST /reconciliation/transactions/:bankTxnId/ignore` | [x] Xong (25/11/2026) | Bỏ qua giao dịch (`IGNORED`) |
| API-72 `GET /refunds` | [x] Xong (25/11/2026) | Danh sách hoàn tiền (OWNER) |
| API-73 `POST /refunds/:refundId/complete` & `/fail` | [x] Xong (25/11/2026) | `REFUND_ALREADY_PROCESSED`, thông báo khách khi hoàn |
| Webhook `POST /webhooks/bank/:provider` | [x] Xong (25/11/2026) | SePay Apikey, `UPDLOCK`, idempotent, khớp chính xác / `NEEDS_REVIEW` |
