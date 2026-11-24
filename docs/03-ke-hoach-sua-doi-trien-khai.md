# Kế Hoạch Sửa Đổi Giao Diện Prototype SportHub Đáp Ứng 100% Nghiệp Vụ SRS

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp toàn diện giao diện Prototype React (`app/`) — chưa cần Backend — để đáp ứng **100% các nghiệp vụ, ràng buộc dữ liệu, luồng trạng thái, công thức tính toán và thành phần bổ sung** trong `docs/SRS.md` và `docs/SDD.md`, đồng thời đạt **100% PASS trên toàn bộ bộ kiểm thử UI Playwright (`e2e/`)** và **0 cảnh báo `oxlint`**.

**Architecture:** Giữ nguyên kiến trúc 11 màn hình chuẩn Figma + bổ sung các modal/tab/view theo Mục 5.9 của `docs/SDD.md`. Chuẩn hóa lớp dữ liệu mô phỏng client-side trong `app/src/store.tsx` (lưu bền vững vào `localStorage` kèm nút/hàm reset demo để giữ trạng thái qua điều hướng và reload), tách các hàm nghiệp vụ thuần (`domain/affected.ts`, `domain/pricing.ts`, `domain/refund.ts`, `domain/slots.ts`, `domain/reports.ts`) để sau này thay bằng API Backend mà không phải viết lại giao diện.

**Tech Stack:** React 19.3, TypeScript 7, React Router 7, Vite 8, CSS thuần (Figma design tokens trong `app/src/index.css`), `oxlint`, Playwright UI E2E (`e2e/`).

---

## Global Constraints (Bắt buộc tuân thủ trong mọi Task — từ `docs/SRS.md` & `docs/SDD.md`)

1. **Phạm vi Prototype (No Backend):** Mọi dữ liệu (`users`, `branches`, `openingHours`, `holidays`, `courts`, `locks`, `promos`, `bookings`, `transactions`, `reconciliations`, `notifications`, `reassignLogs`) được quản lý đồng bộ qua `AppProvider` (`app/src/store.tsx`) và đồng bộ `localStorage` (có tiện ích reset dữ liệu mẫu).
2. **Vòng đời đơn 6 trạng thái:** `pending` (*Chờ thanh toán*), `confirmed` (*Đã xác nhận*), `playing` (*Đang sử dụng*), `completed` (*Hoàn thành*), `cancelled` (*Đã hủy*), `expired` (*Quá hạn thanh toán*).
3. **Bảo lưu giá & tiền cọc (UC 018):** Mỗi `Booking` lưu cố định `unitPriceSnap`, `depositAmount`, `total` lúc tạo; chỉnh sửa bảng giá hoặc mức cọc sân không làm thay đổi các đơn cũ (kể cả đơn đang ở `/payment/:id`).
4. **Chính sách hoàn tiền bậc thang (FR 12 / UC 009 / D1):** Tiền đặt cọc **KHÔNG bao giờ hoàn lại**. Phần tiền đã trả *vượt quá tiền cọc* (`max(0, paid - depositAmount)`) được hoàn: `>= 5 ngày` hoàn **100%**, `2 đến <5 ngày` hoàn **50%**, `< 2 ngày` hoặc no-show hoàn **0%**. Đơn hoàn tiền `> 0` sinh bản ghi `Refund` trạng thái `PENDING`.
5. **Đơn đóng do cơ sở (UC 021):** `cancelCategory = 'FACILITY'`, giữ nguyên đánh dấu cần hoàn trả ngoài hệ thống và **loại trừ khỏi Doanh thu thực thu**.
6. **Quy tắc kiểm tra dữ liệu gốc:** SĐT `^0\d{9}$`; Họ tên `^[\p{L}\s]{2,100}$`; Email bắt buộc khi đăng ký khách hàng; Mật khẩu `^\S{6,32}$`; Sai mật khẩu 5 lần liên tiếp tạm khóa 5 phút (`D9`); Tỷ lệ cọc `10%–100%` hoặc tiền cố định `> 0`; `open < close`; Tên khuyến mãi `5–150` ký tự, mã `^[A-Z0-9]{4,20}$`.
7. **Mặc định đặt sân (D6):** Hình thức thanh toán mặc định trên `/booking` là **`Thanh toán đủ 100%` (`full`)**; thời hạn giữ chỗ `10 phút` (`D2`); ngưỡng no-show `30 phút` (`D3`).
8. **Chuẩn `data-testid`:** Gắn đầy đủ `data-testid` theo `docs/02-quy-trinh-e2e-test-playwright.md` để mọi kịch bản Playwright chạy ổn định.

