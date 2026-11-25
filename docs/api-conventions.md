# Quy ước API (SDD 5.1–5.4)

Đặc tả đầy đủ từng API (request, response mẫu, xử lý phía server, lỗi) nằm ở `docs/SDD.md` mục 5.5.
File này là luật chung + chỉ mục. Ví dụ JSON trong SDD chỉ minh họa; quy tắc nghiệp vụ thắng ví dụ (R-06).

## 1. Luật chung

| Nội dung | Quy ước |
| --- | --- |
| Base URL | `/api/v1`. Realtime: `/socket.io` |
| Định dạng | JSON UTF-8, trường **camelCase**; enum giữ mã CSDL (`PENDING_PAYMENT`) — FE tự ánh xạ nhãn |
| Xác thực | `Authorization: Bearer <accessToken>`; refresh token ở cookie `sh_rt` |
| Định danh | Đơn dùng `bookingCode` (`BK2026111001`) trong URL; tài nguyên khác dùng id số |
| Thời điểm | ISO 8601 có offset: `2026-11-12T18:00:00+07:00`. Ngày `YYYY-MM-DD`. Giờ `HH:mm` |
| `meta.serverTime` | Có trong **mọi** response để FE đếm ngược theo giờ máy chủ |
| Tiền | Số nguyên VNĐ. Tỷ lệ % là số thực (`30`, `50.5`) |
| Phân trang | `?page=1&pageSize=20` (≤ 100); `meta.page, pageSize, totalItems, totalPages`; sắp xếp `?sort=-createdAt` |
| Idempotency-Key | Bắt buộc với: API-13, 16, 28, 29, 33 (và mọi POST tạo đơn/thu tiền/tạo QR mới thêm sau) |
| `version` | Bắt buộc trong body với API đổi trạng thái đơn: 18, 29, 30, 33, 34, 35, 38, 39 |
| `allowedActions` | Server tính cho người gọi: `PAY, CANCEL, SETTLE, CHECK_IN, COMPLETE, NO_SHOW_CANCEL, REASSIGN, CLOSE_BY_FACILITY`. FE hiện/ẩn nút theo mảng này, không tự suy luận |
| Rate limit | login/register 10/phút/IP; recheck 1/5 giây/đơn → `429` + `Retry-After` |
| Thông báo lỗi | Tiếng Việt, đúng câu trong SDD; FE hiển thị nguyên `error.message`, rẽ nhánh theo `error.code` |

## 2. Envelope

```jsonc
// Thành công – đối tượng
{ "data": { ... }, "meta": { "serverTime": "2026-11-12T17:00:05+07:00" } }
// Thành công – danh sách
{ "data": [ ... ], "meta": { "page": 1, "pageSize": 20, "totalItems": 2, "totalPages": 1, "serverTime": "…" } }
// Lỗi
{ "error": { "code": "VALIDATION_ERROR", "message": "Dữ liệu không hợp lệ.",
             "details": [{ "field": "phone", "message": "Số điện thoại phải gồm 10 chữ số và bắt đầu bằng 0." }],
             "traceId": "8f2c1e7a9b" } }
```

Thêm thông tin phụ của danh sách vào `meta` (`statusCounts`, `tabCounts`, `unreadCount`, `countByStatus`…).
`204` không có body (logout, xóa ngày nghỉ, xóa KM chưa dùng).

## 3. Mã lỗi dùng chung

| HTTP | code | Khi nào |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Sai định dạng/thiếu trường; `details[]` theo trường |
| 400 | `INVALID_DATE_RANGE` | from > to hoặc > 366 ngày |
| 401 | `UNAUTHENTICATED` / `TOKEN_EXPIRED` / `TOKEN_REVOKED` / `REFRESH_INVALID` | Token thiếu/hết hạn/thu hồi; cookie refresh hỏng |
| 401 | `ACCOUNT_NOT_FOUND` / `WRONG_PASSWORD` | Đăng nhập (`details.remainingAttempts`) |
| 403 | `FORBIDDEN` / `BRANCH_FORBIDDEN` / `BOOKING_FORBIDDEN` / `ACCOUNT_LOCKED` | Quyền |
| 404 | `NOT_FOUND` | Không có tài nguyên |
| 409 | `SLOT_TAKEN`, `BOOKING_STATE_CHANGED`, `COURT_IN_USE`, `PHONE_TAKEN`, `EMAIL_TAKEN`, `PROMO_EXHAUSTED`, `IDEMPOTENCY_CONFLICT` | Xung đột |
| 422 | Mã nghiệp vụ riêng từng API | Vi phạm quy tắc (`OUTSIDE_OPENING_HOURS`, `HOLD_EXPIRED`, `PAYMENT_INCOMPLETE`…) |
| 423 | `ACCOUNT_TEMP_LOCKED` | Sai mật khẩu 5 lần (`details.lockedUntil`) |
| 429 | `TOO_MANY_REQUESTS` | Vượt rate limit |
| 502 | `PAYMENT_GATEWAY_ERROR` | Không gọi được SePay |
| 500 | `INTERNAL_ERROR` | Kèm `traceId`; không lộ stack trace |

Toàn bộ mã lỗi định nghĩa **một lần** trong `packages/shared/src/errors.ts` (`ERROR_CATALOG`: code → HTTP status → message mặc định).

## 4. Đối tượng dùng chung (SDD 5.3)

`User`, `BookingSummary` (danh sách, trường làm phẳng `branchName, courtName, customerName, customerPhone, isGuest`),
`BookingDetail` (lồng `branch/court/customer` + `priceLines[], payments[], statusHistory[], transfers[], refund`),
`PaymentRequest` (kèm `bank { bin, bankName, accountNo, accountName }`), `Receipt`. Định nghĩa type + mapper một lần;
mọi API trả đơn dùng chung mapper để `allowedActions`, `isOverdue`, `version` luôn nhất quán.

