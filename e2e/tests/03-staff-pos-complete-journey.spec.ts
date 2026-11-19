import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { ACCOUNTS, SEED_BOOKINGS } from '../fixtures/test-data.js';
import { loginAs } from '../fixtures/auth.fixture.js';

test.describe('03. Kịch bản UI hoàn chỉnh — Hành trình Nhân viên POS (Quầy -> Đơn & Bàn giao -> Dashboard ngày)', () => {
  test('UI-J08 @smoke @uc-010 @uc-011 @uc-014 @uc-015 Khách vãng lai tại quầy (Tiền mặt 100%) -> Nhận sân -> Hoàn thành -> Đối chiếu Dashboard ngày', async ({
    page,
  }) => {
    await loginAs(page, 'staff');
    await expect(page).toHaveURL(/\/staff\/booking/);

    // Bước 1: Kiểm tra validate thiếu SĐT / tên khách vãng lai
    await page.locator('table.sched button.cell.free').first().click();
    await page.getByPlaceholder('09xxxxxxxx').fill('09123');
    await page.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/i }).click();
    await expect(page.locator('.toast.err').last()).toContainText(/Số điện thoại/i);

    await page.getByPlaceholder('09xxxxxxxx').fill('0905889900');
    await page.getByPlaceholder('Nhập họ tên').fill('');
    await page.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/i }).click();
    await expect(page.locator('.toast.err').last()).toContainText(/họ và tên/i);

    // Bước 2: Điền hợp lệ & thu tiền mặt 100%
    await page.getByPlaceholder('Nhập họ tên').fill('Nguyễn Khách Vãng Lai');
    await page.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/i }).click();

    const receiptBox = page.locator('div.col.g6', { hasText: 'Phiếu thu gần nhất tại quầy' });
    await expect(receiptBox).toContainText(ACCOUNTS.staffCs1.name);
    await expect(receiptBox).toContainText('Tiền mặt');
    const receiptText = await receiptBox.innerText();
    const orderCode = receiptText.match(/Mã đơn:\s*#(BK\w+)/)![1];

    // Bước 3: Chuyển sang Quản lý đơn & Nhận sân tìm chính đơn vừa tạo
    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await page.getByPlaceholder('Mã đơn, tên hoặc SĐT khách').fill(orderCode);
    await page.getByRole('button', { name: 'Tìm đơn' }).click();

    const row = page.locator('tbody tr', { hasText: `#${orderCode}` });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Khách vãng lai');
    await expect(row).toContainText('Đã trả đủ 100%');

    // Bước 4: Nhận sân ngay -> Đang sử dụng -> Kết thúc & Hoàn thành
    await row.getByRole('button', { name: 'Nhận sân ngay' }).click();
    await expect(row).toContainText('Đang sử dụng');
    await row.getByRole('button', { name: /Kết thúc & Hoàn thành/i }).click();
    await expect(row).toContainText('Hoàn thành');

    // Bước 5: Sang Thống kê trong ngày kiểm tra 4 KPI & sơ đồ sân hiển thị bình thường
    await page.getByRole('link', { name: 'Thống kê trong ngày' }).click();
    await expect(page.getByText('Tổng lượt đặt hôm nay')).toBeVisible();
    await expect(page.getByText('Số sân đang có khách chơi')).toBeVisible();
    await expect(page.getByText('Đơn chờ nhận sân / tất toán')).toBeVisible();
    await expect(page.getByText('Doanh thu thực thu hôm nay')).toBeVisible();
  });

  test('UI-J09 @smoke @uc-010 @uc-007 @uc-013 @uc-014 Hội viên đặt cọc tại quầy (VietQR) -> Thu tất toán phần còn thiếu & Bàn giao sân -> Hiện Đang sử dụng trên Dashboard', async ({
    page,
  }) => {
    await loginAs(page, 'staff');

    // Bước 1: Tra cứu hội viên không tồn tại -> thông báo khách vãng lai; tra cứu hội viên có sẵn 0987654321
    await page.getByPlaceholder('09xxxxxxxx').fill('0909123456');
    await page.getByRole('button', { name: 'Tra cứu' }).click();
    await expect(page.getByText(/Không tìm thấy hội viên/i)).toBeVisible();

    await page.getByPlaceholder('09xxxxxxxx').fill(ACCOUNTS.customer.seedBookingPhone);
    await page.getByRole('button', { name: 'Tra cứu' }).click();
    await expect(page.getByPlaceholder('Nhập họ tên')).toHaveValue(ACCOUNTS.customer.name);

    // Bước 2: Chọn ô trống trên Sân Cầu lông 02 -> Thu cọc giữ sân + Quét mã VietQR
    const courtRow = page.locator('table.sched tbody tr', { hasText: 'Sân Cầu lông 02' });
    await courtRow.locator('button.cell.free').first().click();
    await page.locator('label.radio-card', { hasText: /Thu cọc giữ sân/i }).click();
    await page.locator('label.radio-card', { hasText: /Quét mã VietQR/i }).click();
    await expect(page.locator('.work-body aside img[alt="VietQR"]')).toBeVisible();

    await page.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/i }).click();
    const receiptBox = page.locator('div.col.g6', { hasText: 'Phiếu thu gần nhất tại quầy' });
    await expect(receiptBox).toContainText('VietQR');
    const receiptText = await receiptBox.innerText();
    const orderCode = receiptText.match(/Mã đơn:\s*#(BK\w+)/)![1];

    // Bước 3: Sang Quản lý đơn -> Tìm đơn vừa tạo -> Thu nốt phần còn lại & Bàn giao sân
    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await page.getByPlaceholder('Mã đơn, tên hoặc SĐT khách').fill(orderCode);
    await page.getByRole('button', { name: 'Tìm đơn' }).click();

    const row = page.locator('tbody tr', { hasText: `#${orderCode}` });
    await expect(row).toContainText('Đã đặt cọc');
    await row.getByRole('button', { name: /Thu nốt .* & Nhận sân/i }).click();

    await page.locator('.work-body aside').getByRole('button', { name: /Đã thu đủ .* & Cho khách vào sân/i }).click();
    await expect(row).toContainText('Đang sử dụng');
    await expect(row).toContainText('Đã trả đủ 100%');

    // Bước 4: Sang Thống kê trong ngày xác nhận thẻ Sân Cầu lông 02 hiển thị Đang sử dụng kèm mã đơn
    await page.getByRole('link', { name: 'Thống kê trong ngày' }).click();
    await expect(page.getByText(`Đang sử dụng • #${orderCode}`)).toBeVisible();
  });

  test('UI-J10 @uc-009 Nhân viên hủy đơn Quá giờ nhận sân (BK2026111005) giữ cọc & giải phóng sân', async ({
    page,
  }) => {
    await loginAs(page, 'staff');
    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();

    await page.getByRole('button', { name: /^Quá giờ nhận sân/ }).click();
    const row = page.locator('tbody tr', { hasText: `#${SEED_BOOKINGS.staffOverdue}` });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Hủy đơn & Mở sân' }).click();

    const cancelAside = page.locator('.work-body aside .card', { hasText: 'Hủy đơn & Giải phóng sân' });
    await expect(cancelAside).toContainText('180.000 VNĐ');
    await cancelAside.getByPlaceholder(/Ghi chú thêm/i).fill('Đã gọi 3 lần không liên lạc được');
    await cancelAside.getByRole('button', { name: 'Xác nhận hủy đơn & Mở trống lại sân' }).click();

    await page.getByRole('button', { name: /^Tất cả đơn hôm nay/ }).click();
    await expect(page.locator('tbody tr', { hasText: `#${SEED_BOOKINGS.staffOverdue}` })).toContainText('Đã hủy');
  });
});
