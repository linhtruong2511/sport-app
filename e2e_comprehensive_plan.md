# SportHub — Báo cáo chạy E2E & Kế hoạch kiểm thử E2E toàn diện

- **Ngày lập:** 25/11/2026
- **Commit kiểm thử:** `bc79018` (nhánh `main`, cây làm việc sạch)
- **Phạm vi:** Playwright E2E full-stack (`app/` React SPA + `backend/` NestJS + SQL Server `SportHub_Test`)
- **Tài liệu liên quan:** `e2e/README.md`, `docs/business-rules.md` §14, `docs/roadmap.md`, `docs/decisions.md`

---

## Phần A — Báo cáo lần chạy

### A.1. Môi trường

| Hạng mục | Giá trị |
| --- | --- |
| Máy | Windows 11, SQL Server Express `SQLEXPRESS` (Windows auth) |
| CSDL | `SportHub_Test`, reset + migrate + seed mẫu bởi `fixtures/global-setup.ts` (`dbReset.ts --db=SportHub_Test`) |
| Backend | `npm run build && npm run start`, `NODE_ENV=test`, cổng 3000 (Playwright tự khởi động) |
| Frontend | Vite dev server cổng 5173 |
| Trình duyệt | Chromium (Desktop Chrome, 1440×900, `vi-VN`, `Asia/Ho_Chi_Minh`), 1 worker, retries = 0 |
| Lệnh | `cd e2e && npx playwright test` |

> Trước khi chạy phải dừng backend dev đang chiếm cổng 3000 (nối DB `SportHub`). Xem phát hiện **F-03**.

### A.2. Kết quả

**4/4 PASS — tổng 37,7 giây** (gồm reset DB, build backend, khởi động 2 server).

| ID | Spec | Kịch bản | Kết quả | Thời gian |
| --- | --- | --- | --- | --- |
| E2E-01 `@smoke` | `01-auth-rbac-ui` | Validate form login, đăng nhập 3 vai trò, chặn route theo vai trò, kế thừa giao diện | ✅ PASS | 5,2 s |
| E2E-02 | `01-auth-rbac-ui` | Đăng ký hội viên mới (SĐT sai → lỗi; hợp lệ → vào giao diện khách) | ✅ PASS | 2,0 s |
| E2E-03 `@smoke` | `02-customer-booking-ui` | Khách chọn ô trống D+3 → báo giá → tạo đơn → màn QR `THANHTOAN BK…` | ✅ PASS | 3,3 s |
| E2E-04 `@smoke` | `03-staff-owner-ui` | NV và Chủ sân đi qua các màn hình vận hành với dữ liệu thật | ✅ PASS | 3,4 s |

Kết quả lưu ở `e2e/playwright-report/index.html` và `e2e/test-results/junit.xml`.

### A.3. Phát hiện