## 5. Chỉ mục endpoint theo module

Quyền: `PUBLIC`, `PUBLIC*` (token tùy chọn), `AUTH`, `CUSTOMER`, `STAFF+` (STAFF trong cơ sở + OWNER), `OWNER`.

**auth** — 01 `GET /auth/me` AUTH · 02 `POST /auth/refresh` cookie · 06 `POST /auth/login` PUBLIC ·
09 `POST /auth/logout` AUTH · 10 `POST /auth/register` PUBLIC

**catalog** — 03 `GET /branches` PUBLIC · 04 `GET /sports` PUBLIC · 08 `GET /branches/{branchId}/sport-summary` PUBLIC

**availability / pricing** — 11 `GET /availability` PUBLIC* · 12 `POST /bookings/quote` PUBLIC* (channel COUNTER chỉ STAFF+)

**bookings** — 13 `POST /bookings` CUSTOMER · 14 `GET /bookings/{code}` AUTH · 18 `POST /bookings/{code}/cancel` CUSTOMER(của mình)/STAFF+ ·
19 `GET /me/bookings` CUSTOMER · 20 `GET /bookings/{code}/cancel-preview` CUSTOMER(của mình)/STAFF+

**payments** — 15 `GET /bookings/{code}/payment-request` AUTH · 16 `POST /bookings/{code}/payment-requests` CUSTOMER(của mình)/STAFF+ ·
17 `POST /payment-requests/{requestId}/recheck` CUSTOMER(của mình)/STAFF+ · webhook `POST /webhooks/bank/{provider}`

**notifications** — 05 `GET /me/notifications/unread-count` · 21 `GET /me/notifications` · 22 `PATCH /me/notifications/{id}` ·
23 `POST /me/notifications/read-all` — tất cả AUTH

**promotions (public)** — 07 `GET /promotions/public` PUBLIC* · 24 `GET /promotions/public/{code}` PUBLIC*

**pos** (STAFF+) — 25 `GET /pos/schedule` · 26 `GET /pos/customers` · 27 `GET /pos/promotions` · 28 `POST /pos/bookings` ·
29 `POST /pos/bookings/{code}/payments` · 30 `POST /pos/bookings/{code}/abort` · 31 `GET /pos/receipts/latest` ·
32 `GET /pos/bookings` · 33 `POST /pos/bookings/{code}/settle` · 34 `POST /pos/bookings/{code}/check-in` ·
35 `POST /pos/bookings/{code}/complete`

**admin – đơn bị ảnh hưởng** (STAFF+) — 36 `GET /affected-bookings` · 37 `GET /affected-bookings/{code}/reassign-options` ·
38 `POST /affected-bookings/{code}/reassign` · 39 `POST /affected-bookings/{code}/close`

**dashboard** (STAFF+) — 40 `GET /dashboard/daily` · 41 `GET /dashboard/daily/bookings`

**admin – nhân viên** (OWNER) — 42 `GET /admin/staff` · 43 `POST /admin/staff` · 44 `PUT /admin/staff/{userId}` ·
45 `POST /admin/staff/{userId}/lock|unlock` · 46 `GET /admin/staff/{userId}/payments`

**admin – sân** (OWNER) — 47 `GET /admin/courts` · 48 `GET /admin/courts/{courtId}` · 49 `POST /admin/courts` ·
50 `PUT /admin/courts/{courtId}` · 51 `GET /admin/court-blocks` · 52 `POST /admin/court-blocks` (`?dryRun`) ·
53 `POST /admin/court-blocks/{blockId}/release`

**admin – giờ mở cửa, ngày nghỉ** (OWNER) — 54 `GET` / 55 `PUT /admin/branches/{branchId}/opening-hours` (`?dryRun`) ·
56 `GET /admin/holidays` · 57 `POST /admin/holidays` (`?dryRun`) · 58 `DELETE /admin/holidays/{holidayId}` (`?group`)

**admin – khuyến mãi** (OWNER) — 59 `GET /admin/promotions` · 60 `GET /admin/promotions/{id}` · 61 `POST /admin/promotions` ·
62 `PUT /admin/promotions/{id}` · 63 `POST /admin/promotions/{id}/pause|resume` · 64 `DELETE /admin/promotions/{id}` ·
65 `POST /admin/promotions/{id}/notify`

**reports** (OWNER) — 66 `GET /reports/revenue`

**reconciliation / refunds** — 67 `GET /reconciliation/transactions` STAFF+ · 68 `GET …/{bankTxnId}/candidates` STAFF+ ·
69 `POST …/{bankTxnId}/match` STAFF+ · 70 `POST …/{bankTxnId}/refund-to-customer` STAFF+ · 71 `POST …/{bankTxnId}/ignore` STAFF+ ·
72 `GET /refunds` OWNER · 73 `POST /refunds/{refundId}/complete|fail` OWNER

## 6. Checklist khi viết một endpoint

- [ ] Route khai báo đúng quyền, `branchScope` nếu là STAFF+, schema zod cho params/query/body.
- [ ] Idempotency-Key / `version` nếu thuộc danh sách ở mục 1.
- [ ] Mọi mã lỗi nghiệp vụ trong đặc tả SDD đều có nhánh xử lý và test.
- [ ] Response dùng mapper chung; có `meta.serverTime`.
- [ ] Ghi `BookingStatusHistory` / `AuditLogs` nếu đặc tả yêu cầu; socket sau commit.
- [ ] Cập nhật bảng "API đã xong" trong `docs/roadmap.md`.
