import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { ACCOUNTS } from '../fixtures/test-data.js';
import { loginAs, logoutCurrent } from '../fixtures/auth.fixture.js';

test.describe('01. E2E Auth, Register & RBAC (Real Backend + SportHub_Test)', () => {
  test('E2E-01 @smoke Kiểm tra validate form login, đăng nhập 3 vai trò và phân quyền RBAC', async ({
    page,
  }) => {
    // 1. Chưa đăng nhập -> route bảo vệ đẩy về /login
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

    // 2. Khách hàng: đăng nhập & bị chặn /staff/*, /owner/*
    await loginAs(page, 'customer', { skipGoto: true });
    await expect(page.locator('.logo-name')).toHaveText('SportHub');
    await expect(page.getByRole('link', { name: 'Đặt sân trực tuyến' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lịch đặt của tôi' })).toBeVisible();

    await page.goto('/staff/booking');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/owner/staff');
    await expect(page).toHaveURL(/\/$/);
    await logoutCurrent(page);

    // 3. Nhân viên: vào /staff/booking, bị chặn /owner/*, kế thừa giao diện khách hàng
    await loginAs(page, 'staff');
    await expect(page).toHaveURL(/\/staff\/booking/);
    await expect(page.getByText(ACCOUNTS.staffCs1.branchName)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quản lý nhân viên' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Quay lại' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: '← Về quản lý' })).toBeVisible();

    await page.goto('/owner/courts');
    await expect(page).toHaveURL(/\/staff\/booking/);
    await logoutCurrent(page);

    // 4. Chủ sân: toàn quyền /owner/* và kế thừa /staff/*, /
    await loginAs(page, 'owner');
    await expect(page).toHaveURL(/\/owner\/staff/);
    await expect(page.getByRole('link', { name: 'Quản lý nhân viên' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quản lý sân bãi' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' })).toBeVisible();

    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(page).toHaveURL(/\/staff\/orders/);
    await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: '← Về quản lý' }).click();
    await expect(page).toHaveURL(/\/owner\/staff/);
    await logoutCurrent(page);
  });

  test('E2E-02 Đăng ký hội viên mới qua Backend API + SQL Server', async ({ page }) => {
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