| # | Mức | Phát hiện | Bằng chứng / vị trí | Đề xuất |
| --- | --- | --- | --- | --- |
| F-01 | Lỗi UI (nhẹ) | React cảnh báo **key trùng `Hoàn thành`** ×4 khi mở `/owner/reports` | `app/src/pages/OwnerReports.tsx:451-462`: `reportCols` có hai phần tử `'Hoàn thành'` (cột số đơn và cột tiền), dùng làm `key={h}` ở dòng 659 và 700 | Đổi `key` sang chỉ số hoặc đặt tên cột tiền khác (vd. "Từ đơn hoàn thành"). Thêm cơ chế chặn console error (I-06) để phát hiện tự động |
| F-02 | Thiếu khả năng kiểm thử | Backend E2E chạy với `NODE_ENV=test` nên **toàn bộ cron job bị tắt** (`jobs.service.ts:26`): `expireHolds`, `cancelNoShows`, `closePaidNoShows`, `autoComplete`, `sendReminders`… | `backend/src/jobs/jobs.service.ts:25-29` | Không thể E2E các luồng hết hạn giữ chỗ, no-show, tự hoàn thành, nhắc lịch. Đã xử lý bằng **R-15** / I-08 (mục B.7) |
| F-03 | Hạ tầng | Backend webServer dùng `reuseExistingServer: false`, Vite proxy cố định `localhost:3000` → **suite fail ngay** nếu dev backend đang chạy | `e2e/playwright.config.ts:83`, `app/vite.config.ts` | Thêm kiểm tra cổng trong `global-setup` với thông báo rõ ràng; ghi vào README |
| F-04 | Test không ổn định theo lịch | E2E-03 đặt ngày `D+3` cố định. Nếu chạy vào **29/12/2026** hoặc **02–06/02/2027**, ngày đó rơi vào ngày nghỉ lễ seed (01/01/2027; 05–09/02/2027) → không có ô trống → test fail | `e2e/tests/02-customer-booking-ui.spec.ts:5-11`, `database/sporthub_init.sql:919-924` | Helper `nextOpenDate()` bỏ qua `BranchHolidays` (đọc qua API) và các ngày sân bị khóa |
| F-05 | Độ phủ | Chỉ 4 test cho 12 màn hình và 73 API; phần lớn chỉ kiểm tra điều hướng. Chưa có luồng thanh toán, hủy, POS, quản trị nào chạy tới cuối | Mục A.4 | Kế hoạch ở Phần B |
| F-06 | Tài liệu lỗi thời | `docs/02-quy-trinh-e2e-test-playwright.md` vẫn mô tả 41 kịch bản trên prototype (`UI-J01..13`, `SRS-UI-01..28`, các script `test:journeys`, `test:srs-audit`) đã bị xóa ở commit `2c8720c` | `docs/02-…md` | Viết lại theo bộ test mới sau Đợt 1, hoặc trỏ sang file này |
| F-07 | Khả năng chẩn đoán | Test dạng nguyên khối (E2E-01 gồm 4 vai trò trong một test) → khi fail khó biết bước nào hỏng. `trace: 'on-first-retry'` + `retries: 0` khi chạy local → **không có trace** lúc fail | `playwright.config.ts:52` | Tách test theo vai trò; đặt `trace: 'retain-on-failure'` |
| F-08 | Ghi chú | `fixtures/srs.ts` (`srsUiGap`, cờ `SRS_FULL`) còn lại từ thời prototype, không spec nào dùng | `e2e/fixtures/srs.ts` | Bỏ hoặc dùng lại cho kịch bản chờ sửa (`test.fixme` có annotation) |

### A.4. Độ phủ hiện tại theo màn hình

| Màn hình | Route | Mức phủ hiện tại |
| --- | --- | --- |
| Trang chủ | `/` | Có chữ "Chi nhánh" |
| Đăng nhập / Đăng ký | `/login` | **Tốt**: validate, 3 vai trò, ẩn/hiện mật khẩu, đăng ký |
| Đặt sân | `/booking` | Một đường: 1 ô Pickleball, mặc định |
| Thanh toán QR | `/payment/:code` | Chỉ kiểm tra QR hiển thị; chưa có thanh toán thành công |
| Lịch đặt của tôi | `/my-bookings` | Chỉ thấy link menu |
| POS tại quầy | `/staff/booking` | Thấy lưới lịch |
| Quản lý đơn & Nhận sân | `/staff/orders` | Chỉ điều hướng |
| Thống kê trong ngày | `/staff/stats` | Một nhãn KPI |
| Đối soát | `/staff/reconciliation`, `/owner/reconciliation` | Điều hướng + thấy nút "Hoàn tiền chờ xử lý" |
| Quản lý nhân viên | `/owner/staff` | Thấy tên 1 NV |
| Quản lý sân bãi | `/owner/courts` | Thấy tên 1 sân |
| Khuyến mãi & Báo cáo | `/owner/reports` | Thấy tiêu đề bảng |

Quy tắc tiền và trạng thái (`business-rules.md` §14) **đã có đủ unit và integration test** (20 file `*.int.test.ts`). E2E không cần tính lại các công thức đó. Việc của E2E là chứng minh **UI hiển thị đúng con số backend trả về** và **các hành trình nhiều vai trò chạy được tới cuối**.

---

## Phần B — Kế hoạch kiểm thử E2E toàn diện

### B.1. Nguyên tắc