---

## Bản đồ cấu trúc tệp tin (`d:\Jobs\Sports\app\src\`)

- **Create:** `src/domain/slots.ts` — Sinh khung giờ động theo giờ mở cửa Thứ 2–CN & tính đơn giá nhiều khung giờ
- **Create:** `src/domain/pricing.ts` — Tính tiền thuê sân, khuyến mãi, tiền cọc theo từng khung giờ
- **Create:** `src/domain/affected.ts` — Quét đơn đặt sân bị ảnh hưởng khi khóa sân / đổi giờ / thêm ngày nghỉ (UC 021)
- **Create:** `src/domain/refund.ts` — Tính tỷ lệ/số tiền hoàn bậc thang 5 ngày / 2 ngày & kiểm tra điều kiện hủy
- **Create:** `src/domain/reports.ts` — Tính động Dashboard ngày (UC 015) & Báo cáo doanh thu theo chi nhánh/từng sân (UC 023) từ dữ liệu thật trong store
- **Create:** `src/appContext.ts` — Tách React Context & hook `useApp` khỏi `store.tsx`
- **Create:** `src/utils/format.ts` — Tách hàm format tiền, ngày, `initials`, `homeOf` (xử lý cảnh báo `oxlint`)
- **Create:** `src/components/AffectedBookingsModal.tsx` — Xử lý UC 021 (*Chuyển sân / Đổi giờ* & *Đóng đơn do cơ sở*)
- **Create:** `src/components/BookingDetailModal.tsx` — Modal chi tiết đơn đặt sân (UC 006 Bước 3, Mục 5.9)
- **Create:** `src/components/NotificationInbox.tsx` — Trung tâm Thông báo động (UC 026: lọc loại/đọc, đánh dấu đã đọc, deep-link kiểm tra mã hết hạn)
- **Create:** `src/components/VietQrBox.tsx` — Component VietQR dùng chung cho màn 04 (`/payment/:id`), màn 06 (POS quầy) và màn 07 (Tất toán QR)
- **Create:** `src/pages/Reconciliation.tsx` — Màn hình bổ sung Đối soát giao dịch & Hoàn tiền chờ xử lý (`/owner/reconciliation`, Mục 5.9)
- **Modify:** `src/data.ts`, `src/store.tsx`, `src/App.tsx`, `src/layouts.tsx`, và các trang liên quan trong `src/pages/*.tsx` (12 màn hình)

---

## Lộ trình sửa đổi 5 Phase (12 Tasks)

### PHASE 1: CHUẨN HÓA MÔ HÌNH DỮ LIỆU & LUẬT NGHIỆP VỤ CỐT LÕI (`data.ts`, `store.tsx`, `domain/*`)

#### Task 1: Mở rộng mô hình dữ liệu & tách hàm nghiệp vụ thuần (`slots.ts`, `refund.ts`, `reports.ts`, `format.ts`)

**Files:**
- Create: `app/src/domain/slots.ts`
- Create: `app/src/domain/refund.ts`
- Create: `app/src/domain/reports.ts`
- Create: `app/src/utils/format.ts`
- Modify: `app/src/data.ts`

