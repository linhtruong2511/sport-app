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

### R-11. Data access và xử lý múi giờ SQL Server (`mssql` + `useUTC: true` + `core/time.ts`)
> **Trạng thái:** thay đề xuất `useUTC: false` của Q-01 bằng `useUTC: true` + `core/time.ts`; **chờ chủ dự án xác nhận**.
- Chốt phương án từ Q-01: không dùng Prisma; dùng driver `mssql` (tedious cho `DB_AUTH_TYPE=sql`, `msnodesqlv8` optional cho Windows dev `DB_AUTH_TYPE=windows`) với SQL tham số hóa và file SQL thuần (`database/sporthub_init.sql` + `database/migrations/`).
- Do dữ liệu `DATETIME2(0)` lưu wall-clock giờ Việt Nam (không offset), backend cấu hình tedious `useUTC: true` và **mọi** chuyển đổi đọc/ghi đi qua `backend/src/core/time.ts` (`toSqlDateTime` / `fromSqlDateTime` dịch chuẩn `+07:00`). Tiến trình bắt buộc chạy `TZ=Asia/Ho_Chi_Minh`.

### R-12. Thời gian cho phép nhận sân sớm (`CHECKIN_EARLY_MINUTES = 15`)
> **Trạng thái:** áp dụng tạm theo đề xuất của Q-15; con số 15 phút **chờ chủ dự án xác nhận** (đổi bằng cách sửa `SystemSettings.CHECKIN_EARLY_MINUTES`, không cần sửa code).
- Chốt Q-15: cho phép nhận sân sớm nhất `StartAt − CHECKIN_EARLY_MINUTES` (mặc định `15` phút), đọc từ bảng `SystemSettings` (migration `004_checkin_early_minutes.sql`), không hard-code.

### R-13. Nền tảng triển khai Production (Linux + SQL Login)
> **Trạng thái:** áp dụng theo đề xuất M-7 của review; **chờ chủ dự án xác nhận** nền tảng Linux.
- Production chuẩn hóa chạy trên **Linux** (Nginx reverse proxy + HTTPS + IP allowlist SePay, Node.js LTS + PM2 1 instance fork mode, `DB_AUTH_TYPE=sql`, `DB_DATABASE=SportHub`, backup/restore qua `database/scripts/backup.sh` & `restore.sh` bằng `sqlcmd`).
- Driver `msnodesqlv8` chuyển sang `optionalDependencies` của `backend/package.json` (chỉ cần cho dev trên Windows khi dùng `DB_AUTH_TYPE=windows`); script PowerShell `backup.ps1`/`restore.ps1` giữ lại cho môi trường Windows dev.

### R-14. Stack kỹ thuật đã chốt (từ Q-13)
- Backend: TypeScript + **NestJS 12** (`backend/`), `mssql`, `zod`, Socket.IO, `node-cron`, Vitest + Supertest.
- Frontend: React 19 + Vite 8 + TypeScript + React Router 7 + TanStack Query + `socket.io-client` + `qrcode.react` (`app/`).
- Monorepo npm workspaces (`@sporthub/shared`, `sportapp-backend`, `app`, `sporthub-ui-e2e`).

### R-15. Kích hoạt job nền và dời thời gian trong E2E (từ Q-E1, Q-E2 của `e2e_comprehensive_plan.md`)
> **Trạng thái:** chủ dự án chốt theo đề xuất ngày 25/11/2026.
- Backend E2E chạy `NODE_ENV=test` nên cron bị tắt (`jobs.service.ts`). E2E kích hoạt job bằng script **chạy một lần, tiến trình riêng**
  `backend/src/scripts/e2eTools.ts`. **Không** thêm endpoint chỉ dành cho test, **không** dùng đồng hồ giả cho cả backend.
- Dùng **đồng hồ thật**. Muốn "tới giờ" thì dời dữ liệu của chính đơn test: `expire-hold` (đưa `HoldExpireAt` và QR `PENDING`
  về quá khứ), `shift-booking` (dời `StartAt/EndAt`, `BookingSlots`, `BookingPriceLines` cùng một khoảng, trong một transaction).
  Va chạm ô vẫn bị `UX_BookingSlots_Court_Slot` chặn.
- Script chỉ chạy khi `NODE_ENV=test` **và** tên DB có hậu tố `_Test`, ngược lại thoát với lỗi.
- Hệ quả: job chạy ngoài tiến trình server nên **không phát socket** (`RealtimeService` bỏ qua khi không có server). Test phải
  reload hoặc chờ API sau khi chạy job. Job quét toàn bảng, nên đơn nhắm tới phải nằm ở làn dữ liệu riêng của spec.
- E2E chuẩn bị dữ liệu **qua API**. SQL trực tiếp chỉ được dùng qua `e2eTools.ts` cho việc dời thời gian.

---

## Các mục Q-xx đã triển khai theo mặc định (lưu vết tham chiếu)

