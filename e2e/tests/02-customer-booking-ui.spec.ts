import { expect, test } from '../fixtures/test.js';
import { nextOpenDate } from '../fixtures/lanes.js';

test.describe('02. E2E Hành trình Khách hàng (Home -> Đặt sân -> Báo giá -> Tạo đơn VietQR)', () => {
  test('E2E-03 @smoke Khách hàng xem trang chủ công khai, chọn ô trống tương lai, lấy báo giá và tạo đơn chờ thanh toán VietQR', async ({
    customerPage,
  }) => {
    await customerPage.goto('/');
    await expect(customerPage.getByText(/Chi nhánh/i).first()).toBeVisible();

    const date = await nextOpenDate('CS01', 3, 'SAN_PB_01');
    await customerPage.goto(`/booking?date=${date}`);

    const sportSelect = customerPage.locator('#booking-sport');
    await expect(sportSelect).toBeEnabled();
    const pickleOpt = sportSelect.locator('option', { hasText: 'Pickleball' }).first();
    await expect(pickleOpt).toBeAttached();
    const pickleValue = await pickleOpt.getAttribute('value');
    await sportSelect.selectOption(pickleValue!);

    const san1Row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(san1Row.locator('button.cell.free').first()).toBeVisible();
    await san1Row.locator('button.cell.free').first().click();

    await expect(customerPage.getByText('Cần thanh toán ngay:')).toBeVisible();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();

    await expect(customerPage).toHaveURL(/\/payment\/(BK\w+)/);
    const bookingCode = customerPage.url().match(/\/payment\/(BK\w+)/)![1];
    await expect(customerPage.getByText(`THANHTOAN ${bookingCode}`)).toBeVisible();
    await expect(customerPage.locator('svg').first()).toBeVisible();
  });
});
