import { expect, type Page } from '@playwright/test';
import { ACCOUNTS, type UserRole } from './test-data.js';

export async function loginAs(
  page: Page,
  role: UserRole,
  override?: { identity?: string; password?: string; skipGoto?: boolean },
): Promise<void> {
  const acc =
    role === 'customer'
      ? ACCOUNTS.customer
      : role === 'staff'
        ? ACCOUNTS.staffCs1
        : ACCOUNTS.owner;

  if (!override?.skipGoto) {
    await page.goto('/login');
  }
  await expect(page.locator('#login-identity')).toBeVisible();

  const radio = page.locator('label.radio-card', { hasText: acc.roleLabel }).locator('input[type="radio"]');
  if (await radio.isVisible().catch(() => false)) {
    await radio.check();
  }

  await page.locator('#login-identity').fill(override?.identity ?? acc.phone);
  await page.locator('#login-password').fill(override?.password ?? acc.password);
  await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();

  if (role === 'customer') {
    await expect(page).toHaveURL(/\/($|booking)/);
  } else if (role === 'staff') {
    await expect(page).toHaveURL(/\/staff\/booking/);
  } else {
    await expect(page).toHaveURL(/\/owner\/staff/);
  }
}

export async function logoutCurrent(page: Page): Promise<void> {
  const customerLogout = page.getByRole('button', { name: 'Đăng xuất' });
  const staffLogout = page.getByRole('button', { name: 'Thoát' });
  if (await customerLogout.isVisible().catch(() => false)) {
    await customerLogout.click();
  } else {
    await staffLogout.click();
  }
  await expect(page).toHaveURL(/\/login/);
}