**Interfaces:**
- Produces:
  - Mở rộng `Branch` thêm `bankName`, `bankAccNo`, `bankAccName`, `openingHours: Record<0|1|2|3|4|5|6, { open: string; close: string; closed: boolean }>`.
  - Mở rộng `Court` thêm `description: string`, `depositType: 'percent' | 'fixed'`, `priceRules: { label: string; start: string; end: string; price: number }[]`.
  - Mở rộng `Booking` thêm `status: ... | 'expired'`, `depositAmount: number`, `unitPriceSnap: number`, `checkedInAt?`, `completedAt?`, `isAffected?`, `cancelCategory?: 'customer' | 'noshow' | 'facility'`, `refundRate?`, `refundAmount?`.
  - Bổ sung kiểu `CustomerAccount`, `PaymentTx`, `ReconciliationItem`, `NotificationItem`, `ReassignLog`, `Lock` (thêm `mode: 'temp' | 'stop'`), `Holiday` (thêm `branchId?: string`, `endDate: string`), `Promo` (thêm `discountType: 'percent' | 'fixed'`, `fixedOff?`, `targetAudience: 'all' | 'specific'`, `targetPhones?`, `status: 'active' | 'paused' | 'discontinued'`).
  - Hàm thuần `generateSlots(open, close, blockMins)`, `calculateRefund(...)`, `computeDailyStats(...)`, `computeRevenueReport(...)`.

- [ ] **Step 1: Cài đặt `app/src/domain/refund.ts`**

```ts
export function calculateRefund(params: {
  playDate: string
  playStart: string
  nowIso: string
  paid: number
  depositAmount: number
  category: 'customer' | 'noshow' | 'facility'
}) {
  if (params.category === 'facility') {
    return { rate: 100, refund: params.paid, kept: 0 }
  }
  if (params.paid <= 0) return { rate: 0, refund: 0, kept: 0 }
  if (params.category === 'noshow') return { rate: 0, refund: 0, kept: params.paid }

  const playMs = new Date(`${params.playDate}T${params.playStart}:00`).getTime()
  const nowMs = new Date(params.nowIso).getTime()
  const diffDays = (playMs - nowMs) / 86_400_000
  const nonDepositPaid = Math.max(0, params.paid - params.depositAmount)
  const rate = diffDays >= 5 ? 100 : diffDays >= 2 ? 50 : 0
  const refund = Math.round((nonDepositPaid * rate) / 100)
  return { rate, refund, kept: params.paid - refund }
}
```

- [ ] **Step 2: Cài đặt `app/src/domain/slots.ts` sinh khung giờ động theo giờ mở cửa từng thứ (bao phủ cả 10:00–14:00, dùng chung cho Online & Quầy)**

- [ ] **Step 3: Cài đặt `app/src/domain/reports.ts` tính động toàn bộ KPI Dashboard ngày và Báo cáo doanh thu theo chi nhánh & từng sân từ `bookings` và `transactions`**

- [ ] **Step 4: Cập nhật `app/src/data.ts` và tách `app/src/utils/format.ts`; chạy `npm run build` trong `app/` xác minh 0 lỗi TypeScript**

---

#### Task 2: Nâng cấp `app/src/store.tsx` — State đầy đủ SRS + Lưu bền vững `localStorage`

**Files:**
- Modify: `app/src/store.tsx`

**Interfaces:**
- Consumes: `domain/refund.ts`, `domain/slots.ts`, `data.ts`.
- Produces:
  - Quản lý `customers[]` (gồm seed + hội viên đăng ký mới), bộ đếm `failedLogins` (khóa tạm 5 phút sau 5 lần sai), `transactions[]`, `notifications[]`, `reconciliations[]`, `reassignLogs[]`.
  - `confirmPayment(id, method, staffId?)` dùng đúng `b.depositAmount` đã snapshot (xóa bỏ hardcode `0.3`), ghi `PaymentTx`, đẩy thông báo `PAYMENT` cho khách hàng.
  - Timer hết hạn giữ chỗ chuyển `status: 'expired'` (*Quá hạn thanh toán*) và hoàn lại `p.used - 1` cho mã khuyến mãi.
  - `cancelBooking(id, { reason, category })` tính hoàn tiền theo `calculateRefund`, hoàn lại lượt mã nếu `paid === 0`, tạo mục chờ hoàn tiền nếu `refund > 0`.
  - `scanAffectedBookings(...)`, `reassignAffectedBooking(...)`, `closeBookingByFacility(...)` cho UC 021.
  - Lưu & khôi phục state từ `localStorage('sporthub.state.v2')` để điều hướng/reload không mất dữ liệu trong quá trình test UI (kèm `window.__SPORTHUB_RESET__` hoặc nút *"Khôi phục dữ liệu mẫu"*).

