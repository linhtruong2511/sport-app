import { test as setup } from '@playwright/test';
import { apiLogin, writeStorageStateFromLogin } from '../fixtures/api.js';

/**
 * I-04: Đăng nhập một lần cho các vai trò seed và lưu storageState (`sh_rt` cookie).
 * Các spec dùng lại storageState để giảm lượt gọi /auth/login (tránh rate limit 10 req/min).
 */
setup('Khởi tạo phiên storageState cho các vai trò seed', async () => {
  const roles = ['customer', 'customer2', 'staff', 'owner'] as const;
  for (const role of roles) {
    const session = await apiLogin(role, { forceFresh: true });
    writeStorageStateFromLogin(role, session);
  }
});
