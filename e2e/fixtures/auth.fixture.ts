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
  const logoutBtn = page
    .getByRole('button', { name: 'Đăng xuất' })
    .or(page.getByRole('button', { name: 'Thoát' }));
  await expect(logoutBtn).toBeVisible();
  await logoutBtn.click();
  await expect(page).toHaveURL(/\/login/);
}
