import { expect, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import { getAuthStorageStatePath } from './api.js';
import { ACCOUNTS, type UserRole } from './test-data.js';

export async function submitAuthWithRateLimitRetry(
  page: Page,
  urlSubstring: string,
  clickTrigger: () => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(urlSubstring)),
      clickTrigger(),
    ]);
    if (res.status() !== 429) {
      return res;
    }
    const headers = res.headers();
    const resetEpoch = Number(headers['x-ratelimit-reset'] || 0);
    const retryAfter = Number(headers['retry-after'] || 0);
    const nowSec = Math.floor(Date.now() / 1000);
    const waitMs =
      retryAfter > 0
        ? retryAfter * 1000 + 1500
        : resetEpoch >= nowSec
          ? (resetEpoch - nowSec) * 1000 + 1500
          : 61_000;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(urlSubstring)),
    clickTrigger(),
  ]);
  return res;
}

export async function loginAs(
  page: Page,
  role: UserRole | 'customer2' | 'staffCs2',
  override?: { identity?: string; password?: string; skipGoto?: boolean },
): Promise<void> {
  const acc =
    role === 'customer'
      ? ACCOUNTS.customer
      : role === 'customer2'
        ? ACCOUNTS.customer2
        : role === 'staff'
          ? ACCOUNTS.staffCs1
          : role === 'staffCs2'
            ? ACCOUNTS.staffCs2
            : ACCOUNTS.owner;

  if (!override?.skipGoto) {
    await page.goto('/login');
  }
  await expect(page.locator('#login-identity')).toBeVisible();

  await page.locator('#login-identity').fill(override?.identity ?? acc.phone);
  await page.locator('#login-password').fill(override?.password ?? acc.password);
  await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
    page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
  );

  if (role === 'customer' || role === 'customer2') {
    await expect(page).toHaveURL(/\/($|booking|my-bookings|payment)/);
  } else if (role === 'staff' || role === 'staffCs2') {
    await expect(page).toHaveURL(/\/staff\//);
  } else {
    await expect(page).toHaveURL(/\/owner\//);
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

export async function openRoleContext(
  browser: Browser,
  role: 'customer' | 'customer2' | 'staff' | 'owner',
): Promise<{ context: BrowserContext; page: Page; saveAndClose: () => Promise<void> }> {
  const statePath = getAuthStorageStatePath(role);
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  return {
    context,
    page,
    saveAndClose: async () => {
      try {
        const cookies = await context.cookies();
        if (cookies.some((c) => c.name === 'sh_rt' && c.value.length > 0)) {
          await context.storageState({ path: statePath });
        }
      } finally {
        await context.close();
      }
    },
  };
}