- [ ] **Step 1: Viết lại `AppProvider` trong `app/src/store.tsx` với đầy đủ action trên và sửa cảnh báo `oxlint` `useNow()` (`useState(() => Date.now())`)**
- [ ] **Step 2: Chạy `npm run build` trong `app/` xác minh 0 lỗi**

---

### PHASE 2: XÁC THỰC, PHÂN QUYỀN & TRANG CHỦ CÔNG KHAI (`UI-01` – `UI-08`)

#### Task 3: Sửa `Login.tsx`, mở Guest Trang chủ (`/`) và sửa `layouts.tsx`

**Files:**
- Modify: `app/src/pages/Login.tsx`
- Modify: `app/src/App.tsx`
- Modify: `app/src/layouts.tsx`

- [ ] **Step 1: Cập nhật `Login.tsx`**:
  - Mặc định `show = false` (ô mật khẩu là `type="password"`).
  - Form đăng nhập tự nhận diện vai trò từ tài khoản khớp trong `customers` / `staff` / `owner`; khối *"Tài khoản đăng nhập nhanh"* chỉ auto-fill SĐT + mật khẩu demo.
  - Hiển thị lỗi khóa tạm 5 phút sau 5 lần sai (`UC 001 Alt 2b`) và lỗi tài khoản bị khóa (`Alt 2c`).
  - Form đăng ký: bắt buộc Email, kiểm tra Họ tên `^[\p{L}\s]{2,100}$`, SĐT `^0\d{9}$`, MK `^\S{6,32}$`, kiểm tra trùng SĐT/Email trên toàn hệ thống, hiển thị toast *"Đăng ký tài khoản thành công"* và chuyển `/booking`.
  - Nút *"← Quay lại Trang chủ"* điều hướng về `/`.
- [ ] **Step 2: Cập nhật `App.tsx` & `layouts.tsx`**:
  - Mở `/` công khai trong `<CustomerLayout />` (khi chưa đăng nhập hiển thị nút *"Đăng nhập"* và *"Đăng ký"* thay cho khối avatar).
  - Sửa avatar dùng `initials(user.name)` (`UI-08`); chuông header hiển thị badge số lượng thông báo chưa đọc thực (`data-testid="nav-unread-count"`).
  - Bật dropdown chọn chi nhánh (`data-testid="branch-switcher"`) trên topbar `StaffLayout` cho vai trò Chủ sân ở mọi route `/staff/*` và `/owner/*` (`UI-23`, `UI-28`).
- [ ] **Step 3: Chạy Playwright kiểm chứng nhóm Auth & Home (`$env:SRS_FULL="1"; npx playwright test --grep "@uc-001|@uc-002|@uc-003|@home"`)**

---

#### Task 4: Nâng cấp `Home.tsx` với dữ liệu cụm sân & ưu đãi động

**Files:**
- Modify: `app/src/pages/Home.tsx`

- [ ] **Step 1: Tính số khung giờ trống từng cụm sân động từ `courts`, `bookings`, `locks`, `holidays` (bỏ mảng `CLUSTERS` có `free` cứng)**
- [ ] **Step 2: Lọc chỉ hiển thị mã khuyến mãi `status === 'active' && !counterOnly`; sửa tiêu đề thẻ ưu đãi không hardcode `p.percent === 10`**

---

### PHASE 3: ĐẶT SÂN ĐỘNG, VIETQR, LỊCH ĐẶT, HOÀN TIỀN 5D/2D & THÔNG BÁO (`UI-09` – `UI-20`)

#### Task 5: Nâng cấp `Booking.tsx` — Khung giờ động, mặc định 100%, cảnh báo cọc & khuyến mãi đủ loại

**Files:**
- Modify: `app/src/pages/Booking.tsx`

