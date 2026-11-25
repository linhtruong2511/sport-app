import { ERROR_CATALOG } from '@sporthub/shared/errors';
import { PROMO_REASON_MESSAGES } from '@sporthub/shared/enums';
import { expect, test, attachConsoleErrorGuard } from '../fixtures/test.js';
import {
  apiCreateBooking,
  apiCreatePromotion,
  apiDeletePromotion,
  apiFindBranchByCode,
  apiFindCourtByCode,
  apiFindSportByCode,
  apiGetAvailability,
  apiGetMyBookings,
  apiLogin,
  apiRegisterCustomer,
  waitForAuthRateLimitIfNeeded,
} from '../fixtures/api.js';
import { expireHold, runJob } from '../fixtures/backend-tools.js';
import { nextOpenDate, vnDateStr, vnNowParts } from '../fixtures/lanes.js';
import { sendSepayWebhook } from '../fixtures/sepay.js';
import { loginAs } from '../fixtures/auth.fixture.js';
import { ACCOUNTS, PROMOS } from '../fixtures/test-data.js';

function formatVndPlain(amount: number): string {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} VNĐ`;
}

async function selectSportByText(
  page: import('@playwright/test').Page,
  sportName: string,
): Promise<void> {
  const sportSelect = page.locator('#booking-sport');
  await expect(sportSelect).toBeEnabled();
  const opt = sportSelect.locator('option', { hasText: sportName }).first();
  await expect(opt).toBeAttached();
  const val = await opt.getAttribute('value');
  await sportSelect.selectOption(val!);
}

async function selectBranchByText(
  page: import('@playwright/test').Page,
  branchName: string,
): Promise<void> {
  const branchSelect = page.locator('#booking-branch');
  await expect(branchSelect).toBeEnabled();
  const opt = branchSelect.locator('option', { hasText: branchName }).first();
  await expect(opt).toBeAttached();
  const val = await opt.getAttribute('value');
  await branchSelect.selectOption(val!);
}

async function clickCellByTimeHeader(
  page: import('@playwright/test').Page,
  courtName: string,
  headerStart: string,
): Promise<void> {
  await expect(page.locator('table.sched thead th').nth(1)).toBeVisible();
  const headers = await page.locator('table.sched thead th').allTextContents();
  const colIdx = headers.findIndex((h) => h.trim().startsWith(headerStart));
  expect(colIdx, `Không tìm thấy cột giờ ${headerStart}`).toBeGreaterThan(0);
  const row = page.locator('table.sched tbody tr', { hasText: courtName });
  await expect(row).toBeVisible();
  const cellBtn = row.locator('td').nth(colIdx).locator('button.cell');
  await expect(cellBtn).toBeVisible();
  await cellBtn.click();
}

test.describe('20. Khách hàng: Đặt sân & Thanh toán (CUS-01..16)', () => {
  test('CUS-01 @p0 @realtime FULL + webhook đúng → Payment tự chuyển thành công, /my-bookings hiện Đã xác nhận', async ({
    customerPage,
  }) => {
    const date = await nextOpenDate('CS01', 11, 'SAN_PB_01');
    await customerPage.goto(`/booking?date=${date}`);
    await selectSportByText(customerPage, 'Pickleball');

    const row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    const firstFree = row.locator('button.cell.free').first();
    await expect(firstFree).toBeVisible();

    const [quoteRes] = await Promise.all([
      customerPage.waitForResponse(
        (r) => r.url().includes('/api/v1/bookings/quote') && r.request().method() === 'POST',
      ),
      firstFree.click(),
    ]);
    const quoteJson = (await quoteRes.json()) as {
      data: { amountDueNow: number; totalAmount: number };
    };
    const expectedAmount = quoteJson.data.amountDueNow;

    const [createRes] = await Promise.all([
      customerPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/bookings') && r.request().method() === 'POST',
      ),
      customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    const createJson = (await createRes.json()) as {
      data: { booking: { bookingCode: string; amountDueNow: number } };
    };
    const bookingCode = createJson.data.booking.bookingCode;
    expect(createJson.data.booking.amountDueNow).toBe(expectedAmount);

    await expect(customerPage).toHaveURL(new RegExp(`/payment/${bookingCode}`));
    await expect(customerPage.getByText('1012345678')).toBeVisible();
    await expect(customerPage.getByTestId('qr-amount')).toContainText(
      formatVndPlain(expectedAmount),
    );
    await expect(customerPage.getByTestId('qr-content')).toHaveText(`THANHTOAN ${bookingCode}`);
    await expect(customerPage.getByTestId('hold-countdown')).toBeVisible();

    // Gửi webhook SePay đúng số tiền
    await sendSepayWebhook({
      bookingCode,
      amount: expectedAmount,
      accountNo: '1012345678',
    });

    // Trang Payment tự chuyển thành công nhờ socket booking.paid (không reload)
    await expect(
      customerPage.getByRole('heading', { name: 'Biên nhận thanh toán thành công' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(customerPage.getByText(/Đã xác nhận • Đã thanh toán/)).toBeVisible();

    await customerPage.goto('/my-bookings');
    await customerPage.getByTestId('my-bookings-from').fill(date);
    await customerPage.getByTestId('my-bookings-to').fill(date);
    const card = customerPage.locator('.span8 .card', { hasText: `#${bookingCode}` });
    await expect(card).toBeVisible();
    await expect(card.locator('.badge', { hasText: 'Đã xác nhận' })).toBeVisible();
    await expect(card.locator('.badge', { hasText: 'Đã thanh toán' })).toBeVisible();
  });

  test('CUS-02 @p0 Đặt cọc + KM (ví dụ chuẩn §6: Bóng đá Mini 03, 09:30–11:00, SANGVUI20)', async ({
    customerPage,
  }) => {
    const date = await nextOpenDate('CS02', 12, 'SAN_BD_03', 3);
    await customerPage.goto(`/booking?date=${date}`);
    await selectBranchByText(customerPage, 'Cơ sở 2');
    await selectSportByText(customerPage, 'Bóng đá mini');

    // Lưới bóng đá mini dùng block 90 phút: 09:30 - 11:00 (1,5h * 300k = 450k)
    await clickCellByTimeHeader(customerPage, 'Sân Bóng đá Mini 03', '09:30');

    await customerPage.locator('#booking-promo').fill(PROMOS.morning20);
    await customerPage.getByRole('button', { name: 'Áp dụng' }).click();

    await customerPage.locator('label.radio-card', { hasText: 'Đặt cọc giữ sân' }).click();

    const sidebar = customerPage.locator('aside');
    await expect(sidebar).toContainText('450.000 VNĐ');
    await expect(sidebar).toContainText('- 90.000 VNĐ');
    await expect(sidebar).toContainText('360.000 VNĐ');
    await expect(sidebar).toContainText('108.000 VNĐ');
    await expect(sidebar).toContainText('252.000 VNĐ');

    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/(BK\w+)/);
    const bookingCode = customerPage.url().match(/\/payment\/(BK\w+)/)![1];
    await expect(customerPage.getByTestId('qr-amount')).toContainText('108.000 VNĐ');

    await sendSepayWebhook({
      bookingCode,
      amount: 108_000,
      accountNo: '0201234567',
    });

    await expect(
      customerPage.getByRole('heading', { name: 'Biên nhận thanh toán thành công' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(customerPage.getByText(/Đã đặt cọc/)).toBeVisible();
  });

  test('CUS-03 @p1 Vắt 2 khung giá: PB03 15:00–17:00 → 2 dòng giá, tổng 400.000 VNĐ', async ({
    customerPage,
  }) => {
    const date = await nextOpenDate('CS01', 13, 'SAN_PB_03');
    await customerPage.goto(`/booking?date=${date}`);
    await selectSportByText(customerPage, 'Pickleball');

    // Lưới Pickleball dùng block 120 phút: ô 15:00 - 17:00 đã vắt qua 2 khung giá
    await clickCellByTimeHeader(customerPage, 'Sân Pickleball 03', '15:00');

    const sidebar = customerPage.locator('aside');
    await expect(sidebar).toContainText('Giờ thường (15:00–16:00');
    await expect(sidebar).toContainText('150.000 VNĐ');
    await expect(sidebar).toContainText('Giờ cao điểm (16:00–17:00');
    await expect(sidebar).toContainText('250.000 VNĐ');
    await expect(sidebar).toContainText('400.000 VNĐ');
  });

  test('CUS-04 @p1 Mã KM lỗi qua báo giá hiển thị đúng câu từng reasonCode', async ({
    page,
  }) => {
    // Dùng tài khoản đăng ký mới để test PROMO_WRONG_AUDIENCE với TRIAN10 (An & Bình đều nằm trong danh sách SPECIFIC seed)
    await waitForAuthRateLimitIfNeeded(1);
    const suffix = String(Date.now()).slice(-7);
    const newCus = await apiRegisterCustomer({
      fullName: 'Khách Kiểm KM',
      phone: `098${suffix}`,
      email: `promo.chk.${suffix}@example.com`,
      password: 'Promo1234',
    });
    expect(newCus.user.role).toBe('CUSTOMER');
    await loginAs(page, 'customer', {
      identity: `098${suffix}`,
      password: 'Promo1234',
    });

    const date = await nextOpenDate('CS01', 14, 'SAN_PB_01');
    await page.goto(`/booking?date=${date}`);
    await selectSportByText(page, 'Pickleball');
    await clickCellByTimeHeader(page, 'Sân Pickleball 01', '17:00');

    // 1. PICKLECS01 -> PROMO_INACTIVE
    await page.locator('#booking-promo').fill(PROMOS.pausedPickle);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('aside .field-err')).toContainText(
      PROMO_REASON_MESSAGES.PROMO_INACTIVE,
    );

    // 2. SANGVUI20 lúc 17:00 -> PROMO_OUT_OF_TIME
    await page.locator('#booking-promo').fill(PROMOS.morning20);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('aside .field-err')).toContainText(
      PROMO_REASON_MESSAGES.PROMO_OUT_OF_TIME,
    );

    // 3. TRIAN10 với khách mới -> PROMO_WRONG_AUDIENCE
    await page.locator('#booking-promo').fill(PROMOS.memberSpecific);
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('aside .field-err')).toContainText(
      PROMO_REASON_MESSAGES.PROMO_WRONG_AUDIENCE,
    );

    // 4. Mã không tồn tại -> PROMO_NOT_FOUND
    await page.locator('#booking-promo').fill('KHONGTONTAI99');
    await page.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(page.locator('aside .field-err')).toContainText(
      PROMO_REASON_MESSAGES.PROMO_NOT_FOUND,
    );
  });

  test('CUS-05 @p0 DEPOSIT_NOT_ALLOWED: giảm giá còn dưới mức cọc → khóa lựa chọn đặt cọc', async ({
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const badminton = await apiFindSportByCode('BADMINTON');
    const date = await nextOpenDate('CS01', 15, 'SAN_CL_01');
    const promoCode = `FIX90K${String(Date.now()).slice(-4)}`;

    const createdPromo = await apiCreatePromotion(
      {
        name: 'Giảm cố định 90k cầu lông',
        code: promoCode,
        discountType: 'FIXED',
        discountValue: 90_000,
        allBranches: true,
        allSports: false,
        sportIds: [badminton.sportId],
        startDate: vnDateStr(0),
        endDate: vnDateStr(30),
        maxUses: 20,
      },
      owner.accessToken,
    );

    try {
      await customerPage.goto(`/booking?date=${date}`);
      await selectSportByText(customerPage, 'Cầu lông');

      // 17:00–18:00 (lưới cầu lông hiển thị block 60 phút): 120.000đ - 90.000đ = 30.000đ < cọc 50.000đ
      await clickCellByTimeHeader(customerPage, 'Sân Cầu lông 01', '17:00');

      await customerPage.locator('#booking-promo').fill(promoCode);
      await customerPage.getByRole('button', { name: 'Áp dụng' }).click();

      const sidebar = customerPage.locator('aside');
      await expect(sidebar).toContainText('30.000 VNĐ');
      const depositRadio = sidebar.locator('input[name="paymode"]').nth(1);
      await expect(depositRadio).toBeDisabled();
      await expect(sidebar).toContainText(ERROR_CATALOG.DEPOSIT_NOT_ALLOWED.defaultMessage);
    } finally {
      await apiDeletePromotion(createdPromo.promotionId, owner.accessToken);
    }
  });

  test('CUS-06 @p0 Tổng = 0 → đi thẳng Đã xác nhận / Đã thanh toán, không mở màn QR', async ({
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const badminton = await apiFindSportByCode('BADMINTON');
    const date = await nextOpenDate('CS01', 16, 'SAN_CL_01');
    const promoCode = `FREE90${String(Date.now()).slice(-4)}`;

    const createdPromo = await apiCreatePromotion(
      {
        name: 'Miễn phí cầu lông giờ thường',
        code: promoCode,
        discountType: 'FIXED',
        discountValue: 90_000,
        allBranches: true,
        allSports: false,
        sportIds: [badminton.sportId],
        startDate: vnDateStr(0),
        endDate: vnDateStr(30),
        maxUses: 20,
      },
      owner.accessToken,
    );

    try {
      await customerPage.goto(`/booking?date=${date}`);
      await selectSportByText(customerPage, 'Cầu lông');

      // 08:00–09:00 (lưới cầu lông hiển thị block 60 phút): 80.000đ - 90.000đ = 0 VNĐ
      await clickCellByTimeHeader(customerPage, 'Sân Cầu lông 01', '08:00');

      await customerPage.locator('#booking-promo').fill(promoCode);
      await customerPage.getByRole('button', { name: 'Áp dụng' }).click();
      await expect(customerPage.locator('aside')).toContainText('0 VNĐ');

      const [createRes] = await Promise.all([
        customerPage.waitForResponse(
          (r) => r.url().endsWith('/api/v1/bookings') && r.request().method() === 'POST',
        ),
        customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click(),
      ]);
      const json = (await createRes.json()) as {
        data: { booking: { bookingCode: string; status: string; paymentStatus: string } };
      };
      expect(json.data.booking.status).toBe('CONFIRMED');
      expect(json.data.booking.paymentStatus).toBe('PAID');

      await expect(customerPage).toHaveURL(/\/my-bookings/);
      await customerPage.getByTestId('my-bookings-from').fill(date);
      await customerPage.getByTestId('my-bookings-to').fill(date);
      const card = customerPage.locator('.span8 .card', {
        hasText: `#${json.data.booking.bookingCode}`,
      });
      await expect(card).toBeVisible();
      await expect(card.locator('.badge', { hasText: 'Đã xác nhận' })).toBeVisible();
      await expect(card.locator('.badge', { hasText: 'Đã thanh toán' })).toBeVisible();
    } finally {
      await apiDeletePromotion(createdPromo.promotionId, owner.accessToken);
    }
  });

  test('CUS-07 @p1 Lưới lịch: PB02 bảo trì D+5..D+7, BD02 ngừng khai thác, 01/01/2027 nghỉ lễ, hôm nay quá khứ, đơn seed bận', async ({
    customerPage,
  }) => {
    // 1. PB02 bảo trì D+5..D+7
    await customerPage.goto(`/booking?date=${vnDateStr(5)}`);
    await selectSportByText(customerPage, 'Pickleball');
    const pb02Row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 02' });
    await expect(pb02Row.locator('td.locked').first()).toContainText('Tạm ngưng nhận lịch');

    // 2. BD02 INACTIVE / ngừng khai thác & đơn seed B2 ở CS02 D+2
    await customerPage.goto(`/booking?date=${vnDateStr(2)}`);
    await selectBranchByText(customerPage, 'Cơ sở 2');
    await selectSportByText(customerPage, 'Bóng đá mini');
    await expect(
      customerPage.locator('table.sched tbody tr', { hasText: 'Sân Bóng đá Mini 02' }),
    ).toHaveCount(0);
    // Đơn seed B2 của An ở SAN_BD_03 lúc 09:00-10:30
    const bd03Row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Bóng đá Mini 03' });
    await expect(bd03Row.locator('.cell.play').first()).toBeVisible();

    // 3. Ngày nghỉ lễ seed 01/01/2027
    await customerPage.goto('/booking?date=2027-01-01');
    await expect(customerPage.getByText(/ngày nghỉ/i).first()).toBeVisible();
    await expect(customerPage.getByText(/Nghỉ Tết Dương lịch/).first()).toBeVisible();

    // 4. Hôm nay: khung giờ đã qua không còn đặt được
    const now = vnNowParts();
    if (now.hour >= 6) {
      await customerPage.goto(`/booking?date=${now.date}`);
      await selectSportByText(customerPage, 'Pickleball');
      const pastHourPrefix = `${String(now.hour - 1).padStart(2, '0')}:00`;
      const headers = await customerPage.locator('table.sched thead th').allTextContents();
      const pastCol = headers.findIndex((h) => h.trim().startsWith(pastHourPrefix));
      // Hoặc cột giờ đã qua bị ẩn khỏi visibleSlotIdxs, hoặc nếu còn thì hiển thị "Đã qua" (không phải button.cell.free)
      if (pastCol > 0) {
        const pb01 = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
        await expect(pb01.locator('td').nth(pastCol).locator('button.cell.free')).toHaveCount(0);
      }
    }
  });

  test('CUS-08 @p0 @realtime Trùng lịch + realtime: A đặt → B thấy chuyển bận không reload; B đặt từ trạng thái cũ → 409 SLOT_TAKEN', async ({
    customerPage,
    customer2Page,
    browser,
  }) => {
    const date = await nextOpenDate('CS01', 17, 'SAN_PB_01', 3);
    const cs01 = await apiFindBranchByCode('CS01');
    const pbSport = await apiFindSportByCode('PICKLEBALL', cs01.branchId);
    const url = `/booking?branchId=${cs01.branchId}&sportId=${pbSport.sportId}&date=${date}`;

    await Promise.all([customerPage.goto(url), customer2Page.goto(url)]);

    const rowA = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    const rowB = customer2Page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(rowA.locator('button.cell.free').first()).toBeVisible();
    await expect(rowB.locator('button.cell.free').first()).toBeVisible();

    const freeCountBeforeB = await rowB.locator('button.cell.free').count();

    // 1. A đặt ô đầu tiên qua UI → B tự cập nhật lưới nhờ socket slot.updated (không reload)
    await rowA.locator('button.cell.free').first().click();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/BK/);

    await expect(rowB.locator('button.cell.free')).toHaveCount(freeCountBeforeB - 1, {
      timeout: 10_000,
    });

    // 2. B giữ trạng thái cũ trên một tab mới (chặn socket.io để mô phỏng tab chưa nhận sự kiện kịp),
    // sau đó A đặt ô còn trống kế tiếp qua API, B bấm đặt → 409 SLOT_TAKEN
    const cus2 = await apiLogin('customer2');
    const cus1 = await apiLogin('customer');
    const avail = await apiGetAvailability({
      branchId: cs01.branchId,
      sportId: pbSport.sportId,
      date,
    });
    const pb01 = avail.courts.find((c) => c.code === 'SAN_PB_01')!;
    const targetCell = pb01.cells.find((c) => c.state === 'FREE')!;
    expect(targetCell).toBeTruthy();

    const staleCtx = await browser.newContext();
    const stalePage = await staleCtx.newPage();
    const guard = attachConsoleErrorGuard(stalePage, [/socket\.io/i]);
    // Đặt cookie refresh bằng cách đăng nhập qua UI hoặc chặn socket trên một page mới
    await stalePage.route('**/socket.io/**', (route) => route.abort());
    try {
      await waitForAuthRateLimitIfNeeded(1);
      await loginAs(stalePage, 'customer2', {
        identity: ACCOUNTS.customer2.phone,
        password: ACCOUNTS.customer2.password,
      });
      await stalePage.goto(url);
      await clickCellByTimeHeader(stalePage, 'Sân Pickleball 01', targetCell.start);
      await expect(
        stalePage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }),
      ).toBeEnabled();

      // A đặt đúng ô đó qua API trước khi B bấm submit
      await apiCreateBooking(
        {
          courtId: pb01.courtId,
          date,
          start: targetCell.start,
          end: targetCell.end,
          paymentOption: 'FULL',
        },
        cus1.accessToken,
      );
      expect(cus2.user.role).toBe('CUSTOMER');

      const [conflictRes] = await Promise.all([
        stalePage.waitForResponse(
          (r) => r.url().endsWith('/api/v1/bookings') && r.request().method() === 'POST',
        ),
        stalePage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click(),
      ]);
      expect(conflictRes.status()).toBe(409);
      await expect(
        stalePage.getByText(ERROR_CATALOG.SLOT_TAKEN.defaultMessage).first(),
      ).toBeVisible();
      guard.assertClean();
    } finally {
      await staleCtx.close();
    }
  });

  test('CUS-09 @p1 Hủy giữ chỗ (cancel-hold-btn) → ô trống lại và đặt lại ngay được', async ({
    customerPage,
  }) => {
    const date = await nextOpenDate('CS01', 18, 'SAN_PB_01');
    await customerPage.goto(`/booking?date=${date}`);
    await selectSportByText(customerPage, 'Pickleball');

    const row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    const freeCells = row.locator('button.cell.free');
    const freeBefore = await freeCells.count();

    await freeCells.first().click();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/BK/);

    await customerPage.getByTestId('cancel-hold-btn').click();
    await expect(customerPage.getByTestId('cancel-booking-modal')).toBeVisible();
    await customerPage.getByTestId('confirm-cancel-btn').click();
    await expect(
      customerPage.getByRole('heading', { name: 'Đơn đặt sân đã bị hủy' }),
    ).toBeVisible();

    await customerPage.goto(`/booking?date=${date}`);
    await selectSportByText(customerPage, 'Pickleball');
    await expect(freeCells).toHaveCount(freeBefore);

    // Đặt lại ngay được
    await freeCells.first().click();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/BK/);
  });

  test('CUS-10 @p0 Webhook sai số tiền → Payment vẫn chờ; đối soát hiện WRONG_AMOUNT', async ({
    customerPage,
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 19, 'SAN_PB_01');
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

    const wrongAmount = booking.amountDueNow - 10_000;
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: wrongAmount,
      accountNo: '1012345678',
    });

    await customerPage.goto(`/payment/${booking.bookingCode}`);
    await expect(
      customerPage.getByText(`Đơn đặt sân #${booking.bookingCode} đang chờ bạn thanh toán`),
    ).toBeVisible();

    await staffPage.goto('/staff/reconciliation');
    const reconCard = staffPage.locator('[data-testid^="recon-"]', {
      hasText: booking.bookingCode,
    });
    await expect(reconCard).toBeVisible();
    await expect(reconCard).toContainText('Sai số tiền');
  });

  test('CUS-11 @p1 Webhook trùng id gửi 2 lần → UI chỉ có 1 phiếu thu, không nhân đôi', async ({
    customerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 20, 'SAN_PB_01');
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

    const fixedTxnId = `E2EDUP${Date.now()}`;
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
      txnId: fixedTxnId,
    });
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
      txnId: fixedTxnId,
    });

    await customerPage.goto(`/payment/${booking.bookingCode}`);
    await expect(
      customerPage.getByRole('heading', { name: 'Biên nhận thanh toán thành công' }),
    ).toBeVisible();
    await expect(customerPage.getByText(/Giao dịch PT/)).toHaveCount(1);
    await expect(
      customerPage.locator('.hint .row', { hasText: 'Đã thanh toán:' }),
    ).toContainText(formatVndPlain(booking.totalAmount));
  });

  test('CUS-12 @p1 Kiểm tra lại thanh toán (recheck-payment-btn): bấm liên tiếp → giới hạn 5 giây; đơn vẫn chờ', async ({
    customerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 21, 'SAN_PB_01');
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

    await customerPage.goto(`/payment/${booking.bookingCode}`);
    const recheckBtn = customerPage.getByTestId('recheck-payment-btn');
    await expect(recheckBtn).toBeVisible();

    // Lần 1 (SePay gateway không cấu hình token sẽ trả 502 hoặc 200 chưa có giao dịch)
    await Promise.all([
      customerPage.waitForResponse((r) => r.url().includes('/recheck')),
      recheckBtn.click(),
    ]);

    // Lần 2 ngay lập tức (< 5s) → 429 TOO_MANY_REQUESTS
    const [secondRes] = await Promise.all([
      customerPage.waitForResponse((r) => r.url().includes('/recheck')),
      recheckBtn.click(),
    ]);
    expect(secondRes.status()).toBe(429);
    await expect(
      customerPage.getByText(ERROR_CATALOG.TOO_MANY_REQUESTS.defaultMessage),
    ).toBeVisible();

    // Đơn vẫn chờ thanh toán
    await expect(
      customerPage.getByText(`Đơn đặt sân #${booking.bookingCode} đang chờ bạn thanh toán`),
    ).toBeVisible();
  });

  test('CUS-13 @p0 @jobs Hết hạn giữ chỗ + webhook đến muộn → LATE_PAYMENT ở đối soát', async ({
    customerPage,
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 22, 'SAN_PB_03');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_03',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    expireHold(booking.bookingCode);
    expect(runJob('expireHolds')).toBeGreaterThanOrEqual(1);

    await customerPage.goto(`/payment/${booking.bookingCode}`);
    await expect(
      customerPage.getByRole('heading', { name: 'Đơn đã quá hạn thanh toán' }),
    ).toBeVisible();

    // Webhook đến muộn sau khi đơn đã EXPIRED
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    await staffPage.goto('/staff/reconciliation');
    const reconCard = staffPage.locator('[data-testid^="recon-"]', {
      hasText: booking.bookingCode,
    });
    await expect(reconCard).toBeVisible();
    await expect(reconCard).toContainText('Chuyển trễ hạn giữ chỗ');
  });

  test('CUS-14 @p0 Chặn xem đơn người khác → BOOKING_FORBIDDEN, không lộ dữ liệu', async ({
    customer2Page,
  }) => {
    const cus1 = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 23, 'SAN_PB_01');
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus1.accessToken,
    );

    await customer2Page.goto(`/payment/${booking.bookingCode}`);
    await expect(
      customer2Page.getByRole('heading', { name: 'Không có quyền truy cập đơn đặt sân này' }),
    ).toBeVisible();
    await expect(
      customer2Page.getByText(ERROR_CATALOG.BOOKING_FORBIDDEN.defaultMessage),
    ).toBeVisible();
    await expect(customer2Page.getByText(`THANHTOAN ${booking.bookingCode}`)).toHaveCount(0);
  });

  test('CUS-15 @p1 Idempotency: double-click Tiếp tục thanh toán QR → chỉ tạo 1 đơn', async ({
    customerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 24, 'SAN_PB_01');
    const beforeList = await apiGetMyBookings({ from: date, to: date }, cus.accessToken);
    const countBefore = beforeList.meta.totalItems;

    await customerPage.goto(`/booking?date=${date}`);
    await selectSportByText(customerPage, 'Pickleball');

    const row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await row.locator('button.cell.free').first().click();

    const submitBtn = customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.dblclick();

    await expect(customerPage).toHaveURL(/\/payment\/BK/);

    const afterList = await apiGetMyBookings({ from: date, to: date }, cus.accessToken);
    expect(afterList.meta.totalItems).toBe(countBefore + 1);
  });

  test('CUS-16 @p2 Khách chưa đăng nhập xem /booking, bấm đặt → yêu cầu đăng nhập → quay lại /booking', async ({
    page,
  }) => {
    await waitForAuthRateLimitIfNeeded(1);
    const date = await nextOpenDate('CS01', 25, 'SAN_PB_01');
    await page.goto(`/booking?date=${date}`);
    await selectSportByText(page, 'Pickleball');

    const row = page.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await row.locator('button.cell.free').first().click();

    await page.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill(ACCOUNTS.customer.password);
    await page.getByRole('button', { name: 'Đăng nhập ngay' }).click();

    await expect(page).toHaveURL(new RegExp(`/booking\\?date=${date}`));
  });
});