1. **E2E không kiểm lại công thức.** Số tiền mong đợi lấy từ response API trong cùng test (`page.waitForResponse`) hoặc từ ví dụ chuẩn ở `business-rules.md` §6. Không tự tính lại ở test, vì đúng bất biến 2 thì FE cũng chỉ hiển thị.
2. **Chuẩn bị dữ liệu qua API, kiểm tra qua UI.** Đăng nhập, tạo đơn, gửi webhook dùng `request` fixture. Chỉ thao tác UI ở bước đang được kiểm.
3. **Mỗi spec tự cấp dữ liệu.** DB chỉ reset một lần mỗi lượt chạy, nên mỗi spec dùng "làn" riêng (sân + ngày) để không giẫm lên nhau. Seed B1–B5 chỉ đọc, không sửa.
4. **Tin nhắn lỗi khớp đúng câu chữ** trong SDD/SRS (lấy từ `ERROR_CATALOG` trong `@sporthub/shared`, không gõ lại trong test).
5. **Không chờ cố định.** Không dùng `waitForTimeout`; chờ theo response, socket event hoặc trạng thái DOM.
6. **Đa phiên khi kiểm realtime:** dùng 2 `browser.newContext()` (vd. khách + NV) trong cùng test.

### B.2. Hạ tầng cần làm trước (Đợt 0)

| ID | Việc | Chi tiết | Ưu tiên |
| --- | --- | --- | --- |
| I-01 | `fixtures/api.ts` | `apiLogin(role)` → access token; `apiCreateBooking({courtCode, date, start, end, paymentOption, promoCode})` kèm `Idempotency-Key`; `apiQuote`; `apiCancel`; tra cứu sân, môn theo mã | P0 |
| I-02 | `fixtures/sepay.ts` | `sendSepayWebhook({bookingCode, amount, accountNo, txnId?, transferType})` gọi `POST /api/v1/webhooks/bank/sepay` với `Authorization: Apikey ${E2E_SEPAY_API_KEY}` (mặc định là dev key) | P0 |
| I-03 | `fixtures/lanes.ts` | `nextOpenDate(branch, minDaysAhead)` bỏ qua ngày nghỉ và khối khóa sân; cấp làn ngày riêng cho mỗi spec, tránh D+5..D+7 (PB02 bảo trì). Sửa F-04 | P0 |
| I-04 | Auth setup project | Project `setup` đăng nhập 3 vai trò một lần, lưu `storageState` (cookie `sh_rt`); spec dùng lại để giảm lượt đăng nhập và tránh rate limit | P0 |
| I-05 | Kiểm tra cổng | `global-setup` báo lỗi rõ khi cổng 3000/5173 đã bị chiếm (F-03) | P0 |
| I-06 | Chặn console error | Fixture tự động: test fail nếu có `console.error` / `pageerror` (có danh sách cho phép). Sẽ bắt được F-01 | P0 |
| I-07 | Cấu hình | `trace: 'retain-on-failure'`; tag `@smoke` / `@p0` / `@p1` / `@realtime` / `@jobs`; script `test:p0` | P0 |
| I-08 | Kích hoạt job & dời thời gian | ✅ **Xong** theo R-15: `e2eTools.ts` + `fixtures/backend-tools.ts` (mục B.7) | P0 cho nhóm `@jobs` |
| I-09 | Tài liệu | Cập nhật `e2e/README.md` (biến môi trường, tag, làn dữ liệu); thay `docs/02-…` (F-06) | P1 |
| I-10 | Tách test cũ | E2E-01 → 4 test theo vai trò; E2E-04 → NV / Chủ sân (F-07) | P1 |

### B.3. Danh mục kịch bản

Chú thích: **P0** = tiền, trạng thái, phạm vi dữ liệu (bắt buộc trước khi phát hành); **P1** = luồng nghiệp vụ chính; **P2** = mở rộng.
Cột "Cần" ghi phụ thuộc hạ tầng.

