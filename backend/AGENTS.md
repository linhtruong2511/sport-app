# backend — Backend Thể thao 88 (NestJS 12 + TypeScript + SQL Server)

Kế thừa quy tắc từ `AGENTS.md` ở thư mục gốc. Đọc kèm: `backend/README.md`, `docs/architecture.md`, `docs/business-rules.md`, `docs/api-conventions.md`, `docs/database.md`.

## Cấu trúc

```
src/
  config/          env.ts (validate production secrets), database.ts (mssql + optional msnodesqlv8)
  core/            db, transaction (afterCommit + socket flush), errors, http (envelope, rate-limit, security-headers, traceId),
                   auth (guards, branchScope), idempotency (IN_PROGRESS lock), settings, clock, time, money, codes, realtime, logger
  database/        database.module.ts, database.service.ts
  health/          health.controller.ts, health.module.ts
  scripts/         testDb.ts, dbReset.ts, dbMigrate.ts
  <module>/        auth, catalog, availability, pricing, bookings, payments, pos, promotions,
                   notifications, dashboard, reports, admin/*, affected-bookings, reconciliation
    <module>.module.ts       module NestJS
    <module>.controller.ts   route + guard + pipe zod → service → envelope
    <module>.service.ts      nghiệp vụ, transaction, sự kiện (không viết SQL trực tiếp)
    <module>.repository.ts   SQL tham số hóa
    <module>.mapper.ts       hàng CSDL → DTO (camelCase, ISO +07:00)
    <module>.schemas.ts      zod (import validator chung từ @sporthub/shared)
    __tests__/               unit (*.test.ts) & integration (*.int.test.ts)
  jobs/            đăng ký cron (node-cron + JobLockService sp_getapplock), gọi service
  integrations/    sepay (BankGateway), notifier (OutboundNotifier stub)
```

Khi tạo module mới, làm theo checklist trong `.claude/commands/new-module.md`.

## Luật bắt buộc

**Transaction và sự kiện**
- Mọi thao tác ghi nhiều bảng dùng `withTransaction(async (tx) => …)`; repository nhận `tx` làm tham số đầu.
- Sự kiện socket/thông báo: gọi `tx.events.push(...)` trong transaction; `withTransaction` tự `flush()` sau commit.
  Không `io.emit` trực tiếp trong service.
- Đổi trạng thái đơn chỉ qua `BookingStateService` (module `bookings`): kiểm tra chuyển hợp lệ theo bảng vòng đời,
  `version`, ghi `BookingStatusHistory`, cập nhật slots. Module khác (pos, payments, jobs, admin) gọi service này.
- Cập nhật tiền của đơn chỉ qua một hàm `applyPayment(tx, booking, payment)` để `PaidAmount/RemainingAmount/PaymentStatus`
  luôn khớp CHECK.

**Thời gian và tiền**
- Không gọi `new Date()` / `Date.now()` trong service, repository, job — dùng `clock.now()` được inject (test dùng `FakeClock`).
- Mọi mốc so sánh trong SQL truyền `@now` từ app.
- Tiền là `number` nguyên. Phép nhân phần trăm dùng `money.percentOf(amount, rate)` (làm tròn `ROUND(x, 0)` một lần,
  chịu được rate lẻ như 50.5). Không cộng trừ tiền bằng chuỗi hay số thực tự do.
- Ghép ngày + giờ, tách giờ, thứ trong tuần (1 = Thứ 2 … 7 = CN): chỉ dùng `core/time.ts`.

**Lỗi**
- Ném `new AppError('SLOT_TAKEN', { details })`; HTTP status và câu mặc định lấy từ `@sporthub/shared/errors`.
- Bắt lỗi SQL ở repository: 2601/2627 trên `UX_BookingSlots_Court_Slot` → `SLOT_TAKEN`; trên `UQ_Users_Phone` →
  `PHONE_TAKEN`; `UX_Users_Email` → `EMAIL_TAKEN`; `UQ_Courts_Branch_Name` → `COURT_NAME_DUPLICATE`;
  `UQ_Promotions_Code` → `PROMO_CODE_DUPLICATE`; 1205 (deadlock) → thử lại tối đa 2 lần rồi mới `INTERNAL_ERROR`.
- Lỗi 500 không lộ stack/SQL ra client; log kèm `traceId`.

**Bảo mật**
- Không tin `branchId`, `customerUserId`, `amount`, `price` từ client: STAFF bị ép branch; số tiền thu so với số tính lại
  phía server (`422 AMOUNT_MISMATCH`).
- Mật khẩu bcrypt (cost ≥ 10). Refresh token: chỉ lưu SHA-256. Cookie `sh_rt` HttpOnly; Secure; SameSite=Strict.
- Webhook: xác thực API key/HMAC bằng so sánh thời gian hằng (`timingSafeEqual`).
- Không log: mật khẩu, token, header Authorization, API key SePay.

**SQL**
- Luôn tham số hóa. Không nối chuỗi giá trị người dùng vào câu SQL.
- Câu đồng thời viết tường minh: `WITH (UPDLOCK, ROWLOCK)`, `UPDATE … WHERE RowVer = @ver`,
  `UPDATE Promotions SET UsedCount = UsedCount + 1 WHERE … AND UsedCount < MaxUses`.
- Sinh mã: `EXEC dbo.usp_NextCode @Prefix, @DateKey, @Code OUTPUT` trong cùng transaction.

## Test

- Unit (`*.test.ts`): hàm thuần trong `pricing`, `money`, `time`, máy trạng thái, mapper. Không chạm DB.
- Integration (`*.int.test.ts`): chạy trên SQL Server Docker, mỗi test trong transaction rollback hoặc DB tạo mới từ
  `sporthub_init.sql` với `@SeedSample = 0` + fixture riêng. Có test song song cho `SLOT_TAKEN`, `PROMO_EXHAUSTED`.
- Test HTTP dùng supertest qua Nest `INestApplication` (không mở cổng thật). Mock SePay bằng `FakeBankGateway`.
- Đặt tên test theo quy tắc: `it('hủy trước đúng 5 ngày → hoàn 100% (FR 12)')`.

## Lệnh

```bash
npm run db:test      # kiểm tra kết nối SQL Server theo backend/.env
npm run db:reset     # reset DB test/dev (từ chối production / DB ngoài whitelist nếu thiếu --force-i-know)
npm run db:migrate   # chạy các migration chưa áp dụng
npm run dev          # nest start --watch (cổng mặc định 3000)
npm run build        # nest build
npm start            # node dist/main.js
npm test             # unit test (Vitest)
npm run test:int     # integration test trên SQL Server SportHub_Test
```
