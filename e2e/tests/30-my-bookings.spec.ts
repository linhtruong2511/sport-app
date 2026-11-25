import { ERROR_CATALOG } from '@sporthub/shared/errors';
import { attachConsoleErrorGuard, expect, test } from '../fixtures/test.js';
import {
  apiCancel,
  apiCreateBooking,
  apiCreatePromotion,
  apiDeletePromotion,
  apiFindCourtByCode,
  apiLogin,
  getAuthStorageStatePath,
} from '../fixtures/api.js';
import { nextOpenDate, vnDateStr } from '../fixtures/lanes.js';
import { sendSepayWebhook } from '../fixtures/sepay.js';

function formatVndPlain(amount: number): string {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} VNĐ`;
}

test.describe('30. Lịch đặt, Hủy & Thông báo (MY-01..10)', () => {
  test('MY-01 @p1 Tab trạng thái với đơn seed (COMPLETED, CONFIRMED, EXPIRED, CANCELED) & lọc from > to bị chặn', async ({
    customerPage,
    customer2Page,
  }) => {
    // An có đơn seed B1 (COMPLETED) và B2 (CONFIRMED)
    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('tab-COMPLETED').click();
    await expect(customerPage.locator('.card', { hasText: 'Hoàn thành' }).first()).toBeVisible();

    await customerPage.getByTestId('tab-CONFIRMED').click();
    await expect(customerPage.locator('.card', { hasText: 'Đã xác nhận' }).first()).toBeVisible();

    // Kiểm tra chặn from > to
    await customerPage.getByTestId('my-bookings-from').fill(vnDateStr(10));
    await customerPage.getByTestId('my-bookings-to').fill(vnDateStr(1));
    await expect(
      customerPage.getByText(ERROR_CATALOG.INVALID_DATE_RANGE.defaultMessage),
    ).toBeVisible();

    // Bình (customer2) có đơn seed B4 (EXPIRED) và B5 (CANCELED)
    await customer2Page.goto('/my-bookings');
    await customer2Page.getByTestId('tab-EXPIRED').click();
    await expect(
      customer2Page.locator('.card', { hasText: 'Quá hạn thanh toán' }).first(),
    ).toBeVisible();

    await customer2Page.getByTestId('tab-CANCELED').click();
    await expect(customer2Page.locator('.card', { hasText: 'Đã hủy' }).first()).toBeVisible();
  });

  test('MY-02 @p0 Hủy FULL ≥ 5 ngày → hoàn 100%, khoản hoàn chờ xử lý ở /owner/reconciliation', async ({
    customerPage,
    ownerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS02', 26, 'SAN_TN_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_TN_01',
        date,
        start: '07:00',
        end: '08:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '0201234567',
    });

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(date);
    await customerPage.getByTestId('my-bookings-to').fill(date);
    await customerPage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();

    const modal = customerPage.getByTestId('cancel-booking-modal');
    await expect(modal).toBeVisible();
    await expect(customerPage.getByTestId('cancel-refund-rate')).toHaveText('100%');
    await expect(customerPage.getByTestId('cancel-refund-amount')).toHaveText(
      formatVndPlain(booking.totalAmount),
    );

    await customerPage.getByTestId('confirm-cancel-btn').click();
    await expect(modal).toBeHidden();

    const card = customerPage.locator('.span8 .card', { hasText: `#${booking.bookingCode}` });
    await expect(card).toContainText('Đã hủy');

    await ownerPage.goto('/owner/reconciliation');
    await ownerPage.getByRole('button', { name: /Hoàn tiền chờ xử lý/ }).click();
    await expect(ownerPage.getByText(`#${booking.bookingCode}`)).toBeVisible();
  });

  test('MY-03 @p0 Hủy đơn cọc chưa tất toán → preview hoàn 0, cảnh báo không hoàn cọc', async ({
    customerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS02', 27, 'SAN_TN_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_TN_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'DEPOSIT',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '0201234567',
    });

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(date);
    await customerPage.getByTestId('my-bookings-to').fill(date);
    await customerPage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();
    await expect(customerPage.getByTestId('cancel-booking-modal')).toBeVisible();
    await expect(customerPage.getByTestId('cancel-refund-amount')).toHaveText('0 VNĐ');
    await expect(customerPage.getByTestId('cancel-booking-modal')).toContainText(
      `Tiền cọc giữ lại: ${formatVndPlain(booking.deposit.amount)}`,
    );
  });

  test('MY-04 @p0 Hủy 2 ≤ T < 5 ngày (FULL đã trả, D+3) → hoàn 50%', async ({
    customerPage,
  }) => {
    const cus = await apiLogin('customer');
    // Dùng D+3 (chắc chắn 2 < T < 5 ngày) trên SAN_PB_03
    const date = await nextOpenDate('CS01', 3, 'SAN_PB_03');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_03',
        date,
        start: '10:00',
        end: '11:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(date);
    await customerPage.getByTestId('my-bookings-to').fill(date);
    await customerPage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();
    await expect(customerPage.getByTestId('cancel-booking-modal')).toBeVisible();
    await expect(customerPage.getByTestId('cancel-refund-rate')).toHaveText('50%');
    await expect(customerPage.getByTestId('cancel-refund-amount')).toHaveText(
      formatVndPlain(Math.round(booking.totalAmount * 0.5)),
    );
  });

  test('MY-05 @p1 Lý do hủy bắt buộc & giới hạn 255 ký tự', async ({ customerPage }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 28, 'SAN_PB_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(date);
    await customerPage.getByTestId('my-bookings-to').fill(date);
    await customerPage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();

    const reasonInput = customerPage.getByTestId('cancel-reason-input');
    await reasonInput.fill('   ');
    await customerPage.getByTestId('confirm-cancel-btn').click();
    await expect(customerPage.getByTestId('cancel-booking-modal')).toContainText(
      'Vui lòng chọn hoặc nhập lý do hủy.',
    );

    // maxLength=255 chặn nhập quá 255 ký tự
    await reasonInput.fill('a'.repeat(270));
    const val = await reasonInput.inputValue();
    expect(val.length).toBe(255);
  });

  test('MY-06 @p1 Không có nút hủy cho đơn COMPLETED / CANCELED / EXPIRED', async ({
    customerPage,
    customer2Page,
  }) => {
    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('tab-COMPLETED').click();
    const completedCard = customerPage.locator('.card', { hasText: 'Hoàn thành' }).first();
    await expect(completedCard).toBeVisible();
    await expect(completedCard.locator('[data-testid^="cancel-btn-"]')).toHaveCount(0);

    await customer2Page.goto('/my-bookings');
    await customer2Page.getByTestId('tab-CANCELED').click();
    const canceledCard = customer2Page.locator('.card', { hasText: 'Đã hủy' }).first();
    await expect(canceledCard).toBeVisible();
    await expect(canceledCard.locator('[data-testid^="cancel-btn-"]')).toHaveCount(0);

    await customer2Page.getByTestId('tab-EXPIRED').click();
    const expiredCard = customer2Page.locator('.card', { hasText: 'Quá hạn thanh toán' }).first();
    await expect(expiredCard).toBeVisible();
    await expect(expiredCard.locator('[data-testid^="cancel-btn-"]')).toHaveCount(0);
  });

  test('MY-07 @p0 Xung đột phiên bản: mở modal hủy → NV hủy cùng đơn → khách xác nhận → 409 BOOKING_STATE_CHANGED', async ({
    browser,
  }) => {
    const cus = await apiLogin('customer');
    const staff = await apiLogin('staff');
    const date = await nextOpenDate('CS01', 29, 'SAN_PB_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    const statePath = getAuthStorageStatePath('customer');
    const staleCtx = await browser.newContext({ storageState: statePath });
    const stalePage = await staleCtx.newPage();
    const guard = attachConsoleErrorGuard(stalePage, [/socket\.io/i]);
    await stalePage.route('**/socket.io/**', (route) => route.abort());

    try {
      await stalePage.goto('/my-bookings');
      await stalePage.getByTestId('my-bookings-from').fill(date);
      await stalePage.getByTestId('my-bookings-to').fill(date);
      await stalePage.getByTestId(`cancel-btn-${booking.bookingCode}`).click();
      await expect(stalePage.getByTestId('cancel-booking-modal')).toBeVisible();
      await expect(stalePage.getByTestId('confirm-cancel-btn')).toBeEnabled();

      // Nhân viên hủy cùng đơn qua API trước khi khách bấm Xác nhận hủy
      await apiCancel(
        booking.bookingCode,
        { reason: 'NV hủy trước để test version', version: booking.version },
        staff.accessToken,
      );

      const [conflictRes] = await Promise.all([
        stalePage.waitForResponse(
          (r) => r.url().includes(`/bookings/${booking.bookingCode}/cancel`),
        ),
        stalePage.getByTestId('confirm-cancel-btn').click(),
      ]);
      expect(conflictRes.status()).toBe(409);
      await expect(stalePage.getByTestId('cancel-booking-modal')).toContainText(
        ERROR_CATALOG.BOOKING_STATE_CHANGED.defaultMessage,
      );
      guard.assertClean();
    } finally {
      try {
        const cookies = await staleCtx.cookies();
        if (cookies.some((c) => c.name === 'sh_rt' && c.value.length > 0)) {
          await staleCtx.storageState({ path: statePath });
        }
      } catch {
        // ignore
      }
      await staleCtx.close();
    }
  });

  test('MY-08 @p1 @realtime Thông báo realtime: sau webhook unread tăng, lọc & đánh dấu đã đọc → giảm', async ({
    customerPage,
  }) => {
    await customerPage.goto('/my-bookings');
    const unreadBadge = customerPage.locator('aside .badge', { hasText: /mới$/ });
    await expect(unreadBadge).toBeVisible();
    const countBefore = Number((await unreadBadge.innerText()).match(/\d+/)?.[0] ?? 0);

    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 30, 'SAN_PB_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    // Chờ unread tăng không cần reload
    await expect
      .poll(async () => {
        const txt = await unreadBadge.innerText();
        return Number(txt.match(/\d+/)?.[0] ?? 0);
      })
      .toBeGreaterThan(countBefore);

    await expect(customerPage.getByTestId('nav-unread-count')).toBeVisible();

    // Lọc theo loại PAYMENT_RESULT và chưa đọc
    await customerPage.getByTestId('notif-filter-type').selectOption('PAYMENT_RESULT');
    await customerPage.getByTestId('notif-filter-read').selectOption('unread');
    const notifCard = customerPage.locator('[data-testid^="notif-"]', {
      hasText: booking.bookingCode,
    });
    await expect(notifCard).toBeVisible();

    const afterWebhookCount = Number((await unreadBadge.innerText()).match(/\d+/)?.[0] ?? 0);
    await notifCard.getByRole('button', { name: 'Đánh dấu đã đọc' }).click();

    await expect
      .poll(async () => {
        const txt = await unreadBadge.innerText();
        return Number(txt.match(/\d+/)?.[0] ?? 0);
      })
      .toBeLessThan(afterWebhookCount);
  });

  test('MY-09 @p2 Chủ sân phát hành KM cho tất cả khách → khách nhận thông báo PROMOTION', async ({
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const promoCode = `NOTIF${String(Date.now()).slice(-5)}`;
    const promo = await apiCreatePromotion(
      {
        name: `Ưu đãi thông báo ${promoCode}`,
        code: promoCode,
        discountType: 'PERCENT',
        discountValue: 10,
        allBranches: true,
        allSports: true,
        startDate: vnDateStr(0),
        endDate: vnDateStr(15),
        maxUses: 50,
        audienceType: 'ALL',
        notifyCustomers: true,
      },
      owner.accessToken,
    );

    try {
      await customerPage.goto('/my-bookings');
      await customerPage.getByTestId('notif-filter-type').selectOption('PROMOTION');
      await expect(
        customerPage.locator('[data-testid^="notif-"]', { hasText: promoCode }),
      ).toBeVisible();
    } finally {
      await apiDeletePromotion(promo.promotionId, owner.accessToken);
    }
  });

  test('MY-10 @p1 Đóng đơn do cơ sở (BY_FACILITY) → khách nhận thông báo SCHEDULE_CHANGE', async ({
    customerPage,
    ownerPage,
  }) => {
    const cus = await apiLogin('customer');
    const owner = await apiLogin('owner');
    const court = await apiFindCourtByCode('SAN_PB_01', owner.accessToken);
    const date = await nextOpenDate('CS01', 31, 'SAN_PB_01');
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
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    // Chủ sân khóa SAN_PB_01 khung giờ đó qua UI → đóng đơn BY_FACILITY
    await ownerPage.goto('/owner/courts');
    await ownerPage.getByRole('button', { name: 'Khóa sân / Bảo trì' }).click();
    await ownerPage.locator('aside select').selectOption(String(court.courtId));
    await ownerPage.locator('input[type="datetime-local"]').nth(0).fill(`${date}T07:00`);
    await ownerPage.locator('input[type="datetime-local"]').nth(1).fill(`${date}T10:00`);
    await ownerPage.getByRole('button', { name: 'Tạm khóa sân' }).click();
    await expect(ownerPage.getByRole('heading', { name: /Xác nhận khóa sân/ })).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Xác nhận áp dụng' }).click();

    await ownerPage.getByTestId(`close-btn-${booking.bookingCode}`).click();
    await ownerPage.getByRole('button', { name: 'Xác nhận đóng đơn' }).click();
    await expect(ownerPage.getByText(/Đã đóng đơn/)).toBeVisible();

    // Giải phóng block để không ảnh hưởng test sau
    const releaseBtn = ownerPage.getByRole('button', { name: 'Mở lại sân' }).first();
    if (await releaseBtn.isVisible()) {
      await releaseBtn.click();
    }

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('notif-filter-type').selectOption('SCHEDULE_CHANGE');
    await expect(
      customerPage.locator('[data-testid^="notif-"]', { hasText: booking.bookingCode }),
    ).toBeVisible();
  });
});
