---
description: Tạo khung một module backend theo kiến trúc 4 lớp (vd. /new-module promotions)
argument-hint: <tên-module>
---

Tạo module backend **$ARGUMENTS** trong `backend/src/$ARGUMENTS/` theo `backend/CLAUDE.md` và `backend/README.md`:

- `$ARGUMENTS.module.ts` — module NestJS, import phụ thuộc và export service cần dùng chung.
- `$ARGUMENTS.controller.ts` — khai báo route, gắn guard (`authenticate`, `authorize`, `branchScope`), pipe validate zod, đọc request đã validate, gọi service, trả envelope `{ data, meta }`.
- `$ARGUMENTS.service.ts` — `@Injectable()` nhận dependency qua constructor (repository, clock, settings, service module khác);
  không phụ thuộc `req/res`.
- `$ARGUMENTS.repository.ts` — SQL tham số hóa, nhận `tx` làm tham số đầu.
- `$ARGUMENTS.mapper.ts`, `$ARGUMENTS.schemas.ts`, `__tests__/$ARGUMENTS.service.test.ts` (một test mẫu chạy được).
- Đăng ký module vào `backend/src/app.module.ts` (prefix hiện tại `/api` trong `backend/src/main.ts`, lộ trình `/api/v1`).

Kiểm tra trong `docs/architecture.md` mục 2 module này phụ trách API nào và không lấn sang module khác.
Không viết nghiệp vụ thật ở bước này — chỉ khung + một endpoint mẫu nếu người dùng yêu cầu.
Chạy `npm run typecheck` và test mẫu trước khi báo xong.
