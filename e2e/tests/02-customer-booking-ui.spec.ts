import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { loginAs } from '../fixtures/auth.fixture.js';

function futureDateStr(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86_400_000 + 7 * 3600_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

test.describe('02. E2E Hành trình Khách hàng (Home -> Đặt sân -> Báo giá -> Tạo đơn VietQR)', () => {
  test('E2E-03 @smoke Khách hàng xem trang chủ công khai, chọn ô trống tương lai, lấy báo giá và tạo đơn chờ thanh toán VietQR', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText(/Chi nhánh/i).first()).toBeVisible();

    await loginAs(page, 'customer');
    await page.goto(`/booking?date=${futureDateStr(3)}`);

    const sportSelect = page.locator('#booking-sport');
    await expect(sportSelect).toBeEnabled();
    const pickleOpt = sportSelect.locator('option', { hasText: 'Pickleball' }).first();
    await expect(pickleOpt).toBeAttached();
    const pickleValue = await pickleOpt.getAttribute('value');
    await sportSelect.selectOption(pickleValue!);

    const san1Row = page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(san1Row.locator('button.cell.free').first()).toBeVisible();
    await san1Row.locator('button.cell.free').first().click();

    await expect(page.getByText('Cần thanh toán ngay:')).toBeVisible();
    await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();

    await expect(page).toHaveURL(/\/payment\/(BK\w+)/);
    const bookingCode = page.url().match(/\/payment\/(BK\w+)/)![1];
    await expect(page.getByText(`THANHTOAN ${bookingCode}`)).toBeVisible();
    await expect(page.locator('svg').first()).toBeVisible();
  });
});