- [ ] **Step 1: Thay `ONLINE_SLOTS` tĩnh bằng `generateSlots()` theo giờ hoạt động của chi nhánh & thứ của ngày đã chọn; hỗ trợ đọc query param `frame` để highlight khung giờ**
- [ ] **Step 2: Đổi mặc định `payMode` sang `'full'` (Thanh toán đủ 100%); thêm dòng cảnh báo *"Tiền cọc không được hoàn lại nếu hủy đơn hoặc không đến nhận sân đúng giờ"* khi chọn cọc; xử lý sân có `deposit === 100%` (UC 007 `Alt 1a`)**
- [ ] **Step 3: Lọc quick chip mã giảm giá theo `status === 'active'`, hỗ trợ mã giảm `VNĐ` và đối tượng khách hàng; hiển thị *"Không còn khung giờ trống, vui lòng chọn ngày hoặc sân khác"* khi kín lịch; bỏ mutation biến vòng lặp trong JSX (dọn cảnh báo `oxlint`)**

---

#### Task 6: Nâng cấp `Payment.tsx` & Component `VietQrBox.tsx`

**Files:**
- Create: `app/src/components/VietQrBox.tsx`
- Modify: `app/src/pages/Payment.tsx`

- [ ] **Step 1: Xây `VietQrBox.tsx` hiển thị STK/Ngân hàng theo từng `Branch`, nút sao chép STK, số tiền từ `b.depositAmount` / `b.total` đã snapshot (`data-testid="qr-amount"`), nội dung `THANHTOAN <Mã đơn>` (`data-testid="qr-content"`)**
- [ ] **Step 2: Cập nhật `Payment.tsx`**:
  - Kiểm tra chủ sở hữu đơn (`b.phone === user.phone || user.role !== 'customer'`) → chặn xem/trả đơn của khách khác (`UI-15`).
  - Xử lý riêng trạng thái `expired` (*Đơn đã quá hạn thanh toán*) và màn hình **Biên nhận sau thanh toán thành công**.
  - Thêm nút mô phỏng *"Mô phỏng chuyển sai số tiền (Đối soát)"* (hoặc kiểm tra giao dịch chưa về) để kiểm thử được cả luồng `Alt 2c` trên prototype!

---

#### Task 7: Nâng cấp `MyBookings.tsx`, `BookingDetailModal.tsx` & `NotificationInbox.tsx`

**Files:**
- Create: `app/src/components/BookingDetailModal.tsx`
- Create: `app/src/components/NotificationInbox.tsx`
- Modify: `app/src/pages/MyBookings.tsx`

- [ ] **Step 1: Thêm đủ 7 tab lọc trạng thái (`Tất cả`, `Chờ thanh toán`, `Đã xác nhận`, `Đang sử dụng`, `Hoàn thành`, `Quá hạn thanh toán`, `Đã hủy`), validate `from <= to` báo *"Khoảng thời gian tra cứu không hợp lệ"* giữ nguyên danh sách, thông báo trống *"Bạn chưa có lịch đặt sân nào"***
- [ ] **Step 2: Ẩn hoàn toàn nút Hủy cho `playing`, `overdue`, `completed`, `expired`, `cancelled`; nâng cấp modal hủy hiển thị `data-testid="cancel-refund-rate"`, `cancel-refund-amount`, cảnh báo mốc `< 2 ngày` / không hoàn cọc, ô nhập tự do `cancel-reason-custom` khi chọn *"Lý do khác"* (<= 255 ký tự)**
- [ ] **Step 3: Tích hợp `BookingDetailModal` và `NotificationInbox` thực (lọc loại `notif-filter-type`, lọc đã đọc `notif-filter-read`, đánh dấu đã đọc giảm số badge trên chuông, deep-link kiểm tra mã hết hạn báo *"Chương trình ưu đãi đã kết thúc"*)**

---

### PHASE 4: QUẦY POS ĐỒNG BỘ, TẤT TOÁN QR, BÀN GIAO & DASHBOARD (`UI-21` – `UI-28`)

#### Task 8: Nâng cấp `StaffBooking.tsx` — Đồng bộ khung giờ, tra cứu hội viên thực & QR động tại quầy

**Files:**
- Modify: `app/src/pages/StaffBooking.tsx`

