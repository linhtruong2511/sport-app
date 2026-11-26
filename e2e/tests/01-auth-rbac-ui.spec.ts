import { expect, test } from '../fixtures/test.js';
import { waitForAuthRateLimitIfNeeded } from '../fixtures/api.js';
import { ACCOUNTS } from '../fixtures/test-data.js';

test.describe('01. E2E Auth, Register & RBAC (Real Backend + SportHub_Test)', () => {
  test('E2E-01a @smoke Chặn route chưa đăng nhập và validate form đăng nhập', async ({ page }) => {
    await page.goto('/staff/orders');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/owner/reports');
    await expect(page).toHaveURL(/\/login/);

    // Validate phía client (không tốn lượt rate-limit backend)
    await page.locator('#login-identity').fill('');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText(/số điện thoại hoặc email/i);

    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill('12345');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText('6 đến 32 ký tự');

    // Toggle hiện/ẩn mật khẩu (mặc định ẩn)
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Hiện mật khẩu' }).click();
    await expect(page.locator('#login-password')).toHaveAttribute('type', 'text');
  });

  test('E2E-01b @smoke Khách hàng vào giao diện khách và bị chặn /staff/*, /owner/*', async ({
    customerPage,
  }) => {
    await customerPage.goto('/');
    await expect(customerPage.locator('.logo-name')).toHaveText('Thể thao 88');
    await expect(customerPage.getByRole('link', { name: 'Đặt sân trực tuyến' })).toBeVisible();
    await expect(customerPage.getByRole('link', { name: 'Lịch đặt của tôi' })).toBeVisible();

    await customerPage.goto('/staff/booking');
    await expect(customerPage).toHaveURL(/\/$/);
    await customerPage.goto('/owner/staff');
    await expect(customerPage).toHaveURL(/\/$/);
  });

  test('E2E-01c @smoke Nhân viên vào /staff/*, kế thừa giao diện khách và bị chặn /owner/*', async ({
    staffPage,
  }) => {
    await staffPage.goto('/staff/booking');
    await expect(staffPage).toHaveURL(/\/staff\/booking/);
    await expect(staffPage.getByText(ACCOUNTS.staffCs1.branchName)).toBeVisible();
    await expect(staffPage.getByRole('link', { name: 'Quản lý nhân viên' })).toHaveCount(0);

    await staffPage.getByRole('link', { name: 'Quay lại' }).click();
    await expect(staffPage).toHaveURL(/\/$/);
    await expect(staffPage.getByRole('link', { name: '← Về quản lý' })).toBeVisible();

    await staffPage.goto('/owner/courts');
    await expect(staffPage).toHaveURL(/\/staff\/booking/);
  });

  test('E2E-01d @smoke Chủ sân toàn quyền /owner/*, kế thừa /staff/* và giao diện khách', async ({
    ownerPage,
  }) => {
    await ownerPage.goto('/owner/staff');
    await expect(ownerPage).toHaveURL(/\/owner\/staff/);
    await expect(ownerPage.getByRole('link', { name: 'Quản lý nhân viên' })).toBeVisible();
    await expect(ownerPage.getByRole('link', { name: 'Quản lý sân bãi' })).toBeVisible();
    await expect(ownerPage.getByRole('link', { name: 'Khuyến mãi & Báo cáo' })).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(ownerPage).toHaveURL(/\/staff\/orders/);
    await ownerPage.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
    await expect(ownerPage).toHaveURL(/\/$/);
    await ownerPage.getByRole('link', { name: '← Về quản lý' }).click();
    await expect(ownerPage).toHaveURL(/\/owner\/staff/);
  });

  test('E2E-02 Đăng ký hội viên mới qua Backend API + SQL Server', async ({ page }) => {
    await waitForAuthRateLimitIfNeeded(1);
    await page.goto('/login');
    await page.getByRole('button', { name: 'Đăng ký hội viên mới' }).click();

    await page.locator('#reg-fullname').fill('Trần Minh Khôi');
    await page.locator('#reg-phone').fill('12345');
    await page.locator('#reg-email').fill('khoitm@example.com');
    await page.locator('#reg-password').fill('Khoi123456');
    await page.locator('#reg-confirm').fill('Khoi123456');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err').first()).toContainText('10 chữ số');

    const uniqueSuffix = String(Date.now()).slice(-7);
    await page.locator('#reg-phone').fill(`097${uniqueSuffix}`);
    await page.locator('#reg-email').fill(`khoi.${uniqueSuffix}@example.com`);
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();

    await expect(page).toHaveURL(/\/($|booking)/);
    await expect(page.getByText('Trần Minh Khôi')).toBeVisible();
  });
});
