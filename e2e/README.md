# SportHub — Bộ Kiểm thử E2E bằng Playwright

Bộ kiểm thử E2E chạy **Full-stack thật** (React SPA `app/` + NestJS Backend `backend/` + SQL Server `SportHub_Test`), tự động reset DB mẫu qua `fixtures/global-setup.ts` trước khi chạy.

## Lệnh chạy nhanh

```bash
cd d:\Jobs\Sports\e2e
npm install

# Chạy toàn bộ bộ kiểm thử E2E (tự động reset SportHub_Test, khởi động backend :3000 và Vite :5173)
npm test

# Chỉ chạy nhóm @smoke
npm run test:smoke

# Chạy có giao diện trình duyệt trực quan
npm run test:headed

# Mở báo cáo HTML
npm run report
```
