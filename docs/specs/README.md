# Tài liệu đặc tả gốc

Bản Markdown của tài liệu đặc tả gốc hiện được đặt trực tiếp tại thư mục `docs/` (`docs/SRS.md` và `docs/SDD.md`, kèm hình ảnh tại `docs/images/srs/` và `docs/images/sdd/`) để công cụ đọc thuận tiện (không cần đọc `.docx` trực tiếp):

```bash
pandoc SRS.docx -t gfm --wrap=none -o docs/SRS.md
pandoc SDD.docx -t gfm --wrap=none -o docs/SDD.md
```

Khi tài liệu gốc thay đổi: chuyển lại sang Markdown vào `docs/SRS.md` / `docs/SDD.md`, so sánh
diff, và cập nhật `docs/business-rules.md` / `docs/decisions.md` nếu quy tắc đổi.

| File | Nội dung | Tra cứu khi |
| --- | --- | --- |
| `docs/SRS.md` | 19 FR, 24 use case, luồng thay thế, trường dữ liệu đầu vào | Cần câu chữ thông báo, luồng ngoại lệ của một UC |
| `docs/SDD.md` | Kiến trúc, 26 bảng, quy tắc tính tiền, 73 API, webhook, socket | Cần request/response/lỗi cụ thể của API-xx |

Script CSDL dự kiến nằm ở `database/sporthub_init.sql` (không đặt ở đây).