Các mục dưới đây đã áp dụng phương án đề xuất mặc định trong code (và một số đã chốt thành R-11..R-14 ở trên); chỉ cần mở lại nếu chủ dự án muốn thay đổi kiến trúc ở giai đoạn sau:

### Q-01. Data access và múi giờ — *đã chốt thành R-11*
SDD ghi "Prisma / SQL thuần". Đã chốt dùng `mssql` + SQL tham số hóa + `core/time.ts` (`useUTC: true`), không dùng Prisma.

### Q-02. Lưu Idempotency-Key ở đâu — *đang áp dụng mặc định*
Đã triển khai migration `001_idempotency_keys.sql` (`IdempotencyKeys`, PK `(IdempotencyKey, UserId)`), khóa `IN_PROGRESS` (`StatusCode = 0`) chống race condition, hash gồm `Method + Path + Body`, và job `cleanupIdempotencyKeys` dọn bản ghi hết hạn hằng giờ.

### Q-03. Socket.IO khi chạy PM2 cluster — *đang áp dụng mặc định*
Chạy **1 instance** (`ecosystem.config.cjs`, PM2 fork mode). Job nền dùng `sp_getapplock` theo từng tài nguyên job (`@LockOwner = 'Transaction'`). Khi scale nhiều instance sẽ bổ sung `@socket.io/redis-adapter`.

### Q-04. Ô hiển thị trên lưới (2 giờ Pickleball, 90 phút bóng đá) — *đang áp dụng mặc định*
Đã thêm cột `Sports.DisplayBlockMinutes` qua migration `002_sports_display_block.sql` (Pickleball 120, Bóng đá 90, Cầu lông 60, Tennis 60, Bóng rổ 60); `BookingSlots` vẫn chia theo `GridBlockMinutes` (R-05).

### Q-05. Cảnh báo cho nhân viên (STAFF_ALERT) — *đang áp dụng mặc định*
Không lưu vào `Notifications`; phát socket `reconciliation.created` tới phòng `branch:{branchId}` và hiển thị badge số giao dịch `NEEDS_REVIEW` ở MH.14.

### Q-06. Gom nhóm ngày nghỉ "Toàn hệ thống" — *đang áp dụng mặc định*
Đã thêm cột `BranchHolidays.GroupKey` qua migration `003_branch_holidays_group_key.sql`.

### Q-07. Mã KM chỉ áp dụng tại quầy (`PROMO_WRONG_CHANNEL`) — *chưa kích hoạt*
Chưa thêm cột `Promotions.Channel`.

### Q-08. Kênh Email/SMS/Zalo — *đang áp dụng mặc định*
Chỉ in-app + socket; interface `OutboundNotifier` dùng `StubOutboundNotifier` ghi log.

### Q-09. MH.14 Đối soát & Hoàn tiền — *đang áp dụng mặc định*
Đã triển khai đầy đủ API 67–73 và màn hình `/owner/reconciliation`, `/staff/reconciliation`.

### Q-10. Hạng hội viên (`MemberTier`) — *đang áp dụng mặc định*
Chỉ lưu/hiển thị, chưa có logic tự xếp hạng hay ưu đãi theo hạng.

### Q-11. UC 025 và UC 024 — *đang áp dụng mặc định*
UC 025 xử lý trong pipeline xác thực + khớp webhook SePay (SDD 2.6b), không có màn hình riêng.

### Q-12. Thực hiện hoàn tiền — *đang áp dụng mặc định*
Hoàn ngoài hệ thống, hệ thống ghi nhận `Refunds` PENDING và OWNER đánh dấu `COMPLETED`/`FAILED` (API-72/73).

### Q-13. Lựa chọn công nghệ chưa ghi trong SDD — *đã chốt thành R-14*
Đã chốt NestJS 12, TypeScript, Zod, Vite 8, React Router 7, TanStack Query, Vitest, npm workspaces, Node.js LTS ≥ 22.

### Q-14. Kỳ tính tiền hoàn trong doanh thu — *đang áp dụng mặc định*
Tính trừ `Bookings.RefundAmount` theo `CanceledAt` trong kỳ (kể cả khi `Refunds` còn `PENDING`).

### Q-15. Nhận sân khi chưa tới giờ — *đã chốt thành R-12*
Đã chốt `CHECKIN_EARLY_MINUTES = 15` trong `SystemSettings` (migration `004_checkin_early_minutes.sql`).

---

## Rủi ro bảo mật đã chấp nhận theo đặc tả

- **Phản hồi `ACCOUNT_NOT_FOUND` vs `WRONG_PASSWORD` ở API-06 (L-5):** Giữ nguyên theo đặc tả SDD API-06 (`ACCOUNT_NOT_FOUND` khi không tìm thấy SĐT/email, `WRONG_PASSWORD` khi sai mật khẩu). Có `authRateLimitMiddleware` (`10 req/phút/IP`) và khóa tạm `R-07` (`5 lần sai / 5 phút`) giảm thiểu dò tài khoản.
