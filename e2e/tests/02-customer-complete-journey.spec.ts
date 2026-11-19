import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { DEMO_DATES, PROMOS, SEED_BOOKINGS } from '../fixtures/test-data.js';
import { loginAs } from '../fixtures/auth.fixture.js';

test.describe('02. Kịch bản UI hoàn chỉnh — Hành trình Khách hàng (Home -> Đặt sân -> KM -> Thanh toán -> Lịch đặt -> Hủy)', () => {
  test('UI-J05 @smoke @uc-004 @uc-005 @uc-006 @uc-008 @uc-009 Hành trình trọn vẹn: Trang chủ -> Tìm sân -> Áp mã SANGVUI20 -> Đặt cọc -> Thanh toán QR -> Xem lịch -> Hủy đơn & mở trống lại sân', async ({
    page,
  }) => {
    await loginAs(page, 'customer');

    // Bước 1: Trang chủ chọn Cơ sở 1 - Pickleball -> Tìm sân trống ngay
    await page.locator('.search-card select').nth(0).selectOption('cs1');
    await page.locator('.search-card select').nth(1).selectOption('pickleball');
    await page.getByRole('button', { name: /Tìm sân trống ngay/i }).click();
    await expect(page).toHaveURL(/\/booking\?.*branch=cs1.*sport=pickleball/);

    // Bước 2: Chọn ô trống đầu tiên của Sân Pickleball 01 (06:00 - 08:00, 300.000 VNĐ)
    const san1Row = page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(san1Row.locator('button.cell.free').first()).toBeVisible();
    const freeCountInitial = await san1Row.locator('button.cell.free').count();
    await san1Row.locator('button.cell.free').first().click();

    // Bước 3: Kiểm thử mã lỗi (không tồn tại, chỉ tại quầy) -> áp mã hợp lệ SANGVUI20 (-20% = -60k -> còn 240k)
    await page.getByPlaceholder('Nhập mã ưu đãi').fill('SAI_MA_999');
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('.field-err')).toContainText('không tồn tại');

    await page.getByPlaceholder('Nhập mã ưu đãi').fill(PROMOS.counter15);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('.field-err')).toContainText('tại quầy');

    await page.getByPlaceholder('Nhập mã ưu đãi').fill(PROMOS.morning20);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('.field-ok')).toContainText(PROMOS.morning20);
    await expect(page.locator('aside')).toContainText('- 60.000 VNĐ');
    await expect(page.locator('aside')).toContainText('240.000 VNĐ');

    // Bước 4: Chọn Đặt cọc giữ sân (30% = 72.000 VNĐ) -> Tiếp tục thanh toán QR
    await page.locator('label.radio-card', { hasText: /Đặt cọc giữ sân/i }).click();
    await expect(page.locator('aside')).toContainText('72.000 VNĐ');
    await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();

    // Bước 5: Màn hình Thanh toán QR kiểm tra đầy đủ mã đơn, QR, STK, số tiền, nội dung chuyển khoản, bộ đếm ngược
    await expect(page).toHaveURL(/\/payment\/(BK\w+)/);
    const newCode = page.url().match(/\/payment\/(BK\w+)/)![1];
    await expect(page.locator('img[alt="Mã VietQR"]')).toBeVisible();
    await expect(page.getByText(`THANHTOAN ${newCode}`)).toBeVisible();
    await expect(page.getByText('72.000 VNĐ').first()).toBeVisible();
    await expect(page.locator('.mono', { hasText: /^\d{2}:\d{2}$/ })).toBeVisible();

    // Bước 6: Xác nhận hoàn tất chuyển khoản -> chuyển về /my-bookings thấy đơn mới Đã xác nhận
    await page.getByRole('button', { name: /Tôi đã hoàn tất chuyển khoản/i }).click();
    await expect(page).toHaveURL(/\/my-bookings/);
    const myCard = page.locator('.card', { hasText: `#${newCode}` });
    await expect(myCard).toBeVisible();
    await expect(myCard).toContainText('Đã xác nhận');
    await expect(myCard).toContainText('72.000 VNĐ');

    // Bước 7: Hủy đơn vừa đặt kèm lý do -> xác nhận chuyển sang tab Đã hủy
    await myCard.getByRole('button', { name: 'Hủy lịch đặt' }).click();
    await expect(page.locator('.modal')).toBeVisible();
    await expect(page.locator('.modal')).toContainText('không được hoàn lại');
    await page.locator('.modal select').selectOption('Bận công việc đột xuất không thể tham gia');
    await page.locator('.modal').getByRole('button', { name: 'Xác nhận hủy' }).click();

    await page.getByRole('button', { name: /^Đã hủy/ }).click();
    const cancelledCard = page.locator('.card', { hasText: `#${newCode}` });
    await expect(cancelledCard).toContainText('Đã hủy');
    await expect(cancelledCard).toContainText('Bận công việc đột xuất');

    // Bước 8: Quay lại /booking xác nhận khung giờ 06:00-08:00 Sân Pickleball 01 đã mở trống trở lại
    await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();
    const san1After = page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(san1After.locator('button.cell.free').first()).toBeVisible();
    const freeCountAfterCancel = await san1After.locator('button.cell.free').count();
    expect(freeCountAfterCancel).toBe(freeCountInitial);
  });

  test('UI-J06 @uc-004 @uc-005 Hành trình đặt sân 100% -> Đổi khung giờ khác giải phóng chỗ -> Đặt lại & thanh toán đủ 100%', async ({
    page,
  }) => {
    await loginAs(page, 'customer');
    await page.getByRole('link', { name: 'Đặt sân trực tuyến' }).click();

    const san1Row = page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(san1Row.locator('button.cell.free').first()).toBeVisible();
    const initialFree = await san1Row.locator('button.cell.free').count();

    // Chọn ô trống cuối (20:00 - 22:00) & thanh toán đủ 100%
    await san1Row.locator('button.cell.free').last().click();
    await page.locator('label.radio-card', { hasText: 'Thanh toán đủ 100%' }).click();
    await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(page).toHaveURL(/\/payment\/BK/);

    // Bấm Đổi khung giờ khác -> hủy giữ chỗ tạm thời, trả lại đúng số ô trống
    await page.getByRole('button', { name: 'Đổi khung giờ khác' }).click();
    await expect(page).toHaveURL(/\/booking/);
    await expect(san1Row.locator('button.cell.free').first()).toBeVisible();
    expect(await san1Row.locator('button.cell.free').count()).toBe(initialFree);

    // Chọn lại, áp TRIAN10 (-10%) và hoàn tất thanh toán 100%
    await page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' }).locator('button.cell.free').last().click();
    await page.getByPlaceholder('Nhập mã ưu đãi').fill(PROMOS.member10);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('.field-ok')).toContainText(PROMOS.member10);
    await page.locator('label.radio-card', { hasText: 'Thanh toán đủ 100%' }).click();
    await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    const paidCode = page.url().match(/\/payment\/(BK\w+)/)![1];
    await page.getByRole('button', { name: /Tôi đã hoàn tất chuyển khoản/i }).click();

    const card = page.locator('.card', { hasText: `#${paidCode}` });
    await expect(card).toContainText('Đã thanh toán đủ');
  });

  test('UI-J07 @uc-004 @uc-006 Kiểm tra lịch bảo trì, ngày nghỉ lễ, bộ lọc tab Lịch đặt và Đặt lại sân', async ({
    page,
  }) => {
    await loginAs(page, 'customer');

    // Dùng nút "Dùng ngay" trên thẻ khuyến mãi từ Trang chủ
    await page.locator('.promo-card', { hasText: PROMOS.member10 }).getByRole('button', { name: 'Dùng ngay' }).click();
    await expect(page).toHaveURL(/\/booking\?promo=TRIAN10/);

    // Sân Pickleball 02 đang bảo trì bị khóa
    await expect(page.locator('table.sched td.locked').first()).toContainText(/bảo trì/i);

    // Chọn ngày nghỉ lễ 25/12/2026 -> đóng cửa toàn bộ
    await page.locator('input[type="date"]').fill(DEMO_DATES.holiday);
    await expect(page.getByText(/Giáng sinh/i)).toBeVisible();
    await expect(page.locator('table.sched button.cell.free')).toHaveCount(0);

    // Sang Lịch đặt của tôi kiểm tra đủ các đơn seed & nút Đặt lại sân này
    await page.getByRole('link', { name: 'Lịch đặt của tôi' }).click();
    await page.getByRole('button', { name: /^Chờ thanh toán/ }).click();
    await expect(page.locator('.card', { hasText: `#${SEED_BOOKINGS.customerPending}` })).toBeVisible();
    await page.getByRole('button', { name: /^Hoàn thành/ }).click();
    const doneCard = page.locator('.card', { hasText: `#${SEED_BOOKINGS.customerCompleted}` });
    await expect(doneCard).toBeVisible();
    await doneCard.getByRole('button', { name: /Đặt lại sân này/i }).click();
    await expect(page).toHaveURL(/\/booking\?branch=cs1&sport=football/);
  });
});
