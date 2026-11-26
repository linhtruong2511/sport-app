# Kiến trúc Thể thao 88 (tóm tắt SDD 2 + ràng buộc triển khai)

## 1. Tổng thể

**Modular monolith** (backend) + **SPA** (frontend), giao tiếp **REST JSON** và **Socket.IO**. Một CSDL SQL Server.

```
Trình duyệt (React SPA) ──HTTPS──► Nginx ──► /api/v1/*      ─► Middleware ─► Services ─► Data access ─► SQL Server
                          ──WSS───►        ──► /socket.io   ─► Realtime Gateway ◄── Services, Scheduler
SePay ──webhook──────────────────► Nginx ──► /api/v1/webhooks/bank/sepay (IP allowlist)
Scheduler (node-cron, trong tiến trình API) ─► Services ─► Realtime Gateway / Notifications (in-app; Email/SMS/Zalo = stub)
```

Chỉ lớp Data access được chạm CSDL. Không có service nào khác ngoài API (không microservice, không queue riêng ở giai đoạn đầu).

## 2. Module backend (SDD 2.3)

| Module | Trách nhiệm | API chính |
| --- | --- | --- |
| `auth` | Đăng nhập/ký, refresh, đăng xuất, khóa tạm khi sai mật khẩu, `/auth/me` | 01, 02, 06, 09, 10 |
| `catalog` | Chi nhánh, bộ môn, sân, bảng giá công khai, sport-summary | 03, 04, 08 |
| `availability` | Lưới lịch: giờ mở cửa, ngày nghỉ, khóa sân, ô đã đặt/đang giữ, giá từng ô | 11, 25 (dùng chung) |
| `pricing` | **Hàm thuần**: tiền thuê, KM, cọc, hoàn tiền. Không I/O ngoài đọc dữ liệu đã truyền vào | 12, 20 (dùng chung) |
| `bookings` | Tạo đơn online, xem/lọc đơn của khách, hủy, máy trạng thái đơn | 13, 14, 18, 19 |
| `payments` | Sinh VietQR, webhook, recheck, phiếu thu, đối soát, hoàn tiền | 15–17, 67–73, webhook |
| `pos` | Đặt tại quầy, tra cứu khách, thu tiền, tất toán, nhận sân, kết thúc sớm | 25–35 |
| `promotions` | CRUD chương trình, kiểm tra điều kiện áp mã, gửi thông báo ưu đãi | 07, 24, 27, 59–65 |
| `notifications` | Lưu + đẩy thông báo in-app; adapter Email/SMS/Zalo (stub) | 05, 21–23 |
| `dashboard` | Chỉ số vận hành trong ngày | 40, 41 |
| `reports` | Doanh thu thực thu, lượt đặt, công suất, hiệu quả KM | 66 |
| `admin` | Nhân viên, sân, bảng giá, giờ mở cửa, ngày nghỉ, khóa sân, đơn bị ảnh hưởng | 36–39, 42–58 |
| `jobs` | Tác vụ nền (mục 7) — chỉ gọi service, không chứa nghiệp vụ riêng | — |

Dùng chung (`backend/src/core/`): `db` (pool, `DbTransactionService`), `errors`, `http` (envelope, rate limit, security headers, traceId), `auth` guard/middleware (`JwtAuthGuard`, `RolesGuard`, `BranchScopeGuard`), `idempotency`, `settings`, `clock`, `money`, `time`, `realtime` (`RealtimeGateway`, `RealtimeService`), `codes` (`usp_NextCode`), `logger`.

## 3. Lớp trong module

| Lớp | Được làm | Không được làm |
| --- | --- | --- |
| Route | Khai báo path, gắn `authenticate`, `authorize(roles)`, `branchScope`, `validate(zodSchema)`, `idempotency` | Logic |
| Controller | Đọc request đã validate, gọi service, trả envelope chuẩn | Nghiệp vụ, SQL |
| Service | Nghiệp vụ, mở transaction, gọi repository, gọi service module khác, thu thập sự kiện domain | Biết về `req/res` |
| Repository | SQL/ORM, ánh xạ hàng ↔ DTO | Quyết định nghiệp vụ |

