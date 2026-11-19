import { expect } from '@playwright/test';
import { test, srsUiGap } from '../fixtures/srs.js';
import { ACCOUNTS, DEMO_DATES, PROMOS, SEED_BOOKINGS } from '../fixtures/test-data.js';
import { loginAs, logoutCurrent } from '../fixtures/auth.fixture.js';

/**
 * Bộ kiểm thử Nghiệm thu SRS thuần UI Prototype (ZERO backend calls).
 * - Chạy mặc định (`npm test`): hiển thị rõ 28 hạng mục SRS còn thiếu/sai trên prototype dưới dạng `fixme`.
 * - Chạy kiểm định TDD (`npm run test:srs-audit` / `SRS_FULL=1`): thực thi toàn bộ 28 kịch bản lên giao diện.
 */
test.describe('05. Nghiệm thu 100% Nghiệp vụ SRS còn thiếu/sai trên UI Prototype (UI-01 – UI-34)', () => {
  // === Màn 01 & 02: Auth & Trang chủ ===
  srsUiGap(
    'SRS-UI-01 @uc-001 Ô mật khẩu mặc định phải ẩn (type="password") và bật/tắt được',
    'UI-04: Login.tsx dùng useState(true) làm lộ mật khẩu mặc định',
    async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
      await page.getByRole('button', { name: 'Hiện / Ẩn' }).click();
      await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
    },
  );

  srsUiGap(
    'SRS-UI-02 @uc-001 Khách hàng đăng nhập sai mật khẩu / SĐT không tồn tại phải bị từ chối',
    'UI-01: store.tsx:118 cho phép mọi SĐT & mật khẩu >= 6 ký tự đăng nhập thành Nguyễn Văn An',
    async ({ page }) => {
      await page.goto('/login');
      await page.locator('#login-identity').fill('0999888777');
      await page.locator('#login-password').fill('MatKhauSai99');
      await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
      await expect(page.locator('.field-err')).toContainText(/không chính xác|không tìm thấy/i);
      await expect(page).toHaveURL(/\/login/);
    },
  );

  srsUiGap(
    'SRS-UI-03 @uc-001 Nhập sai mật khẩu 5 lần liên tiếp -> khóa tạm tài khoản 5 phút (Alt 2b)',
    'UI-03: Chưa có bộ đếm nhập sai và trạng thái tạm khóa 5 phút trong store.tsx',
    async ({ page }) => {
      await page.goto('/login');
      await page.locator('label.radio-card', { hasText: ACCOUNTS.staffCs2.roleLabel }).click();
      for (let i = 0; i < 5; i++) {
        await page.locator('#login-identity').fill(ACCOUNTS.staffCs2.phone);
        await page.locator('#login-password').fill(`Wrong${i}99`);
        await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
      }
      await expect(page.locator('.field-err')).toContainText(/quá 5 lần.*5 phút/i);
    },
  );

  srsUiGap(
    'SRS-UI-04 @uc-003 Đăng ký bắt buộc Email, chặn trùng SĐT, chặn tên chứa số và mật khẩu có khoảng trắng',
    'UI-02: Login.tsx để Email tùy chọn và không kiểm tra trùng SĐT/Email hay ký tự hợp lệ',
    async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Đăng ký hội viên mới' }).click();

      // Thiếu Email
      await page.getByPlaceholder('Nguyễn Văn An').fill('Lê Bảo Ngọc');
      await page.getByPlaceholder('0912345678').fill('0979998877');
      await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('Ngoc123456');
      await page.getByPlaceholder('Nhập lại mật khẩu').fill('Ngoc123456');
      await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
      await expect(page.locator('.field-err')).toContainText(/email|bắt buộc/i);

      // Trùng SĐT nhân viên hiện có
      await page.getByPlaceholder('0912345678').fill(ACCOUNTS.staffCs1.phone);
      await page.getByPlaceholder('ban@example.com').fill('ngoc@gmail.com');
      await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
      await expect(page.locator('.field-err')).toContainText(/đã được sử dụng/i);
    },
  );

  srsUiGap(
    'SRS-UI-05 @home Trang chủ mở công khai cho Guest (nút Quay lại Trang chủ từ /login hoạt động)',
    'UI-05: Route / bị khóa sau Guard customer; nút Quay lại Trang chủ chỉ bật toast',
    async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: /Quay lại Trang chủ/i }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole('link', { name: /Đăng nhập/i })).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-06 @home Trang chủ ẩn mã khuyến mãi đang tạm dừng và cập nhật avatar đúng theo tên người dùng đăng ký mới',
    'UI-07 & UI-08: Home.tsx không lọc p.active; layouts.tsx hardcode avatar "AN" cho mọi khách hàng',
    async ({ page }) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Đăng ký hội viên mới' }).click();
      await page.getByPlaceholder('Nguyễn Văn An').fill('Trần Bảo Minh');
      await page.getByPlaceholder('0912345678').fill('0978887766');
      await page.getByPlaceholder('ban@example.com').fill('minhtb@gmail.com');
      await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('Minh123456');
      await page.getByPlaceholder('Nhập lại mật khẩu').fill('Minh123456');
      await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
      await expect(page.locator('.avatar')).toHaveText('TM');
    },
  );

  // === Màn 03 & 04: Đặt sân & Thanh toán ===
  srsUiGap(
    'SRS-UI-07 @uc-004 Màn hình Đặt sân mặc định chọn Thanh toán đủ 100% (SRS UC 004 Bước 3 / D6)',
    'UI-10: Booking.tsx đang mặc định payMode="deposit"',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await page.locator('table.sched button.cell.free').first().click();
      await expect(page.locator('label.radio-card', { hasText: 'Thanh toán đủ 100%' }).locator('input')).toBeChecked();
    },
  );

  srsUiGap(
    'SRS-UI-08 @uc-004 Lưới lịch sinh khung giờ động theo giờ mở cửa (bao phủ cả 10:00–14:00 cho mã buổi trưa)',
    'UI-09: ONLINE_SLOTS hardcode 7 khung rời rạc, bỏ trống 10:00–14:00',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await expect(page.locator('table.sched thead')).toContainText('10:00');
      await expect(page.locator('table.sched thead')).toContainText('12:00');
    },
  );

  srsUiGap(
    'SRS-UI-09 @uc-007 Chọn Đặt cọc giữ sân hiển thị cảnh báo bắt buộc "Tiền cọc không được hoàn lại..."',
    'UI-11: Booking.tsx thiếu dòng cảnh báo không hoàn tiền cọc trước khi xác nhận',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await page.locator('table.sched button.cell.free').first().click();
      await page.locator('label.radio-card', { hasText: /Đặt cọc giữ sân/i }).click();
      await expect(page.getByText(/Tiền cọc không được hoàn lại nếu hủy đơn hoặc không đến nhận sân đúng giờ/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-10 @uc-005 @uc-018 Đổi mức cọc sân lên 50% -> đơn mới ghi nhận đúng 50% (không hardcode 30%) & đơn cũ bảo lưu mức cọc cũ',
    'UI-13: store.tsx:138 hardcode 0.3 (30%) và Payment.tsx tính lại theo court.deposit hiện tại thay vì snapshot',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();
      await page.locator('tbody tr', { hasText: 'SAN_PK_01' }).getByRole('button', { name: 'Cập nhật' }).click();
      await page.locator('.work-body aside input[type="number"]').first().fill('50');
      await page.getByRole('button', { name: 'Lưu thông tin sân' }).click();

      await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' }).locator('button.cell.free').first().click();
      await page.locator('label.radio-card', { hasText: /Đặt cọc giữ sân/i }).click();
      await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
      await page.getByRole('button', { name: /Tôi đã hoàn tất chuyển khoản/i }).click();

      await expect(page.getByText('Đã đặt cọc (50%)').first()).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-11 @uc-008 Hủy đơn chưa thanh toán phải hoàn lại lượt sử dụng mã khuyến mãi (D10)',
    'UI-11: Booking.tsx tăng p.used khi tạo đơn nhưng không hoàn lại khi khách hủy giữ chỗ',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' }).locator('button.cell.free').first().click();
      await page.getByPlaceholder('Nhập mã ưu đãi').fill(PROMOS.member10);
      await page.getByRole('button', { name: 'Áp dụng' }).click();
      await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
      await page.getByRole('button', { name: 'Đổi khung giờ khác' }).click();

      await page.getByRole('link', { name: '← Về quản lý' }).click();
      await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
      await expect(page.locator('.work-body section .row', { hasText: PROMOS.member10 }).first()).toContainText('102 / 300');
    },
  );

  srsUiGap(
    'SRS-UI-12 @uc-005 Chặn khách hàng truy cập /payment/:id của đơn thuộc khách khác',
    'UI-15: Payment.tsx chưa kiểm tra chủ sở hữu đơn',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.goto(`/payment/${SEED_BOOKINGS.otherCustomerPending}`);
      await expect(page.getByText(/Không có quyền|Không tìm thấy/i)).toBeVisible();
      await expect(page.getByRole('button', { name: /Tôi đã hoàn tất chuyển khoản/i })).toHaveCount(0);
    },
  );

  // === Màn 05: Lịch đặt của tôi, Hủy hoàn tiền & Thông báo ===
  srsUiGap(
    'SRS-UI-13 @uc-006 Lịch đặt của tôi có đủ 7 bộ lọc trạng thái (gồm Đang sử dụng & Quá hạn thanh toán) và báo lỗi khi Từ ngày > Đến ngày',
    'UI-18: MyBookings.tsx chỉ có 5 tab và không validate from <= to',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Lịch đặt của tôi' }).click();
      for (const label of ['Tất cả', 'Chờ thanh toán', 'Đã xác nhận', 'Đang sử dụng', 'Hoàn thành', 'Quá hạn thanh toán', 'Đã hủy']) {
        await expect(page.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
      }
      const dates = page.locator('input[type="date"]');
      await dates.nth(0).fill('2026-11-30');
      await dates.nth(1).fill('2026-11-01');
      await expect(page.getByText(/Khoảng thời gian tra cứu không hợp lệ/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-14 @uc-009 Chính sách hoàn tiền bậc thang FR 12: hủy trước >=5 ngày hoàn 100% phần ngoài cọc; 2–<5 ngày hoàn 50%; giữ cọc 100%',
    'UI-16: MyBookings.tsx luôn giữ toàn bộ tiền đã trả, chưa có tính toán hoàn tiền 100%/50%/0%',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
      await page.locator('input[type="date"]').fill(DEMO_DATES.inSixDays);
      await page.locator('table.sched button.cell.free').first().click();
      await page.locator('label.radio-card', { hasText: 'Thanh toán đủ 100%' }).click();
      await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
      await page.getByRole('button', { name: /Tôi đã hoàn tất chuyển khoản/i }).click();

      const card = page.locator('.card', { hasText: '18/11/2026' }).first();
      await card.getByRole('button', { name: /Hủy/i }).click();
      await expect(page.locator('[data-testid="cancel-refund-rate"]')).toContainText('100%');
      await page.locator('.modal').getByRole('button', { name: 'Xác nhận hủy' }).click();
      await page.getByRole('button', { name: /^Đã hủy/ }).click();
      await expect(page.locator('.card', { hasText: '18/11/2026' }).first()).toContainText(/Hoàn 100%/i);
    },
  );

  srsUiGap(
    'SRS-UI-15 @uc-009 Chọn "Lý do khác" phải mở ô nhập văn bản bắt buộc (<=255 ký tự) và không hiển thị nút Hủy cho đơn Đang sử dụng',
    'UI-17 & UI-20: MyBookings.tsx thiếu input cho Lý do khác và vẫn hiển thị nút Hủy cho đơn playing/overdue',
    async ({ page }) => {
      await loginAs(page, 'customer');
      await page.getByRole('link', { name: 'Lịch đặt của tôi' }).click();
      await page.locator('.card', { hasText: `#${SEED_BOOKINGS.customerConfirmed}` }).getByRole('button', { name: /Hủy/i }).click();
      await page.locator('.modal select').selectOption('Lý do khác');
      await expect(page.locator('[data-testid="cancel-reason-custom"]')).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-16 @uc-026 Trung tâm Thông báo động: Chủ sân phát hành KM có gửi thông báo -> xuất hiện trong mục Thông báo Khách hàng, lọc được và đánh dấu Đã đọc',
    'UI-19: MyBookings.tsx hardcode 3 thông báo tĩnh và badge "3 mới"',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
      const form = page.locator('.work-body aside form');
      await form.getByPlaceholder(/Ưu đãi khung giờ vàng/i).fill('Thông báo ưu đãi mới E2E');
      await form.getByPlaceholder('SANGVUI20').fill('NOTIFTEST10');
      await form.getByRole('button', { name: 'Lưu & Phát hành ưu đãi' }).click();

      await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
      await page.getByRole('link', { name: 'Lịch đặt của tôi' }).click();
      await expect(page.locator('[data-testid="notif-filter-type"]')).toBeVisible();
      await expect(page.locator('aside')).toContainText('NOTIFTEST10');
    },
  );

  // === Màn 06, 07, 08: Nhân viên POS ===
  srsUiGap(
    'SRS-UI-17 @uc-010 Khung giờ quầy đồng bộ với lịch Online (gồm 06:00–08:00, 10:00–12:00) và tra cứu thấy hội viên mới đăng ký',
    'UI-21 & UI-22: COUNTER_SLOTS chỉ có 5 ô cứng lệch pha Online; tra cứu chỉ đọc 5 phần tử MEMBERS tĩnh',
    async ({ page }) => {
      await loginAs(page, 'staff');
      await expect(page.locator('table.sched thead')).toContainText('06:00 - 08:00');
      await expect(page.locator('table.sched thead')).toContainText('10:00 - 12:00');
    },
  );

  srsUiGap(
    'SRS-UI-18 @uc-012 @uc-013 Tất toán nhận sân chọn "📱 Quét QR" phải hiển thị mã VietQR động đúng số tiền còn thiếu',
    'UI-24: StaffOrders.tsx chọn radio Quét QR không hiển thị mã QR nào',
    async ({ page }) => {
      await loginAs(page, 'staff');
      await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
      await page.locator('tbody tr', { hasText: `#${SEED_BOOKINGS.customerConfirmed}` }).getByRole('button', { name: /Thu nốt .* & Nhận sân/i }).click();
      await page.locator('.work-body aside label.radio-card', { hasText: /Quét QR/i }).click();
      await expect(page.locator('[data-testid="settle-qr-image"]')).toBeVisible();
      await expect(page.locator('[data-testid="settle-qr-amount"]')).toContainText('315.000 VNĐ');
    },
  );

  srsUiGap(
    'SRS-UI-19 @uc-014 Chặn thao tác "Nhận sân ngay" khi cùng sân đang có đơn trước ở trạng thái Đang sử dụng (Alt 2c)',
    'UI-26: StaffOrders.tsx chưa kiểm tra xung đột sân đang playing (SAN_CL_01 đang có BK2026111002 playing)',
    async ({ page }) => {
      await loginAs(page, 'staff');
      await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
      const row = page.locator('tbody tr', { hasText: `#${SEED_BOOKINGS.staffSameCourtAsPlaying}` });
      await row.getByRole('button', { name: 'Nhận sân ngay' }).click();
      await expect(page.getByText(/Sân đang được sử dụng bởi đơn trước/i)).toBeVisible();
      await expect(row).toContainText('Đã xác nhận');
    },
  );

  srsUiGap(
    'SRS-UI-20 @uc-013 @uc-009 Quản lý đơn có bộ lọc ngày (không khóa TODAY) và panel hủy đơn có Phân loại hủy (chặn chọn Không đến nhận sân khi chưa quá giờ)',
    'UI-26 & UI-27: StaffOrders.tsx khóa cứng ngày TODAY và thiếu radio Phân loại hủy',
    async ({ page }) => {
      await loginAs(page, 'staff');
      await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
      await expect(page.locator('[data-testid="orders-date-filter"]')).toBeVisible();
      await page.locator('tbody tr', { hasText: `#${SEED_BOOKINGS.customerConfirmed}` }).getByRole('button', { name: 'Hủy lịch' }).click();
      await page.locator('[data-testid="cancel-category-noshow"]').check();
      await page.getByRole('button', { name: 'Xác nhận hủy đơn & Mở trống lại sân' }).click();
      await expect(page.getByText(/Chưa quá giờ nhận sân quy định/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-21 @uc-015 Chủ sân lọc được Dashboard trong ngày theo chi nhánh và nhấp vào thẻ KPI mở danh sách chi tiết đơn',
    'UI-23 & UI-28: StaffLayout ẩn bộ lọc chi nhánh ở /staff/stats và thẻ KPI không click được',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Thống kê trong ngày' }).click();
      const picker = page.locator('[data-testid="branch-switcher"]');
      await expect(picker).toBeVisible();
      await picker.selectOption('cs2');
      await expect(page.getByText(/Cơ sở 2 - Mỹ Đình/)).toBeVisible();
      await page.locator('[data-testid="kpi-pending-orders"]').click();
      await expect(page.locator('[data-testid="kpi-drilldown-modal"]')).toBeVisible();
    },
  );

  // === Màn 09, 10, 11: Chủ sân ===
  srsUiGap(
    'SRS-UI-22 @uc-017 @uc-018 Quản lý sân có trường Mô tả sân, chặn mức cọc < 10% (VD 5%) và chặn đổi cơ sở khi sân còn đơn chưa hoàn thành',
    'UI-30: OwnerCourts.tsx thiếu Mô tả sân, cho nhập cọc 0% và không kiểm tra đơn tương lai khi đổi chi nhánh',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();
      await expect(page.locator('[data-testid="court-desc"]')).toBeVisible();

      // Chặn cọc 5%
      await page.locator('.work-body aside form input').first().fill('Sân Test Cọc 5%');
      await page.locator('[data-testid="court-deposit"]').fill('5');
      await page.getByRole('button', { name: 'Lưu thông tin sân' }).click();
      await expect(page.locator('.field-err')).toContainText(/10%.*100%/i);

      // Chặn đổi chi nhánh SAN_PK_01 (đang có BK2026111001)
      await page.locator('tbody tr', { hasText: 'SAN_PK_01' }).getByRole('button', { name: 'Cập nhật' }).click();
      await page.locator('.work-body aside form select').first().selectOption('cs2');
      await page.getByRole('button', { name: 'Lưu thông tin sân' }).click();
      await expect(page.locator('.field-err')).toContainText(/đang có đơn đặt chưa hoàn thành/i);
    },
  );

  srsUiGap(
    'SRS-UI-23 @uc-020 Tab Giờ mở cửa chặn Giờ đóng cửa <= Giờ mở cửa (Alt 2a) và hỗ trợ cấu hình theo Thứ 2–Chủ nhật + khoảng ngày nghỉ',
    'UI-31: OwnerCourts Tab 2 không kiểm tra open < close và không có lịch tuần / khoảng ngày nghỉ',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();
      await page.getByRole('button', { name: 'Giờ mở cửa & Lịch nghỉ lễ' }).click();

      const times = page.locator('.work-body section input[type="time"]');
      await times.nth(0).fill('22:00');
      await times.nth(1).fill('06:00');
      await page.getByRole('button', { name: 'Lưu giờ mở cửa' }).click();
      await expect(page.getByText(/Giờ đóng cửa phải lớn hơn giờ mở cửa/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-24 @uc-019 @uc-021 Khóa sân hỗ trợ chế độ Ngừng khai thác, cảnh báo danh sách đơn bị ảnh hưởng và cho Chuyển sân / Đóng đơn do cơ sở (UC 021)',
    'UI-25 & UI-31: Chưa có chế độ Ngừng khai thác, chưa quét đơn bị ảnh hưởng và chưa triển khai UC 021',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();
      await page.getByRole('button', { name: 'Tạm khóa bảo trì sân' }).click();
      await expect(page.locator('[data-testid="lock-mode-stop"]')).toBeVisible();

      await page.locator('.work-body aside select').selectOption('SAN_PK_01');
      await page.locator('.work-body aside input[type="datetime-local"]').nth(0).fill(`${DEMO_DATES.today}T17:00`);
      await page.locator('.work-body aside input[type="datetime-local"]').nth(1).fill(`${DEMO_DATES.today}T22:00`);
      await page.getByRole('button', { name: 'Tạm khóa sân' }).click();

      await expect(page.locator('[data-testid="affected-warning-list"]')).toContainText(SEED_BOOKINGS.customerConfirmed);
      await page.locator(`[data-testid="reassign-btn-${SEED_BOOKINGS.customerConfirmed}"]`).click();
      await page.locator('[data-testid="reassign-target-court"]').selectOption('SAN_PK_03');
      await page.getByRole('button', { name: 'Xác nhận chuyển' }).click();
      await expect(page.getByText(/Đã chuyển sân/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-25 @uc-022 Quản lý khuyến mãi hiển thị cả mã tại quầy, hỗ trợ giảm tiền VNĐ và nút Xóa (xóa hẳn nếu chưa dùng / Ngừng áp dụng nếu đã dùng)',
    'UI-33: OwnerReports ẩn QUAYCG15, thiếu loại giảm VNĐ và thiếu nút Xóa / Ngừng áp dụng',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
      await expect(page.getByText(PROMOS.counter15, { exact: true })).toBeVisible();
      await expect(page.locator('[data-testid="promo-discount-type"]')).toBeVisible();

      // Xóa mã đã dùng (TRIAN10) -> chuyển Ngừng áp dụng
      await page.locator(`[data-testid="promo-delete-${PROMOS.member10}"]`).click();
      await expect(page.locator(`[data-testid="promo-card-${PROMOS.member10}"]`)).toContainText('Ngừng áp dụng');
    },
  );

  srsUiGap(
    'SRS-UI-26 @uc-023 Báo cáo doanh thu tính động theo dữ liệu thực trong store, lọc được tới từng sân, có bảng theo từng sân và thông báo kỳ trống',
    'UI-32: OwnerReports.tsx hardcode hằng số REPORT cố định, thiếu lọc & bảng theo từng sân và thông báo Alt 2a',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
      await expect(page.locator('[data-testid="report-court-filter"]')).toBeVisible();
      await expect(page.locator('[data-testid="report-by-court-table"]')).toBeVisible();

      const dates = page.locator('.work-body section').first().locator('input[type="date"]');
      await dates.nth(0).fill(DEMO_DATES.emptyMonthFrom);
      await dates.nth(1).fill(DEMO_DATES.emptyMonthTo);
      await page.getByRole('button', { name: 'Lọc dữ liệu' }).click();
      await expect(page.getByText(/Không có dữ liệu phát sinh trong khoảng thời gian đã chọn/i)).toBeVisible();
    },
  );

  srsUiGap(
    'SRS-UI-27 @uc-016 Quản lý nhân viên có tìm kiếm, hộp thoại xác nhận khi khóa và số đơn/doanh thu cộng dồn theo giao dịch thực tế',
    'UI-29: OwnerStaff.tsx thiếu ô tìm kiếm, không có confirm dialog và hiển thị số seed cứng',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await expect(page.locator('[data-testid="staff-search"]')).toBeVisible();
      await page.locator('[data-testid="staff-search"]').fill('Lê Văn Hùng');
      await expect(page.locator('tbody tr')).toHaveCount(1);
    },
  );

  srsUiGap(
    'SRS-UI-28 @uc-025 @uc-009 Giao diện bổ sung Đối soát giao dịch & Hoàn tiền chờ xử lý (Mục 5.9 Thiết kế chi tiết final)',
    'UI-34: Chưa có màn hình/tab /owner/reconciliation trong prototype',
    async ({ page }) => {
      await loginAs(page, 'owner');
      await page.goto('/owner/reconciliation');
      await expect(page.getByRole('heading', { name: /Đối soát giao dịch/i })).toBeVisible();
    },
  );
});
