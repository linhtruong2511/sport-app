import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { ACCOUNTS } from '../fixtures/test-data.js';
import { loginAs, logoutCurrent } from '../fixtures/auth.fixture.js';

test.describe('03. E2E Giao diện Nhân viên POS & Chủ sân', () => {
  test('E2E-04 @smoke Nhân viên & Chủ sân điều hướng đầy đủ màn hình vận hành với dữ liệu thật', async ({
    page,
  }) => {
    await loginAs(page, 'staff');
    await expect(page.getByText(ACCOUNTS.staffCs1.branchName)).toBeVisible();
    await expect(page.locator('table.sched')).toBeVisible();

    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(page).toHaveURL(/\/staff\/orders/);

    await page.getByRole('link', { name: 'Thống kê trong ngày' }).click();
    await expect(page).toHaveURL(/\/staff\/stats/);
    await expect(page.getByText('Tổng lượt đặt hôm nay')).toBeVisible();

    await page.getByRole('link', { name: 'Đối soát chuyển khoản' }).click();
    await expect(page).toHaveURL(/\/staff\/reconciliation/);
    await logoutCurrent(page);

    await loginAs(page, 'owner');
    await expect(page).toHaveURL(/\/owner\/staff/);
    await expect(page.getByText(ACCOUNTS.staffCs1.name)).toBeVisible();

    await page.getByRole('link', { name: 'Quản lý sân bãi' }).click();
    await expect(page).toHaveURL(/\/owner\/courts/);
    await expect(page.getByText('Sân Pickleball 01')).toBeVisible();

    await page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' }).click();
    await expect(page).toHaveURL(/\/owner\/reports/);
    await expect(
      page.getByRole('heading', { name: 'Bảng tổng hợp doanh thu & tỷ lệ lấp đầy theo từng chi nhánh' }),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Đối soát & Hoàn tiền' }).click();
    await expect(page).toHaveURL(/\/owner\/reconciliation/);
    await expect(page.getByRole('button', { name: /Hoàn tiền chờ xử lý/ })).toBeVisible();
  });
});
