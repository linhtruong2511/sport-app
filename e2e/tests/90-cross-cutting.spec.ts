import fs from 'node:fs';
import { firefox, webkit } from '@playwright/test';
import { expect, test, attachConsoleErrorGuard } from '../fixtures/test.js';
import {
  apiCreateBooking,
  apiFindCourtByCode,
  apiLogin,
  getAuthStorageStatePath,
} from '../fixtures/api.js';
import { nextOpenDate } from '../fixtures/lanes.js';

function toVnSlash(isoDate: string): string {
  return isoDate.slice(0, 10).split('-').reverse().join('/');
}

test.describe('90. Xuyên suốt (X-01..06)', () => {
  test('X-01 @p0 Múi giờ trình duyệt America/New_York vẫn hiển thị giờ Việt Nam (bất biến 10)', async ({
    browser,
  }) => {
    const cus = await apiLogin('customer');
    const court = await apiFindCourtByCode('SAN_CL_01');
    const date = await nextOpenDate('CS01', 43, 'SAN_CL_01');
    const { booking } = await apiCreateBooking(
      {
        courtId: court.courtId,
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    const statePath = getAuthStorageStatePath('customer');
    const nyCtx = await browser.newContext({
      storageState: statePath,
      timezoneId: 'America/New_York',
      locale: 'en-US',
    });
    const nyPage = await nyCtx.newPage();
    const guard = attachConsoleErrorGuard(nyPage);

    try {
      // 1. Lưới lịch /booking
      await nyPage.goto(`/booking?branchId=${court.branch.branchId}&sportId=${court.sport.sportId}&date=${date}`);
      await expect(nyPage.locator('table.sched thead')).toContainText('08:00 - 09:00');
      await expect(nyPage.locator('h2').first()).toContainText(toVnSlash(date));

      // 2. Trang Payment
      await nyPage.goto(`/payment/${booking.bookingCode}`);
      await expect(nyPage.getByText(`${toVnSlash(date)} • 08:00 - 09:00`)).toBeVisible();

      // 3. Trang Lịch đặt của tôi
      await nyPage.goto('/my-bookings');
      await nyPage.getByTestId('my-bookings-from').fill(date);
      await nyPage.getByTestId('my-bookings-to').fill(date);
      const card = nyPage.locator('.span8 .card', { hasText: `#${booking.bookingCode}` });
      await expect(card).toBeVisible();
      await expect(card).toContainText(`${toVnSlash(date)} • 08:00 - 09:00`);
      guard.assertClean();
    } finally {
      try {
        const cookies = await nyCtx.cookies();
        if (cookies.some((c) => c.name === 'sh_rt' && c.value.length > 0)) {
          await nyCtx.storageState({ path: statePath });
        }
      } catch {
        // ignore
      }
      await nyCtx.close();
    }
  });

  test('X-02 @p1 Backend lỗi 500 / mất mạng → UI hiện thông báo lỗi, không trắng trang, thử lại được', async ({
    customerPage,
  }) => {
    const date = await nextOpenDate('CS01', 44, 'SAN_PB_01');

    await customerPage.route('**/api/v1/availability**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Đã xảy ra lỗi hệ thống, vui lòng thử lại sau.',
            traceId: 'e2e-500',
          },
        }),
      }),
    );

    await customerPage.goto(`/booking?date=${date}`);
    await expect(
      customerPage.getByText('Đã xảy ra lỗi hệ thống, vui lòng thử lại sau.'),
    ).toBeVisible({ timeout: 10_000 });
    const retryBtn = customerPage.getByRole('button', { name: 'Thử lại' });
    await expect(retryBtn).toBeVisible();

    await customerPage.unroute('**/api/v1/availability**');
    await retryBtn.click();
    await expect(customerPage.locator('table.sched tbody tr', { hasText: 'Sân' }).first()).toBeVisible();
  });

  test('X-03 @p1 XSS: tên khách vãng lai & lý do hủy chứa <img onerror> hiển thị dạng chữ an toàn', async ({
    staffPage,
    customerPage,
  }) => {
    const xssPayload = '<img src=x onerror="window.__xssTriggered=1">';
    const datePos = await nextOpenDate('CS01', 45, 'SAN_CL_01');

    // 1. XSS ở tên khách vãng lai POS
    await staffPage.goto('/staff/booking');
    await staffPage.locator('section input[type="date"]').fill(datePos);
    const clRow = staffPage.locator('table.sched tbody tr', { hasText: 'Sân Cầu lông 01' });
    await clRow.locator('button.cell.free').first().click();
    await staffPage.locator('aside input[placeholder="09xxxxxxxx"]').fill('0909555666');
    await staffPage.locator('aside input[placeholder="Nhập họ tên"]').fill(xssPayload);

    const [posRes] = await Promise.all([
      staffPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/pos/bookings') && r.request().method() === 'POST',
      ),
      staffPage.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/ }).click(),
    ]);
    expect(posRes.status()).toBe(201);
    const posJson = (await posRes.json()) as { data: { booking: { bookingCode: string } } };

    await staffPage.goto('/staff/orders');
    await staffPage.getByTestId('orders-date-filter').fill(datePos);
    const orderRow = staffPage.locator('table.tbl tbody tr', {
      hasText: `#${posJson.data.booking.bookingCode}`,
    });
    await expect(orderRow).toBeVisible();
    await expect(orderRow).toContainText(xssPayload);
    expect(
      await staffPage.evaluate(() => (window as unknown as { __xssTriggered?: number }).__xssTriggered),
    ).toBeUndefined();

    // 2. XSS ở lý do hủy đơn của khách
    const cus = await apiLogin('customer');
    const dateCus = await nextOpenDate('CS01', 46, 'SAN_PB_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_01',
        date: dateCus,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(dateCus);
    await customerPage.getByTestId('my-bookings-to').fill(dateCus);
    await customerPage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();
    await customerPage.getByTestId('cancel-reason-input').fill(xssPayload);
    await customerPage.getByTestId('confirm-cancel-btn').click();
    await expect(customerPage.getByTestId('cancel-booking-modal')).toBeHidden();

    const cusCard = customerPage.locator('.span8 .card', { hasText: `#${booking.bookingCode}` });
    await expect(cusCard).toContainText(xssPayload);
    expect(
      await customerPage.evaluate(
        () => (window as unknown as { __xssTriggered?: number }).__xssTriggered,
      ),
    ).toBeUndefined();
  });

  test('X-04 @p2 Mobile 390×844: Trang chủ → Đặt sân → Payment → Lịch đặt dùng được', async ({
    browser,
  }) => {
    const statePath = getAuthStorageStatePath('customer');
    const mobileCtx = await browser.newContext({
      storageState: statePath,
      viewport: { width: 390, height: 844 },
    });
    const mPage = await mobileCtx.newPage();
    const guard = attachConsoleErrorGuard(mPage);
    const date = await nextOpenDate('CS01', 47, 'SAN_PB_01');

    try {
      await mPage.goto('/');
      await expect(mPage.getByRole('button', { name: /Tìm sân trống ngay/ })).toBeVisible();

      await mPage.goto(`/booking?date=${date}`);
      const sportSelect = mPage.locator('#booking-sport');
      const pbVal = await sportSelect
        .locator('option', { hasText: 'Pickleball' })
        .first()
        .getAttribute('value');
      await sportSelect.selectOption(pbVal!);

      const row = mPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
      await row.locator('button.cell.free').first().click();
      await mPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();

      await expect(mPage).toHaveURL(/\/payment\/BK/);
      await expect(mPage.getByTestId('qr-content')).toBeVisible();

      await mPage.goto('/my-bookings');
      await expect(mPage.getByRole('heading', { name: /Lịch đặt sân của tôi/ })).toBeVisible();
      guard.assertClean();
    } finally {
      try {
        const cookies = await mobileCtx.cookies();
        if (cookies.some((c) => c.name === 'sh_rt' && c.value.length > 0)) {
          await mobileCtx.storageState({ path: statePath });
        }
      } catch {
        // ignore
      }
      await mobileCtx.close();
    }
  });

  test('X-05 @p2 Firefox & WebKit smoke check (skip nếu chưa cài binary trình duyệt)', async ({
    baseURL,
  }) => {
    const ffPath = firefox.executablePath();
    const wkPath = webkit.executablePath();
    const hasFirefox = fs.existsSync(ffPath);
    const hasWebkit = fs.existsSync(wkPath);

    test.skip(
      !hasFirefox && !hasWebkit,
      `Chưa cài Firefox (${ffPath}) và WebKit (${wkPath}) trong ms-playwright.`,
    );

    if (hasFirefox) {
      const b = await firefox.launch();
      const p = await b.newPage();
      await p.goto(baseURL || 'http://localhost:5173');
      await expect(p.getByText(/Chi nhánh/i).first()).toBeVisible();
      await b.close();
    }

    if (hasWebkit) {
      const b = await webkit.launch();
      const p = await b.newPage();
      await p.goto(baseURL || 'http://localhost:5173');
      await expect(p.getByText(/Chi nhánh/i).first()).toBeVisible();
      await b.close();
    }
  });

  test('X-06 @p2 Kiểm tra khả năng truy cập (a11y) cơ bản trên các màn hình chính', async ({
    customerPage,
  }) => {
    // Q-E3: chưa cài @axe-core/playwright nên kiểm tra semantic DOM (lang, heading, alt, accessible button name)
    const routes = ['/', '/booking', '/my-bookings'];
    for (const r of routes) {
      await customerPage.goto(r);
      await expect(customerPage.locator('h1').first()).toBeVisible();
      const a11yReport = await customerPage.evaluate(() => {
        const lang = document.documentElement.getAttribute('lang');
        const h1Count = document.querySelectorAll('h1').length;
        const imgsWithoutAlt = Array.from(document.querySelectorAll('img')).filter(
          (img) => img.getAttribute('alt') === null,
        ).length;
        const emptyButtons = Array.from(document.querySelectorAll('button')).filter((btn) => {
          const text = btn.textContent?.trim() ?? '';
          const aria = btn.getAttribute('aria-label')?.trim() ?? '';
          const title = btn.getAttribute('title')?.trim() ?? '';
          return !text && !aria && !title;
        }).length;
        return { lang, h1Count, imgsWithoutAlt, emptyButtons };
      });
      expect(a11yReport.lang, `Thiếu lang trên ${r}`).toBeTruthy();
      expect(a11yReport.h1Count, `Thiếu h1 trên ${r}`).toBeGreaterThanOrEqual(1);
      expect(a11yReport.imgsWithoutAlt, `Ảnh thiếu alt trên ${r}`).toBe(0);
      expect(a11yReport.emptyButtons, `Button thiếu nhãn trên ${r}`).toBe(0);
    }
  });
});
