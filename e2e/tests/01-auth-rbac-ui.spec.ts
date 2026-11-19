import { expect } from '@playwright/test';
import { test } from '../fixtures/srs.js';
import { ACCOUNTS } from '../fixtures/test-data.js';
import { loginAs, logoutCurrent } from '../fixtures/auth.fixture.js';

test.describe('01. UI Xác thực, Đăng ký & Phân quyền kế thừa 3 vai trò (UC 001, UC 002, UC 003)', () => {
  test('UI-J01 @smoke @uc-001 Đăng nhập & Đăng xuất lần lượt cả 3 vai trò (Khách hàng, Nhân viên, Chủ sân)', async ({
    page,
  }) => {
    // 1. Khách hàng
    await loginAs(page, 'customer');
    await expect(page.locator('.logo-name')).toHaveText('SportHub');
    await expect(page.getByRole('link', { name: 'Đặt sân trực tuyến' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Lịch đặt của tôi' })).toBeVisible();
    await logoutCurrent(page);

    // 2. Nhân viên thu ngân
    await loginAs(page, 'staff', { skipGoto: true });
    await expect(page).toHaveURL(/\/staff\/booking/);
    await expect(page.getByText(ACCOUNTS.staffCs1.branchName)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quản lý nhân viên' })).toHaveCount(0);
    await logoutCurrent(page);

    // 3. Chủ sân
    await loginAs(page, 'owner', { skipGoto: true });
    await expect(page).toHaveURL(/\/owner\/staff/);
    await expect(page.getByRole('link', { name: 'Quản lý nhân viên' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Quản lý sân bãi' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Khuyến mãi & Báo cáo' })).toBeVisible();
    await logoutCurrent(page);
  });

  test('UI-J02 @uc-001 Kiểm tra lỗi đăng nhập: bỏ trống, mật khẩu ngắn, sai mật khẩu, tài khoản bị khóa', async ({
    page,
  }) => {
    await page.goto('/login');

    // Bỏ trống tài khoản
    await page.locator('#login-identity').fill('');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText(/số điện thoại hoặc email/i);

    // Mật khẩu < 6 ký tự
    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill('12345');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText('6 ký tự');

    // Sai mật khẩu Nhân viên
    await page.locator('label.radio-card', { hasText: ACCOUNTS.staffCs1.roleLabel }).click();
    await page.locator('#login-identity').fill(ACCOUNTS.staffCs1.phone);
    await page.locator('#login-password').fill('SaiMatKhau');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText('Mật khẩu không chính xác');

    // Tài khoản Nhân viên bị khóa (NV004)
    await page.locator('#login-identity').fill(ACCOUNTS.staffLocked.phone);
    await page.locator('#login-password').fill(ACCOUNTS.staffLocked.password);
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText(/đã bị khóa/i);

    // Sai mật khẩu Chủ sân
    await page.locator('label.radio-card', { hasText: ACCOUNTS.owner.roleLabel }).click();
    await page.locator('#login-password').fill('WrongOwner');
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();
    await expect(page.locator('.field-err')).toContainText('Mật khẩu không chính xác');
  });

  test('UI-J03 @uc-003 Luồng đăng ký hội viên mới: kiểm tra lỗi SĐT/xác nhận MK -> đăng ký thành công', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Đăng ký hội viên mới' }).click();

    // SĐT sai định dạng
    await page.getByPlaceholder('Nguyễn Văn An').fill('Trần Minh Khôi');
    await page.getByPlaceholder('0912345678').fill('12345');
    await page.getByPlaceholder('Tối thiểu 6 ký tự').fill('Khoi123456');
    await page.getByPlaceholder('Nhập lại mật khẩu').fill('Khoi123456');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err')).toContainText('10 chữ số');

    // Mật khẩu xác nhận không khớp
    await page.getByPlaceholder('0912345678').fill('0971234567');
    await page.getByPlaceholder('Nhập lại mật khẩu').fill('KhacMatKhau');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err')).toContainText(/không khớp/i);

    // Hợp lệ -> vào giao diện khách hàng
    await page.getByPlaceholder('ban@example.com').fill('khoitm@gmail.com');
    await page.getByPlaceholder('Nhập lại mật khẩu').fill('Khoi123456');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page).toHaveURL(/\/($|booking)/);
    await expect(page.getByText('Trần Minh Khôi')).toBeVisible();
  });

  test('UI-J04 @smoke @rbac Kiểm tra kế thừa giao diện và chặn truy cập trái phép giữa 3 vai trò', async ({ page }) => {
    // Chưa đăng nhập -> mọi route nghiệp vụ bị đẩy về /login
    await page.goto('/staff/orders');
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/owner/reports');
    await expect(page).toHaveURL(/\/login/);

    // Khách hàng: bị chặn /staff/* và /owner/*
    await loginAs(page, 'customer');
    await page.goto('/staff/booking');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/owner/staff');
    await expect(page).toHaveURL(/\/$/);
    await logoutCurrent(page);

    // Nhân viên: kế thừa giao diện khách hàng (/booking), bị chặn /owner/*
    await loginAs(page, 'staff', { skipGoto: true });
    await page.getByRole('link', { name: 'Quay lại' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: '← Về quản lý' })).toBeVisible();
    await page.goto('/owner/courts');
    await expect(page).toHaveURL(/\/staff\/booking/);
    await logoutCurrent(page);

    // Chủ sân: kế thừa giao diện Nhân viên & Khách hàng
    await loginAs(page, 'owner', { skipGoto: true });
    await page.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(page).toHaveURL(/\/staff\/orders/);
    await page.getByRole('link', { name: 'Giao diện Khách đặt sân' }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole('link', { name: '← Về quản lý' }).click();
    await expect(page).toHaveURL(/\/owner\/staff/);
  });
});
