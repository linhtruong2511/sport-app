import { expect, test } from '../fixtures/test.js';
import { ACCOUNTS } from '../fixtures/test-data.js';

test.describe('03. E2E Giao diện Nhân viên POS & Chủ sân', () => {
  test('E2E-04a @smoke Nhân viên điều hướng đầy đủ màn hình vận hành với dữ liệu thật', async ({
    staffPage,
  }) => {
    await staffPage.goto('/staff/booking');
    await expect(staffPage.getByText(ACCOUNTS.staffCs1.branchName)).toBeVisible();
    await expect(staffPage.locator('table.sched')).toBeVisible();

    await staffPage.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(staffPage).toHaveURL(/\/staff\/orders/);

    await staffPage.getByRole('link', { name: 'Thống kê trong ngày' }).click();
    await expect(staffPage).toHaveURL(/\/staff\/stats/);
    await expect(staffPage.getByText('Tổng lượt đặt hôm nay')).toBeVisible();

    await staffPage.getByRole('link', { name: 'Đối soát chuyển khoản' }).click();
    await expect(staffPage).toHaveURL(/\/staff\/reconciliation/);
  });

  test('E2E-04b @smoke Chủ sân điều hướng đầy đủ màn hình quản trị với dữ liệu thật', async ({
    ownerPage,
  }) => {
    await ownerPage.goto('/owner/staff');
    await expect(ownerPage.getByText(ACCOUNTS.staffCs1.name)).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Quản lý sân bãi' }).click();
    await expect(ownerPage).toHaveURL(/\/owner\/courts/);
    await expect(ownerPage.getByText('Sân Pickleball 01')).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
    await expect(ownerPage).toHaveURL(/\/owner\/reports/);
    await expect(
      ownerPage.getByRole('heading', {
        name: 'Bảng tổng hợp doanh thu & tỷ lệ lấp đầy theo từng chi nhánh',
      }),
    ).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Đối soát & Hoàn tiền' }).click();
    await expect(ownerPage).toHaveURL(/\/owner\/reconciliation/);
    await expect(ownerPage.getByRole('button', { name: /Hoàn tiền chờ xử lý/ })).toBeVisible();
  });
});
