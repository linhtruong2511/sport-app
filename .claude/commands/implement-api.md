---
description: Triển khai một API theo mã trong SDD (vd. /implement-api API-13)
argument-hint: API-xx
---

Triển khai **$ARGUMENTS** cho SportHub. Làm đúng thứ tự, không bỏ bước:

1. **Đọc đặc tả**: tìm `$ARGUMENTS` trong `docs/SDD.md` mục 5.5 (endpoint, quyền, request, response, xử lý phía
   server, lỗi nghiệp vụ). Đọc use case liên quan trong `docs/SRS.md`. Đọc `docs/decisions.md` và các mục liên quan
   trong `docs/business-rules.md`. Nếu thiếu `docs/SDD.md`, dừng và nhắc người dùng chuyển docx sang md.
2. **Tóm tắt kế hoạch** (ngắn) trước khi code:
   - module + file sẽ tạo/sửa;
   - quyền, `branchScope`, Idempotency-Key, `version` có cần không (bảng ở `docs/api-conventions.md` mục 1);
   - danh sách **đầy đủ** mã lỗi và điều kiện;
   - bảng CSDL đọc/ghi (đúng tên trong `database/sporthub_init.sql`), transaction, khóa;
   - sự kiện socket/thông báo phát sau commit;
   - mâu thuẫn phát hiện giữa SDD/SRS/decisions → **hỏi** thay vì tự chọn.
3. **Test trước**: viết test cho quy tắc tiền/trạng thái và từng mã lỗi (unit cho hàm thuần, integration cho luồng có DB).
4. **Code** theo 4 lớp (module/guard → controller → service → repository trong `backend/src/`); dùng mapper chung cho DTO; zod schema từ
   `@sporthub/shared` khi có.
5. **Kiểm tra**: `npm run lint`, `npm run typecheck`, test liên quan. Sửa tới khi xanh.
6. **Cập nhật** bảng "API đã xong" trong `docs/roadmap.md`; thêm R-xx vào `docs/decisions.md` nếu người dùng vừa chốt điều gì.
7. Báo lại: đã làm gì, test nào chạy, điểm còn mở.
