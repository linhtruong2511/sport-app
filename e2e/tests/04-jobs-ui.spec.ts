import { expect, test } from '../fixtures/test.js';
import { expireHold, runJob } from '../fixtures/backend-tools.js';
import { nextOpenDate } from '../fixtures/lanes.js';

test.describe('04. E2E Job nền (R-15: kích hoạt qua e2eTools)', () => {
  test('E2E-05 @jobs CUS-13 Đơn chờ thanh toán quá hạn giữ chỗ → EXPIRED, trang thanh toán báo quá hạn, ô mở lại', async ({
    customerPage,
  }) => {
    // Làn riêng: >= D+9, Sân Pickleball 03 (không trùng E2E-03 và khối bảo trì PB02 D+5..D+7)
    const date = await nextOpenDate('CS01', 9, 'SAN_PB_03');
    await customerPage.goto(`/booking?date=${date}`);

    const sportSelect = customerPage.locator('#booking-sport');
    await expect(sportSelect).toBeEnabled();
    const pickleValue = await sportSelect
      .locator('option', { hasText: 'Pickleball' })
      .first()
      .getAttribute('value');
    await sportSelect.selectOption(pickleValue!);

    const row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 03' });
    const freeCells = row.locator('button.cell.free');
    await expect(freeCells.first()).toBeVisible();
    const freeBefore = await freeCells.count();

    await freeCells.first().click();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/(BK\w+)/);
    const bookingCode = customerPage.url().match(/\/payment\/(BK\w+)/)![1];
    await expect(customerPage.getByText(`THANHTOAN ${bookingCode}`)).toBeVisible();

    expireHold(bookingCode);
    expect(runJob('expireHolds')).toBeGreaterThanOrEqual(1);

    // Job chạy ngoài tiến trình server nên không có socket → reload
    await customerPage.reload();
    await expect(
      customerPage.getByRole('heading', { name: 'Đơn đã quá hạn thanh toán' }),
    ).toBeVisible();

    await expect(customerPage.getByRole('link', { name: 'Đặt lại sân mới' })).toBeVisible();
    await customerPage.goto(`/booking?date=${date}`);
    await sportSelect.selectOption(pickleValue!);
    await expect(freeCells).toHaveCount(freeBefore);
  });
});
