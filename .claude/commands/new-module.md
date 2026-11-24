---
description: Tạo khung một module backend theo kiến trúc 4 lớp (vd. /new-module promotions)
argument-hint: <tên-module>
---

Tạo module backend **$ARGUMENTS** trong `apps/api/src/modules/$ARGUMENTS/` theo `apps/api/CLAUDE.md`:

- `$ARGUMENTS.routes.ts` — router Express, gắn `authenticate`, `authorize`, `branchScope` (nếu STAFF+), `validate`.
- `$ARGUMENTS.controller.ts` — chỉ đọc request đã validate, gọi service, trả envelope `{ data, meta }`.
- `$ARGUMENTS.service.ts` — class/func nhận dependency qua tham số (repository, clock, settings, service module khác);
  không import `express`.
- `$ARGUMENTS.repository.ts` — SQL tham số hóa, nhận `tx` làm tham số đầu.
- `$ARGUMENTS.mapper.ts`, `$ARGUMENTS.schemas.ts`, `__tests__/$ARGUMENTS.service.test.ts` (một test mẫu chạy được).
- Đăng ký router vào `app.ts` dưới `/api/v1`.

Kiểm tra trong `docs/architecture.md` mục 2 module này phụ trách API nào và không lấn sang module khác.
Không viết nghiệp vụ thật ở bước này — chỉ khung + một endpoint mẫu nếu người dùng yêu cầu.
Chạy `npm run typecheck` và test mẫu trước khi báo xong.