#### B.3.1. Xác thực & tài khoản — `10-auth.spec.ts` (UC 001–003, 016)

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| AUTH-01 | Sai mật khẩu → thông báo backend đúng câu chữ; form không bị xóa | P1 | — |
| AUTH-02 | Sai 5 lần (tài khoản riêng, tạo qua đăng ký) → `423 ACCOUNT_TEMP_LOCKED`, UI hiện thời điểm mở khóa; nhập đúng mật khẩu ngay sau đó vẫn bị chặn | P0 | I-01 |
| AUTH-03 | NV bị khóa `0933445588` → `403 ACCOUNT_LOCKED` | P1 | — |
| AUTH-04 | Đăng nhập bằng email viết HOA → thành công | P2 | — |
| AUTH-05 | Reload trang vẫn giữ phiên (refresh cookie); đăng xuất rồi reload thì không vào lại được; nút Back không mở lại trang có bảo vệ | P1 | — |
| AUTH-06 | Đăng ký: trùng SĐT, trùng email, họ tên có số, mật khẩu nhập lại sai, mật khẩu có khoảng trắng | P1 | — |
| AUTH-07 | Deep link `/my-bookings` khi chưa đăng nhập → login → quay lại đúng `/my-bookings`; KH với `from=/owner/...` → về `/` | P2 | — |
| AUTH-08 | **Thu hồi phiên realtime:** NV mở `/staff/orders` (context A), Chủ sân khóa NV (context B) → context A bị đẩy về `/login` (socket `auth.revoked` / `401 TOKEN_REVOKED`) | P0 | I-04 |

#### B.3.2. Khách hàng: đặt sân & thanh toán — `20-customer-booking.spec.ts` (UC 004–008)

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| CUS-01 | **FULL + webhook đúng:** đặt 1 ô → QR hiện STK, số tiền, `THANHTOAN {code}`, đếm ngược → gửi webhook đúng `AmountDueNow` → trang Payment tự chuyển "thành công" (socket `booking.paid`) → `/my-bookings` hiện "Đã xác nhận / Đã thanh toán (100%)" | P0 | I-01, I-02 |
| CUS-02 | **Đặt cọc + KM** (ví dụ chuẩn §6): Bóng đá Mini 03, 09:00–10:30, `SANGVUI20`, đặt cọc → UI hiện 450.000 / −90.000 / 360.000 / cọc 108.000 / còn 252.000 → webhook 108.000 → "Đã đặt cọc" | P0 | I-02 |
| CUS-03 | **Vắt 2 khung giá:** PB03 15:00–17:00 → hiển thị 2 dòng giá, tổng 400.000 | P1 | I-03 |
| CUS-04 | **Mã KM lỗi qua báo giá:** `PICKLECS01` → "đang tạm dừng"; `SANGVUI20` lúc 17:00 → "ngoài khung giờ"; `TRIAN10` với khách mới → "chỉ dành cho khách hàng được chỉ định"; mã không tồn tại. Kiểm tra mỗi reasonCode hiển thị đúng câu | P1 | — |
| CUS-05 | **`DEPOSIT_NOT_ALLOWED`:** Chủ sân tạo mã FIXED 90.000 cho cầu lông (qua API) → khách đặt Cầu lông 1h (120.000) → tổng 30.000 → UI khóa lựa chọn đặt cọc, chỉ cho trả 100% | P0 | I-01 |
| CUS-06 | **Tổng = 0:** mã FIXED ≥ giá → tạo đơn đi thẳng "Đã xác nhận / Đã thanh toán", không mở màn QR | P0 | I-01 |
| CUS-07 | **Lưới lịch:** PB02 bị khóa D+5..D+7; BD02 (INACTIVE) không đặt được; 01/01/2027 hiện "nghỉ lễ"; ô đã qua trong hôm nay bị khóa; ô của đơn seed hiện bận | P1 | I-03 |
| CUS-08 | **Trùng lịch + realtime:** khách A và B mở cùng lưới; A đặt ô X → lưới của B thấy X chuyển bận không cần reload (`slot.updated`); B bấm X từ trạng thái cũ → `409 SLOT_TAKEN`, câu thông báo đúng, lưới làm mới | P0 | 2 context |
| CUS-09 | **Hủy giữ chỗ** (`cancel-hold-btn`, "Đổi khung giờ khác") → ô trống lại; đặt lại ngay được | P1 | — |
| CUS-10 | **Webhook sai số tiền** → trang Payment vẫn chờ; giao dịch hiện ở `/staff/reconciliation` với lý do `WRONG_AMOUNT`; đơn không đổi | P0 | I-02 |
| CUS-11 | **Webhook trùng `id`** gửi 2 lần → UI chỉ có 1 phiếu thu; số đã trả không nhân đôi | P1 | I-02 |
| CUS-12 | **"Kiểm tra lại thanh toán"** (`recheck-payment-btn`): bấm liên tiếp → bị giới hạn 5 giây; không có giao dịch thì đơn vẫn chờ (không bao giờ tự xác nhận) | P1 | — |
| CUS-13 | **Hết hạn giữ chỗ:** đơn quá `HoldExpireAt` → trang Payment hiện "quá hạn", ô trống lại; webhook đến muộn → `LATE_PAYMENT` ở đối soát | P0 | I-08 |
| CUS-14 | **Chặn xem đơn người khác:** khách B mở `/payment/{code của A}` → thông báo `BOOKING_FORBIDDEN`, không lộ dữ liệu | P0 | I-01 |
| CUS-15 | **Idempotency:** double-click "Tiếp tục thanh toán QR" → chỉ một đơn được tạo (đếm qua API danh sách đơn) | P1 | — |
| CUS-16 | Khách chưa đăng nhập xem lưới `/booking`, bấm đặt → yêu cầu đăng nhập → quay lại và giữ lựa chọn (nếu thiết kế có) | P2 | — |

