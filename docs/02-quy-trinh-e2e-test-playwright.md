# QUY TRÌNH & BỘ KIỂM THỬ UI E2E BẰNG PLAYWRIGHT CHO PROTOTYPE SPORTHUB (THEO SRS)

- **Phạm vi kiểm thử:** **100% kiểm thử giao diện Prototype (`app/`)** chạy trực tiếp trên trình duyệt Chromium (không phụ thuộc Backend API hay CSDL).
- **Tài liệu chuẩn hóa:** `Documentation/SRS.docx` (UC 001 – UC 026) & `Documentation/Thiết kế chi tiết (final).docx` (Mục 5.7–5.9).
- **Mã nguồn Playwright:** Thư mục `e2e/` (`playwright.config.ts`, `fixtures/`, `tests/01..05*.spec.ts`).

---

## 1. Chiến lược Kiểm thử UI Prototype 2 tầng

| Chế độ chạy | Lệnh thực thi (`cd e2e`) | Mục đích & Kết quả mong đợi |
| --- | --- | --- |
| **Chế độ 1 — Chạy Kịch bản Hoàn chỉnh (Baseline UI Journeys)** | `npm test` *(hoặc `npm run test:journeys`)* | Chạy **13 kịch bản liên hoàn xuyên suốt đa màn hình & đa vai trò** (`UI-J01` – `UI-J13`) trên prototype hiện tại (**13/13 PASS**), đồng thời báo cáo rõ **28 hạng mục SRS còn thiếu/sai (`SRS-UI-01` – `SRS-UI-28`)** ở trạng thái `fixme`. |
| **Chế độ 2 — Nghiệm thu toàn bộ SRS trên UI (`SRS_FULL=1`)** | `npm run test:srs-audit` | Chạy **TẤT CẢ 41 kịch bản UI** (13 kịch bản hoàn chỉnh + 28 kịch bản nghiệm thu SRS) để kiểm chứng trực tiếp từng nghiệp vụ sau khi sửa giao diện prototype (mục tiêu sau sửa đổi: **41/41 PASS, 0 skipped**). |

---

## 2. Cấu trúc thư mục `e2e/`

```text
e2e/
├── package.json                                 # test, test:journeys, test:srs-audit, test:smoke, test:headed, report
├── playwright.config.ts                         # Tự khởi chạy Vite dev server http://localhost:5173, lưu trace/video/screenshot
├── fixtures/
│   ├── srs.ts                                   # Wrapper `srsUiGap()` bật/tắt bằng cờ SRS_FULL=1
│   ├── auth.fixture.ts                          # Helper đăng nhập / đăng xuất đa vai trò (hỗ trợ giữ SPA state)
│   └── test-data.ts                             # Tài khoản mẫu, ngày demo, mã đơn seed, mã khuyến mãi
└── tests/
    ├── 01-auth-rbac-ui.spec.ts                  # UI-J01..J04: Đăng nhập/Đăng xuất 3 vai trò, lỗi, đăng ký, kế thừa RBAC
    ├── 02-customer-complete-journey.spec.ts     # UI-J05..J07: Hành trình hoàn chỉnh Khách hàng (Home -> Đặt -> KM -> QR -> Lịch -> Hủy)
    ├── 03-staff-pos-complete-journey.spec.ts    # UI-J08..J10: Hành trình hoàn chỉnh Nhân viên POS (Quầy -> Tất toán -> Bàn giao -> Dashboard)
    ├── 04-owner-admin-complete-journey.spec.ts  # UI-J11..J13: Hành trình hoàn chỉnh Chủ sân liên thông đa vai trò (NV -> Sân -> Bảo trì/Nghỉ lễ -> KM -> Báo cáo)
    └── 05-srs-ui-compliance-gaps.spec.ts        # SRS-UI-01..28: 28 kịch bản nghiệm thu nghiệp vụ SRS còn thiếu/sai trên UI (UI-01..UI-34)
```

---

## 3. Danh mục 13 Kịch bản UI Hoàn chỉnh (Chạy trực tiếp trên Prototype)

