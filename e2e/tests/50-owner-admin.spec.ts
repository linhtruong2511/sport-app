import { ERROR_CATALOG } from '@sporthub/shared/errors';
import { PROMO_REASON_MESSAGES } from '@sporthub/shared/enums';
import { expect, test } from '../fixtures/test.js';
import {
  apiCreateBooking,
  apiFindBranchByCode,
  apiFindCourtByCode,
  apiGetBranches,
  apiGetOpeningHours,
  apiLogin,
  apiRequest,
  apiUpdateCourt,
  apiUpdateOpeningHours,
  waitForAuthRateLimitIfNeeded,
} from '../fixtures/api.js';
import { loginAs, logoutCurrent, submitAuthWithRateLimitRetry } from '../fixtures/auth.fixture.js';
import { nextOpenDate, vnDateStr } from '../fixtures/lanes.js';
import { sendSepayWebhook } from '../fixtures/sepay.js';
import { ACCOUNTS } from '../fixtures/test-data.js';

function formatVndPlain(amount: number): string {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} VNĐ`;
}

function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function encodeLetters(numStr: string): string {
  const letters = 'ABCDEFGHIJ';
  return numStr
    .split('')
    .map((ch) => letters[Number(ch)] ?? 'X')
    .join('');
}

test.describe('50. Chủ sân quản trị (OWN-01..11)', () => {
  test('OWN-01 @p1 Nhân viên: trùng SĐT, thêm NV CS02, khóa/mở khóa, đổi cơ sở thu hồi phiên, tìm & lọc', async ({
    ownerPage,
    page,
  }) => {
    const suffix = String(Date.now()).slice(-7);
    const phone = `092${suffix}`;
    const staffName = `NV Test ${encodeLetters(suffix)}`;

    await ownerPage.goto('/owner/staff');

    // 1. Trùng SĐT
    await ownerPage.getByRole('button', { name: '+ Thêm nhân viên mới' }).click();
    const modal = ownerPage.locator('.modal');
    await modal.locator('input').nth(0).fill(staffName);
    await modal.locator('input').nth(1).fill(ACCOUNTS.staffCs1.phone);
    await modal.locator('input[type="password"]').fill('NvTest123');
    await modal.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(modal.locator('.field-err')).toContainText(
      /Số điện thoại này đã được sử dụng/,
    );

    // 2. Tạo NV CS02
    const branches = await apiGetBranches();
    const cs01 = branches.find((b) => b.code === 'CS01')!;
    const cs02 = branches.find((b) => b.code === 'CS02')!;
    await modal.locator('input').nth(1).fill(phone);
    await modal.locator('select').nth(0).selectOption(String(cs02.branchId));
    await modal.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(modal).toBeHidden();

    // NV mới đăng nhập vào đúng CS02
    await waitForAuthRateLimitIfNeeded(1);
    await loginAs(page, 'staffCs2', { identity: phone, password: 'NvTest123' });
    await expect(page.getByText(cs02.name)).toBeVisible();
    await logoutCurrent(page);

    // 3. Khóa → không đăng nhập được → Mở khóa
    await ownerPage.getByTestId('staff-search').fill(phone);
    const row = ownerPage.locator('table.tbl tbody tr', { hasText: phone });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Khóa', exact: true }).click();
    await expect(row.getByText('Đã khóa')).toBeVisible();

    await waitForAuthRateLimitIfNeeded(1);
    await page.goto('/login');
    await page.locator('#login-identity').fill(phone);
    await page.locator('#login-password').fill('NvTest123');
    await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );
    await expect(page.getByRole('alert')).toContainText(
      ERROR_CATALOG.ACCOUNT_LOCKED.defaultMessage,
    );

    await row.getByRole('button', { name: 'Mở khóa' }).click();
    await expect(row.getByText('Đang làm việc')).toBeVisible();

    // 4. NV đăng nhập lại → Chủ sân đổi cơ sở sang CS01 → phiên cũ bị thu hồi
    await waitForAuthRateLimitIfNeeded(1);
    await loginAs(page, 'staffCs2', { identity: phone, password: 'NvTest123' });
    await row.getByRole('button', { name: 'Sửa' }).click();
    const editModal = ownerPage.locator('.modal');
    await editModal.locator('select').nth(0).selectOption(String(cs01.branchId));
    await editModal.getByRole('button', { name: 'Lưu thông tin' }).click();
    await expect(editModal).toBeHidden();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // 5. Lọc theo trạng thái
    await ownerPage.getByTestId('staff-search').fill('');
    await ownerPage.getByTestId('staff-status-filter').selectOption('LOCKED');
    await expect(
      ownerPage.locator('table.tbl tbody tr', { hasText: ACCOUNTS.staffLocked.name }),
    ).toBeVisible();
  });

  test('OWN-02 @p1 Sân: trùng tên, court-desc > 500, court-deposit < 10%, sân mới hiện trên lưới khách', async ({
    ownerPage,
    customerPage,
  }) => {
    const cs01 = await apiFindBranchByCode('CS01');
    await ownerPage.goto('/owner/courts');
    await ownerPage.getByTestId('branch-switcher').selectOption(String(cs01.branchId));

    await ownerPage.getByRole('button', { name: '+ Thêm sân mới' }).click();
    const modal = ownerPage.locator('.modal');

    // Mô tả > 500 ký tự bị maxLength chặn ở 500
    await modal.getByTestId('court-desc').fill('x'.repeat(520));
    expect((await modal.getByTestId('court-desc').inputValue()).length).toBe(500);

    // Tỷ lệ cọc < 10% → lỗi
    await modal.locator('input').nth(0).fill('Sân Pickleball 01');
    await modal.getByTestId('court-deposit').fill('5');
    await modal.getByRole('button', { name: 'Lưu thông tin sân' }).click();
    await expect(modal.locator('.field-err')).toContainText('10% – 100%');

    // Trùng tên trong cơ sở → 409 COURT_NAME_DUPLICATE
    await modal.getByTestId('court-deposit').fill('30');
    await modal.getByRole('button', { name: 'Lưu thông tin sân' }).click();
    await expect(modal.locator('.field-err')).toContainText(
      ERROR_CATALOG.COURT_NAME_DUPLICATE.defaultMessage,
    );

    // Tạo sân mới hợp lệ
    const uniqueCourtName = `Sân Pickleball E2E ${String(Date.now()).slice(-4)}`;
    await modal.locator('input').nth(0).fill(uniqueCourtName);
    await modal.locator('select').nth(1).selectOption({ label: 'Pickleball' });
    await modal.getByRole('button', { name: 'Lưu thông tin sân' }).click();
    await expect(modal).toBeHidden();

    // Sân mới xuất hiện trên lưới khách
    const date = await nextOpenDate('CS01', 10);
    await customerPage.goto(`/booking?date=${date}`);
    const sportSelect = customerPage.locator('#booking-sport');
    const pickleVal = await sportSelect
      .locator('option', { hasText: 'Pickleball' })
      .first()
      .getAttribute('value');
    await sportSelect.selectOption(pickleVal!);
    await expect(
      customerPage.locator('table.sched tbody tr', { hasText: uniqueCourtName }),
    ).toBeVisible();
  });

  test('OWN-03 @p0 Bảng giá & snapshot: tạo đơn → sửa giá → đơn cũ giữ giá cũ, báo giá mới dùng giá mới; trùng giờ → PRICE_RULE_OVERLAP', async ({
    ownerPage,
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const cus = await apiLogin('customer');
    const court = await apiFindCourtByCode('SAN_PB_04', owner.accessToken);
    const originalRules = court.priceRules.map((r) => ({
      label: r.label,
      dayOfWeekMask: r.dayOfWeekMask,
      startTime: r.startTime,
      endTime: r.endTime,
      pricePerHour: r.pricePerHour,
    }));

    const date = await nextOpenDate('CS02', 36, 'SAN_PB_04');
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
    const oldPrice = booking.totalAmount;

    try {
      await ownerPage.goto('/owner/courts');
      await ownerPage.getByTestId('branch-switcher').selectOption(String(court.branch.branchId));

      const row = ownerPage.locator('table.tbl tbody tr', { hasText: court.name });
      await row.getByRole('button', { name: 'Cập nhật' }).click();
      const modal = ownerPage.locator('.modal');

      // Thử nhập khung giờ chồng lấn → PRICE_RULE_OVERLAP
      const startRule2 = modal.locator('input[aria-label="Giờ bắt đầu khung 2"]');
      const origRule2Start = await startRule2.inputValue();
      await startRule2.fill('10:00');
      await modal.getByRole('button', { name: 'Lưu thông tin sân' }).click();
      await expect(modal.locator('.field-err')).toContainText(/chồng chéo|trùng/i);
      await startRule2.fill(origRule2Start);

      // Sửa giá khung 1 (giờ thường) lên 190.000
      await modal.locator('input[aria-label="Đơn giá khung 1"]').fill('190000');
      await modal.getByRole('button', { name: 'Lưu thông tin sân' }).click();
      await expect(modal).toBeHidden();

      // Đơn cũ vẫn giữ giá cũ ở chi tiết đơn
      await customerPage.goto('/my-bookings');
      await customerPage.getByTestId('my-bookings-from').fill(date);
      await customerPage.getByTestId('my-bookings-to').fill(date);
      const card = customerPage.locator('.span8 .card', { hasText: `#${booking.bookingCode}` });
      await card.getByRole('button', { name: 'Xem chi tiết' }).click();
      await expect(customerPage.getByTestId('booking-detail-modal')).toContainText(
        formatVndPlain(oldPrice),
      );

      // Báo giá mới dùng giá mới 190.000đ/giờ (block PB 2h -> 380.000 VNĐ)
      await customerPage.goto(`/booking?branchId=${court.branch.branchId}&sportId=${court.sport.sportId}&date=${date}`);
      const gridRow = customerPage.locator('table.sched tbody tr', { hasText: court.name });
      await gridRow.locator('button.cell.free').first().click();
      await expect(customerPage.locator('aside')).toContainText('380.000 VNĐ');
    } finally {
      await apiUpdateCourt(
        court.courtId,
        {
          name: court.name,
          branchId: court.branch.branchId,
          depositType: court.depositType,
          depositValue: court.depositValue,
          status: court.status,
          priceRules: originalRules,
        },
        owner.accessToken,
      );
    }
  });

  test('OWN-04 @p1 Giờ mở cửa: open ≥ close → lỗi; thu hẹp giờ có đơn → cảnh báo dryRun & hiện đơn ảnh hưởng', async ({
    ownerPage,
  }) => {
    const owner = await apiLogin('owner');
    const cus = await apiLogin('customer');
    const cs02 = await apiFindBranchByCode('CS02');
    const originalHours = await apiGetOpeningHours(cs02.branchId, owner.accessToken);
    const date = await nextOpenDate('CS02', 37, 'SAN_PB_04');

    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_PB_04',
        date,
        start: '21:00',
        end: '22:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    try {
      await ownerPage.goto('/owner/courts');
      await ownerPage.getByTestId('branch-switcher').selectOption(String(cs02.branchId));
      await ownerPage.getByRole('button', { name: 'Giờ mở cửa & Ngày nghỉ' }).click();

      // open >= close → lỗi
      const firstOpen = ownerPage.locator('input[type="time"]').nth(0);
      const firstClose = ownerPage.locator('input[type="time"]').nth(1);
      const origOpen = await firstOpen.inputValue();
      await firstOpen.fill('22:00');
      await firstClose.fill('20:00');
      await ownerPage.getByRole('button', { name: 'Lưu giờ mở cửa' }).click();
      await expect(ownerPage.locator('.field-err')).toContainText(
        'Giờ đóng cửa phải lớn hơn giờ mở cửa.',
      );

      // Thu hẹp giờ mọi ngày (áp dụng T2 cho cả tuần) về 05:00 - 20:00
      await firstOpen.fill(origOpen);
      await firstClose.fill('20:00');
      await ownerPage.getByRole('button', { name: 'Áp dụng giờ Thứ Hai cho cả tuần' }).click();
      await ownerPage.getByRole('button', { name: 'Lưu giờ mở cửa' }).click();

      const dryRunModal = ownerPage.locator('.modal');
      await expect(dryRunModal).toBeVisible();
      await expect(dryRunModal).toContainText(`#${booking.bookingCode}`);
      await dryRunModal.getByRole('button', { name: 'Xác nhận áp dụng' }).click();
      await expect(dryRunModal).toBeHidden();

      await expect(ownerPage.getByTestId('affected-warning-list')).toContainText(
        `#${booking.bookingCode}`,
      );
    } finally {
      await apiUpdateOpeningHours(cs02.branchId, originalHours.days, owner.accessToken);
    }
  });

  test('OWN-05 @p1 Ngày nghỉ: quá khứ → lỗi; > 60 ngày → lỗi; trùng đơn → affected; lưới khách hiện nghỉ lễ', async ({
    ownerPage,
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const cus = await apiLogin('customer');
    const cs02 = await apiFindBranchByCode('CS02');
    const date = await nextOpenDate('CS02', 38, 'SAN_TN_01');

    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_TN_01',
        date,
        start: '08:00',
        end: '09:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    let createdHolidayId: number | null = null;
    try {
      await ownerPage.goto('/owner/courts');
      await ownerPage.getByTestId('branch-switcher').selectOption(String(cs02.branchId));
      await ownerPage.getByRole('button', { name: 'Giờ mở cửa & Ngày nghỉ' }).click();

      const aside = ownerPage.locator('aside');
      // Quá khứ
      await aside.locator('input[aria-label="Từ ngày"]').fill(vnDateStr(-1));
      await aside.getByRole('button', { name: '+ Thêm ngày nghỉ' }).click();
      await expect(aside.locator('.field-err')).toContainText(
        'Không thể thêm ngày nghỉ trong quá khứ.',
      );

      // > 60 ngày
      await aside.locator('input[aria-label="Từ ngày"]').fill(date);
      await aside.locator('input[aria-label="Số ngày nghỉ liên tiếp"]').fill('65');
      await aside.getByRole('button', { name: '+ Thêm ngày nghỉ' }).click();
      await expect(aside.locator('.field-err')).toContainText('1 đến 60');

      // Ngày nghỉ trùng đơn trên CS02
      await aside.locator('input[aria-label="Số ngày nghỉ liên tiếp"]').fill('1');
      await aside.locator('select[aria-label="Phạm vi ngày nghỉ"]').selectOption('BRANCH');
      await aside
        .locator('select[aria-label="Chi nhánh nghỉ lễ"]')
        .selectOption(String(cs02.branchId));
      await aside.locator('input[placeholder*="Nghỉ Tết"]').fill('Nghỉ bảo trì E2E');

      const [dryRes] = await Promise.all([
        ownerPage.waitForResponse((r) => r.url().includes('/api/v1/admin/holidays')),
        aside.getByRole('button', { name: '+ Thêm ngày nghỉ' }).click(),
      ]);
      expect(dryRes.status()).toBe(201);

      const modal = ownerPage.locator('.modal');
      await expect(modal).toBeVisible();
      await expect(modal).toContainText(`#${booking.bookingCode}`);

      const [createRes] = await Promise.all([
        ownerPage.waitForResponse((r) => r.url().includes('/api/v1/admin/holidays')),
        modal.getByRole('button', { name: 'Xác nhận áp dụng' }).click(),
      ]);
      const createdJson = (await createRes.json()) as {
        data: { holidays: Array<{ holidayId: number }> };
      };
      createdHolidayId = createdJson.data.holidays[0]?.holidayId ?? null;
      await expect(modal).toBeHidden();
      await expect(ownerPage.getByTestId('affected-warning-list')).toContainText(
        `#${booking.bookingCode}`,
      );

      // Lưới khách hiện ngày nghỉ
      await customerPage.goto(`/booking?branchId=${cs02.branchId}&date=${date}`);
      await expect(customerPage.getByText(/Nghỉ bảo trì E2E/).first()).toBeVisible();
    } finally {
      if (createdHolidayId) {
        await apiRequest(`/admin/holidays/${createdHolidayId}?group=true`, {
          method: 'DELETE',
          token: owner.accessToken,
        });
      }
    }
  });

  test('OWN-06 @p0 Khóa sân → Chuyển sân: giữ mã đơn & tiền, khách nhận SCHEDULE_CHANGE, ô cũ trống, ô mới bận', async ({
    ownerPage,
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const cus = await apiLogin('customer');
    const cl01 = await apiFindCourtByCode('SAN_CL_01', owner.accessToken);
    const cl02 = await apiFindCourtByCode('SAN_CL_02', owner.accessToken);
    const date = await nextOpenDate('CS01', 39, 'SAN_CL_01');

    const { booking } = await apiCreateBooking(
      {
        courtId: cl01.courtId,
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

    let createdBlockId: number | null = null;
    try {
      await ownerPage.goto('/owner/courts');
      await ownerPage.getByTestId('branch-switcher').selectOption(String(cl01.branch.branchId));
      await ownerPage.getByRole('button', { name: 'Khóa sân / Bảo trì' }).click();

      await ownerPage.locator('aside select').selectOption(String(cl01.courtId));
      await ownerPage.locator('input[type="datetime-local"]').nth(0).fill(`${date}T09:00`);
      await ownerPage.locator('input[type="datetime-local"]').nth(1).fill(`${date}T12:00`);
      await ownerPage.getByRole('button', { name: 'Tạm khóa sân' }).click();

      const dryModal = ownerPage.locator('.modal');
      await expect(dryModal).toBeVisible();
      const [blockRes] = await Promise.all([
        ownerPage.waitForResponse((r) => r.url().includes('/api/v1/admin/court-blocks')),
        dryModal.getByRole('button', { name: 'Xác nhận áp dụng' }).click(),
      ]);
      const blockJson = (await blockRes.json()) as {
        data: { block: { blockId: number } | null };
      };
      createdBlockId = blockJson.data.block?.blockId ?? null;
      await expect(dryModal).toBeHidden();

      await expect(ownerPage.getByTestId('affected-warning-list')).toContainText(
        `#${booking.bookingCode}`,
      );
      await ownerPage.getByTestId(`reassign-btn-${booking.bookingCode}`).click();

      const reassignModal = ownerPage.locator('.modal');
      await expect(reassignModal).toBeVisible();
      await reassignModal.getByTestId('reassign-target-court').selectOption(String(cl02.courtId));
      await reassignModal.getByRole('button', { name: 'Xác nhận chuyển' }).click();
      await expect(reassignModal).toBeHidden();

      // Khách nhận thông báo SCHEDULE_CHANGE và đơn giữ nguyên mã + tiền
      await customerPage.goto('/my-bookings');
      await customerPage.getByTestId('my-bookings-from').fill(date);
      await customerPage.getByTestId('my-bookings-to').fill(date);
      await customerPage.getByTestId('notif-filter-type').selectOption('SCHEDULE_CHANGE');
      await expect(
        customerPage.locator('[data-testid^="notif-"]', { hasText: booking.bookingCode }),
      ).toBeVisible();
      await expect(
        customerPage.locator('.span8 .card', { hasText: `#${booking.bookingCode}` }),
      ).toContainText(cl02.name);
    } finally {
      if (createdBlockId) {
        await apiRequest(`/admin/court-blocks/${createdBlockId}/release`, {
          method: 'POST',
          token: owner.accessToken,
        });
      }
    }
  });

  test('OWN-07 @p0 Đóng đơn BY_FACILITY: hoàn 100% kể cả cọc, loại khỏi doanh thu báo cáo', async ({
    ownerPage,
  }) => {
    const owner = await apiLogin('owner');
    const cus = await apiLogin('customer');
    const cl01 = await apiFindCourtByCode('SAN_CL_01', owner.accessToken);
    const date = await nextOpenDate('CS01', 40, 'SAN_CL_01');

    const { booking } = await apiCreateBooking(
      {
        courtId: cl01.courtId,
        date,
        start: '10:00',
        end: '11:00',
        paymentOption: 'DEPOSIT',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    let createdBlockId: number | null = null;
    try {
      await ownerPage.goto('/owner/courts');
      await ownerPage.getByTestId('branch-switcher').selectOption(String(cl01.branch.branchId));
      await ownerPage.getByRole('button', { name: 'Khóa sân / Bảo trì' }).click();

      await ownerPage.locator('aside select').selectOption(String(cl01.courtId));
      await ownerPage.locator('input[type="datetime-local"]').nth(0).fill(`${date}T09:00`);
      await ownerPage.locator('input[type="datetime-local"]').nth(1).fill(`${date}T12:00`);
      await ownerPage.getByRole('button', { name: 'Tạm khóa sân' }).click();

      const dryModal = ownerPage.locator('.modal');
      await expect(dryModal).toBeVisible();
      const [blockRes] = await Promise.all([
        ownerPage.waitForResponse((r) => r.url().includes('/api/v1/admin/court-blocks')),
        dryModal.getByRole('button', { name: 'Xác nhận áp dụng' }).click(),
      ]);
      const blockJson = (await blockRes.json()) as {
        data: { block: { blockId: number } | null };
      };
      createdBlockId = blockJson.data.block?.blockId ?? null;

      await ownerPage.getByTestId(`close-btn-${booking.bookingCode}`).click();
      await ownerPage.locator('.modal').getByRole('button', { name: 'Xác nhận đóng đơn' }).click();
      await expect(ownerPage.getByText(/Đã đóng đơn/)).toBeVisible();

      // Mở lại sân luôn
      if (createdBlockId) {
        await apiRequest(`/admin/court-blocks/${createdBlockId}/release`, {
          method: 'POST',
          token: owner.accessToken,
        });
        createdBlockId = null;
      }

      // Kiểm tra khoản hoàn 100% (kể cả cọc) trong /owner/reconciliation
      await ownerPage.goto('/owner/reconciliation');
      await ownerPage.getByRole('button', { name: /Hoàn tiền chờ xử lý/ }).click();
      const refundRow = ownerPage.locator('.card > div', { hasText: `#${booking.bookingCode}` });
      await expect(refundRow).toBeVisible();
      await expect(refundRow).toContainText(`Hoàn 100% = ${formatVndPlain(booking.amountDueNow)}`);

      // Kiểm tra API báo cáo loại đơn BY_FACILITY khỏi doanh thu
      const reportRes = await apiRequest<{
        data: { summary: { byFacility: number; netRevenue: number; orders: number } };
      }>(`/reports/revenue?from=${date}&to=${date}&courtId=${cl01.courtId}`, {
        token: owner.accessToken,
      });
      expect(reportRes.data.data.summary.byFacility).toBeGreaterThanOrEqual(1);
      expect(reportRes.data.data.summary.netRevenue).toBe(0);
    } finally {
      if (createdBlockId) {
        await apiRequest(`/admin/court-blocks/${createdBlockId}/release`, {
          method: 'POST',
          token: owner.accessToken,
        });
      }
    }
  });

  test('OWN-08 @p1 Khuyến mãi: trùng mã, FIXED, phát hành → khách áp được, tạm dừng → lỗi, sửa mã đã dùng bị khóa, xóa → Ngừng áp dụng', async ({
    ownerPage,
    customerPage,
  }) => {
    const owner = await apiLogin('owner');
    const promoCode = `E2EFIX${String(Date.now()).slice(-4)}`;
    const date = await nextOpenDate('CS01', 15, 'SAN_PB_01');

    await ownerPage.goto('/owner/reports');
    await ownerPage.getByRole('button', { name: /Quản lý khuyến mãi/ }).click();

    // 1. Trùng mã SANGVUI20
    await ownerPage.getByRole('button', { name: '+ Tạo khuyến mãi mới' }).click();
    const modal = ownerPage.locator('.modal');
    await modal.locator('input[placeholder*="Ưu đãi"]').fill('Test Trùng Mã');
    await modal.locator('input[placeholder="SANGVUI20"]').fill('SANGVUI20');
    await modal.getByRole('button', { name: 'Lưu & Phát hành ưu đãi' }).click();
    await expect(modal.locator('.field-err')).toContainText('Mã giảm giá này đã tồn tại.');

    // 2. Tạo mã FIXED
    await modal.getByTestId('promo-discount-type').getByText('Giảm số tiền (VNĐ)').click();
    await modal.locator('input[placeholder*="Ưu đãi"]').fill(`Ưu đãi ${promoCode}`);
    await modal.locator('input[placeholder="SANGVUI20"]').fill(promoCode);
    await modal.getByTestId('promo-fixed-amount').fill('30000');
    const [createRes] = await Promise.all([
      ownerPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/admin/promotions') && r.request().method() === 'POST',
      ),
      modal.getByRole('button', { name: 'Lưu & Phát hành ưu đãi' }).click(),
    ]);
    const promoJson = (await createRes.json()) as { data: { promotionId: number } };
    const promoId = promoJson.data.promotionId;
    await expect(modal).toBeHidden();

    // Khách áp dụng được và tạo đơn (UsedCount = 1)
    await customerPage.goto(`/booking?date=${date}`);
    const sportSelect = customerPage.locator('#booking-sport');
    const pbVal = await sportSelect
      .locator('option', { hasText: 'Pickleball' })
      .first()
      .getAttribute('value');
    await sportSelect.selectOption(pbVal!);
    const pb01Row = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await pb01Row.locator('button.cell.free').first().click();
    await customerPage.locator('#booking-promo').fill(promoCode);
    await customerPage.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(customerPage.locator('aside .field-ok')).toBeVisible();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/BK/);

    // Tạm dừng → khách nhận "đang tạm dừng"
    const promoCard = ownerPage.getByTestId(`promo-card-${promoCode}`);
    await promoCard.getByRole('button', { name: 'Tạm dừng' }).click();
    await expect(promoCard).toContainText('Tạm dừng');

    await customerPage.goto(`/booking?date=${date}`);
    await sportSelect.selectOption(pbVal!);
    await pb01Row.locator('button.cell.free').first().click();
    await customerPage.locator('#booking-promo').fill(promoCode);
    await customerPage.getByRole('button', { name: 'Áp dụng' }).click();
    await expect(customerPage.locator('aside .field-err')).toContainText(
      PROMO_REASON_MESSAGES.PROMO_INACTIVE,
    );

    // Sửa mã khi đã có lượt dùng: ô Code bị disabled trên UI và API trả PROMO_CODE_LOCKED
    await promoCard.getByRole('button', { name: 'Chỉnh sửa' }).click();
    await expect(ownerPage.locator('.modal input[placeholder="SANGVUI20"]')).toBeDisabled();
    await ownerPage.locator('.modal').getByRole('button', { name: 'Đóng' }).click();

    let lockedErr = '';
    try {
      await apiRequest(`/admin/promotions/${promoId}`, {
        method: 'PUT',
        token: owner.accessToken,
        body: {
          name: `Ưu đãi ${promoCode}`,
          code: `${promoCode}X`,
          discountType: 'FIXED',
          discountValue: 30000,
          allBranches: true,
          branchIds: [],
          allSports: true,
          sportIds: [],
          startDate: vnDateStr(0),
          endDate: vnDateStr(29),
          maxUses: 100,
          audienceType: 'ALL',
          customerPhones: [],
        },
      });
    } catch (e) {
      lockedErr = (e as { code: string }).code;
    }
    expect(lockedErr).toBe('PROMO_CODE_LOCKED');

    // Xóa mã đã dùng → chuyển Ngừng áp dụng
    await ownerPage.getByTestId(`promo-delete-${promoCode}`).click();
    await expect(promoCard).toContainText('Ngừng áp dụng');
  });

  test('OWN-09 @p0 Báo cáo: from > to bị chặn, > 366 ngày → INVALID_DATE_RANGE, số khớp API, lọc sân, kỳ trống', async ({
    ownerPage,
  }) => {
    const owner = await apiLogin('owner');

    const [repRes] = await Promise.all([
      ownerPage.waitForResponse((r) => r.url().includes('/api/v1/reports/revenue')),
      ownerPage.goto('/owner/reports'),
    ]);
    const repJson = (await repRes.json()) as {
      data: {
        summary: { netRevenue: number; orders: number };
        byCourt: Array<{ key: string; name: string; orders: number }>;
      };
    };

    // Mọi số hiển thị khớp response /reports/revenue
    await expect(ownerPage.locator('.hero')).toContainText(
      formatVndPlain(repJson.data.summary.netRevenue),
    );
    await expect(ownerPage.getByText(`Lượt đặt & Công suất (${fmtNum(repJson.data.summary.orders)} đơn)`)).toBeVisible();
    const byCourtTable = ownerPage.getByTestId('report-by-court-table');
    await expect(byCourtTable).toBeVisible();
    for (const row of repJson.data.byCourt.slice(0, 3)) {
      await expect(byCourtTable).toContainText(row.name);
    }

    // Lọc theo sân cụ thể
    const courtFilter = ownerPage.getByTestId('report-court-filter');
    const secondOptVal = await courtFilter.locator('option').nth(1).getAttribute('value');
    await courtFilter.selectOption(secondOptVal!);
    await Promise.all([
      ownerPage.waitForResponse((r) => r.url().includes(`courtId=${secondOptVal}`)),
      ownerPage.getByRole('button', { name: 'Lọc dữ liệu' }).click(),
    ]);
    await expect(byCourtTable.locator('tbody tr')).toHaveCount(1);

    // Đặt lại tất cả sân & test from > to
    await courtFilter.selectOption('all');
    const dateInputs = ownerPage.locator('section input[type="date"]');
    await dateInputs.nth(0).fill(vnDateStr(5));
    await dateInputs.nth(1).fill(vnDateStr(1));
    await ownerPage.getByRole('button', { name: 'Lọc dữ liệu' }).click();
    await expect(
      ownerPage.getByText('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.'),
    ).toBeVisible();

    // Kỳ > 366 ngày → API 400 INVALID_DATE_RANGE
    await dateInputs.nth(0).fill('2025-01-01');
    await dateInputs.nth(1).fill('2027-01-01');
    const [invalidRes] = await Promise.all([
      ownerPage.waitForResponse((r) => r.url().includes('/api/v1/reports/revenue')),
      ownerPage.getByRole('button', { name: 'Lọc dữ liệu' }).click(),
    ]);
    expect(invalidRes.status()).toBe(400);
    await expect(ownerPage.getByText('Khoảng thời gian tra cứu tối đa 366 ngày.')).toBeVisible();

    // Kỳ trống hiện thông báo
    await dateInputs.nth(0).fill('2030-01-01');
    await dateInputs.nth(1).fill('2030-01-05');
    await Promise.all([
      ownerPage.waitForResponse((r) => r.url().includes('from=2030-01-01')),
      ownerPage.getByRole('button', { name: 'Lọc dữ liệu' }).click(),
    ]);
    await expect(
      ownerPage.getByText('Không có dữ liệu phát sinh trong khoảng thời gian đã chọn.'),
    ).toBeVisible();
    expect(owner.user.role).toBe('OWNER');
  });

  test('OWN-10 @p1 Hoàn tiền: đánh dấu COMPLETED / FAILED ở /owner/reconciliation và lưu sau reload', async ({
    ownerPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 42, 'SAN_PB_01');
    // Tạo 2 đơn FULL đã thanh toán → hủy trước >= 5 ngày để sinh 2 khoản hoàn PENDING
    const b1 = await apiCreateBooking(
      { courtCode: 'SAN_PB_01', date, start: '08:00', end: '09:00', paymentOption: 'FULL' },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: b1.booking.bookingCode,
      amount: b1.booking.amountDueNow,
      accountNo: '1012345678',
    });
    const b2 = await apiCreateBooking(
      { courtCode: 'SAN_PB_01', date, start: '09:00', end: '10:00', paymentOption: 'FULL' },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: b2.booking.bookingCode,
      amount: b2.booking.amountDueNow,
      accountNo: '1012345678',
    });

    const apiCancelFn = async (code: string) => {
      await apiRequest(`/bookings/${code}/cancel`, {
        method: 'POST',
        token: cus.accessToken,
        body: {
          cancelType: 'CUSTOMER_REQUEST',
          reason: 'Hủy để kiểm hoàn tiền E2E',
          version: (await apiRequest<{ data: { version: string } }>(`/bookings/${code}`, { token: cus.accessToken })).data.data.version,
        },
      });
    };
    await apiCancelFn(b1.booking.bookingCode);
    await apiCancelFn(b2.booking.bookingCode);

    await ownerPage.goto('/owner/reconciliation');
    await ownerPage.getByRole('button', { name: /Hoàn tiền chờ xử lý/ }).click();

    // Đánh dấu COMPLETED cho b1
    const card1 = ownerPage.locator('.card > div', { hasText: `#${b1.booking.bookingCode}` });
    await expect(card1).toBeVisible();
    await card1.getByRole('button', { name: 'Đánh dấu đã hoàn tiền' }).click();
    await expect(card1).toBeHidden();

    // Đánh dấu FAILED cho b2
    const card2 = ownerPage.locator('.card > div', { hasText: `#${b2.booking.bookingCode}` });
    await expect(card2).toBeVisible();
    await card2.getByRole('button', { name: 'Hoàn thất bại' }).click();
    const failModal = ownerPage.locator('.modal');
    await failModal.locator('textarea').fill('Sai số tài khoản nhận hoàn');
    await failModal.getByRole('button', { name: 'Xác nhận thất bại' }).click();
    await expect(card2).toBeHidden();

    // Reload kiểm tra lưu bền vững
    await ownerPage.reload();
    await ownerPage.getByRole('button', { name: /Hoàn tiền chờ xử lý/ }).click();
    await ownerPage.getByRole('button', { name: 'Đã hoàn tiền', exact: true }).click();
    await expect(ownerPage.getByText(`#${b1.booking.bookingCode}`)).toBeVisible();

    await ownerPage.getByRole('button', { name: 'Hoàn thất bại', exact: true }).click();
    await expect(ownerPage.getByText(`#${b2.booking.bookingCode}`)).toBeVisible();
  });

  test('OWN-11 @p1 branch-switcher của Chủ sân đổi đúng dữ liệu trên /staff/stats và /staff/orders', async ({
    ownerPage,
  }) => {
    const cs01 = await apiFindBranchByCode('CS01');
    const cs02 = await apiFindBranchByCode('CS02');

    await ownerPage.goto('/staff/stats');
    const switcher = ownerPage.getByTestId('branch-switcher');
    await expect(switcher).toBeVisible();

    await switcher.selectOption(String(cs01.branchId));
    await expect(ownerPage.getByText(new RegExp(`Phạm vi:.*${cs01.name}`))).toBeVisible();

    await switcher.selectOption(String(cs02.branchId));
    await expect(ownerPage.getByText(new RegExp(`Phạm vi:.*${cs02.name}`))).toBeVisible();

    await ownerPage.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
    await expect(ownerPage).toHaveURL(/\/staff\/orders/);
    await ownerPage.getByTestId('branch-switcher').selectOption(String(cs01.branchId));
    await expect(ownerPage.getByText(new RegExp(cs01.name))).toBeVisible();
    await ownerPage.getByTestId('branch-switcher').selectOption(String(cs02.branchId));
    await expect(ownerPage.getByText(new RegExp(cs02.name))).toBeVisible();
  });
});