- [ ] **Step 1: Dùng `generateSlots()` đồng bộ hoàn toàn với `/booking`; đọc `branchFilter` từ outlet context khi Chủ sân thao tác; bỏ hardcode `promoCode = 'QUAYCG15'` cho mọi cơ sở**
- [ ] **Step 2: Tra cứu hội viên từ `customers[]` trong store (thấy ngay hội viên vừa đăng ký ở `/login`), kiểm tra định dạng SĐT 10 số khi bấm *Tra cứu* (`Alt 2c`), không gán nhầm `member = true` khi không tìm thấy**
- [ ] **Step 3: Khi chọn `Quét mã VietQR`, mở luồng chờ thanh toán QR dùng `VietQrBox` với nội dung `THANHTOAN <Mã đơn>`, có nút *"Kiểm tra lại giao dịch"*, *"Tạo lại mã QR"*, *"Chuyển thu tiền mặt"*, *"Hủy tạo đơn"*; lưu giao dịch vào `transactions[]` (bỏ `Math.random()` để hết cảnh báo `oxlint`)**

---

#### Task 9: Nâng cấp `StaffOrders.tsx` & `StaffStats.tsx`

**Files:**
- Modify: `app/src/pages/StaffOrders.tsx`
- Modify: `app/src/pages/StaffStats.tsx`

- [ ] **Step 1: Nâng cấp `StaffOrders.tsx`**:
  - Thêm bộ chọn ngày (`data-testid="orders-date-filter"`), tab `Đơn bị ảnh hưởng` (`data-testid="affected-orders-tab"`), tab `Chờ thanh toán`, `Hoàn thành`, `Đã hủy`, `Quá hạn thanh toán`.
  - Panel Tất toán: khi chọn **📱 Quét QR**, hiển thị `VietQrBox` (`data-testid="settle-qr-image"`, `settle-qr-amount`) đúng số tiền còn thiếu; lưu giao dịch `SETTLEMENT` độc lập.
  - Chặn *"Nhận sân"* nếu sân hiện tại đang có đơn `playing` (`UC 014 Alt 2c`); ghi nhận thời điểm `checkedInAt` / `completedAt`.
  - Panel Hủy đơn: thêm radio bắt buộc **Phân loại hủy** (`cancel-category-customer` vs `cancel-category-noshow`), chặn chọn no-show khi chưa quá 30 phút (`Alt 2c`), hiển thị tính toán hoàn tiền bậc thang.
- [ ] **Step 2: Nâng cấp `StaffStats.tsx`**:
  - Dùng `computeDailyStats()` (Chủ sân lọc được theo chi nhánh hoặc toàn hệ thống; tổng `QR + Tiền mặt === Doanh thu thực thu`).
  - Cho phép click vào 4 thẻ KPI mở modal danh sách đơn tương ứng (`data-testid="kpi-drilldown-modal"`).
  - Truyền query `?bookingId=` / `?courtId=` khi bấm các nút điều hướng nhanh.

---

### PHASE 5: QUẢN TRỊ CHỦ SÂN ĐẦY ĐỦ, UC 021, BÁO CÁO THỰC & ĐỐI SOÁT (`UI-29` – `UI-34`)

#### Task 10: Nâng cấp `OwnerStaff.tsx`, `OwnerCourts.tsx` & xây `AffectedBookingsModal.tsx` (UC 016 – UC 021)

**Files:**
- Create: `app/src/components/AffectedBookingsModal.tsx`
- Modify: `app/src/pages/OwnerStaff.tsx`
- Modify: `app/src/pages/OwnerCourts.tsx`

- [ ] **Step 1: Nâng cấp `OwnerStaff.tsx`**: thêm thanh tìm kiếm (`staff-search`) + lọc trạng thái, cho phép sửa cả NV đang khóa, kiểm tra trùng SĐT/Email toàn hệ thống, tính số đơn & tổng thu thực tế từ `transactions[]` kèm modal xem danh sách giao dịch chi tiết, thêm hộp thoại xác nhận khi khóa.
- [ ] **Step 2: Nâng cấp `OwnerCourts.tsx` (3 tab)**:
  - **Tab 1:** Thêm `<textarea data-testid="court-desc" />`, kiểm tra cọc `10%–100%` (hoặc cố định `> 0`) tại `data-testid="court-deposit"`, bảng giá nhiều dòng khung giờ không chồng chéo, **chặn đổi chi nhánh khi còn đơn tương lai `pending`/`confirmed`** (`UC 018 Alt 2b`).
  - **Tab 2:** Bảng giờ mở/đóng cửa Thứ 2–Chủ nhật kèm kiểm tra `open < close` (`Alt 2a`); lịch nghỉ theo khoảng `Từ ngày – Đến ngày` & chi nhánh (`Alt 2c`); quét & cảnh báo danh sách đơn bị ảnh hưởng (`data-testid="affected-warning-list"`) trước khi lưu.
  - **Tab 3:** Radio `Tạm khóa bảo trì` (`lock-mode-temp`) / `Ngừng khai thác` (`lock-mode-stop`), bắt buộc lý do, quét & hiển thị đơn bị ảnh hưởng, tích hợp `AffectedBookingsModal` cho **UC 021** (*Chuyển sân / Đổi giờ* giữ nguyên mã & tiền + đẩy thông báo khách; *Đóng đơn do cơ sở* không tính vào doanh thu thực thu).