| ID | Tệp spec | Kịch bản E2E hoàn chỉnh xuyên màn hình | UC bao phủ |
| --- | --- | --- | --- |
| `UI-J01` | `01-auth-rbac-ui` | Đăng nhập & Đăng xuất lần lượt cả 3 vai trò (Khách hàng → Nhân viên → Chủ sân), xác nhận điều hướng & menu đúng quyền | UC 001, UC 002 |
| `UI-J02` | `01-auth-rbac-ui` | Kiểm tra toàn bộ lỗi đăng nhập: bỏ trống, mật khẩu < 6 ký tự, sai mật khẩu NV/Chủ sân, tài khoản NV bị khóa (`0911223344`) | UC 001 |
| `UI-J03` | `01-auth-rbac-ui` | Luồng Đăng ký hội viên mới: bắt lỗi SĐT sai 10 số, mật khẩu nhập lại không khớp → đăng ký hợp lệ vào giao diện khách | UC 003 |
| `UI-J04` | `01-auth-rbac-ui` | Kiểm soát kế thừa & chặn truy cập trái phép: chưa đăng nhập bị đẩy về `/login`, Khách bị chặn `/staff/*` & `/owner/*`, NV vào được `/` nhưng bị chặn `/owner/*`, Chủ sân vào đủ 3 tầng | RBAC |
| `UI-J05` | `02-customer-complete-journey` | **Hành trình Khách hàng trọn vẹn:** Trang chủ tìm sân → kiểm thử mã KM lỗi → áp `SANGVUI20` (-20%) → Đặt cọc 30% → màn Thanh toán QR (mã QR, STK, nội dung `THANHTOAN`, đếm ngược) → xác nhận thanh toán → thấy đơn `Đã xác nhận` ở `/my-bookings` → Hủy đơn kèm lý do → chuyển `Đã hủy` & khung giờ mở trống lại trên `/booking` | UC 004, 005, 006, 007, 008, 009 |
| `UI-J06` | `02-customer-complete-journey` | Đặt sân thanh toán 100% → bấm *"Đổi khung giờ khác"* giải phóng chỗ tạm → đặt lại, áp `TRIAN10` & hoàn tất thanh toán đủ 100% | UC 004, 005, 008 |
| `UI-J07` | `02-customer-complete-journey` | Dùng mã từ thẻ Trang chủ, kiểm tra sân bảo trì (`SAN_PK_02`), ngày nghỉ lễ (`25/12/2026`), lọc tab Lịch đặt & nút *"Đặt lại sân này →"* | UC 004, 006 |
| `UI-J08` | `03-staff-pos-complete-journey` | **Hành trình Nhân viên POS (Khách vãng lai):** Kiểm tra lỗi thiếu tên/SĐT → tạo đơn thu Tiền mặt 100% → kiểm tra Phiếu thu gần nhất → sang `/staff/orders` tìm đơn → *"Nhận sân ngay"* (`Đang sử dụng`) → *"Kết thúc & Hoàn thành"* (`Hoàn thành`) → đối chiếu Dashboard `/staff/stats` | UC 010, 011, 014, 015 |
| `UI-J09` | `03-staff-pos-complete-journey` | **Hành trình Nhân viên POS (Hội viên đặt cọc & Tất toán):** Tra cứu SĐT lạ & SĐT hội viên (`0987654321`) → tạo đơn thu cọc VietQR → sang `/staff/orders` thu tất toán phần còn thiếu & bàn giao `Đang sử dụng` → xác nhận thẻ sân hiển thị `Đang sử dụng` trên `/staff/stats` | UC 007, 010, 012, 013, 014, 015 |
| `UI-J10` | `03-staff-pos-complete-journey` | Nhân viên lọc tab `Quá giờ nhận sân`, hủy đơn `BK2026111005` kèm ghi chú, giữ cọc 180.000đ và mở trống lại sân | UC 009 |
| `UI-J11` | `04-owner-admin-complete-journey` | **Hành trình Chủ sân liên thông Nhân sự:** Chặn trùng SĐT → thêm NV mới (`0955667788`, Cơ sở 2) → Khóa TK → Đăng xuất Chủ sân & thử đăng nhập TK vừa khóa bị chặn → Đăng nhập Chủ sân mở khóa → NV mới đăng nhập thành công vào đúng Cơ sở 2 | UC 001, UC 016 |
| `UI-J12` | `04-owner-admin-complete-journey` | **Hành trình Chủ sân liên thông Sân bãi:** Chặn trùng tên sân → thêm `Sân Pickleball VIP 09` → mở lại `SAN_PK_02` & khóa bảo trì `SAN_PK_03` → thêm ngày nghỉ `20/11/2026` → sang giao diện Khách kiểm chứng cả 3 thay đổi có hiệu lực ngay | UC 017, 019, 020 |
| `UI-J13` | `04-owner-admin-complete-journey` | **Hành trình Chủ sân liên thông Khuyến mãi & Báo cáo:** Kiểm tra chặn lọc báo cáo `Từ ngày > Đến ngày` → chặn trùng mã → phát hành mã mới `CUOITUAN15` (-15%) → Tạm dừng / Chạy lại → sang giao diện Khách áp dụng thành công chính mã `CUOITUAN15` vừa tạo | UC 008, 022, 023 |

