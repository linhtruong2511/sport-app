# Review repo SportHub — đối chiếu tài liệu và `report.md`

**Ngày review:** 25/11/2026 · **Nhánh:** `main` (commit `e8457fc`, working tree sạch lúc bắt đầu)
**Phạm vi:** toàn repo (`backend/`, `app/`, `packages/shared/`, `database/`, `deploy/`, `e2e/`, `docs/`) đối chiếu với `CLAUDE.md`, `docs/decisions.md`, `business-rules.md`, `architecture.md`, `api-conventions.md`, `database.md`, `roadmap.md` và `report.md`.

## 0. Phương pháp và giới hạn

| Đã làm | Không làm được |
| --- | --- |
| Chạy `npm run typecheck`, `lint`, `test`, `build` ở thư mục gốc | **Không chạy `npm run test:int`**: không có `backend/.env` và không có SQL Server trong môi trường review |
| Đọc code các phần chạm bất biến: idempotency, transaction, webhook, vòng đời đơn, jobs, auth, realtime, rate limit, POS (check-in/settle), báo cáo, deploy | Không chạy E2E Playwright, không chạy app thật, không thử webhook SePay thật |
| Đếm route, job, màn hình, số test | Không đọc từng dòng của 17.988 dòng service/repository; **ưu tiên các luồng tiền và trạng thái** |

Mọi phát hiện dưới đây đều có đường dẫn và dòng; điều nào là suy luận từ code (chưa tái hiện bằng test chạy thật) được ghi rõ là *suy luận*.

---

## 1. Kết luận

Báo cáo triển khai **đúng về mặt số lượng và build**, nhưng câu "rà soát 12 bất biến" và "100% hoàn tất" **chưa đúng hoàn toàn**:

- Con số kiểm chứng khớp: typecheck, lint, 51 unit test (9 file), build đều xanh; 73 API, 8 job, 12 màn hình, 85 `it(` ở 19 file integration đều đúng.
- Có **1 lỗ hổng phân quyền thực sự ở realtime** (bất biến 8), **2 rủi ro vận hành có thể gây mất dữ liệu hoặc mở cửa cho kẻ tấn công ở production**, và **một lỗ hổng độ bền ở webhook** (bất biến 9).
- Một số điểm lệch kiến trúc/tài liệu chưa được ghi vào `decisions.md`.
- Tài liệu hướng dẫn (`CLAUDE.md`, `docs/*`) còn mô tả trạng thái trước M0, dễ làm người/agent sau đi sai hướng.

**Khuyến nghị:** chưa nên coi là sẵn sàng Go-Live cho đến khi xử lý nhóm **Cao** (mục 2). Nhóm này không cần thiết kế lại, chủ yếu là sửa nhỏ và thêm test.

---

## 2. Phát hiện mức Cao

