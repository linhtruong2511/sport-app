# Quyết định và câu hỏi mở

- **R-xx**: đã chốt — code phải theo. Thêm mục mới khi người dùng xác nhận một mâu thuẫn.
- **Q-xx**: còn mở — có **mặc định đề xuất** để không chặn việc code; khi được chốt, chuyển thành R-xx và sửa code liên quan.

Lập ngày 25/11/2026 từ SRS, SDD và `sporthub_init.sql`.

---

## Đã chốt

### R-01. Thứ tự ưu tiên tài liệu
`decisions.md` > SRS (đoạn "Bổ sung ngày …" ghi đè phần cũ) > SDD > ví dụ JSON trong SDD.
Riêng **tên bảng/cột**: `sporthub_init.sql` > SDD.

### R-02. Tên đối tượng CSDL theo script
`PaymentRequest` (số ít), `Channel`, `CreatedAt`, `MaxDiscountAmount`, `Courts.Description` một cột,
PK `SystemSettings(SettingKey)`, PK `CodeSequences(Prefix, DateKey)`. Văn bản SDD còn ghi tên cũ — bỏ qua.

### R-03. Hạn giữ chỗ = 10 phút
SDD 3.3 ghi "cần chốt (ví dụ 15)", nhưng SDD 2.7, 3.5d và seed `BOOKING_HOLD_MINUTES = 10`.
→ Dùng 10, đọc từ `SystemSettings`. `HoldExpireAt = min(now + 10', StartAt)`.

### R-04. Khách không đến nhận sân (no-show) — tách theo trạng thái tiền
- SRS FR 11 (bổ sung 24/11/2026): đơn **đã thanh toán 100%** mà khách không đến thì **không hủy sớm**, giữ sân tới hết giờ đã
  đặt rồi mới ghi nhận Đã hủy, lý do khách không tới. SDD 3.5e cũng ghi như vậy.
- SDD 2.8 (job `cancelNoShows`) và 2.7 lại hủy mọi đơn CONFIRMED tại `StartAt + 30'` → **mâu thuẫn, SDD 2.7/2.8 sai**.
- Chốt:
  - Đơn `DEPOSITED`: hủy NO_SHOW tại `StartAt + NO_SHOW_GRACE_MINUTES`, giữ cọc, giải phóng ô.
  - Đơn `PAID`: job mới `closePaidNoShows` hủy NO_SHOW tại `EndAt` nếu chưa nhận sân; RefundRate = 0.
    Trong khoảng `StartAt + 30'` → `EndAt`, khách đến muộn vẫn nhận sân bình thường; `isOverdue = true` để NV chú ý.
  - NV chọn "Khách không đến nhận sân" cho đơn PAID trước `EndAt` → `422 NO_SHOW_NOT_ELIGIBLE`.

### R-05. Độ hạt `BookingSlots` = `Sports.GridBlockMinutes`
Thuật ngữ SDD 1.3 nói ô cố định 30 phút, nhưng SDD 3.3 và seed chia theo `GridBlockMinutes` (15/30/60).
→ Chia theo `GridBlockMinutes` của môn. Hệ quả: **không đổi `GridBlockMinutes` khi môn đã có đơn tương lai**
(API admin phải chặn nếu sau này cho sửa môn).

### R-06. Ví dụ JSON không phải quy tắc
Một số ví dụ trong SDD mâu thuẫn quy tắc (vd. API-36/52/55: đơn `PENDING_PAYMENT` nhưng `paymentStatus = DEPOSITED`;
API-49 response trả `SAN_PK_08` nhưng seed dùng tiền tố `SAN_PB_`). Theo quy tắc, không theo ví dụ.
Mã sân tự sinh: `SAN_{viết tắt môn}_{STT 2 chữ số}` với viết tắt theo seed: `PB` Pickleball, `CL` Cầu lông,
`BR` Bóng rổ, `BD` Bóng đá, `TN` Tennis.

### R-07. Khóa tạm đăng nhập
Đạt 5 lần sai → `LockedUntil = now + 5'` **và đặt lại** `FailedLoginCount = 0` (theo API-06).

### R-08. Câu thông báo lỗi
Lấy đúng câu trong đặc tả API của SDD (mục 5.5); API nào SDD không ghi câu thì lấy SRS.
Vd. tài khoản NV bị khóa: "Tài khoản nhân viên đã bị khóa, vui lòng liên hệ chủ hệ thống."

### R-09. Cọc ≥ tổng tiền → bắt buộc thanh toán đủ
Báo giá trả `deposit.fullPaymentRequired = true`; tạo đơn DEPOSIT → `422 DEPOSIT_NOT_ALLOWED`.
Đơn FULL luôn `DepositAmount = 0` (khớp CHECK `CK_Bookings_DueNow`).

### R-10. Khung giá chọn theo thời điểm tạo đơn
SDD 3.5a: `EffectiveFrom ≤ thời điểm tạo đơn < EffectiveTo`, không theo ngày chơi.

---

## Còn mở (có mặc định đề xuất)

### Q-01. Data access và múi giờ — *quan trọng, chốt trước M0*
SDD ghi "Prisma / SQL thuần". Prisma đọc/ghi `DATETIME2` như UTC → lệch 7 giờ với dữ liệu giờ VN; Prisma không mô tả được
filtered index, CHECK phức tạp; các câu `UPDLOCK`, `sp_getapplock`, `OUTPUT inserted` phải viết raw.
**Đề xuất:** `mssql` (tedious) + `useUTC: false` + query builder nhẹ (Kysely với dialect MSSQL) hoặc SQL tham số hóa trong
repository. Schema quản lý bằng file SQL, không dùng `prisma migrate`.
*Phương án B:* Prisma (introspect bằng `db pull`) cho CRUD + `$queryRaw` cho câu đồng thời, bắt buộc qua lớp chuyển đổi giờ.