#### B.3.3. Lịch đặt, hủy & thông báo — `30-my-bookings.spec.ts` (UC 006, 009, 026)

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| MY-01 | Các tab trạng thái (`tab-*`) với đơn seed của An: COMPLETED, CONFIRMED, EXPIRED, CANCELED hiện đúng tab và nhãn; lọc `from/to`, `from > to` bị chặn | P1 | — |
| MY-02 | **Hủy FULL ≥ 5 ngày:** modal hiện `cancel-refund-rate` 100%, `cancel-refund-amount` bằng số tiền đã trả (khớp `GET cancel-preview`) → hủy → "Đã hủy"; khoản hoàn xuất hiện "chờ xử lý" ở `/owner/reconciliation` | P0 | I-01, I-02 |
| MY-03 | **Hủy đơn cọc chưa tất toán** → preview hoàn 0, có cảnh báo không hoàn cọc | P0 | I-02 |
| MY-04 | **Hủy 2 ≤ T < 5 ngày** (đơn FULL đã trả, ngày chơi D+3) → 50% | P0 | I-02, I-03 |
| MY-05 | Lý do bắt buộc; > 255 ký tự bị chặn; chọn "Lý do khác" bắt buộc nhập | P1 | — |
| MY-06 | Không có nút hủy cho đơn COMPLETED / CANCELED / EXPIRED / đã qua giờ bắt đầu | P1 | — |
| MY-07 | **Xung đột phiên bản:** mở modal hủy (context khách) → NV hủy cùng đơn (context NV) → khách xác nhận → `409 BOOKING_STATE_CHANGED`, UI làm mới trạng thái | P0 | 2 context |
| MY-08 | **Thông báo realtime:** sau webhook (CUS-01), `nav-unread-count` tăng không cần reload; mở hộp thư, lọc theo loại / đã đọc, đánh dấu đã đọc → số giảm | P1 | I-02 |
| MY-09 | Chủ sân phát hành KM cho tất cả khách → khách nhận thông báo PROMOTION | P2 | — |
| MY-10 | NV đóng đơn của khách (BY_FACILITY / hủy) → khách nhận SCHEDULE_CHANGE | P1 | — |

