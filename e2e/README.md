# SportHub — Bộ Kiểm thử E2E bằng Playwright

Bộ kiểm thử E2E chạy **Full-stack thật** (React SPA `app/` + NestJS Backend `backend/` + SQL Server `SportHub_Test`), tự động reset DB mẫu qua `fixtures/global-setup.ts` trước khi chạy.

> **Lưu ý cổng trước khi chạy:** Đảm bảo không có dev server nào đang chiếm cổng `3000` (Backend) hoặc `5173` (Vite) trừ khi chạy với `E2E_SKIP_WEBSERVER=1`.

## Lệnh chạy nhanh

```bash
cd d:\Jobs\Sports\e2e
npm install

# Chạy toàn bộ bộ kiểm thử E2E (tự động reset SportHub_Test, khởi động backend :3000 và Vite :5173)
npm test

# Chỉ chạy nhóm @smoke / @p0 / @p1 / @jobs / @realtime
npm run test:smoke
npm run test:p0
npm run test:p1
npm run test:jobs
npm run test:realtime

# Kiểm tra TypeScript cho bộ test
npm run typecheck

# Chạy có giao diện trình duyệt trực quan / UI mode
npm run test:headed
npm run test:ui

# Mở báo cáo HTML
npm run report
```

## Biến môi trường hỗ trợ

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DB_TEST_DATABASE` | `SportHub_Test` | Tên DB SQL Server kiểm thử |
| `E2E_BASE_URL` | `http://localhost:5173` | URL frontend Vite |
| `E2E_API_BASE_URL` | `http://localhost:3000/api/v1` | URL backend REST API |
| `E2E_SEPAY_API_KEY` | `sporthub-dev-sepay-key` | API key gửi webhook SePay giả lập (`fixtures/sepay.ts`) |
| `E2E_SKIP_WEBSERVER` | *(rỗng)* | Đặt `1` nếu đã tự khởi động server test bên ngoài |
| `E2E_SKIP_DB_RESET` | *(rỗng)* | Đặt `1` để bỏ qua reset DB trong `global-setup.ts` |

## Hạ tầng & Làn dữ liệu (`fixtures/`)

- `tests/auth.setup.ts` (project `setup`): đăng nhập 4 tài khoản seed (`customer`, `customer2`, `staff`, `owner`) một lần đầu phiên, lưu cookie `sh_rt` vào `e2e/.auth/*.json` để giảm lượt `/auth/login` (tránh rate limit `10 req/phút`).
- `fixtures/test.ts`: mở rộng `test` với console/pageerror guard (`I-06`) và cung cấp `customerPage`, `customer2Page`, `staffPage`, `ownerPage` (tự động lưu lại `sh_rt` xoay vòng khi đóng context).
- `fixtures/api.ts`: helper gọi REST API (`apiLogin`, `apiCreateBooking`, `apiQuote`, `apiCancel`, …).
- `fixtures/sepay.ts`: `sendSepayWebhook(...)` gửi webhook SePay thật tới `POST /api/v1/webhooks/bank/sepay`.
- `fixtures/lanes.ts`: `nextOpenDate(branchCode, minDaysAhead, courtCode)` tự bỏ qua ngày nghỉ lễ (`BranchHolidays`) và lịch bảo trì sân (`CourtBlocks`), cấp làn ngày riêng cho từng kịch bản.

## Job nền và dời thời gian (R-15)

Backend E2E chạy `NODE_ENV=test` nên cron bị tắt. Muốn kiểm tra luồng phụ thuộc thời gian, dùng `fixtures/backend-tools.ts`:

```ts
import { expireHold, runJob, shiftBooking } from '../fixtures/backend-tools.js';

expireHold(bookingCode);          // HoldExpireAt + QR PENDING về quá khứ
runJob('expireHolds');            // chạy job một lần, trả số bản ghi bị tác động
shiftBooking(bookingCode, -120);  // dời StartAt/EndAt, slots, price lines (không vắt qua nửa đêm)
```

- Helper gọi `node backend/dist/scripts/e2eTools.js`, nên cần bản build backend (`webServer` đã chạy `npm run build`).
- Job chạy ở tiến trình riêng nên **không phát socket**: sau khi gọi phải `page.reload()` hoặc chờ API.
- Job quét toàn bảng: kiểm tra trạng thái đơn cụ thể trên UI, không assert số bản ghi chính xác.
- Chạy riêng nhóm này: `npm run test:jobs`.