Module A cần dữ liệu module B → gọi `BService`, truyền transaction hiện tại nếu cần nguyên tử.

## 4. Xác thực và phân quyền (SDD 2.4)

- `authenticate`: đọc `Authorization: Bearer`, verify JWT; hết hạn → `401 TOKEN_EXPIRED`; so `tv` với `Users.TokenVersion`
  (cache ngắn, xóa khi khóa/đổi cơ sở) → `401 TOKEN_REVOKED`; `Status = LOCKED` → `403 ACCOUNT_LOCKED`.
- `authorize('STAFF','OWNER')` theo bảng quyền ở `business-rules.md` mục 1. Ký hiệu SDD: `STAFF+` = STAFF + OWNER.
- `branchScope`: gắn cho mọi route POS/admin/dashboard/affected/reconciliation. STAFF → ép `branchId`.
  Truy cập đơn theo `bookingCode` → service kiểm tra `BranchId` (STAFF) hoặc `CustomerUserId` (CUSTOMER).
- `PUBLIC*`: token tùy chọn; có token thì trả thêm dữ liệu theo người dùng (vd. ô `MINE` trên lưới).
- Refresh: `POST /auth/refresh` đọc cookie `sh_rt`, xoay vòng token. Logout: thu hồi token hiện tại, xóa cookie.

## 5. Chống trùng lịch và đồng thời (SDD 2.5)

Ba cơ chế, mỗi cơ chế có chỗ dùng riêng — **không thay thế lẫn nhau**:

| Cơ chế | Dùng cho | Cách làm |
| --- | --- | --- |
| Unique filtered index `UX_BookingSlots_Court_Slot (CourtId, SlotStart) WHERE IsActive = 1` | Tạo đơn, chuyển sân | Chia đơn thành ô theo `Sports.GridBlockMinutes` (R-05), INSERT tất cả; bắt lỗi 2601/2627 → `409 SLOT_TAKEN` |
| Optimistic concurrency `Bookings.RowVer` | Hủy, thu tiền tại quầy, nhận sân, kết thúc, chuyển sân, đóng đơn | Client gửi `version` (base64); `UPDATE … WHERE BookingId=@id AND RowVer=@ver`; 0 dòng → `409 BOOKING_STATE_CHANGED` |
| Pessimistic `WITH (UPDLOCK, ROWLOCK)` | Webhook, recheck, đối soát khớp tay | Khóa đơn trong transaction, đọc lại trạng thái rồi quyết định — không được bỏ sót tiền |

Thêm:
- **Idempotency-Key** (UUID v4) bắt buộc với POST tạo đơn, thu tiền, tạo QR. Lưu key + hash body + response 24 giờ (Q-02).
  Cùng key cùng body → trả lại response cũ; cùng key khác body → `409 IDEMPOTENCY_CONFLICT`.
- **Sinh mã** `BK…`, `PT…`, `KH…`, `NV…` bằng `dbo.usp_NextCode` **trong cùng transaction** tạo bản ghi.
- `UsedCount` tăng bằng UPDATE có điều kiện (`UsedCount < MaxUses`), không đọc-rồi-ghi.
- Transaction tạo đơn/thu tiền: isolation `READ COMMITTED` là đủ vì đã có unique index + UPDLOCK; không dùng
  `SERIALIZABLE` diện rộng (dễ deadlock). Bắt deadlock (1205) → thử lại tối đa 2 lần.

## 6. Thanh toán VietQR (SDD 2.6)

Xem `business-rules.md` mục 7 cho quy tắc khớp. Ràng buộc kỹ thuật:
- Sinh payload EMVCo ở backend (module `payments/vietqr.ts`), có unit test so với chuỗi mẫu; CRC16-CCITT đúng chuẩn.
- Webhook handler không yêu cầu JWT, không qua `idempotency` middleware (đã idempotent bằng unique key).
- Webhook phải trả lời nhanh: lưu giao dịch + khớp trong một transaction ngắn; việc gửi thông báo/socket làm sau commit.
- Client SePay cho `recheck` nằm sau interface `BankGateway` để test bằng fake.

