import { ERROR_CATALOG } from '@sporthub/shared/errors';
import { expect, test } from '../fixtures/test.js';
import {
  apiCancel,
  apiCreateBooking,
  apiCreatePosBooking,
  apiFindBranchByCode,
  apiFindSportByCode,
  apiGetAvailability,
  apiGetBookingDetail,
  apiLogin,
  apiPosCheckIn,
  apiRequest,
} from '../fixtures/api.js';
import { runJob, shiftBooking } from '../fixtures/backend-tools.js';
import { nextOpenDate, vnDateStr, vnNowParts } from '../fixtures/lanes.js';
import { sendSepayWebhook } from '../fixtures/sepay.js';
import { ACCOUNTS } from '../fixtures/test-data.js';

function formatVndPlain(amount: number): string {
  return `${Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} VNĐ`;
}

function fmtNum(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

test.describe('40. Nhân viên POS & Vận hành (POS-01..12)', () => {
  test('POS-01 @p0 Khách vãng lai, tiền mặt 100%: validate thiếu tên/SĐT → tạo đơn → hiện phiếu thu', async ({
    staffPage,
  }) => {
    const date = await nextOpenDate('CS01', 32, 'SAN_CL_01');
    await staffPage.goto('/staff/booking');
    await staffPage.locator('section input[type="date"]').fill(date);

    const row = staffPage.locator('table.sched tbody tr', { hasText: 'Sân Cầu lông 01' });
    await expect(row.locator('button.cell.free').first()).toBeVisible();
    await row.locator('button.cell.free').first().click();

    // Thiếu SĐT
    await staffPage.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/ }).click();
    await expect(staffPage.getByText(/Số điện thoại khách không hợp lệ/)).toBeVisible();

    // Đủ SĐT nhưng thiếu tên
    await staffPage.locator('aside input[placeholder="09xxxxxxxx"]').fill('0908111222');
    await staffPage.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/ }).click();
    await expect(staffPage.getByText(/Vui lòng nhập họ và tên khách/)).toBeVisible();

    // Đủ thông tin → tạo đơn tiền mặt 100%
    await staffPage.locator('aside input[placeholder="Nhập họ tên"]').fill('Lê Khách Vãng Lai');
    const [res] = await Promise.all([
      staffPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/pos/bookings') && r.request().method() === 'POST',
      ),
      staffPage.getByRole('button', { name: /Xác nhận thu tiền & Tạo đơn/ }).click(),
    ]);
    expect(res.status()).toBe(201);
    const json = (await res.json()) as {
      data: {
        booking: { bookingCode: string; paidAmount: number; status: string; paymentStatus: string };
        receipt: { paymentCode: string; amount: number } | null;
      };
    };
    expect(json.data.booking.status).toBe('CONFIRMED');
    expect(json.data.booking.paymentStatus).toBe('PAID');
    expect(json.data.receipt).not.toBeNull();

    await expect(staffPage.getByText('🧾 Phiếu thu gần nhất tại quầy')).toBeVisible();
    await expect(
      staffPage.locator('section').getByText(`#${json.data.booking.bookingCode}`).first(),
    ).toBeVisible();
    await expect(staffPage.getByText(json.data.receipt!.paymentCode)).toBeVisible();
  });

  test('POS-02 @p0 @realtime Hội viên + QR cọc: tra SĐT → tạo QR → webhook → POS cập nhật realtime', async ({
    staffPage,
  }) => {
    const date = await nextOpenDate('CS01', 33, 'SAN_CL_01');
    await staffPage.goto('/staff/booking');
    await staffPage.locator('section input[type="date"]').fill(date);

    const row = staffPage.locator('table.sched tbody tr', { hasText: 'Sân Cầu lông 01' });
    await expect(row.locator('button.cell.free').first()).toBeVisible();
    await row.locator('button.cell.free').first().click();

    await staffPage.getByRole('button', { name: 'Hội viên có tài khoản' }).click();
    await staffPage.locator('aside input[placeholder="09xxxxxxxx"]').fill(ACCOUNTS.customer.phone);
    await staffPage.getByRole('button', { name: 'Tra cứu' }).click();
    await expect(staffPage.getByText(new RegExp(ACCOUNTS.customer.name))).toBeVisible();

    await staffPage.locator('label.radio-card', { hasText: /Thu cọc giữ sân/ }).click();
    await staffPage.locator('label.radio-card', { hasText: /Quét mã VietQR/ }).click();

    const [createRes] = await Promise.all([
      staffPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/pos/bookings') && r.request().method() === 'POST',
      ),
      staffPage.getByRole('button', { name: /Tạo đơn & Hiện mã VietQR/ }).click(),
    ]);
    expect(createRes.status()).toBe(201);
    const json = (await createRes.json()) as {
      data: { booking: { bookingCode: string; amountDueNow: number } };
    };
    const { bookingCode, amountDueNow } = json.data.booking;

    await expect(staffPage.getByTestId('pos-qr-image')).toBeVisible();
    await expect(staffPage.getByTestId('pos-qr-content')).toHaveText(`THANHTOAN ${bookingCode}`);
    await expect(staffPage.getByText(/Mã QR còn hiệu lực:/)).toBeVisible();

    await sendSepayWebhook({
      bookingCode,
      amount: amountDueNow,
      accountNo: '1012345678',
    });

    await expect(
      staffPage.getByText(`Đã xác nhận thanh toán VietQR cho đơn #${bookingCode}.`),
    ).toBeVisible({ timeout: 10_000 });
    await expect(staffPage.getByTestId('pos-qr-image')).toBeHidden();
  });

  test('POS-03 @p0 @jobs Tất toán → (đơn vẫn Đã xác nhận) → Nhận sân → Kết thúc & Hoàn thành (dùng shiftBooking)', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const now = vnNowParts();
    // Tạo đơn đặt cọc trên SAN_BR_01 cho ngày mai 10:00–11:00 rồi dời về hôm nay trong cửa sổ nhận sân sớm 15'
    const tomorrow = vnDateStr(1);
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_BR_01',
        date: tomorrow,
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

    const targetStartMin = Math.min(22 * 60, Math.max(5 * 60, now.totalMinutes + 5));
    const deltaMinutes = targetStartMin - (24 * 60 + 10 * 60);
    shiftBooking(booking.bookingCode, deltaMinutes);

    await staffPage.goto('/staff/orders');
    const row = staffPage.locator('table.tbl tbody tr', { hasText: `#${booking.bookingCode}` });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: /Thu nốt / }).click();
    const modal = staffPage.getByTestId('settle-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(formatVndPlain(booking.remainingAmount));

    await modal.getByRole('button', { name: /Đã thu đủ/ }).click();
    await expect(modal).toBeHidden();

    // R-16: tất toán chỉ thu tiền → đơn vẫn Đã xác nhận (PAID); nhân viên bấm "Nhận sân ngay" mới sang Đang sử dụng
    await expect(row).toContainText('Đã xác nhận');
    await expect(row).not.toContainText('Đang sử dụng');
    await row.getByRole('button', { name: 'Nhận sân ngay' }).click();
    await expect(row).toContainText('Đang sử dụng');
    await row.getByRole('button', { name: /Kết thúc & Hoàn thành/ }).click();
    await expect(row).toContainText('Hoàn thành');
  });

  test('POS-04 @p0 @jobs Nhận sân khi chưa trả đủ → 422 PAYMENT_INCOMPLETE và UI chỉ mở tất toán', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const staff = await apiLogin('staff');
    const now = vnNowParts();
    const tomorrow = vnDateStr(1);
    const { booking } = await apiCreateBooking(
      {
        courtCode: 'SAN_BR_01',
        date: tomorrow,
        start: '12:00',
        end: '13:00',
        paymentOption: 'DEPOSIT',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: booking.bookingCode,
      amount: booking.amountDueNow,
      accountNo: '1012345678',
    });

    const targetStartMin = Math.min(22 * 60, Math.max(5 * 60, now.totalMinutes + 6));
    const deltaMinutes = targetStartMin - (24 * 60 + 12 * 60);
    shiftBooking(booking.bookingCode, deltaMinutes);

    const detail = await apiGetBookingDetail(booking.bookingCode, staff.accessToken);
    let errCode = '';
    try {
      await apiRequest(`/pos/bookings/${booking.bookingCode}/check-in`, {
        method: 'POST',
        token: staff.accessToken,
        body: { version: detail.version },
      });
    } catch (e) {
      errCode = (e as { code: string }).code;
    }
    expect(errCode).toBe('PAYMENT_INCOMPLETE');

    await staffPage.goto('/staff/orders');
    const row = staffPage.locator('table.tbl tbody tr', { hasText: `#${booking.bookingCode}` });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Nhận sân ngay' })).toHaveCount(0);
    await row.getByRole('button', { name: /Thu nốt / }).click();
    await expect(staffPage.getByTestId('settle-modal')).toBeVisible();

    // Dọn đơn này để không ảnh hưởng POS-05/07 nếu cùng ngày
    await staffPage.getByTestId('settle-modal').getByRole('button', { name: 'Đóng' }).click();
    await apiCancel(
      booking.bookingCode,
      { reason: 'Dọn dữ liệu test POS-04', version: detail.version },
      staff.accessToken,
    );
  });

  test('POS-05 @p1 @jobs Nhận sân khi sân còn đơn IN_USE → 409 COURT_IN_USE, hiện mã đơn chặn', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const staff = await apiLogin('staff');
    const now = vnNowParts();
    const tomorrow = vnDateStr(1);

    // Đơn A: sẽ chuyển thành IN_USE trên SAN_BR_01
    const resA = await apiCreatePosBooking(
      {
        courtCode: 'SAN_BR_01',
        date: tomorrow,
        start: '14:00',
        end: '15:00',
        paymentOption: 'FULL',
        cashAmount: 200_000,
      },
      staff.accessToken,
    );
    const targetStartA = Math.min(21 * 60, Math.max(5 * 60, now.totalMinutes + 2));
    shiftBooking(resA.booking.bookingCode, targetStartA - (24 * 60 + 14 * 60));
    await apiPosCheckIn(resA.booking.bookingCode, staff.accessToken);

    // Đơn B: CONFIRMED + PAID cùng sân SAN_BR_01, giờ ngay sau đơn A
    const resB = await apiCreateBooking(
      {
        courtCode: 'SAN_BR_01',
        date: tomorrow,
        start: '16:00',
        end: '17:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: resB.booking.bookingCode,
      amount: resB.booking.amountDueNow,
      accountNo: '1012345678',
    });
    const targetStartB = Math.min(22 * 60, Math.max(6 * 60, now.totalMinutes + 4));
    shiftBooking(resB.booking.bookingCode, targetStartB - (24 * 60 + 16 * 60));

    await staffPage.goto('/staff/orders');
    const rowB = staffPage.locator('table.tbl tbody tr', {
      hasText: `#${resB.booking.bookingCode}`,
    });
    await expect(rowB).toBeVisible();

    const [checkInRes] = await Promise.all([
      staffPage.waitForResponse((r) =>
        r.url().includes(`/pos/bookings/${resB.booking.bookingCode}/check-in`),
      ),
      rowB.getByRole('button', { name: 'Nhận sân ngay' }).click(),
    ]);
    expect(checkInRes.status()).toBe(409);
    await expect(staffPage.getByText(new RegExp(`#${resA.booking.bookingCode}`)).first()).toBeVisible();

    // Kết thúc đơn A để giải phóng SAN_BR_01
    const rowA = staffPage.locator('table.tbl tbody tr', {
      hasText: `#${resA.booking.bookingCode}`,
    });
    await rowA.getByRole('button', { name: /Kết thúc & Hoàn thành/ }).click();
    await expect(rowA).toContainText('Hoàn thành');
  });

  test('POS-06 @p1 COUNTER_ABORT: tạo đơn QR tại quầy, khách bỏ đi → Hủy tạo đơn → ô trống lại', async ({
    staffPage,
  }) => {
    const date = await nextOpenDate('CS01', 34, 'SAN_CL_01');
    await staffPage.goto('/staff/booking');
    await staffPage.locator('section input[type="date"]').fill(date);

    const row = staffPage.locator('table.sched tbody tr', { hasText: 'Sân Cầu lông 01' });
    const freeCells = row.locator('button.cell.free');
    await expect(freeCells.first()).toBeVisible();
    const freeBefore = await freeCells.count();

    await freeCells.first().click();
    await staffPage.locator('aside input[placeholder="09xxxxxxxx"]').fill('0907333444');
    await staffPage.locator('aside input[placeholder="Nhập họ tên"]').fill('Khách Hủy Quầy');
    await staffPage.locator('label.radio-card', { hasText: /Quét mã VietQR/ }).click();
    await staffPage.getByRole('button', { name: /Tạo đơn & Hiện mã VietQR/ }).click();

    await expect(staffPage.getByTestId('pos-qr-image')).toBeVisible();
    await staffPage.getByRole('button', { name: 'Hủy tạo đơn' }).click();

    await expect(staffPage.getByTestId('pos-qr-image')).toBeHidden();
    await expect(freeCells).toHaveCount(freeBefore);
  });

  test('POS-07 @p0 @jobs NO_SHOW: quá sớm → NO_SHOW_NOT_ELIGIBLE; DEPOSITED ≥ StartAt+30p → hủy giữ cọc; PAID chỉ đủ từ EndAt', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const staff = await apiLogin('staff');
    const now = vnNowParts();
    const tomorrow = vnDateStr(1);

    // 1. Đơn DEPOSITED
    const dep = await apiCreateBooking(
      {
        courtCode: 'SAN_CL_02',
        date: tomorrow,
        start: '10:00',
        end: '11:00',
        paymentOption: 'DEPOSIT',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: dep.booking.bookingCode,
      amount: dep.booking.amountDueNow,
      accountNo: '1012345678',
    });

    // Dời StartAt về now - 15 phút (chưa đủ 30 phút)
    const depShift1 = now.totalMinutes - 15 - (24 * 60 + 10 * 60);
    shiftBooking(dep.booking.bookingCode, depShift1);

    let earlyErr = '';
    try {
      await apiCancel(
        dep.booking.bookingCode,
        { cancelType: 'NO_SHOW', reason: 'Thử no-show sớm' },
        staff.accessToken,
      );
    } catch (e) {
      earlyErr = (e as { code: string }).code;
    }
    expect(earlyErr).toBe('NO_SHOW_NOT_ELIGIBLE');

    // Dời thêm -20 phút → StartAt = now - 35 phút (đủ điều kiện NO_SHOW)
    shiftBooking(dep.booking.bookingCode, -20);

    // 2. Đơn PAID: dời StartAt về now - 40 phút (EndAt = now + 20 phút) → chưa đến EndAt nên chưa được NO_SHOW!
    const paid = await apiCreateBooking(
      {
        courtCode: 'SAN_CL_02',
        date: tomorrow,
        start: '14:00',
        end: '15:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: paid.booking.bookingCode,
      amount: paid.booking.amountDueNow,
      accountNo: '1012345678',
    });
    const paidShift1 = now.totalMinutes - 40 - (24 * 60 + 14 * 60);
    shiftBooking(paid.booking.bookingCode, paidShift1);

    let paidEarlyErr = '';
    try {
      await apiCancel(
        paid.booking.bookingCode,
        { cancelType: 'NO_SHOW', reason: 'Thử no-show đơn PAID trước EndAt' },
        staff.accessToken,
      );
    } catch (e) {
      paidEarlyErr = (e as { code: string }).code;
    }
    expect(paidEarlyErr).toBe('NO_SHOW_NOT_ELIGIBLE');

    await staffPage.goto('/staff/orders');
    const rowPaid = staffPage.locator('table.tbl tbody tr', {
      hasText: `#${paid.booking.bookingCode}`,
    });
    await expect(rowPaid).toBeVisible();
    await expect(rowPaid.getByRole('button', { name: 'Hủy đơn & Mở sân' })).toHaveCount(0);

    const rowDep = staffPage.locator('table.tbl tbody tr', {
      hasText: `#${dep.booking.bookingCode}`,
    });
    await expect(rowDep).toBeVisible();
    await rowDep.getByRole('button', { name: 'Hủy đơn & Mở sân' }).click();

    const noShowModal = staffPage.getByTestId('no-show-confirm-modal');
    await expect(noShowModal).toBeVisible();
    await expect(noShowModal).toContainText(formatVndPlain(dep.booking.paidAmount));
    await noShowModal.getByRole('button', { name: 'Xác nhận hủy & Mở sân' }).click();
    await expect(noShowModal).toBeHidden();
    await expect(rowDep).toContainText('Đã hủy');

    // Dời đơn PAID qua EndAt (-25 phút → EndAt = now - 5 phút) → đủ điều kiện
    shiftBooking(paid.booking.bookingCode, -25);
    await staffPage.reload();
    await expect(rowPaid.getByRole('button', { name: 'Hủy đơn & Mở sân' })).toBeVisible();

    // Dọn bằng job closePaidNoShows hoặc hủy no-show
    expect(runJob('closePaidNoShows')).toBeGreaterThanOrEqual(1);
  });

  test('POS-08 @p0 Phạm vi cơ sở: NV CS01 không thấy đơn CS02, tra mã CS02 → BRANCH_FORBIDDEN, không có branch-switcher', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const staff = await apiLogin('staff');
    const date = await nextOpenDate('CS02', 2, 'SAN_BD_03');
    const cs02Booking = await apiCreateBooking(
      {
        courtCode: 'SAN_BD_03',
        date,
        start: '18:00',
        end: '19:00',
        paymentOption: 'FULL',
      },
      cus.accessToken,
    );

    await staffPage.goto('/staff/orders');
    await expect(staffPage.getByTestId('branch-switcher')).toHaveCount(0);

    await staffPage.getByTestId('orders-date-filter').fill(date);
    await staffPage
      .locator('input[placeholder="Mã đơn, tên hoặc SĐT khách"]')
      .fill(cs02Booking.booking.bookingCode);
    await staffPage.getByRole('button', { name: 'Tìm đơn' }).click();
    await expect(staffPage.getByText('Không có đơn nào phù hợp.')).toBeVisible();

    let errCode = '';
    try {
      await apiGetBookingDetail(cs02Booking.booking.bookingCode, staff.accessToken);
    } catch (e) {
      errCode = (e as { code: string }).code;
    }
    expect(errCode).toBe('BRANCH_FORBIDDEN');
  });

  test('POS-09 @p1 Thống kê: KPI khớp /dashboard/daily, kpi-drilldown-modal, đổi stats-date-picker', async ({
    staffPage,
  }) => {
    const [dashRes] = await Promise.all([
      staffPage.waitForResponse((r) => r.url().includes('/api/v1/dashboard/daily')),
      staffPage.goto('/staff/stats'),
    ]);
    const dashJson = (await dashRes.json()) as {
      data: {
        kpis: { totalBookings: number; playingCourts: number; totalCourts: number };
        revenue: { total: number };
      };
    };

    await expect(staffPage.getByTestId('kpi-total-bookings')).toContainText(
      `${dashJson.data.kpis.totalBookings} lượt đặt`,
    );
    await expect(staffPage.getByTestId('kpi-playing-courts')).toContainText(
      `${dashJson.data.kpis.playingCourts} / ${dashJson.data.kpis.totalCourts} sân`,
    );
    await expect(staffPage.getByTestId('kpi-revenue')).toContainText(
      `${fmtNum(dashJson.data.revenue.total)} VNĐ`,
    );

    await staffPage.getByTestId('kpi-total-bookings').click();
    await expect(staffPage.getByTestId('kpi-drilldown-modal')).toBeVisible();
    await staffPage.getByTestId('kpi-drilldown-modal').getByRole('button', { name: 'Đóng' }).click();

    const tomorrow = vnDateStr(1);
    const [tomorrowRes] = await Promise.all([
      staffPage.waitForResponse(
        (r) => r.url().includes('/api/v1/dashboard/daily') && r.url().includes(`date=${tomorrow}`),
      ),
      staffPage.getByTestId('stats-date-picker').fill(tomorrow),
    ]);
    expect(tomorrowRes.status()).toBe(200);
  });

  test('POS-10 @p1 @realtime Realtime chéo vai trò: khách đặt online → lưới POS đổi ô sang bận không cần reload', async ({
    staffPage,
    customerPage,
  }) => {
    const date = await nextOpenDate('CS01', 35, 'SAN_PB_01');
    const cs01 = await apiFindBranchByCode('CS01');
    const pbSport = await apiFindSportByCode('PICKLEBALL', cs01.branchId);

    await staffPage.goto('/staff/booking');
    await staffPage.locator('section input[type="date"]').fill(date);
    await Promise.all([
      staffPage.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/pos/schedule') &&
          r.url().includes(`sportId=${pbSport.sportId}`),
      ),
      staffPage.locator('section select').selectOption(String(pbSport.sportId)),
    ]);

    const posRow = staffPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await expect(posRow.locator('button.cell.free').first()).toBeVisible();
    const posFreeBefore = await posRow.locator('button.cell.free').count();

    // Khách đặt ô đầu tiên qua UI
    await customerPage.goto(`/booking?branchId=${cs01.branchId}&sportId=${pbSport.sportId}&date=${date}`);
    const cusRow = customerPage.locator('table.sched tbody tr', { hasText: 'Sân Pickleball 01' });
    await cusRow.locator('button.cell.free').first().click();
    await customerPage.getByRole('button', { name: /Tiếp tục thanh toán QR/i }).click();
    await expect(customerPage).toHaveURL(/\/payment\/BK/);

    // Lưới POS tự cập nhật không cần reload
    await expect(posRow.locator('button.cell.free')).toHaveCount(posFreeBefore - 1, {
      timeout: 10_000,
    });
  });

  test('POS-11 @p0 Đối soát tay: Hoàn lại khách (ghi chú bắt buộc), Khớp đơn, Bỏ qua', async ({
    staffPage,
  }) => {
    const cus = await apiLogin('customer');
    const date = await nextOpenDate('CS01', 35, 'SAN_PB_03');

    // Tạo 1 giao dịch sai số tiền (WRONG_AMOUNT)
    const bWrong = await apiCreateBooking(
      { courtCode: 'SAN_PB_03', date, start: '08:00', end: '09:00', paymentOption: 'FULL' },
      cus.accessToken,
    );
    await sendSepayWebhook({
      bookingCode: bWrong.booking.bookingCode,
      amount: bWrong.booking.amountDueNow - 5000,
      accountNo: '1012345678',
    });

    // Tạo 1 đơn + giao dịch sai nội dung nhưng đúng số tiền (để Khớp đơn)
    const bMatch = await apiCreateBooking(
      { courtCode: 'SAN_PB_03', date, start: '09:00', end: '10:00', paymentOption: 'FULL' },
      cus.accessToken,
    );
    const unknownContent = `CHUYEN KHOAN TEST ${Date.now()}`;
    await sendSepayWebhook({
      content: unknownContent,
      amount: bMatch.booking.amountDueNow,
      accountNo: '1012345678',
    });

    // Tạo 1 giao dịch rác để Bỏ qua
    const ignoreContent = `CHUYEN NHAM ${Date.now()}`;
    await sendSepayWebhook({
      content: ignoreContent,
      amount: 123_000,
      accountNo: '1012345678',
    });

    await staffPage.goto('/staff/reconciliation');

    // 1. Hoàn lại khách (ghi chú bắt buộc >= 3 ký tự)
    const wrongCard = staffPage.locator('[data-testid^="recon-"]', {
      hasText: bWrong.booking.bookingCode,
    });
    await expect(wrongCard).toBeVisible();
    await wrongCard.getByRole('button', { name: 'Hoàn lại khách' }).click();
    const refundModal = staffPage.locator('.modal');
    await refundModal.getByRole('button', { name: 'Xác nhận hoàn lại khách' }).click();
    await expect(refundModal.locator('.field-err')).toContainText('tối thiểu 3 ký tự');

    await refundModal.locator('textarea').fill('Đã chuyển hoàn lại khách qua STK');
    await refundModal.getByRole('button', { name: 'Xác nhận hoàn lại khách' }).click();
    await expect(wrongCard).toBeHidden();

    // 2. Khớp tay
    const matchCard = staffPage.locator('[data-testid^="recon-"]', { hasText: unknownContent });
    await expect(matchCard).toBeVisible();
    await matchCard.getByRole('button', { name: 'Khớp đơn' }).click();
    const matchModal = staffPage.locator('.modal');
    await matchModal
      .locator('input[placeholder="Nhập mã đơn, tên hoặc SĐT khách..."]')
      .fill(bMatch.booking.bookingCode);
    const candidateLabel = matchModal.locator('label.radio-card', {
      hasText: bMatch.booking.bookingCode,
    });
    await expect(candidateLabel).toBeVisible();
    await candidateLabel.click();
    await matchModal.getByRole('button', { name: 'Xác nhận khớp đơn' }).click();
    await expect(matchCard).toBeHidden();

    // 3. Bỏ qua
    const ignoreCard = staffPage.locator('[data-testid^="recon-"]', { hasText: ignoreContent });
    await expect(ignoreCard).toBeVisible();
    await ignoreCard.getByRole('button', { name: 'Bỏ qua' }).click();
    await expect(ignoreCard).toBeHidden();
  });

  test('POS-12 @p2 Bộ lọc ngày, tìm theo mã/SĐT và chuyển tab ở /staff/orders', async ({
    staffPage,
  }) => {
    const tomorrow = vnDateStr(1);
    await staffPage.goto('/staff/orders');
    await staffPage.getByTestId('orders-date-filter').fill(tomorrow);

    // Seed B3 ở CS01 ngày D+1, khách vãng lai Trần Minh Hoàng (0905112233)
    await expect(staffPage.locator('table.tbl tbody tr', { hasText: '0905112233' })).toBeVisible();

    await staffPage.locator('input[placeholder="Mã đơn, tên hoặc SĐT khách"]').fill('0905112233');
    await staffPage.getByRole('button', { name: 'Tìm đơn' }).click();
    await expect(staffPage.locator('table.tbl tbody tr', { hasText: 'Trần Minh Hoàng' })).toBeVisible();

    await staffPage.getByRole('button', { name: /Chờ khách nhận sân/ }).click();
    await expect(staffPage.locator('table.tbl tbody tr', { hasText: 'Trần Minh Hoàng' })).toBeVisible();

    await staffPage.getByRole('button', { name: /Đã hủy/ }).click();
    await expect(staffPage.getByText('Không có đơn nào phù hợp.')).toBeVisible();
  });
});
