# SportHub — Bộ Test UI Prototype bằng Playwright

Bộ kiểm thử E2E **thuần giao diện (100% UI Prototype, không cần Backend)** bao phủ:
- **13 kịch bản liên hoàn đa màn hình & đa vai trò** (`UI-J01` – `UI-J13`) trong `tests/01`–`04`
- **28 kịch bản nghiệm thu SRS còn thiếu/sai trên Prototype** (`SRS-UI-01` – `SRS-UI-28`) trong `tests/05-srs-ui-compliance-gaps.spec.ts`

Xem chi tiết quy trình tại [`../docs/02-quy-trinh-e2e-test-playwright.md`](../docs/02-quy-trinh-e2e-test-playwright.md).

## Lệnh chạy nhanh

```bash
cd d:\Jobs\Sports\e2e
npm install

# 1. Chạy toàn bộ 41 kịch bản (13 kịch bản hoàn chỉnh + 28 kịch bản SRS — mặc định `IS_SRS_FULL = true` trong `fixtures/srs.ts`)
npm test

# 2. Chỉ chạy 13 kịch bản hoàn chỉnh xuyên suốt (01..04)
npm run test:journeys

# 3. Chạy kiểm định toàn bộ 41 kịch bản SRS với cờ SRS_FULL=1 tường minh
npm run test:srs-audit

# 4. Chạy có giao diện trình duyệt trực quan để quan sát luồng chạy
npm run test:headed

# 5. Mở báo cáo HTML (kèm screenshot/video/trace)
npm run report
```