## 7. Tác vụ nền (SDD 2.8, sửa theo R-04)

node-cron trong tiến trình API. Mỗi job dùng `JobLockService` lấy `sp_getapplock @Resource='sporthub-job-<tên>', @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=0` trên transaction khóa riêng (để các job khác nhau không chặn nhau); không lấy được → bỏ lượt. Mọi job **idempotent** (điều kiện WHERE theo trạng thái), xử lý theo lô (≤ 200 đơn/lượt), mỗi đơn một transaction riêng kèm `try/catch` để một đơn lỗi không chặn cả lô.

| Job | Chu kỳ | Chọn | Hành động |
| --- | --- | --- | --- |
| `expireHolds` | 30 giây | `Status='PENDING_PAYMENT' AND HoldExpireAt < now` | EXPIRED; slots IsActive=0; UsedCount −1; QR → EXPIRED; `slot.updated`, `booking.updated` |
| `sendReminders` | 1 phút | `Status='CONFIRMED' AND ReminderSentAt IS NULL AND StartAt <= now + REMINDER_BEFORE_MINUTES` | Thông báo REMINDER; `ReminderSentAt = now` |
| `cancelNoShows` | 1 phút | `Status='CONFIRMED' AND PaymentStatus='DEPOSITED' AND now >= StartAt + NO_SHOW_GRACE_MINUTES` | CANCELED, NO_SHOW, RefundRate=0; slots IsActive=0 |
| `closePaidNoShows` | 1 phút | `Status='CONFIRMED' AND PaymentStatus='PAID' AND CheckedInAt IS NULL AND now >= EndAt` | CANCELED, NO_SHOW, RefundRate=0, lý do "Khách không tới nhận sân" (R-04) |
| `autoComplete` | 1 phút | `Status='IN_USE' AND EndAt <= now` | COMPLETED, `CheckedOutAt = now` |
| `expireQr` | 1 phút | `PaymentRequest.Status='PENDING' AND ExpiresAt < now` | EXPIRED; `payment_request.expired` |
| `retryPromoNotify` | 15 phút | `Promotions.NotifyStatus='FAILED'` | Gửi lại thông báo ưu đãi |

Job dùng `ChangedBy = NULL` trong lịch sử. Logic chuyển trạng thái nằm trong service `bookings`, job chỉ gọi.

## 8. Realtime (SDD 5.7)

- Kết nối: `io(url, { auth: { token } })`. Không token → chỉ được vào phòng `availability`.
- Phòng tự động: `user:{userId}`; STAFF vào `branch:{branchId}`. Client đăng ký: `availability:{branchId}:{date}`,
  `booking:{code}` (server kiểm tra quyền xem đơn), `branch:{branchId}` (OWNER khi đổi chi nhánh).
- Sự kiện: `slot.updated`, `booking.updated`, `booking.paid`, `payment_request.expired`, `notification.created`,
  `reconciliation.created`, `auth.revoked`. Payload tối thiểu; dữ liệu đầy đủ luôn lấy qua REST.
- Service **thu thập** sự kiện trong transaction, `realtime.flush()` chỉ chạy sau commit; rollback → bỏ sự kiện.
- PM2 cluster nhiều instance cần adapter dùng chung cho Socket.IO (Q-03). Mặc định giai đoạn đầu: **1 instance**.

## 9. Triển khai

- Nginx: phục vụ file tĩnh SPA, proxy `/api/v1` và `/socket.io` (upgrade header), HTTPS, rate limit
  (`/auth/login`, `/auth/register` 10 req/phút/IP), allowlist IP SePay cho webhook.
- Biến môi trường xem `.env.example`. Tiến trình chạy với `TZ=Asia/Ho_Chi_Minh`.
- Log JSON có `traceId` (cũng trả trong `error.traceId`). Không log token, mật khẩu, API key.