---

#### Task 11: Nâng cấp `OwnerReports.tsx` (Báo cáo thực + Khuyến mãi đủ SRS) & bổ sung `Reconciliation.tsx`

**Files:**
- Create: `app/src/pages/Reconciliation.tsx`
- Modify: `app/src/pages/OwnerReports.tsx`
- Modify: `app/src/App.tsx`, `app/src/layouts.tsx`

- [ ] **Step 1: Tái cấu trúc phần Báo cáo trong `OwnerReports.tsx`**:
  - Xóa 100% hằng số cứng `REPORT`, gọi `computeRevenueReport()` từ `bookings` & `transactions` trong store (tạo/hoàn thành/hủy/đóng đơn do cơ sở cập nhật báo cáo tức thì!).
  - Thêm bộ lọc theo **từng sân** (`data-testid="report-court-filter"`), bảng tổng hợp theo chi nhánh (đếm số sân thực) và **bảng so sánh chi tiết theo từng sân** (`data-testid="report-by-court-table"`), thông báo *"Không có dữ liệu phát sinh trong khoảng thời gian đã chọn"* khi kỳ trống (`Alt 2a`).
- [ ] **Step 2: Nâng cấp phần Quản lý Khuyến mãi trong `OwnerReports.tsx` (UC 022)**:
  - Hiển thị cả mã tại quầy (`QUAYCG15`) lẫn mã online.
  - Thêm chọn loại giảm `%` / `VNĐ` (`promo-discount-type`), phạm vi loại sân, đối tượng áp dụng (`Tất cả` / `Chỉ định`), khung giờ tùy chỉnh, nút **Xóa** (`promo-delete-<code>`: `used === 0` xóa hẳn / `used > 0` chuyển `Ngừng áp dụng`), validate tên `5–150` & mã `4–20`, mở sửa mã khi `used === 0`, đẩy thông báo thực vào `notifications[]` khi tích gửi thông báo.
- [ ] **Step 3: Thêm màn hình bổ sung `/owner/reconciliation` (`Reconciliation.tsx`, Mục 5.9)** hiển thị 2 tab: *Giao dịch cần đối soát* (UC 005/012/025) và *Khoản hoàn tiền chờ xử lý* (UC 009).

---

#### Task 12: Dọn sạch cảnh báo `oxlint` & Nghiệm thu 100% bộ Test UI Playwright

**Files:**
- Modify: `e2e/tests/05-srs-ui-compliance-gaps.spec.ts` *(gỡ `srsGap` sau khi toàn bộ UI đạt SRS)*

- [ ] **Step 1: Chạy build & lint trong `app/`**

Run:
```powershell
Set-Location "d:\Jobs\Sports\app"
npm run build
npm run lint
```
Expected: `tsc -b && vite build` thành công; `oxlint` trả **`Found 0 warnings and 0 errors`**.

- [ ] **Step 2: Chạy toàn bộ bộ kiểm thử UI Playwright ở chế độ nghiệm thu SRS đầy đủ**

Run:
```powershell
Set-Location "d:\Jobs\Sports\e2e"
npm run test:srs-audit
```
Expected: **100% PASS (0 failed, 0 skipped)** trên toàn bộ kịch bản hoàn chỉnh và toàn bộ tiêu chí kiểm tra nghiệp vụ SRS!