---

## 4. Danh mục 28 Kịch bản Nghiệm thu SRS còn thiếu trên Prototype (`05-srs-ui-compliance-gaps.spec.ts`)

Bao phủ trọn vẹn toàn bộ 34 hạng mục `UI-01` – `UI-34` trong `docs/01-bao-cao-ra-soat-srs.md`:
- **Auth & Trang chủ (`SRS-UI-01` – `06`):** Mật khẩu ẩn mặc định, xác thực khách hàng thực, khóa tạm 5 lần/5 phút, đăng ký bắt buộc Email & chống trùng, Trang chủ mở cho Guest, ẩn mã tạm dừng & avatar động.
- **Đặt sân & Thanh toán (`SRS-UI-07` – `12`):** Mặc định Thanh toán 100%, khung giờ động có `10:00–14:00`, cảnh báo không hoàn cọc, cọc 50% không bị hardcode 30% & bảo lưu cọc cũ, hoàn lượt mã khi hủy giữ chỗ, chặn xem `/payment/:id` của người khác.
- **Lịch đặt, Hoàn tiền & Thông báo (`SRS-UI-13` – `16`):** Đủ 7 tab trạng thái & validate `from <= to`, chính sách hoàn tiền bậc thang 100%/50%/0%, ô nhập *"Lý do khác"* & chặn khách hủy đơn `playing`/`overdue`, Trung tâm thông báo động nhận thông báo từ khuyến mãi mới.
- **Nhân viên POS (`SRS-UI-17` – `21`):** Đồng bộ khung giờ quầy & online, hiển thị mã VietQR động khi tất toán, chặn nhận sân trùng sân đang `playing`, bộ lọc ngày & Phân loại hủy (chặn no-show sớm), bộ lọc chi nhánh & click KPI drill-down cho Chủ sân trên `/staff/stats`.
- **Quản trị Chủ sân & Bổ sung (`SRS-UI-22` – `28`):** Mô tả sân + min cọc 10% + chặn đổi cơ sở khi còn đơn, chặn `open >= close` + lịch tuần & khoảng ngày nghỉ, chế độ Ngừng khai thác + cảnh báo đơn bị ảnh hưởng + **UC 021 Chuyển sân / Đóng đơn do cơ sở**, khuyến mãi hiện mã quầy + loại giảm VNĐ + nút Xóa/Ngừng áp dụng, Báo cáo tính động từ dữ liệu thật + lọc & bảng theo từng sân + thông báo kỳ trống, tìm kiếm/confirm/giao dịch thực nhân viên, màn hình Đối soát giao dịch & Hoàn tiền (`/owner/reconciliation`).

---

## 5. Quy ước `data-testid` chuẩn hóa cho quá trình sửa Prototype

- **Auth / Header:** `nav-unread-count`, `branch-switcher`
- **My Bookings & Cancel:** `cancel-refund-rate`, `cancel-refund-amount`, `cancel-reason-custom`, `notif-filter-type`, `notif-filter-read`
- **Staff POS & Orders:** `orders-date-filter`, `settle-qr-image`, `settle-qr-amount`, `cancel-category-customer`, `cancel-category-noshow`, `affected-orders-tab`, `kpi-pending-orders`, `kpi-drilldown-modal`
- **Owner:** `staff-search`, `court-desc`, `court-deposit`, `lock-mode-temp`, `lock-mode-stop`, `affected-warning-list`, `reassign-btn-<id>`, `reassign-target-court`, `promo-discount-type`, `promo-card-<code>`, `promo-delete-<code>`, `report-court-filter`, `report-by-court-table`
