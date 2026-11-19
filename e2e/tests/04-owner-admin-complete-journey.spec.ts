import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { ACCOUNTS, DEMO_DATES, PROMOS } from '../fixtures/test-data.js';
import { loginAs, logoutCurrent } from '../fixtures/auth.fixture.js';

test.describe('04. Kịch bản UI hoàn chỉnh — Hành trình Chủ sân liên thông đa vai trò (UC 016 – UC 023)', () => {
  test('UI-J11 @smoke @uc-016 Quản lý nhân viên: Thêm mới -> Chặn trùng SĐT -> Khóa TK (bị chặn đăng nhập) -> Mở khóa (đăng nhập thành công đúng chi nhánh)', async ({
    page,
  }) => {
    await loginAs(page, 'owner');
    const form = page.locator('.work-body aside form');

    // 1. Chặn trùng SĐT nhân viên hiện có
    await form.locator('input').nth(0).fill('Trùng SĐT');
    await form.locator('input').nth(1).fill(ACCOUNTS.staffCs1.phone);
    await form.locator('input').nth(3).fill('Nv123456');
    await form.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(form.locator('.field-err')).toContainText(/đã được cấp/i);

    // 2. Thêm mới nhân viên Nguyễn Thị Lan phân công Cơ sở 2 - Mỹ Đình
    await form.locator('input').nth(0).fill('Nguyễn Thị Lan');
    await form.locator('input').nth(1).fill('0955667788');
    await form.locator('input').nth(2).fill('lannt@sporthub.vn');
    await form.locator('select').nth(0).selectOption('cs2');
    await form.locator('input').nth(3).fill('Lan123456');
    await form.getByRole('button', { name: 'Lưu thông tin' }).click();

    const lanRow = page.locator('tbody tr', { hasText: 'Nguyễn Thị Lan' });
    await expect(lanRow).toContainText('Cơ sở 2 - Mỹ Đình');

    // 3. Khóa tài khoản Nguyễn Thị Lan -> Đăng xuất Chủ sân -> Thử đăng nhập bằng tài khoản Lan bị chặn!
    await lanRow.getByRole('button', { name: 'Khóa' }).click();
    await expect(lanRow).toContainText('Đã khóa');
    await logoutCurrent(page);

    await page.locator('label.radio-card', { hasText: ACCOUNTS.staffCs1.roleLabel }).click();
    await page.locator('#login-identity').fill('0955667788');
    await page.locator('#login-password').fill('Lan123456');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText(/đã bị khóa/i);

    // 4. Đăng nhập lại Chủ sân -> Mở khóa Lan -> Đăng xuất -> Lan đăng nhập thành công đúng Cơ sở 2
    await loginAs(page, 'owner', { skipGoto: true });
    await page.locator('tbody tr', { hasText: 'Nguyễn Thị Lan' }).getByRole('button', { name: 'Mở khóa' }).click();
    await logoutCurrent(page);

    await loginAs(page, 'staff', { identity: '0955667788', password: 'Lan123456', skipGoto: true });
    await expect(page.getByText('Cơ sở 2 - Mỹ Đình')).toBeVisible();
    await expect(page.getByText('Nguyễn Thị Lan').first()).toBeVisible();
  });

  test('UI-J12 @smoke @uc-017 @uc-019 @uc-020 Quản lý sân bãi: Thêm sân mới + Khóa bảo trì + Thêm ngày nghỉ -> Xác nhận tác động ngay trên lịch Khách hàng', async ({
    page,
  }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();

    // 1. Chặn trùng tên sân cùng chi nhánh -> Thêm sân mới Sân Pickleball VIP 09
    const form = page.locator('.work-body aside form');
    await form.locator('input').nth(0).fill('Sân Pickleball 01');
    await form.getByRole('button', { name: 'Lưu thông tin sân' }).click();
    await expect(form.locator('.field-err')).toContainText(/đã tồn tại/i);

    await form.locator('input').nth(0).fill('Sân Pickleball VIP 09');
    await form.getByRole('button', { name: 'Lưu thông tin sân' }).click();
    await expect(page.locator('tbody tr', { hasText: 'Sân Pickleball VIP 09' })).toBeVisible();

    // 2. Tab 3: Mở lại SAN_PK_02 & Khóa bảo trì SAN_PK_03
    await page.getByRole('button', { name: 'Tạm khóa bảo trì sân' }).click();
    await page.locator('.work-body section .row', { hasText: 'Sân Pickleball 02' }).first().getByRole('button', { name: 'Mở lại sân' }).click();
    await page.locator('.work-body aside select').selectOption('SAN_PK_03');
    await page.getByRole('button', { name: 'Tạm khóa sân' }).click();
    await expect(page.locator('.work-body section').getByText(/Sân Pickleball 03 • Cơ sở 1/)).toBeVisible();

    // 3. Tab 2: Thêm ngày nghỉ lễ 20/11/2026
    await page.getByRole('button', { name: 'Giờ mở cửa & Lịch nghỉ lễ' }).click();
    await page.locator('.work-body aside input[type="date"]').fill(DEMO_DATES.customHoliday);
    await page.getByPlaceholder(/Nghỉ Tết/i).fill('Bảo trì điện toàn hệ thống');
    await page.getByRole('button', { name: '+ Thêm ngày nghỉ' }).click();
    await expect(page.getByText('20/11/2026')).toBeVisible();

    // 4. Chuyển sang giao diện Khách đặt sân kiểm chứng CẢ 3 thay đổi có hiệu lực ngay!
    await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
    await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();

    await expect(page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball VIP 09' })).toBeVisible();
    await expect(page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 03' }).locator('td.locked').first()).toBeVisible();

    await page.locator('input[type="date"]').fill(DEMO_DATES.customHoliday);
    await expect(page.getByText(/Bảo trì điện toàn hệ thống/i)).toBeVisible();
    await expect(page.locator('table.sched button.cell.free')).toHaveCount(0);
  });

  test('UI-J13 @smoke @uc-022 @uc-023 Phát hành khuyến mãi mới -> Tạm dừng / Chạy lại -> Khách hàng áp dụng được ngay mã vừa tạo -> Kiểm tra bộ lọc Báo cáo', async ({
    page,
  }) => {
    await loginAs(page, 'owner');
    await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();

    // 1. Validate báo cáo Từ ngày > Đến ngày bị chặn
    const reportDates = page.locator('.work-body section').first().locator('input[type="date"]');
    await reportDates.nth(0).fill('2026-11-30');
    await reportDates.nth(1).fill('2026-11-01');
    await page.getByRole('button', { name: 'Lọc dữ liệu' }).click();
    await expect(page.locator('.toast.err').last()).toContainText(/sau ngày bắt đầu/i);

    // 2. Validate trùng mã SANGVUI20 -> Phát hành mã mới CUOITUAN15 (-15% cả ngày)
    const form = page.locator('.work-body aside form');
    await form.getByPlaceholder(/Ưu đãi khung giờ vàng/i).fill('Mã trùng');
    await form.getByPlaceholder('SANGVUI20').fill(PROMOS.morning20);
    await form.getByRole('button', { name: 'Lưu & Phát hành ưu đãi' }).click();
    await expect(form.locator('.field-err')).toContainText(/đã tồn tại/i);

    await form.getByPlaceholder(/Ưu đãi khung giờ vàng/i).fill('Siêu sale cuối tuần');
    await form.getByPlaceholder('SANGVUI20').fill('CUOITUAN15');
    await form.locator('select').nth(0).selectOption('15|0');
    await form.getByRole('button', { name: 'Lưu & Phát hành ưu đãi' }).click();
    await expect(page.getByText('CUOITUAN15', { exact: true })).toBeVisible();

    // 3. Tạm dừng -> Chạy lại
    const promoCard = page.locator('.work-body section .row', { hasText: 'CUOITUAN15' }).first();
    await promoCard.getByRole('button', { name: 'Tạm dừng' }).click();
    await expect(promoCard).toContainText('Tạm dừng');
    await promoCard.getByRole('button', { name: 'Chạy lại' }).click();
    await expect(promoCard).toContainText('Đang chạy');

    // 4. Sang giao diện Khách đặt sân áp thử chính mã CUOITUAN15 vừa tạo
    await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
    await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
    await page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' }).locator('button.cell.free').first().click();
    await page.getByPlaceholder('Nhập mã ưu đãi').fill('CUOITUAN15');
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('.field-ok')).toContainText('CUOITUAN15');
    await expect(page.locator('aside')).toContainText('- 45.000 VNĐ');
  });
});