### C-1. Bất kỳ người dùng đăng nhập nào cũng nghe được sự kiện của mọi đơn (vi phạm bất biến 8)
- **Vị trí:** [backend/src/core/realtime/realtime.gateway.ts:115-122](backend/src/core/realtime/realtime.gateway.ts#L115-L122)
- **Hiện trạng:** `subscribe` kênh `booking` chỉ kiểm tra có token, rồi `client.join('booking:{code}')`. Comment trong code ghi *"Fine-grained booking ownership / branch check will be added in M3"* — M3 đã đánh dấu xong nhưng phần này **chưa làm**.
- **Tài liệu yêu cầu:** `architecture.md` §8 — "`booking:{code}` (server kiểm tra quyền xem đơn)"; bất biến 8 trong `CLAUDE.md`.
- **Hậu quả:** khách A đăng ký phòng `booking:BK2026112501` của khách B sẽ nhận `booking.paid` / `booking.updated` (trạng thái, số tiền đã trả, số tiền còn lại). Mã đơn có dạng `BK` + ngày + số thứ tự nên rất dễ đoán. STAFF cơ sở khác cũng nghe được.
- **Cách sửa:** trong `handleSubscribe`, tải đơn theo mã và gọi cùng hàm `assertBookingAccess` của `BookingStateService` (CUSTOMER → chủ đơn, STAFF → cùng `BranchId`); lỗi thì không `join`. Thêm integration test với socket client thứ hai.
- **Liên quan:** cùng file, `cors: { origin: true, credentials: true }` (dòng 27) phản chiếu mọi origin; nên dùng `env.corsOrigin` như REST. Tham số `date` của phòng `availability` không được kiểm định dạng (dòng 86-95), cho phép tạo phòng với chuỗi tùy ý.

### C-2. Mặc định bí mật ghi sẵn trong code, không chặn khi chạy production
- **Vị trí:** [backend/src/config/env.ts:22](backend/src/config/env.ts#L22), [:26](backend/src/config/env.ts#L26)
- **Hiện trạng:** `JWT_ACCESS_SECRET` mặc định `sporthub-dev-access-secret-change-in-prod`, `SEPAY_WEBHOOK_API_KEY` mặc định `sporthub-dev-sepay-key`. Hai giá trị này nằm trong repo công khai và trong `.env.example`. Không có kiểm tra "`NODE_ENV=production` mà biến chưa đặt thì dừng".
- **Hậu quả:** nếu vận hành quên một biến, ai đọc repo cũng có thể ký JWT OWNER hợp lệ (toàn quyền) hoặc gửi webhook giả "đã nhận tiền" (đơn bị xác nhận mà không có tiền thật — webhook khớp chính xác theo số tiền/mã đơn nên chỉ cần biết key và mã đơn). Runbook `deploy/README.md` có nhắc đặt biến nhưng không có chốt chặn kỹ thuật.
- **Cách sửa:** ở `env.ts`, nếu `nodeEnv === 'production'` mà thiếu `JWT_ACCESS_SECRET` / `SEPAY_WEBHOOK_API_KEY` / mật khẩu DB, hoặc giá trị bằng chuỗi mặc định, hoặc secret JWT < 32 ký tự → `throw` lúc khởi động. Bỏ giá trị mặc định chứa tên máy cá nhân `LINHTRUONG\SQLEXPRESS` ([env.ts:31](backend/src/config/env.ts#L31), [.env.example:19](backend/.env.example#L19)).

### C-3. `db:reset` và `sporthub_init.sql` xóa sạch dữ liệu mà không có chốt chặn môi trường
- **Vị trí:** [backend/src/scripts/dbReset.ts:23-75](backend/src/scripts/dbReset.ts#L23-L75), [database/sporthub_init.sql:66-](database/sporthub_init.sql#L66) (chuỗi `DROP TABLE IF EXISTS` toàn bộ 26 bảng)
- **Hiện trạng:** script dùng `env.db.database` làm đích, không kiểm tra `NODE_ENV`, tên DB hay cờ xác nhận. `deploy/README.md` §3 hướng dẫn chạy chính file init này cho lần cài đầu (trên DB production tên `SportHub`).
- **Hậu quả:** chạy nhầm `npm run db:reset` (hoặc chạy lại file init) trên máy production → mất toàn bộ đơn, tiền, người dùng. Quy tắc `.claude/settings.json` chỉ chặn ở phía agent, không chặn con người.
- **Cách sửa:** từ chối khi `NODE_ENV=production` hoặc tên DB không khớp whitelist (`SportHub_Test`, `SportApp`…) trừ khi có `--force-i-know`; đưa cảnh báo "file init xóa dữ liệu" vào đầu `deploy/README.md` §3. Nên bọc phần DROP trong `IF` kiểm tra bảng `Users` đã có dữ liệu.

### C-4. Webhook SePay có thể làm mất giao dịch thay vì chuyển `NEEDS_REVIEW` (bất biến 9)
- **Vị trí:** [backend/src/payments/payments.service.ts:332-343](backend/src/payments/payments.service.ts#L332-L343), [webhooks.controller.ts:21-27](backend/src/payments/webhooks.controller.ts#L21-L27), [main.ts:22-28](backend/src/main.ts#L22-L28)
- **Hiện trạng (3 điểm liên quan):**
  1. `INSERT BankTransactions` và toàn bộ bước khớp đơn nằm **trong cùng một transaction**. Nếu bước khớp ném lỗi (ví dụ vi phạm CHECK trong `applyPaymentInTx`, lỗi sinh mã `PT…`), cả transaction rollback, bản ghi giao dịch biến mất, trả 5xx. Lỗi mang tính xác định sẽ làm SePay gửi lại mãi mà vẫn không bao giờ có dòng nào để đối soát tay.
  2. `business-rules.md` §7 bước 2 yêu cầu `RawPayload` **nguyên văn**. Vì `bodyParser: false` rồi dùng `express.json()` không có `verify`, `req.rawBody` luôn `undefined`, code rơi vào `JSON.stringify(req.body)` — là bản tuần tự hóa lại, không phải nguyên văn.
  3. `ZodValidationPipe` chạy trước khi xác thực API key và trước khi lưu: payload lệch schema (ví dụ `transferAmount` có phần thập phân, thiếu `transactionDate`) bị trả 400 và **không được ghi lại**.
- **Hậu quả:** khách đã chuyển tiền thật nhưng hệ thống không có dấu vết nào để chủ sân đối soát.
- **Cách sửa:** (a) lưu `BankTransactions` trong transaction riêng, commit trước; khớp đơn ở transaction thứ hai, và nếu lỗi thì cập nhật `NEEDS_REVIEW` (issue `UNKNOWN_CONTENT`) thay vì để lỗi lan ra; (b) dùng `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })`; (c) kiểm API key bằng guard trước pipe, và nới schema (chỉ bắt buộc `id`, `accountNumber`, `transferAmount`, `transferType`), phần còn lại lưu vào `RawPayload`.

---

## 3. Phát hiện mức Trung bình

### M-1. Idempotency-Key không có khóa "đang xử lý" — race giữa hai request trùng key
- [backend/src/core/idempotency/idempotency.interceptor.ts:93-145](backend/src/core/idempotency/idempotency.interceptor.ts#L93-L145)
- Bản ghi chỉ được ghi **sau khi** handler đã commit. Hai request cùng key đến gần nhau đều thấy "chưa có bản ghi" và cùng chạy nghiệp vụ. Với API-13 request thứ hai thường nhận `409 SLOT_TAKEN` thay vì kết quả đã lưu (khác với tài liệu "cùng key → cùng kết quả"); với API-16/29/33 hiệu ứng phụ thứ hai bị chặn bởi trạng thái đơn, nhưng response vẫn khác.
- Nếu tiến trình chết giữa lúc commit nghiệp vụ và lúc ghi bản ghi idempotency, retry sẽ chạy lại nghiệp vụ.
- Hash chỉ gồm body ([dòng 85-88](backend/src/core/idempotency/idempotency.interceptor.ts#L85-L88)), không gồm method/path: cùng key dùng cho hai endpoint khác nhau với body giống nhau (ví dụ `{}`) sẽ trả nhầm response.
- *Cách sửa:* chèn bản ghi `IN_PROGRESS` ở đầu (unique key), request thứ hai chờ hoặc trả `409`; thêm `Method + Path` vào hash. Ca kiểm thử "cùng key gửi 2 lần" (`business-rules.md` §14) mới chỉ kiểm tra tuần tự — cần thêm ca song song.

### M-2. `expireHolds` không có try/catch từng đơn — một đơn lỗi chặn cả lô
- [backend/src/bookings/bookings.service.ts:770-849](backend/src/bookings/bookings.service.ts#L770-L849)
- `architecture.md` §7: "mỗi đơn một transaction riêng **để một đơn lỗi không chặn cả lô**". Các job trong `lifecycle-jobs.service.ts` làm đúng (có `try/catch`), riêng `expireHolds` — job quan trọng nhất, chạy mỗi 30 giây — thì không. Một đơn gây lỗi xác định (ví dụ dữ liệu `PromotionCode` mồ côi) sẽ ném ra khỏi vòng lặp; lượt sau lại gặp đúng đơn đó ở đầu hàng đợi → các đơn hết hạn phía sau **không bao giờ được giải phóng ô**.
- `PaymentsService.expirePendingQrRequests` (job `expireQr`) chưa đọc kỹ; nên kiểm tra tương tự.

### M-3. Chuyển trạng thái đơn bị phân tán, lớp service chứa SQL (vi phạm quy ước 4 lớp và `backend/CLAUDE.md`)
- `backend/CLAUDE.md`: "Đổi trạng thái đơn **chỉ qua `BookingStateService`**". Thực tế `BookingStateService` chỉ giữ `applyPaymentInTx`. Câu `UPDATE dbo.Bookings` nằm ở 5 file: `bookings.repository.ts` (3 chỗ), `pos.repository.ts` (2), `affected-bookings.repository.ts` (1), và **`jobs/lifecycle-jobs.service.ts` (3 chỗ, SQL viết thẳng trong service)** — [dòng 69-108, 197-207, 301-323](backend/src/jobs/lifecycle-jobs.service.ts#L69).
- Cũng trong `lifecycle-jobs.service.ts` và `jobs.service.ts`: service import trực tiếp `sql` và gọi `.request()` (6 + 1 chỗ), tức service chạm CSDL không qua repository.
- Việc cắt ô theo `GridBlockMinutes` được viết lặp ở [bookings.service.ts:292-299](backend/src/bookings/bookings.service.ts#L292-L299), [pos.service.ts:815](backend/src/pos/pos.service.ts#L815), [affected-bookings.service.ts:472](backend/src/affected-bookings/affected-bookings.service.ts#L472). R-05 là chốt chặn chống trùng lịch; ba bản sao dễ lệch nhau.
- [`pos.service.ts`](backend/src/pos/pos.service.ts) dài 1.739 dòng (11 API), `pos.repository.ts` 994 dòng.
- *Rủi ro:* sửa quy tắc trạng thái phải nhớ đủ 5 nơi; dễ sót `BookingStatusHistory` hoặc `UsedCount`. *Cách sửa:* gom `cancelBooking/expire/complete/noShow` vào `BookingStateService` (hoặc repository của `bookings`), job và POS chỉ gọi; tách `pos.service.ts` theo nhóm API.

### M-4. Số 15 phút nhận sân sớm bị hard-code, trái bất biến 12 và Q-15
- [backend/src/pos/pos.service.ts:1361](backend/src/pos/pos.service.ts#L1361), [:1552](backend/src/pos/pos.service.ts#L1552) — `addMinutes(startAt, -15)`.
- Bất biến 12: tham số nghiệp vụ đọc từ `SystemSettings`. Q-15 còn mở ("cần xác nhận con số 15 phút") nhưng code đã chốt cứng và lặp 2 lần. Mã `CHECK_IN_TOO_EARLY` có trong SDD (4 lần nhắc), nên không phải mã bịa.
- *Cách sửa:* thêm key `CHECKIN_EARLY_MINUTES` vào `SystemSettings` (migration), đọc qua `SettingsService`.

### M-5. Rate limit tin `X-Forwarded-For` do client gửi; không đặt `trust proxy`
- [backend/src/core/http/rate-limit.middleware.ts:20-32](backend/src/core/http/rate-limit.middleware.ts#L20-L32), [main.ts](backend/src/main.ts)
- Lấy phần tử **đầu** của `X-Forwarded-For`. Nginx cấu hình `$proxy_add_x_forwarded_for` (nối thêm vào header client gửi), nên phần tử đầu là giá trị do kẻ tấn công tự đặt → đổi header mỗi request là qua mặt bộ giới hạn ở tầng ứng dụng. Ngược lại, nếu bỏ header thì `req.ip` là `127.0.0.1` (do không `app.set('trust proxy', …)`) và mọi người dùng chung một thùng đếm.
- Nginx (`limit_req` theo `$binary_remote_addr`) vẫn chặn được ở production nên mức trung bình, nhưng lớp thứ hai trong app đang cho cảm giác an toàn giả. `AuditLogs`/`RefreshTokens.IpAddress` cũng ghi `req.ip` sai ở production.
- *Cách sửa:* `expressApp.set('trust proxy', 1)` rồi dùng `req.ip`; bỏ đọc `X-Forwarded-For` thủ công.

### M-6. Cấu hình múi giờ driver lệch tài liệu, hai driver có thể hành xử khác nhau
- [backend/src/config/database.ts:50](backend/src/config/database.ts#L50) đặt `useUTC: true`; `docs/database.md` §3 và Q-01 yêu cầu `useUTC = false`. Code có thể vẫn đúng vì `core/time.ts` tự dịch `+7h` (`toSqlDateTime`/`fromSqlDateTime`), nhưng đó là một **quyết định khác tài liệu và chưa ghi vào `decisions.md`**.
- Mặc định là driver `msnodesqlv8` (Windows Auth, [database.ts:9-10](backend/src/config/database.ts#L9-L10)) — nhánh này không đi qua đoạn `options.useUTC`, và cách ODBC trả `DATETIME2` phụ thuộc `TZ` của tiến trình. *Suy luận:* hai đường kết nối (windows/sql) có thể cho kết quả lệch 7 giờ nếu `TZ` không phải `Asia/Ho_Chi_Minh`. Test tích hợp chạy ở máy nào cũng cần `TZ` giống production.
- *Cách sửa:* ghi R-xx mới ("lưu wall-clock VN, đọc `useUTC: true`, mọi chuyển đổi qua `core/time.ts`"); thêm test round-trip `DATETIME2` cho cả hai driver; thêm kiểm tra `process.env.TZ` lúc khởi động.

### M-7. Bộ máy triển khai không nhất quán giữa Linux và Windows
- `deploy/nginx.conf` dùng đường dẫn Linux (`/etc/letsencrypt`, `/var/www`); `deploy/README.md` §5 dùng `sudo systemctl`; nhưng backup/restore là PowerShell + Windows Task Scheduler, tên backup `C:\Backups`, và backend mặc định `DB_AUTH_TYPE=windows` với `msnodesqlv8` (chỉ chạy trên Windows, cần ODBC Driver 17).
- `msnodesqlv8` là dependency bắt buộc ([backend/package.json:29](backend/package.json#L29)): `npm ci` trên Linux có thể lỗi build native.
- Tên DB: runbook ghi `SportHub`, mặc định trong code và `.env.example` là `SportApp`, init script tạo `SportHub`. Dễ nhầm DB đích (kết hợp C-3).
- Webhook SePay đang `allow 127.0.0.1; deny all;` — nếu quên thay thì **không nhận được webhook nào** (an toàn nhưng gây mất tiền chưa ghi nhận). Cần mục kiểm tra Go-Live rõ ràng.
- *Cách sửa:* chọn **một** nền tảng triển khai và ghi vào `decisions.md`; nếu Linux thì chuyển `msnodesqlv8` sang `optionalDependencies`, đổi script backup sang `sqlcmd`/bash.

### M-8. Mật khẩu/phiên: hai điểm nhỏ nhưng nằm trong luồng bảo mật
- Hủy cache `TokenVersion` **trước khi commit** ([auth.service.ts:314-316](backend/src/auth/auth.service.ts#L314-L316)): một request đến đúng lúc đó đọc DB (chưa commit, còn `tv` cũ) rồi nạp lại cache, token cũ vẫn hợp lệ tới 10 giây ([token-version-cache.service.ts:16](backend/src/auth/token-version-cache.service.ts#L16)). Nên xóa cache **sau commit** (qua `tx.events` hoặc hook sau commit).
- Refresh token xoay vòng nhưng không phát hiện tái sử dụng token đã thu hồi (không thu hồi cả họ token). Spec không bắt buộc, nên chỉ là khuyến nghị.
- `bcrypt.compare` chạy bên trong transaction giữ kết nối DB ([auth.service.ts:154-175](backend/src/auth/auth.service.ts#L154-L175)); khi bị tấn công đăng nhập, pool 20 kết nối cạn nhanh. Nên bcrypt ngoài transaction, chỉ mở transaction để ghi bộ đếm.

### M-9. Độ phủ kiểm thử mỏng so với Definition of Done
- DoD chung (`roadmap.md`): "mọi mã lỗi trong đặc tả SDD của các API thuộc giai đoạn có test". Thực tế 85 ca integration cho 73 API + webhook: POS 4 ca / 11 API, dashboard 2 / 2, affected-bookings 3 / 4, admin/courts 7 / 12 endpoint, reports 4 / 1. Rất khó phủ hết mã lỗi như vậy.
- Các hộp kiểm trong `business-rules.md` §14 vẫn để trống (`[ ]`) nên không thể đối chiếu từng ca. Không có test nào cho gateway Socket.IO (đúng chỗ C-1 nằm) và không có test cho `rate-limit` phía tích hợp.
- *Cách sửa:* lập bảng "ca §14 → tên test" và tick; ưu tiên thêm: subscribe phòng đơn người khác, ca idempotency song song, webhook lỗi giữa chừng, `expireHolds` với một đơn lỗi.

---

## 4. Phát hiện mức Thấp / ghi nhận

| # | Nội dung | Vị trí |
| --- | --- | --- |
| L-1 | `applyPaymentInTx` chỉ kiểm tra `amount > 0` và `Paid ≤ Total`; việc "đúng `AmountDueNow`/`RemainingAmount`, không nhận một phần" (bất biến 6) hoàn toàn do nơi gọi bảo đảm. Nên thêm kiểm tra tập trung ở hàm duy nhất ghi tiền. | [booking-state.service.ts:98](backend/src/bookings/booking-state.service.ts#L98) |
| L-2 | Dòng thừa `nextStatus === 'CONFIRMED' ? null : null` (luôn `null`). | [booking-state.service.ts:107](backend/src/bookings/booking-state.service.ts#L107) |
| L-3 | Sự kiện socket của đơn bị hủy/hết hạn phát `remainingAmount: 0` trong khi cột DB vẫn giữ `Total − Paid` (CHECK `CK_Bookings_Remaining`). Dữ liệu realtime và REST không đồng nhất. | [lifecycle-jobs.service.ts:353](backend/src/jobs/lifecycle-jobs.service.ts#L353), [bookings.service.ts:837](backend/src/bookings/bookings.service.ts#L837) |
| L-4 | Khóa job dùng `sp_getapplock` kiểu `Transaction` với tài nguyên riêng theo job, khác `architecture.md` §7 (`Session`, một tài nguyên `sporthub-jobs`). Cách làm thực tế tốt hơn (job không chặn nhau) nhưng nên cập nhật tài liệu. Mỗi job đang chạy giữ thêm 1 kết nối trong pool 20. | [job-lock.service.ts](backend/src/jobs/job-lock.service.ts) |
| L-5 | Đăng nhập trả `ACCOUNT_NOT_FOUND` khác `WRONG_PASSWORD` (cho phép dò tài khoản). Đây là yêu cầu của SDD API-06, ghi nhận như một rủi ro đã chấp nhận. | [auth.service.ts:158-160](backend/src/auth/auth.service.ts#L158-L160) |
| L-6 | Webhook: body không hợp lệ + thiếu key trả 400 thay vì 401 (thứ tự pipe/guard). | [webhooks.controller.ts:21-23](backend/src/payments/webhooks.controller.ts#L21-L23) |
| L-7 | `BranchScopeGuard` chỉ gắn ở 3 controller (POS, affected, reconciliation); dashboard tự kiểm trong service (`resolveBranchScope`) — đúng chức năng nhưng khác `architecture.md` §3-4 ("gắn cho mọi route"). | `dashboard.service.ts:109-116` |
| L-8 | Frontend tự tính tỷ lệ chuyển khoản/tổng thu (`(bankTransfer / grossCollected) * 100`) và cộng `courtCount`, `amount` — thuộc dạng hiển thị nhẹ nhưng chạm nguyên tắc "FE không tính KPI". | [OwnerReports.tsx:466](app/src/pages/OwnerReports.tsx#L466), [Home.tsx:65](app/src/pages/Home.tsx#L65), [Reconciliation.tsx:279](app/src/pages/Reconciliation.tsx#L279) |
| L-9 | Chunk JS 709 kB (gzip 192 kB) — đúng như báo cáo; chưa code-splitting. | build `app/` |
| L-10 | `docs/sporthub_init.sql` là bản sao y hệt `database/sporthub_init.sql`: hai nguồn sự thật có thể lệch. | `docs/sporthub_init.sql` |

---

## 5. Đối chiếu `report.md`

| Khẳng định trong báo cáo | Kết quả đối chiếu |
| --- | --- |
| `npm run build` Pass | **Xác nhận** (chạy lại: thành công, chunk 709,16 kB / gzip 192,19 kB) |
| `npm run lint` 0 lỗi 0 cảnh báo | **Xác nhận** (eslint + oxlint không in lỗi) |
| `npm run typecheck` Pass | **Xác nhận** |
| `npm test` 51/51 (9 file) | **Xác nhận** (8 + 43 = 51; 1 + 8 file) |
| `npm run test:int` 85/85 (19 file) | **Chưa tái kiểm** (cần SQL Server). Đếm tĩnh: 85 `it(` ở 19 file → số lượng khớp |
| 73 API + Webhook | **Xác nhận bằng đếm route**: 79 decorator − 2 health − 1 webhook = 76 route; 3 API ghép đôi (45 lock/unlock, 63 pause/resume, 73 complete/fail) → 73 |
| 8 job nền | **Xác nhận**: 8 `cron.schedule` trong `jobs.service.ts` |
| 12 màn hình nối API thật, gỡ dữ liệu giả | **Đúng một phần**: 12 file page tồn tại, không còn `localStorage`/nút demo trong `app/src`. Nhưng thư mục **`app/mocks/` (khoảng 27 file MSW + seed + README hướng dẫn cài `msw`) vẫn nằm trong git**, không được `tsconfig` biên dịch (`include: ["src"]`) và không có `msw` trong `package.json` — mã chết gây nhiễu |
| Rate limit 10 req/phút/IP | **Đúng về mặt số**, nhưng xem M-5 |
| "Rà soát 12 bất biến" (M9) | **Không đúng hoàn toàn**: bất biến 8 (C-1), 9 (C-4), 12 (M-4) và quy ước 4 lớp (M-3) có sai lệch |
| "Cứng hóa & Vận hành (M9)" | Có cấu hình, nhưng C-2, C-3, M-5, M-7 cho thấy chưa đủ "cứng" |
| Bảng "chưa làm" — E2E | **Trung thực**: `e2e/playwright.config.ts` chỉ khởi động Vite dev server, không khởi động backend/DB; `e2e/package.json` vẫn mô tả "SportHub Prototype". `tests/05-srs-ui-compliance-gaps.spec.ts` còn nhắc dữ liệu prototype |
| Bảng "chưa làm" — Q-01..Q-15 | **Thiếu**: các điểm code đã quyết khác tài liệu (`useUTC: true`, applock theo từng job, 15 phút nhận sân hard-code) chưa được ghi thành R-xx/Q-xx mới như `CLAUDE.md` yêu cầu |
| Bảng "chưa làm" — production | Chưa nêu: C-2 (bí mật mặc định), C-3 (db:reset), M-7 (nền tảng triển khai) |

**Hạng mục nên bổ sung vào mục 2 của `report.md`:** sửa phân quyền phòng `booking:*`, độ bền webhook, chốt chặn production (`env`, `db:reset`), thống nhất nền tảng triển khai, dọn `app/mocks/`, cập nhật tài liệu.

---

## 6. Tài liệu lỗi thời / mâu thuẫn với trạng thái repo

Các mô tả "dự kiến ở M0" nay đã sai vì M0 xong. Đáng lo nhất vì `CLAUDE.md` được nạp tự động cho mọi phiên làm việc:

| Tệp | Dòng | Nội dung cần sửa |
| --- | --- | --- |
| `CLAUDE.md` | 15, 37, 42, 47-48 | "`sporthub_init.sql` dự kiến… hiện chưa có", "app đang chạy prototype", `packages/shared`/`database` "dự kiến" |
| `CLAUDE.md` | 56-65, 78 | Lệnh "prototype", tài khoản seed trỏ tới `app/src/data.ts` (**tệp này đã bị xóa**); mật khẩu seed thật trong SQL có thể khác |
| `CLAUDE.md` | mục Lệnh | Nói "chưa có npm workspaces" trong khi root `package.json` đã khai báo 4 workspace |
| `backend/CLAUDE.md` | mục Cấu trúc, Lệnh | Còn liệt kê `common/all-exceptions.filter.ts`, "script `npm test` sẽ bổ sung ở M0" (đã có) |
| `app/CLAUDE.md` | mục Nguyên tắc số 1, Route | Nói về `app/src/domain/*` (đã xóa) và `/payment/:id` |
| `docs/architecture.md` | 34 | "core dự kiến; hiện backend có `common/`…" |
| `docs/database.md` | 5, 40 | "database/sporthub_init.sql dự kiến", "`core/time.ts` dự kiến"; `useUTC=false` mâu thuẫn code (M-6) |
| `docs/api-conventions.md` | 10, 57 | "prefix `/api`" (code đã là `/api/v1`), `errors.ts` "dự kiến" |
| `docs/business-rules.md` | §14 | Chưa tick ca nào |
| `docs/decisions.md` | — | Q-01 (Prisma/mssql), Q-13 (Express — thực tế NestJS), Q-15 vẫn "đề xuất"; cần đổi thành R-xx hoặc ghi rõ đang áp mặc định |
| `app/mocks/README.md` | toàn bộ | Mô tả bộ mock như đang dùng; mâu thuẫn với việc đã nối backend thật |

*Ghi chú:* theo `CLAUDE.md`, tài liệu có thứ tự ưu tiên; nếu `CLAUDE.md` nói "chưa có" mà repo đã có, agent/người mới sẽ có xu hướng tạo lại tệp đã tồn tại.

---

## 7. Điểm làm tốt (đã kiểm tra)

- **Chống trùng lịch:** tạo đơn đi đúng thứ tự `business-rules.md` §3.1, `INSERT BookingSlots` là chốt chặn, không có "SELECT rồi INSERT" ([bookings.service.ts:116-301](backend/src/bookings/bookings.service.ts#L116-L301)).
- **Nguyên tử `UsedCount`:** UPDATE có điều kiện, rollback cả đơn khi hết lượt; hoàn lượt đúng khi `PENDING_PAYMENT` hủy/hết hạn.
- **Hủy đơn:** kiểm `RowVer` bằng so sánh buffer sau `UPDLOCK`, ghi `BookingStatusHistory`, `Refunds`, thông báo, socket **sau commit** (`DbTransactionService` chỉ `flush` sau `commit`).
- **R-04 no-show hai nhánh** đúng: `cancelNoShows` (DEPOSITED, `StartAt + grace`) và `closePaidNoShows` (PAID, `EndAt`); `cancel-preview` và `cancel` dùng chung `calculateRefund`.
- **Webhook:** so sánh API key bằng `timingSafeEqual`; khớp tự động chỉ khi đúng mã + số tiền + tài khoản + còn hạn; `LATE_PAYMENT` xử lý đúng (`now > HoldExpireAt`) kể cả khi job chưa chạy.
- **Doanh thu:** truy vấn loại `BY_FACILITY` ở cả phiếu thu lẫn hoàn tiền, tính hoàn theo `CanceledAt` (Q-14) — [reports.repository.ts:333-410](backend/src/reports/reports.repository.ts#L333-L410).
- **Đăng nhập:** khóa tạm theo R-07 (đặt lại bộ đếm), tham số đọc từ `SystemSettings`; cookie `sh_rt` HttpOnly/SameSite=Strict/Path đúng; bcrypt cost 10; thu hồi phiên khi khóa/đổi cơ sở/đổi mật khẩu có `auth.revoked`.
- **Không dùng `new Date()`/`Date.now()` cho "bây giờ"** trong nghiệp vụ (chỉ `Clock` và helper thời gian); không còn `TODO/FIXME` trong mã.
- **Frontend:** không còn `localStorage`/`sessionStorage`; không có công cụ demo; 12 trang đều dùng lớp API.

---

## 8. Thứ tự xử lý đề xuất

1. **C-1** (realtime phòng đơn) + test — sửa nhỏ, rủi ro rò rỉ dữ liệu.
2. **C-2** và **C-3** (chốt chặn production) — vài dòng mỗi cái, ngăn sự cố nặng.
3. **C-4** (độ bền webhook) + test lỗi giữa chừng + `RawPayload` nguyên văn.
4. **M-2**, **M-1** (độ bền job và idempotency).
5. **M-7**, **M-5**, **M-6**: chốt nền tảng triển khai, `trust proxy`, ghi R-xx cho `useUTC`.
6. **M-3**, **M-4**: gom chuyển trạng thái, đưa 15 phút vào `SystemSettings`.
7. **M-9**: bổ sung test theo bảng §14; chạy lại `test:int` trên SQL Server thật và dán kết quả vào `report.md`.
8. Cập nhật tài liệu (mục 6), xóa `app/mocks/` và `docs/sporthub_init.sql` trùng, viết lại fixture E2E.
