import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..', 'app');
const BACKEND_DIR = path.resolve(__dirname, '..', 'backend');
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const BACKEND_HEALTH_URL = process.env.E2E_API_HEALTH_URL || 'http://localhost:3000/api/v1/health/db';

function resolveCachedChromium(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return undefined;
  const cacheDir = path.join(localAppData, 'ms-playwright');
  if (!fs.existsSync(cacheDir)) return undefined;
  const candidates = fs
    .readdirSync(cacheDir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const dir of candidates) {
    const exe = path.join(cacheDir, dir, 'chrome-win64', 'chrome.exe');
    if (fs.existsSync(exe)) return exe;
    const exeLegacy = path.join(cacheDir, dir, 'chrome-win', 'chrome.exe');
    if (fs.existsSync(exeLegacy)) return exeLegacy;
  }
  return undefined;
}

const cachedExe = resolveCachedChromium();

export default defineConfig({
  testDir: './tests',
  globalSetup: './fixtures/global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 7_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
  ],
  use: {
    baseURL: BASE_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        ...(cachedExe ? { launchOptions: { executablePath: cachedExe } } : {}),
      },
    },
  ],
  webServer: process.env.E2E_SKIP_WEBSERVER
    ? undefined
    : [
        {
          command: 'npm run build && npm run start',
          cwd: BACKEND_DIR,
          url: BACKEND_HEALTH_URL,
          reuseExistingServer: false,
          timeout: 60_000,
          env: {
            NODE_ENV: 'test',
            PORT: '3000',
            TZ: 'Asia/Ho_Chi_Minh',
            DB_DATABASE: process.env.DB_TEST_DATABASE || 'SportHub_Test',
          },
        },
        {
          command: 'npm run dev -- --port 5173 --strictPort',
          cwd: APP_DIR,
          url: BASE_URL,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      ],
});