### Q-02. Lưu Idempotency-Key ở đâu
SDD yêu cầu lưu key + kết quả 24 giờ nhưng 26 bảng không có bảng nào cho việc này, kiến trúc không có Redis.
**Đề xuất:** migration `001_idempotency_keys.sql` thêm bảng
`IdempotencyKeys(Key UNIQUEIDENTIFIER, UserId BIGINT NULL, Method, Path, RequestHash CHAR(64), StatusCode, ResponseBody NVARCHAR(MAX), CreatedAt, ExpiresAt)`,
PK `(Key, UserId)`; job dọn dòng hết hạn hằng giờ.

### Q-03. Socket.IO khi chạy PM2 cluster
Nhiều instance thì sự kiện phát ở instance A không tới client nối vào instance B; rate limit trong bộ nhớ cũng lệch.
**Đề xuất:** giai đoạn đầu chạy **1 instance** (PM2 fork). Khi cần scale: thêm Redis + `@socket.io/redis-adapter`.
Job vẫn giữ `sp_getapplock` để an toàn khi scale.

### Q-04. Ô hiển thị trên lưới (2 giờ Pickleball, 90 phút bóng đá)
SDD 1.3 và API-11 (`slotMinutes: 120`) có "ô lịch hiển thị" cấu hình theo môn, tham chiếu "mục 5.8" — mục này **không có**
trong SDD; CSDL chỉ có `GridBlockMinutes` (CHECK 15/30/60).
**Đề xuất:** migration thêm `Sports.DisplayBlockMinutes SMALLINT NOT NULL DEFAULT 60`, CHECK là bội số của
`GridBlockMinutes`. Seed: Pickleball 120, Bóng đá 90, Cầu lông 60, Tennis 60, Bóng rổ 60. Khách chọn 1 hoặc nhiều ô liền
nhau; backend vẫn kiểm tra bội số `GridBlockMinutes`.

### Q-05. Cảnh báo cho nhân viên (STAFF_ALERT)
SDD 2.6b tạo "thông báo STAFF_ALERT" cho NV và Chủ sân khi có giao dịch cần đối soát, nhưng `Notifications.Type` CHECK không
có giá trị này và bảng mô tả là chỉ cho CUSTOMER.
**Đề xuất:** không lưu vào `Notifications`; cảnh báo NV/OWNER bằng socket `reconciliation.created` + badge số lượng ở MH.14
(đếm từ `BankTransactions WHERE MatchStatus = 'NEEDS_REVIEW'`).

### Q-06. Gom nhóm ngày nghỉ "Toàn hệ thống"
API-56 trả `groupKey` (tham chiếu mục 5.8 không tồn tại); `BranchHolidays` không có cột này.
**Đề xuất:** migration thêm `BranchHolidays.GroupKey VARCHAR(30) NULL`; tạo với scope ALL thì các dòng chung một key.

### Q-07. Mã KM chỉ áp dụng tại quầy (`PROMO_WRONG_CHANNEL`)
Chỉ dùng "nếu chốt bổ sung cột Channel". **Đề xuất:** chưa làm.

### Q-08. Kênh Email/SMS/Zalo
**Đề xuất:** chỉ in-app + socket; interface `OutboundNotifier` với bản stub ghi log.

### Q-09. MH.14 Đối soát & Hoàn tiền
Có trong API (67–73) nhưng không có trong danh sách màn hình SDD mục 4. **Đề xuất:** làm, vì cần cho UC 005-2c/2d, UC 012-3d,
UC 009-3a, UC 021. Route `/owner/reconciliation`; STAFF xem tab giao dịch của cơ sở mình.

### Q-10. Hạng hội viên (`MemberTier`)
SRS chưa định nghĩa hạng. **Đề xuất:** chỉ lưu/hiển thị, không có logic tự xếp hạng hay ưu đãi theo hạng.

### Q-11. UC 025 và UC 024
UC 005 gọi "thực hiện UC 025 để xác thực giao dịch" nhưng không có đặc tả UC 024/025.
**Đề xuất:** coi UC 025 là bước xác thực + khớp webhook theo SDD 2.6b; không có màn hình riêng.

### Q-12. Thực hiện hoàn tiền
SRS UC 009-3a ngụ ý hoàn qua cổng thanh toán; SDD chỉ ghi nhận `Refunds` PENDING và OWNER đánh dấu.
**Đề xuất:** hoàn **ngoài hệ thống**, hệ thống chỉ ghi nhận (API-72/73). Không tích hợp API chi hộ.

### Q-13. Lựa chọn công nghệ chưa ghi trong SDD
**Đề xuất mặc định:** TypeScript (FE + BE), Express, zod, Vite, React Router, TanStack Query, Vitest, npm workspaces,
pino (log), Node.js LTS ≥ 22. Đổi được trước khi bắt đầu M0.

### Q-14. Kỳ tính tiền hoàn trong doanh thu
SDD 3.5f trừ "Σ_kỳ Bookings.RefundAmount" nhưng không nói kỳ theo mốc nào.
**Đề xuất:** theo `CanceledAt` trong kỳ (tiền hoàn phát sinh lúc hủy), kể cả khi `Refunds` còn PENDING.

### Q-15. Nhận sân khi chưa tới giờ
SDD chỉ yêu cầu "ngày chơi là hôm nay". **Đề xuất:** cho phép nhận sân sớm nhất `StartAt − 15'` và chỉ khi đơn trước
trên sân đã xong (đã có kiểm tra `COURT_IN_USE`). Cần xác nhận con số 15 phút.