#### B.3.4. Nhân viên POS & vận hành — `40-staff-pos.spec.ts` (UC 010–015)

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| POS-01 | **Khách vãng lai, tiền mặt 100%:** thiếu tên/SĐT → lỗi; đủ → "Đã xác nhận / Đã thanh toán", phiếu thu hiện đúng số | P0 | — |
| POS-02 | **Hội viên + QR cọc:** tra SĐT `0987654321` → gắn tài khoản → tạo QR cọc (`create-qr-btn`, `qr-countdown`) → webhook → POS cập nhật realtime | P0 | I-02 |
| POS-03 | **Tất toán → Nhận sân → Kết thúc:** đơn cọc hôm nay → `settle-modal` thu đúng `RemainingAmount` → "Nhận sân" → "Đang sử dụng" → "Kết thúc & Hoàn thành" → "Hoàn thành" | P0 | I-08 (cần đơn trong khung nhận sân sớm 15 phút) |
| POS-04 | Nhận sân khi chưa trả đủ → `422 PAYMENT_INCOMPLETE`, FE tự mở màn tất toán | P0 | I-08 |
| POS-05 | Nhận sân khi sân còn đơn IN_USE → `409 COURT_IN_USE`, hiện mã đơn đang chặn | P1 | I-08 |
| POS-06 | **COUNTER_ABORT:** tạo đơn QR tại quầy, khách bỏ đi → `pos-cancel-modal` → ô trống lại | P1 | — |
| POS-07 | **NO_SHOW:** chọn no-show quá sớm → `NO_SHOW_NOT_ELIGIBLE`; đủ điều kiện (StartAt + 30') → `no-show-confirm-modal` → hủy, giữ cọc; đơn PAID chỉ đủ điều kiện từ EndAt | P0 | I-08 |
| POS-08 | **Phạm vi cơ sở:** NV CS01 không thấy đơn CS02 ở `/staff/orders`; tra mã đơn CS02 → `BRANCH_FORBIDDEN`; NV không có `branch-switcher` | P0 | — |
| POS-09 | **Thống kê:** KPI ở `/staff/stats` khớp response `/dashboard/daily` trong cùng test; `kpi-drilldown-modal`; đổi `stats-date-picker` | P1 | — |
| POS-10 | **Realtime chéo vai trò:** khách đặt online → lưới POS của NV đổi ô sang bận không cần reload | P1 | 2 context |
| POS-11 | **Đối soát tay:** giao dịch `NEEDS_REVIEW` (seed B4 `LATE_PAYMENT`, CUS-10 `WRONG_AMOUNT`) → "Hoàn lại khách" (ghi chú bắt buộc) / "Bỏ qua" / khớp tay khi số tiền đúng | P0 | I-02 |
| POS-12 | `orders-date-filter`, tìm theo mã/SĐT, các tab trạng thái của `/staff/orders` | P2 | — |

#### B.3.5. Chủ sân quản trị — `50-owner-admin.spec.ts` (UC 016–023)

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| OWN-01 | **Nhân viên:** trùng SĐT → lỗi; thêm NV CS02 → NV đăng nhập vào đúng CS02; khóa → không đăng nhập được; mở khóa; đổi cơ sở → phiên cũ bị thu hồi; `staff-search`, `staff-status-filter` | P1 | — |
| OWN-02 | **Sân:** trùng tên trong cơ sở → lỗi; `court-desc` > 500; `court-deposit` PERCENT < 10 → lỗi; sân mới xuất hiện trên lưới khách | P1 | — |
| OWN-03 | **Bảng giá & snapshot:** tạo đơn → Chủ sân sửa giá → đơn cũ vẫn giá cũ ở chi tiết đơn, báo giá mới dùng giá mới; khung trùng giờ → `PRICE_RULE_OVERLAP` | P0 | I-01 |
| OWN-04 | **Giờ mở cửa:** `open ≥ close` → lỗi; thu hẹp giờ khi có đơn → cảnh báo `affectedCount` (dryRun) → lưu → danh sách đơn bị ảnh hưởng | P1 | I-01 |
| OWN-05 | **Ngày nghỉ:** ngày bắt đầu ở quá khứ → lỗi; > 60 ngày → lỗi; thêm ngày nghỉ trùng đơn → danh sách bị ảnh hưởng; lưới khách hiện ngày nghỉ | P1 | I-01 |
| OWN-06 | **Khóa sân → Chuyển sân:** khóa sân có đơn → `AffectedBookingsModal` → `reassign-btn` → chọn `reassign-target-court` → giữ mã đơn và số tiền; khách nhận SCHEDULE_CHANGE; ô cũ trống, ô mới bận | P0 | I-01 |
| OWN-07 | **Đóng đơn BY_FACILITY:** `close-btn` trên đơn đã đặt cọc → hoàn 100% kể cả cọc, khoản hoàn "chờ xử lý"; báo cáo doanh thu loại đơn này | P0 | I-01, I-02 |
| OWN-08 | **Khuyến mãi:** trùng mã → lỗi; `promo-discount-type` PERCENT/FIXED; phát hành → khách áp được; tạm dừng → khách nhận "đang tạm dừng"; sửa Code khi đã có lượt dùng → `PROMO_CODE_LOCKED`; xóa mã đã dùng → chuyển "Ngừng áp dụng" (`promo-delete-*`) | P1 | — |
| OWN-09 | **Báo cáo:** `from > to` bị chặn; > 366 ngày → `INVALID_DATE_RANGE`; mọi số trên bảng khớp response `/reports/revenue` (FE không tự tính); `report-court-filter`, `report-by-court-table`; kỳ trống hiện thông báo | P0 | — |
| OWN-10 | **Hoàn tiền:** đánh dấu COMPLETED / FAILED ở `/owner/reconciliation`; trạng thái lưu sau reload | P1 | MY-02 hoặc OWN-07 |
| OWN-11 | `branch-switcher` của Chủ sân (Tất cả / CS01 / CS02) trên `/staff/stats` và `/staff/orders` đổi đúng dữ liệu | P1 | — |

#### B.3.6. Xuyên suốt — `90-cross-cutting.spec.ts`

| ID | Kịch bản & điểm kiểm | P | Cần |
| --- | --- | --- | --- |
| X-01 | **Múi giờ trình duyệt khác VN** (`timezoneId: 'America/New_York'`): lưới, QR, lịch đặt vẫn hiển thị giờ Việt Nam (bất biến 10) | P0 | — |
| X-02 | **Backend lỗi / mất mạng** (`page.route` abort 500): UI hiện thông báo lỗi, không trắng trang; thử lại được | P1 | — |
| X-03 | **XSS:** tên khách vãng lai / lý do hủy chứa `<img onerror>` → hiển thị dạng chữ | P1 | — |
| X-04 | **Mobile** 390×844: Trang chủ → Đặt sân → Payment → Lịch đặt dùng được (không tràn, nút bấm được) | P2 | — |
| X-05 | **Firefox, WebKit:** chạy nhóm `@smoke` | P2 | — |
| X-06 | **Truy cập (a11y):** quét axe các màn hình chính | P2 | Thư viện mới `@axe-core/playwright`, cần duyệt |

**Tổng:** 63 kịch bản mới (P0: 26, P1: 29, P2: 8) + 5 test hiện có (E2E-05 đã phủ một phần CUS-13).

### B.4. Lộ trình

| Đợt | Nội dung | Điều kiện hoàn thành |
| --- | --- | --- |
| **Đợt 0 — Hạ tầng** | Sửa F-01, F-03, F-04, F-07; làm I-01..I-07 (Q-E1 đã chốt, I-08 đã xong) | 4 test cũ vẫn xanh; `nextOpenDate` dùng ở E2E-03; console guard bật |
| **Đợt 1 — P0 không cần job** | CUS-01, 02, 05, 06, 08, 10, 14 · MY-02, 03, 04, 07 · POS-01, 02, 08, 11 · OWN-03, 06, 07, 09 · AUTH-02, 08 · X-01 | Xanh 3 lượt liên tiếp với `--repeat-each=3`, không flaky |
| **Đợt 2 — P0 cần job** | CUS-13 (phần webhook muộn), POS-03, 04, 07 — dùng `backend-tools.ts` | Như trên |
| **Đợt 3 — P1** | Phần P1 còn lại; I-09, I-10 | Toàn suite < 10 phút trên 1 worker |
| **Đợt 4 — P2 & CI** | Mobile, cross-browser, a11y; chạy `@smoke` mỗi PR, full suite hằng đêm | Báo cáo HTML + JUnit lưu artifact CI |

### B.5. Câu hỏi đã chốt và còn mở

| # | Câu hỏi | Kết luận |
| --- | --- | --- |
| **Q-E1** | Kích hoạt job nền và "dời thời gian" trong E2E thế nào? (F-02) | ✅ **Đã chốt 25/11/2026 → R-15.** Script chạy một lần ở tiến trình riêng, dùng đồng hồ thật, dời dữ liệu của chính đơn test. Không thêm endpoint test, không dùng đồng hồ giả toàn backend. Đã làm, xem B.7 |
| **Q-E2** | E2E có được đọc/ghi trực tiếp `SportHub_Test` không? | ✅ **Đã chốt → R-15.** Chuẩn bị dữ liệu qua API; SQL trực tiếp chỉ qua `e2eTools.ts` để dời thời gian |
| Q-E3 | Có thêm `@axe-core/playwright` (X-06) không? | Còn mở. Chỉ làm ở Đợt 4 nếu cần |

### B.7. I-08 đã hoàn thành (25/11/2026)

| Thành phần | Mô tả |
| --- | --- |
| `backend/src/scripts/e2eTools.ts` | `run-job <jobName>` (7 job: `expireHolds`, `expireQr`, `cancelNoShows`, `closePaidNoShows`, `autoComplete`, `sendReminders`, `retryPromoNotify`); `expire-hold <code>`; `shift-booking <code> --minutes=<n>`. In một dòng JSON. Từ chối chạy nếu `NODE_ENV ≠ test` hoặc tên DB không có hậu tố `_Test` |
| `e2e/fixtures/backend-tools.ts` | `runJob(name)`, `expireHold(code)`, `shiftBooking(code, minutes)`, gọi `node backend/dist/scripts/e2eTools.js` |
| `e2e/tests/04-jobs-ui.spec.ts` | **E2E-05 `@jobs`** (CUS-13, phần hết hạn giữ chỗ): tạo đơn qua UI → `expireHold` → `runJob('expireHolds')` → reload thấy "Đơn đã quá hạn thanh toán" → ô trống trở lại. **PASS** (6,8 s); suite 5/5 PASS trong 43,9 s |

Lưu ý khi dùng:
- Script **phải chạy từ bản build** (`dist/`): `tsx`/esbuild không sinh decorator metadata nên Nest DI lỗi. Webserver E2E đã `npm run build` backend trước khi chạy test.
- Mỗi lần gọi tốn khoảng 1,5–2 giây (khởi động Nest context).
- Không có socket sau khi chạy job: phải `page.reload()` hoặc chờ API.
- Job quét toàn bảng: assertion về số bản ghi chỉ dùng `≥ 1`, còn trạng thái của đơn cụ thể thì kiểm tra trên UI.
- `shift-booking` được phép đổi sang ngày khác, nhưng đơn không được vắt qua nửa đêm (`CK_Bookings_Time`). Nếu trùng ô với đơn khác thì bị `UX_BookingSlots_Court_Slot` chặn. Với luồng nhận sân, nên dùng sân không có đơn hôm nay (vd. `SAN_BR_01`).
- Phần còn lại của CUS-13 (webhook đến muộn → `LATE_PAYMENT`) cần thêm I-02.

### B.6. Rủi ro

| Rủi ro | Giảm thiểu |
| --- | --- |
| Dữ liệu giữa các spec giẫm lên nhau (1 lần reset / lượt chạy) | Làn sân + ngày riêng (I-03); seed chỉ đọc |
| Rate limit đăng nhập làm fail giữa chừng | `storageState` (I-04); AUTH-02 dùng tài khoản riêng |
| Test phụ thuộc giờ chạy thật (ô quá khứ, nhận sân sớm 15') | Chọn ngày ≥ D+8 cho luồng không cần "hôm nay"; luồng hôm nay dùng I-08 |
| Socket chậm gây flaky | Chờ theo DOM với `expect.poll`, timeout riêng cho tag `@realtime` |
| Dev backend chiếm cổng | I-05 |
