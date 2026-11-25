# Báo cáo Kết quả Triển khai & Chạy Toàn bộ Kiểm thử E2E (`SportHub`)

- **Ngày thực hiện:** 2026-11-25 (giờ VN `+07:00`)
- **Kế hoạch đối chiếu:** [e2e_comprehensive_plan.md](file:///d:/Jobs/Sports/e2e_comprehensive_plan.md)
- **Phạm vi thay đổi:** Chỉ triển khai/cập nhật hạ tầng & kịch bản test trong `e2e/` (**không chỉnh sửa** mã nguồn `app/`, `backend/`, `packages/shared/`, `database/`).
- **Lệnh thực thi cuối:** `npm test -w sporthub-ui-e2e`
- **Cấu hình chạy:** Playwright `1.59.x`, Chromium headless, `workers = 1`, `fullyParallel = false`, DB test `SportHub_Test` reset + seed trước khi chạy (`seedSample = true`), job nền kích hoạt qua [e2eTools.ts](file:///d:/Jobs/Sports/backend/src/scripts/e2eTools.ts), webhook thanh toán giả lập qua [sepay.ts](file:///d:/Jobs/Sports/e2e/fixtures/sepay.ts).
- **Artifacts kết quả lần chạy cuối:** [junit.xml](file:///d:/Jobs/Sports/e2e/test-results/junit.xml)

---

## 1. Tổng hợp Kết quả

| Chỉ số | Số lượng | Ghi chú |
| --- | ---: | --- |
| **Tổng số test** | **73** | 1 `setup` + 9 smoke/UI có sẵn (sau tách) + 63 kịch bản Đợt 1–6 |
| **Passed** | **69** | Toàn bộ Auth/RBAC, Đặt sân KH (kể cả realtime & jobs), Lịch đặt/Hủy/Thông báo, POS/Đối soát (trừ POS-02), Chủ sân quản trị (trừ OWN-09 console guard), Xuyên suốt (`X-01..04`, `X-06`) |
| **Failed** | **3** | **100% là lỗi thật của ứng dụng/backend**: `POS-02`, `E2E-04b`, `OWN-09` (2 lỗi gốc: `CK_Payments_Collector` và `F-01`) |
| **Skipped** | **1** | `X-05` (chưa cài binary Firefox và WebKit trong `ms-playwright`) |
| **Tổng thời gian** | **5.6 phút** (`338.83s`) | `typecheck`: `npm run typecheck -w sporthub-ui-e2e` thoát mã `0` |

---

## 2. Kết quả theo Nhóm / Tệp Kiểm thử

| Nhóm / Tệp | Số test | Pass | Fail | Skip | Thời gian | Liên kết |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Setup phiên 4 vai trò (`auth.setup`) | 1 | 1 | 0 | 0 | 0.66s | [auth.setup.ts](file:///d:/Jobs/Sports/e2e/tests/auth.setup.ts) |
| Đợt 0/Smoke: Auth & RBAC (`E2E-01a..d`, `E2E-02`) | 5 | 5 | 0 | 0 | 9.12s | [01-auth-rbac-ui.spec.ts](file:///d:/Jobs/Sports/e2e/tests/01-auth-rbac-ui.spec.ts) |
| Đợt 0/Smoke: Đặt sân cơ bản (`E2E-03`) | 1 | 1 | 0 | 0 | 2.37s | [02-customer-booking-ui.spec.ts](file:///d:/Jobs/Sports/e2e/tests/02-customer-booking-ui.spec.ts) |
| Đợt 0/Smoke: Staff & Owner (`E2E-04a`, `E2E-04b`) | 2 | 1 | 1 | 0 | 3.95s | [03-staff-owner-ui.spec.ts](file:///d:/Jobs/Sports/e2e/tests/03-staff-owner-ui.spec.ts) |
| Đợt 0/Smoke: Job nền (`E2E-05`) | 1 | 1 | 0 | 0 | 6.78s | [04-jobs-ui.spec.ts](file:///d:/Jobs/Sports/e2e/tests/04-jobs-ui.spec.ts) |
| Đợt 1: Xác thực & Tài khoản (`AUTH-01..08`) | 8 | 8 | 0 | 0 | 101.16s | [10-auth.spec.ts](file:///d:/Jobs/Sports/e2e/tests/10-auth.spec.ts) |
| Đợt 2: Khách đặt sân & VietQR (`CUS-01..16`) | 16 | 16 | 0 | 0 | 40.48s | [20-customer-booking.spec.ts](file:///d:/Jobs/Sports/e2e/tests/20-customer-booking.spec.ts) |
| Đợt 3: Lịch đặt, Hủy & Thông báo (`MY-01..10`) | 10 | 10 | 0 | 0 | 26.83s | [30-my-bookings.spec.ts](file:///d:/Jobs/Sports/e2e/tests/30-my-bookings.spec.ts) |
| Đợt 4: Nhân viên POS & Vận hành (`POS-01..12`) | 12 | 11 | 1 | 0 | 55.66s | [40-staff-pos.spec.ts](file:///d:/Jobs/Sports/e2e/tests/40-staff-pos.spec.ts) |
| Đợt 5: Chủ sân quản trị (`OWN-01..11`) | 11 | 10 | 1 | 0 | 38.95s | [50-owner-admin.spec.ts](file:///d:/Jobs/Sports/e2e/tests/50-owner-admin.spec.ts) |
| Đợt 6: Xuyên suốt (`X-01..06`) | 6 | 5 | 0 | 1 | 16.59s | [90-cross-cutting.spec.ts](file:///d:/Jobs/Sports/e2e/tests/90-cross-cutting.spec.ts) |

---

## 3. Lỗi Thật của Hệ thống Phát hiện bởi E2E (Chưa sửa code)

### Lỗi 1 (P0 — Backend): Webhook SePay cho đơn đặt tại quầy (`COUNTER`) bị lỗi ràng buộc `CK_Payments_Collector`

- **Ca kiểm thử phát hiện:** `POS-02` trong [40-staff-pos.spec.ts](file:///d:/Jobs/Sports/e2e/tests/40-staff-pos.spec.ts#L75-L120)
- **Hiện tượng:** Nhân viên tạo đơn tại quầy (`/staff/booking`) với hình thức **Đặt cọc** + **Quét mã VietQR**, sau đó khách chuyển khoản đúng số tiền và webhook SePay (`POST /api/v1/webhooks/bank/sepay`) gửi về hợp lệ. Giao dịch vẫn **không xác nhận đơn**, không bắn toast/realtime về màn POS; thay vào đó hệ thống đẩy giao dịch vào đối soát tay (`NEEDS_REVIEW`).
- **Log lỗi SQL Server thu được từ tiến trình Backend:**
  ```text
  {"timestamp":"2026-11-25T03:21:19.825Z","level":"error","message":"Bank transaction matching failed; routing to NEEDS_REVIEW","context":"PaymentsService","bankTxnId":17,"error":{"name":"RequestError","message":"[Microsoft][ODBC Driver 17 for SQL Server][SQL Server]The INSERT statement conflicted with the CHECK constraint \"CK_Payments_Collector\". The conflict occurred in database \"SportHub_Test\", table \"dbo.Payments\"."}}
  ```
- **Nguyên nhân gốc:**
  - CSDL quy định `CONSTRAINT CK_Payments_Collector CHECK (Channel <> 'COUNTER' OR CollectedBy IS NOT NULL)` tại [sporthub_init.sql](file:///d:/Jobs/Sports/database/sporthub_init.sql#L591).
  - Tuy nhiên khi xử lý webhook SePay tại [payments.service.ts](file:///d:/Jobs/Sports/backend/src/payments/payments.service.ts#L463-L473), backend truyền `channel: booking.Channel` (`'COUNTER'` đối với đơn tạo ở POS) cùng `collectedBy: null` vào `applyPaymentInTx(...)`. Khi `INSERT INTO dbo.Payments`, SQL Server từ chối do `Channel = 'COUNTER'` mà `CollectedBy IS NULL`, và khối `catch` ở dòng 586–600 tự động chuyển giao dịch thành `NEEDS_REVIEW`.
- **Hướng khắc phục đề xuất:** Với thanh toán chuyển khoản tự động qua webhook SePay (`method: 'BANK_TRANSFER'`), `Channel` của bản ghi `Payments` phải là `'ONLINE'` (hoặc cập nhật logic/ràng buộc tương ứng nếu cần phân biệt thanh toán QR tự động phát sinh từ đơn POS).

### Lỗi 2 (UI / React — F-01): Trùng `key="Hoàn thành"` trên trang Báo cáo doanh thu (`/owner/reports`)

- **Ca kiểm thử phát hiện:** `E2E-04b` ([03-staff-owner-ui.spec.ts](file:///d:/Jobs/Sports/e2e/tests/03-staff-owner-ui.spec.ts#L23-L52)) và `OWN-09` ([50-owner-admin.spec.ts](file:///d:/Jobs/Sports/e2e/tests/50-owner-admin.spec.ts#L647-L715)), bị bắt bởi console guard (`I-06`) trong [test.ts](file:///d:/Jobs/Sports/e2e/fixtures/test.ts#L10-L37).
- **Hiện tượng:** Mọi bước điều hướng, lọc báo cáo, đối chiếu số liệu API `/reports/revenue`, kiểm tra `from > to`, `> 366 ngày`, lọc sân và kỳ trống đều **PASSED** về mặt chức năng; tuy nhiên lúc đóng fixture `ownerPage`, `assertClean()` ghi nhận lỗi React trên trình duyệt:
  - `E2E-04b`: 4 thông báo `[console.error] Encountered two children with the same key, '%s'... Hoàn thành`
  - `OWN-09`: 24 thông báo `[console.error] Encountered two children with the same key, '%s'... Hoàn thành`
- **Nguyên nhân gốc:** Tại [OwnerReports.tsx](file:///d:/Jobs/Sports/app/src/pages/OwnerReports.tsx#L451-L462), mảng `reportCols` chứa 2 phần tử trùng tên `'Hoàn thành'` (một cho cột số đơn hoàn thành, một cho cột doanh thu từ đơn hoàn thành) và vòng `.map` dùng chính chuỗi nhãn làm `key`.
- **Hướng khắc phục đề xuất:** Đổi cấu trúc cột thành cặp `{ key, label }` với `key` duy nhất (hoặc đặt tên cột rõ nghĩa hơn, ví dụ `'Số đơn hoàn thành'` và `'DT hoàn thành'`).

### Các quan sát & chênh lệch nhỏ khác cần lưu ý

1. **Độ lệch thông báo lỗi giữa `ERROR_CATALOG` và Backend/Frontend thực tế:**
   - Trùng mã khuyến mãi trả `"Mã giảm giá này đã tồn tại."` ([admin-promotions.service.ts](file:///d:/Jobs/Sports/backend/src/admin/promotions/admin-promotions.service.ts#L480)) thay vì `ERROR_CATALOG.PROMO_CODE_DUPLICATE.defaultMessage` (`"Mã khuyến mãi đã tồn tại."`).
   - Vượt 366 ngày trên báo cáo trả `"Khoảng thời gian tra cứu tối đa 366 ngày."` ([reports.service.ts](file:///d:/Jobs/Sports/backend/src/reports/reports.service.ts#L159)) thay vì `ERROR_CATALOG.INVALID_DATE_RANGE.defaultMessage`.
   - Trùng SĐT nhân viên trả `"Số điện thoại này đã được sử dụng bởi tài khoản nhân viên khác."` thay vì `ERROR_CATALOG.PHONE_TAKEN.defaultMessage`.
2. **Hiển thị `refundRate` trên Modal hủy đơn cọc chưa tất toán (`CancelBookingModal` / `MY-03`):**
   - Với đơn đặt cọc hủy trước ≥ 5 ngày, backend ([bookings.service.ts](file:///d:/Jobs/Sports/backend/src/bookings/bookings.service.ts#L521)) trả `refundRate: 100` (tỷ lệ theo mốc thời gian cho phần vượt cọc) nhưng `refundableBase = 0` nên `refundAmount = 0`. Trên [CancelBookingModal.tsx](file:///d:/Jobs/Sports/app/src/components/CancelBookingModal.tsx#L145-L150), `cancel-refund-rate` hiển thị `100%` (`Tỷ lệ hoàn phần vượt cọc: 100%`) và `cancel-refund-amount` hiển thị `0 VNĐ` — đúng tính toán nghiệp vụ, nhưng nên cân nhắc làm rõ hơn về UI hoặc hiển thị `0%` khi `refundableBase === 0`.
3. **Khả năng rớt sự kiện socket khi vừa điều hướng (`Payment.tsx` & `ws proxy error ECONNRESET`):**
   - Trong log `[WebServer]`, Vite dev server proxy đôi khi ghi nhận `[vite] ws proxy error: Error: read ECONNRESET`. Trong lần chạy đầu tiên trước khi ổn định, `CUS-01` từng ghi nhận trace socket ngắt kết nối và tự nối lại sau ~1 giây (`reconnectionDelay`), đúng khoảng webhook vừa bắn. Tại [Payment.tsx](file:///d:/Jobs/Sports/app/src/pages/Payment.tsx#L58-L61), `handleReconnect` mới chỉ gọi `subscribeRoom(room)` mà **chưa** gọi `queryClient.invalidateQueries` cho `bookingsKeys.detail(bookingCode)` / `paymentsKeys.request(bookingCode)` để đồng bộ trạng thái nếu sự kiện `booking.paid` bị lỡ trong lúc rớt mạng tạm thời.
4. **Cơ chế khóa nút xác nhận hủy khi mở Modal (`CancelBookingModal` & `MY-07`):**
   - Khi khách mở sẵn `CancelBookingModal` và một nhân viên/nguồn khác hủy đơn đó qua API, socket `booking.updated` làm `previewQ` (`useCancelPreview`) refetch ngầm trong modal đang mở và chuyển `blockedByPreview = true`, khiến nút `Xác nhận hủy` bị vô hiệu hóa (`disabled`) ngay trước khi khách kịp bấm (dù bảo vệ người dùng trong điều kiện mạng tốt, nếu socket chưa tới kịp sẽ nhận `409 BOOKING_STATE_CHANGED` — đây là hành vi mà `MY-07` mô phỏng bằng việc ngắt `socket.io`).
5. **Phạm vi bỏ qua (`X-05` & `Q-E3`):**
   - `X-05`: Đã kiểm tra đường dẫn `firefox.executablePath()` và `webkit.executablePath()`, cả hai chưa cài trên máy nên skip an toàn theo đúng kế hoạch.
   - `X-06`: Chưa cài `@axe-core/playwright` (`Q-E3`), nên thực hiện kiểm tra semantic DOM (`lang`, `h1 >= 1`, `img[alt]`, `button` có nhãn). Lưu ý cần đợi SPA tải xong (`h1` hiển thị) vì trạng thái bootstrap ban đầu trên `/` chỉ có spinner trước khi render `Home`.

---

## 4. Hạ tầng E2E đã Triển khai (Đợt 0)

- [playwright.config.ts](file:///d:/Jobs/Sports/e2e/playwright.config.ts): Thêm project `setup` + `chromium` (`dependencies: ['setup']`), giữ lại `trace: 'retain-on-failure'`, timeout `45s`, expect `8s`, khởi động BE test + FE qua `webServer`.
- [package.json](file:///d:/Jobs/Sports/e2e/package.json): Bổ sung scripts `test:p0`, `test:p1`, `test:jobs`, `test:realtime`, `typecheck`.
- [global-setup.ts](file:///d:/Jobs/Sports/e2e/fixtures/global-setup.ts): Kiểm tra cổng `3000`/`5173` khi `E2E_SKIP_WEBSERVER=1` (`I-05`) và reset/seed `SportHub_Test`.
- [api.ts](file:///d:/Jobs/Sports/e2e/fixtures/api.ts): Helper gọi API cho toàn bộ vai trò, theo dõi `X-RateLimit-Remaining` / `Retry-After` cho `/auth/login` & `/auth/register`, quản lý `storageState` (`I-01`).
- [sepay.ts](file:///d:/Jobs/Sports/e2e/fixtures/sepay.ts): Helper giả lập webhook SePay với `Apikey` (`I-02`).
- [lanes.ts](file:///d:/Jobs/Sports/e2e/fixtures/lanes.ts): Tính ngày tương lai theo giờ VN, tự né ngày nghỉ/ngày đóng/sân bảo trì (`I-03`).
- [backend-tools.ts](file:///d:/Jobs/Sports/e2e/fixtures/backend-tools.ts) & [e2eTools.ts](file:///d:/Jobs/Sports/backend/src/scripts/e2eTools.ts): Kích hoạt job nền, ép hết hạn giữ chỗ, dịch thời gian đơn cho test `POS-03/04/05/07`, `CUS-13` (`R-15`).
- [auth.fixture.ts](file:///d:/Jobs/Sports/e2e/fixtures/auth.fixture.ts) & [test.ts](file:///d:/Jobs/Sports/e2e/fixtures/test.ts): Fixtures `customerPage`, `customer2Page`, `staffPage`, `ownerPage` tự đồng bộ rotation cookie `sh_rt` (`I-04`), helper `submitAuthWithRateLimitRetry`, và console/pageerror guard (`I-06`).

---

## 5. Chi tiết Kết quả 73 Test Cases (Lần chạy cuối)

| # | Tệp | Mã / Tên ca kiểm thử | Kết quả | Thời gian |
| ---: | --- | --- | --- | ---: |
| 1 | `auth.setup.ts` | Khởi tạo phiên `storageState` cho các vai trò seed | **PASS** | 0.66s |
| 2 | `01-auth-rbac-ui.spec.ts` | `E2E-01a` Chặn route chưa đăng nhập và validate form đăng nhập | **PASS** | 1.86s |
| 3 | `01-auth-rbac-ui.spec.ts` | `E2E-01b` Khách hàng vào giao diện khách và bị chặn `/staff/*`, `/owner/*` | **PASS** | 1.61s |
| 4 | `01-auth-rbac-ui.spec.ts` | `E2E-01c` Nhân viên vào `/staff/*`, kế thừa khách và bị chặn `/owner/*` | **PASS** | 1.84s |
| 5 | `01-auth-rbac-ui.spec.ts` | `E2E-01d` Chủ sân toàn quyền `/owner/*`, kế thừa `/staff/*` & khách | **PASS** | 1.48s |
| 6 | `01-auth-rbac-ui.spec.ts` | `E2E-02` Đăng ký hội viên mới qua Backend API + SQL Server | **PASS** | 2.33s |
| 7 | `02-customer-booking-ui.spec.ts` | `E2E-03` Khách xem trang chủ, chọn ô trống, báo giá, tạo đơn VietQR | **PASS** | 2.37s |
| 8 | `03-staff-owner-ui.spec.ts` | `E2E-04a` Nhân viên điều hướng đầy đủ màn hình vận hành | **PASS** | 1.81s |
| 9 | `03-staff-owner-ui.spec.ts` | `E2E-04b` Chủ sân điều hướng đầy đủ màn hình quản trị | **FAIL** *(F-01)* | 2.13s |
| 10 | `04-jobs-ui.spec.ts` | `E2E-05` Job `expirePendingBookings` → `EXPIRED`, mở lại ô | **PASS** | 6.78s |
| 11 | `10-auth.spec.ts` | `AUTH-01` Sai mật khẩu → thông báo backend, không xóa form | **PASS** | 1.37s |
| 12 | `10-auth.spec.ts` | `AUTH-03` Nhân viên bị khóa `0933445588` → `403 ACCOUNT_LOCKED` | **PASS** | 1.22s |
| 13 | `10-auth.spec.ts` | `AUTH-04` Đăng nhập bằng email viết HOA → thành công | **PASS** | 1.79s |
| 14 | `10-auth.spec.ts` | `AUTH-05` Reload giữ phiên; đăng xuất rồi reload & Back bị chặn | **PASS** | 34.88s |
| 15 | `10-auth.spec.ts` | `AUTH-06` Đăng ký validate họ tên/mật khẩu, trùng SĐT/email (`409`) | **PASS** | 2.54s |
| 16 | `10-auth.spec.ts` | `AUTH-07` Deep link `/my-bookings`; khách với `from=/owner/*` về `/` | **PASS** | 1.98s |
| 17 | `10-auth.spec.ts` | `AUTH-08` Thu hồi phiên realtime khi Chủ sân khóa nhân viên | **PASS** | 3.88s |
| 18 | `10-auth.spec.ts` | `AUTH-02` Sai mật khẩu 5 lần → `423 ACCOUNT_TEMP_LOCKED` | **PASS** | 53.51s |
| 19 | `20-customer-booking.spec.ts` | `CUS-01` FULL + webhook đúng → Payment tự chuyển thành công | **PASS** | 2.58s |
| 20 | `20-customer-booking.spec.ts` | `CUS-02` Đặt cọc + `SANGVUI20` (`SAN_BD_03`, 09:30–11:00 = 108k cọc) | **PASS** | 2.02s |
| 21 | `20-customer-booking.spec.ts` | `CUS-03` Vắt 2 khung giá `SAN_PB_03` 15:00–17:00 → 400.000 VNĐ | **PASS** | 1.22s |
| 22 | `20-customer-booking.spec.ts` | `CUS-04` Mã KM lỗi qua báo giá hiển thị đúng câu từng `reasonCode` | **PASS** | 3.07s |
| 23 | `20-customer-booking.spec.ts` | `CUS-05` `DEPOSIT_NOT_ALLOWED`: giảm còn dưới cọc → khóa cọc | **PASS** | 1.38s |
| 24 | `20-customer-booking.spec.ts` | `CUS-06` Tổng = 0 → đi thẳng Đã xác nhận / Đã thanh toán | **PASS** | 1.79s |
| 25 | `20-customer-booking.spec.ts` | `CUS-07` Lưới lịch: bảo trì `PB02`, ngừng `BD02`, nghỉ lễ `01/01/2027`, seed | **PASS** | 2.31s |
| 26 | `20-customer-booking.spec.ts` | `CUS-08` Trùng lịch + realtime `slot.updated` & `409 SLOT_TAKEN` | **PASS** | 4.65s |
| 27 | `20-customer-booking.spec.ts` | `CUS-09` Hủy giữ chỗ (`cancel-hold-btn`) → ô trống lại | **PASS** | 2.25s |
| 28 | `20-customer-booking.spec.ts` | `CUS-10` Webhook sai số tiền → Payment vẫn chờ; đối soát `WRONG_AMOUNT` | **PASS** | 3.31s |
| 29 | `20-customer-booking.spec.ts` | `CUS-11` Webhook trùng id gửi 2 lần → 1 phiếu thu, không nhân đôi | **PASS** | 1.78s |
| 30 | `20-customer-booking.spec.ts` | `CUS-12` `recheck-payment-btn` bấm liên tiếp → giới hạn 5 giây | **PASS** | 2.32s |
| 31 | `20-customer-booking.spec.ts` | `CUS-13` Hết hạn giữ chỗ + webhook muộn → `LATE_PAYMENT` | **PASS** | 6.71s |
| 32 | `20-customer-booking.spec.ts` | `CUS-14` Chặn xem đơn người khác → `403 BOOKING_FORBIDDEN` | **PASS** | 1.79s |
| 33 | `20-customer-booking.spec.ts` | `CUS-15` Idempotency: double-click đặt → chỉ tạo 1 đơn | **PASS** | 1.64s |
| 34 | `20-customer-booking.spec.ts` | `CUS-16` Khách vãng lai bấm đặt → đăng nhập → quay lại `/booking` | **PASS** | 1.66s |
| 35 | `30-my-bookings.spec.ts` | `MY-01` Tab trạng thái đơn seed & lọc `from > to` bị chặn | **PASS** | 3.53s |
| 36 | `30-my-bookings.spec.ts` | `MY-02` Hủy FULL ≥ 5 ngày → hoàn 100%, chờ xử lý hoàn tiền | **PASS** | 3.24s |
| 37 | `30-my-bookings.spec.ts` | `MY-03` Hủy đơn cọc chưa tất toán → hoàn 0, cảnh báo giữ cọc | **PASS** | 1.89s |
| 38 | `30-my-bookings.spec.ts` | `MY-04` Hủy 2 ≤ T < 5 ngày (FULL đã trả, D+3) → hoàn 50% | **PASS** | 1.82s |
| 39 | `30-my-bookings.spec.ts` | `MY-05` Lý do hủy bắt buộc & giới hạn 255 ký tự | **PASS** | 1.46s |
| 40 | `30-my-bookings.spec.ts` | `MY-06` Không có nút hủy cho `COMPLETED` / `CANCELED` / `EXPIRED` | **PASS** | 3.00s |
| 41 | `30-my-bookings.spec.ts` | `MY-07` Xung đột phiên bản → `409 BOOKING_STATE_CHANGED` | **PASS** | 5.13s |
| 42 | `30-my-bookings.spec.ts` | `MY-08` Thông báo realtime sau webhook: unread tăng, lọc, đánh dấu đọc | **PASS** | 1.64s |
| 43 | `30-my-bookings.spec.ts` | `MY-09` Chủ sân phát hành KM → khách nhận thông báo `PROMOTION` | **PASS** | 1.65s |
| 44 | `30-my-bookings.spec.ts` | `MY-10` Đóng đơn `BY_FACILITY` → khách nhận thông báo `SCHEDULE_CHANGE` | **PASS** | 3.49s |
| 45 | `40-staff-pos.spec.ts` | `POS-01` Khách vãng lai, tiền mặt 100%: validate → tạo đơn → phiếu thu | **PASS** | 5.63s |
| 46 | `40-staff-pos.spec.ts` | `POS-02` Hội viên + QR cọc + webhook → POS cập nhật realtime | **FAIL** *(`CK_Payments_Collector`)* | 13.07s |
| 47 | `40-staff-pos.spec.ts` | `POS-03` Tất toán → Nhận sân → Kết thúc & Hoàn thành (`shiftBooking`) | **PASS** | 4.27s |
| 48 | `40-staff-pos.spec.ts` | `POS-04` Nhận sân chưa trả đủ → `422 PAYMENT_INCOMPLETE` | **PASS** | 3.54s |
| 49 | `40-staff-pos.spec.ts` | `POS-05` Nhận sân khi sân còn đơn `IN_USE` → `409 COURT_IN_USE` | **PASS** | 5.02s |
| 50 | `40-staff-pos.spec.ts` | `POS-06` `COUNTER_ABORT`: Hủy tạo đơn QR tại quầy → ô trống lại | **PASS** | 2.87s |
| 51 | `40-staff-pos.spec.ts` | `POS-07` `NO_SHOW`: quá sớm bị chặn, DEPOSITED ≥ +30p, PAID ≥ EndAt | **PASS** | 10.81s |
| 52 | `40-staff-pos.spec.ts` | `POS-08` Phạm vi cơ sở: NV CS01 bị `BRANCH_FORBIDDEN` với đơn CS02 | **PASS** | 1.36s |
| 53 | `40-staff-pos.spec.ts` | `POS-09` Thống kê `/staff/stats`: KPI khớp `/dashboard/daily`, drilldown | **PASS** | 1.49s |
| 54 | `40-staff-pos.spec.ts` | `POS-10` Realtime chéo vai trò: khách đặt online → POS đổi bận | **PASS** | 3.14s |
| 55 | `40-staff-pos.spec.ts` | `POS-11` Đối soát tay: Hoàn lại khách, Khớp đơn, Bỏ qua | **PASS** | 2.58s |
| 56 | `40-staff-pos.spec.ts` | `POS-12` Bộ lọc ngày, tìm mã/SĐT và chuyển tab ở `/staff/orders` | **PASS** | 1.89s |
| 57 | `50-owner-admin.spec.ts` | `OWN-01` Nhân viên: trùng SĐT, thêm NV CS02, khóa/mở, đổi cơ sở | **PASS** | 6.33s |
| 58 | `50-owner-admin.spec.ts` | `OWN-02` Sân: validate trùng tên, mô tả > 500, cọc < 10%, hiện trên lưới | **PASS** | 3.22s |
| 59 | `50-owner-admin.spec.ts` | `OWN-03` Bảng giá & snapshot + trùng giờ `PRICE_RULE_OVERLAP` | **PASS** | 4.57s |
| 60 | `50-owner-admin.spec.ts` | `OWN-04` Giờ mở cửa: `open >= close`, thu hẹp cảnh báo `dryRun` | **PASS** | 2.32s |
| 61 | `50-owner-admin.spec.ts` | `OWN-05` Ngày nghỉ: quá khứ, > 60 ngày, trùng đơn `affected`, lưới nghỉ lễ | **PASS** | 3.28s |
| 62 | `50-owner-admin.spec.ts` | `OWN-06` Khóa sân → Chuyển sân giữ mã & tiền, khách nhận thông báo | **PASS** | 4.34s |
| 63 | `50-owner-admin.spec.ts` | `OWN-07` Đóng đơn `BY_FACILITY`: hoàn 100% cọc, loại khỏi doanh thu | **PASS** | 3.62s |
| 64 | `50-owner-admin.spec.ts` | `OWN-08` Khuyến mãi: trùng mã, FIXED, áp dụng, tạm dừng, khóa sửa mã đã dùng | **PASS** | 4.33s |
| 65 | `50-owner-admin.spec.ts` | `OWN-09` Báo cáo doanh thu: lọc, validation kỳ, khớp API, lọc sân | **FAIL** *(F-01)* | 1.92s |
| 66 | `50-owner-admin.spec.ts` | `OWN-10` Hoàn tiền: đánh dấu `COMPLETED` / `FAILED` & lưu sau reload | **PASS** | 3.26s |
| 67 | `50-owner-admin.spec.ts` | `OWN-11` `branch-switcher` Chủ sân đổi dữ liệu `/staff/stats` & `/staff/orders` | **PASS** | 1.79s |
| 68 | `90-cross-cutting.spec.ts` | `X-01` Múi giờ `America/New_York` vẫn hiển thị giờ VN (Bất biến 10) | **PASS** | 3.90s |
| 69 | `90-cross-cutting.spec.ts` | `X-02` Backend lỗi 500 → UI báo lỗi, không trắng trang, thử lại được | **PASS** | 2.46s |
| 70 | `90-cross-cutting.spec.ts` | `X-03` XSS ở tên khách vãng lai & lý do hủy render dạng chữ an toàn | **PASS** | 5.29s |
| 71 | `90-cross-cutting.spec.ts` | `X-04` Responsive mobile `390×844` toàn luồng khách hàng | **PASS** | 2.69s |
| 72 | `90-cross-cutting.spec.ts` | `X-05` Firefox & WebKit smoke check (chưa cài binary trình duyệt) | **SKIP** | — |
| 73 | `90-cross-cutting.spec.ts` | `X-06` Kiểm tra khả năng truy cập semantic DOM (`lang`, `h1`, `alt`, `button`) | **PASS** | 2.26s |
