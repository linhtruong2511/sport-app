import { ERROR_CATALOG } from '@sporthub/shared/errors';
import { attachConsoleErrorGuard, expect, test } from '../fixtures/test.js';
import {
  apiCreateStaff,
  apiFindBranchByCode,
  apiLogin,
  apiRegisterCustomer,
  apiRequest,
  waitForAuthRateLimitIfNeeded,
} from '../fixtures/api.js';
import {
  loginAs,
  logoutCurrent,
  submitAuthWithRateLimitRetry,
} from '../fixtures/auth.fixture.js';
import { ACCOUNTS } from '../fixtures/test-data.js';

function encodeLetters(numStr: string): string {
  const letters = 'ABCDEFGHIJ';
  return numStr
    .split('')
    .map((ch) => letters[Number(ch)] ?? 'X')
    .join('');
}

test.describe('10. Xác thực & Tài khoản (AUTH-01..08)', () => {
  test('AUTH-01 @p1 Sai mật khẩu → thông báo backend đúng câu chữ; form không bị xóa', async ({
    page,
  }) => {
    await waitForAuthRateLimitIfNeeded(1);
    await page.goto('/login');

    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill('WrongPass123');

    await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );

    await expect(page.getByRole('alert')).toContainText(
      ERROR_CATALOG.WRONG_PASSWORD.defaultMessage,
    );
    await expect(page.locator('#login-identity')).toHaveValue(ACCOUNTS.customer.phone);
    await expect(page.locator('#login-password')).toHaveValue('WrongPass123');
  });

  test('AUTH-03 @p1 Nhân viên bị khóa 0933445588 → 403 ACCOUNT_LOCKED', async ({ page }) => {
    await waitForAuthRateLimitIfNeeded(1);
    await page.goto('/login');

    await page.locator('#login-identity').fill(ACCOUNTS.staffLocked.phone);
    await page.locator('#login-password').fill(ACCOUNTS.staffLocked.password);

    const res = await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );
    expect(res.status()).toBe(403);
    await expect(page.getByRole('alert')).toContainText(
      ERROR_CATALOG.ACCOUNT_LOCKED.defaultMessage,
    );
  });

  test('AUTH-04 @p2 Đăng nhập bằng email viết HOA → thành công', async ({ page }) => {
    await waitForAuthRateLimitIfNeeded(1);
    await loginAs(page, 'customer', { identity: ACCOUNTS.customer.email.toUpperCase() });
    await expect(page.getByText(ACCOUNTS.customer.name)).toBeVisible();
  });

  test('AUTH-05 @p1 Reload giữ phiên; đăng xuất rồi reload & Back không mở lại trang bảo vệ', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await waitForAuthRateLimitIfNeeded(1);
    await loginAs(page, 'customer');

    await page.goto('/my-bookings');
    await expect(page).toHaveURL(/\/my-bookings/);
    await expect(page.getByRole('heading', { name: /Lịch đặt sân của tôi/ })).toBeVisible();

    // Reload vẫn giữ phiên nhờ cookie refresh sh_rt
    await page.reload();
    await expect(page).toHaveURL(/\/my-bookings/);
    await expect(page.getByRole('heading', { name: /Lịch đặt sân của tôi/ })).toBeVisible();

    await logoutCurrent(page);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/my-bookings');
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  });

  test('AUTH-06 @p1 Đăng ký: validate họ tên có số, mật khẩu không khớp/khoảng trắng, trùng SĐT/email', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Đăng ký hội viên mới' }).click();

    // Họ tên có số (client)
    await page.locator('#reg-fullname').fill('Nguyen Van 123');
    await page.locator('#reg-phone').fill('0971112233');
    await page.locator('#reg-email').fill('valid.reg@example.com');
    await page.locator('#reg-password').fill('Valid1234');
    await page.locator('#reg-confirm').fill('Valid1234');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err').first()).toContainText('chữ cái');

    // Mật khẩu có khoảng trắng (client)
    await page.locator('#reg-fullname').fill('Nguyễn Văn Kiểm');
    await page.locator('#reg-password').fill('Valid 1234');
    await page.locator('#reg-confirm').fill('Valid 1234');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err').first()).toContainText('khoảng trắng');

    // Mật khẩu nhập lại sai (client)
    await page.locator('#reg-password').fill('Valid1234');
    await page.locator('#reg-confirm').fill('Valid9999');
    await page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click();
    await expect(page.locator('.field-err').first()).toContainText('không khớp');

    // Trùng SĐT (backend 409 PHONE_TAKEN)
    await waitForAuthRateLimitIfNeeded(2);
    await page.locator('#reg-phone').fill(ACCOUNTS.customer.phone);
    await page.locator('#reg-email').fill(`uniq.${Date.now()}@example.com`);
    await page.locator('#reg-confirm').fill('Valid1234');
    const phoneRes = await submitAuthWithRateLimitRetry(page, '/api/v1/auth/register', () =>
      page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click(),
    );
    expect(phoneRes.status()).toBe(409);
    await expect(page.locator('.field-err').first()).toContainText(
      ERROR_CATALOG.PHONE_TAKEN.defaultMessage,
    );

    // Trùng email (backend 409 EMAIL_TAKEN)
    const suffix = String(Date.now()).slice(-7);
    await page.locator('#reg-phone').fill(`096${suffix}`);
    await page.locator('#reg-email').fill(ACCOUNTS.customer.email);
    const emailRes = await submitAuthWithRateLimitRetry(page, '/api/v1/auth/register', () =>
      page.getByRole('button', { name: 'Đăng ký & Bắt đầu đặt sân' }).click(),
    );
    expect(emailRes.status()).toBe(409);
    await expect(page.locator('.field-err').first()).toContainText(
      ERROR_CATALOG.EMAIL_TAKEN.defaultMessage,
    );
  });

  test('AUTH-07 @p2 Deep link /my-bookings sau login; khách với from=/owner/* về /', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await waitForAuthRateLimitIfNeeded(2);

    // Case 1: Deep link /my-bookings
    await page.goto('/my-bookings');
    await expect(page).toHaveURL(/\/login/);
    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill(ACCOUNTS.customer.password);
    await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );
    await expect(page).toHaveURL(/\/my-bookings/);
    await logoutCurrent(page);

    // Case 2: Deep link /owner/staff rồi đăng nhập bằng CUSTOMER → chuyển về /
    await page.goto('/owner/staff');
    await expect(page).toHaveURL(/\/login/);
    await page.locator('#login-identity').fill(ACCOUNTS.customer.phone);
    await page.locator('#login-password').fill(ACCOUNTS.customer.password);
    await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );
    await expect(page).toHaveURL(/\/$/);
  });

  test('AUTH-08 @p0 @realtime Thu hồi phiên realtime khi Chủ sân khóa nhân viên', async ({
    browser,
    ownerPage,
  }) => {
    const ownerSession = await apiLogin('owner');
    const cs01 = await apiFindBranchByCode('CS01');
    const suffix = String(Date.now()).slice(-7);
    const phone = `094${suffix}`;
    const staffName = `NV Thu Hồi ${encodeLetters(suffix)}`;
    const staffPass = 'Nv123456';

    await apiCreateStaff(
      {
        fullName: staffName,
        phone,
        email: `revoke.${suffix}@sporthub.vn`,
        branchId: cs01.branchId,
        password: staffPass,
      },
      ownerSession.accessToken,
    );

    // Context A: Nhân viên vừa tạo đăng nhập và mở /staff/orders
    const staffCtx = await browser.newContext();
    const staffPage = await staffCtx.newPage();
    const guard = attachConsoleErrorGuard(staffPage);
    try {
      await waitForAuthRateLimitIfNeeded(1);
      const staffTokenRes = await apiLogin({ identity: phone, password: staffPass }, { forceFresh: true });
      await loginAs(staffPage, 'staff', { identity: phone, password: staffPass });
      await staffPage.getByRole('link', { name: 'Quản lý đơn & Nhận sân' }).click();
      await expect(staffPage).toHaveURL(/\/staff\/orders/);

      // Context B: Chủ sân khóa nhân viên này trên /owner/staff
      await ownerPage.goto('/owner/staff');
      await ownerPage.getByTestId('staff-search').fill(phone);
      const staffRow = ownerPage.locator('table.tbl tbody tr', { hasText: phone });
      await expect(staffRow).toBeVisible();
      await staffRow.getByRole('button', { name: 'Khóa', exact: true }).click();
      await expect(staffRow.getByText('Đã khóa')).toBeVisible();

      // Context A nhận socket auth.revoked và tự đẩy về /login
      await expect(staffPage).toHaveURL(/\/login/, { timeout: 10_000 });

      // Token cũ gọi API bị chặn (401 TOKEN_REVOKED hoặc 403 ACCOUNT_LOCKED)
      let apiErrStatus = 0;
      try {
        await apiRequest('/auth/me', { token: staffTokenRes.accessToken });
      } catch (e) {
        apiErrStatus = (e as { status: number }).status;
      }
      expect([401, 403]).toContain(apiErrStatus);
      guard.assertClean();
    } finally {
      await staffCtx.close();
    }
  });

  test('AUTH-02 @p0 Sai mật khẩu 5 lần (tài khoản riêng) → 423 ACCOUNT_TEMP_LOCKED và nhập đúng vẫn bị chặn', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Cần 1 register + 6 login calls = 7 calls trong cửa sổ 60s
    // Kiểm tra quota bằng 1 probe hoặc đợi nếu cần thiết
    const suffix = String(Date.now()).slice(-7);
    const phone = `095${suffix}`;
    const email = `locktest.${suffix}@example.com`;
    const correctPass = 'LockTest123';

    await waitForAuthRateLimitIfNeeded(1);
    const regSession = await apiRegisterCustomer({
      fullName: 'Tài Khoản Khóa Tạm',
      phone,
      email,
      password: correctPass,
    });
    expect(regSession.user.phone).toBe(phone);

    // Chủ động đảm bảo đủ 6 lượt login trước khi thử sai 5 lần
    // Gọi login probe không hợp lệ nếu còn ít quota? Tốt hơn: nếu bị 429 ở bất kỳ bước nào thì đợi reset rồi thử lại?
    // Không, nếu reset 60s xảy ra giữa 5 lần sai, FailedLoginCount vẫn lưu trong DB (không bị reset theo rate-limit)!
    await page.goto('/login');
    await page.locator('#login-identity').fill(phone);

    let lastStatus = 0;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await page.locator('#login-password').fill(`WrongPass${attempt}`);
      const res = await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
        page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
      );
      lastStatus = res.status();
      if (attempt < 5) {
        expect(lastStatus).toBe(401);
        await expect(page.getByRole('alert')).toContainText(
          ERROR_CATALOG.WRONG_PASSWORD.defaultMessage,
        );
      }
    }

    expect(lastStatus).toBe(423);
    await expect(page.getByRole('alert')).toContainText(
      ERROR_CATALOG.ACCOUNT_TEMP_LOCKED.defaultMessage,
    );

    // Nhập đúng mật khẩu ngay sau đó vẫn bị chặn 423
    await page.locator('#login-password').fill(correctPass);
    const afterRes = await submitAuthWithRateLimitRetry(page, '/api/v1/auth/login', () =>
      page.getByRole('button', { name: 'Đăng nhập ngay' }).click(),
    );
    expect(afterRes.status()).toBe(423);
    await expect(page.getByRole('alert')).toContainText(
      ERROR_CATALOG.ACCOUNT_TEMP_LOCKED.defaultMessage,
    );
  });
});
