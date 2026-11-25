import { test as base, expect, type Browser, type Page } from '@playwright/test';
import { getAuthStorageStatePath } from './api.js';

const DEFAULT_CONSOLE_ALLOWLIST: RegExp[] = [
  /^Failed to load resource:/i,
];

export function attachConsoleErrorGuard(
  page: Page,
  extraAllowlist: RegExp[] = [],
): { assertClean: () => void; clear: () => void } {
  const errors: string[] = [];
  const allowlist = [...DEFAULT_CONSOLE_ALLOWLIST, ...extraAllowlist];

  page.on('pageerror', (err) => {
    errors.push(`[pageerror] ${err.message}`);
  });

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (allowlist.some((re) => re.test(text))) return;
    errors.push(`[console.error] ${text}`);
  });

  return {
    assertClean: () => {
      expect(
        errors,
        `Phát hiện lỗi console/runtime trên trình duyệt:\n${errors.join('\n')}`,
      ).toEqual([]);
    },
    clear: () => {
      errors.length = 0;
    },
  };
}

async function createPersistedRolePage(
  browser: Browser,
  role: 'customer' | 'customer2' | 'staff' | 'owner',
  use: (page: Page) => Promise<void>,
  extraAllowlist: RegExp[],
): Promise<void> {
  const statePath = getAuthStorageStatePath(role);
  const context = await browser.newContext({ storageState: statePath });
  const page = await context.newPage();
  const guard = attachConsoleErrorGuard(page, extraAllowlist);
  try {
    await use(page);
    guard.assertClean();
  } finally {
    try {
      const cookies = await context.cookies();
      if (cookies.some((c) => c.name === 'sh_rt' && c.value.length > 0)) {
        await context.storageState({ path: statePath });
      }
    } catch {
      // ignore if context already closed
    }
    await context.close();
  }
}

export interface E2eFixtures {
  customerPage: Page;
  customer2Page: Page;
  staffPage: Page;
  ownerPage: Page;
  allowConsoleErrors: (patterns: RegExp[]) => void;
}

export const test = base.extend<E2eFixtures>({
  allowConsoleErrors: async ({}, use, testInfo) => {
    const patterns: RegExp[] = [];
    (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist =
      patterns;
    await use((extra) => {
      patterns.push(...extra);
    });
  },

  page: async ({ page }, use, testInfo) => {
    const extra =
      (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist ?? [];
    const guard = attachConsoleErrorGuard(page, extra);
    await use(page);
    guard.assertClean();
  },

  customerPage: async ({ browser }, use, testInfo) => {
    const extra =
      (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist ?? [];
    await createPersistedRolePage(browser, 'customer', use, extra);
  },

  customer2Page: async ({ browser }, use, testInfo) => {
    const extra =
      (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist ?? [];
    await createPersistedRolePage(browser, 'customer2', use, extra);
  },

  staffPage: async ({ browser }, use, testInfo) => {
    const extra =
      (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist ?? [];
    await createPersistedRolePage(browser, 'staff', use, extra);
  },

  ownerPage: async ({ browser }, use, testInfo) => {
    const extra =
      (testInfo as unknown as { _extraConsoleAllowlist?: RegExp[] })._extraConsoleAllowlist ?? [];
    await createPersistedRolePage(browser, 'owner', use, extra);
  },
});

export { expect };
