# Tài liệu đặc tả gốc

Đặt bản Markdown của tài liệu gốc vào thư mục này để Claude Code đọc được (Claude Code không đọc `.docx` thuận tiện):

```bash
pandoc SRS.docx -t gfm --wrap=none -o docs/specs/SRS.md
pandoc SDD.docx -t gfm --wrap=none -o docs/specs/SDD.md
```

Giữ file `.docx` gốc ở `docs/specs/source/` nếu muốn lưu vết. Khi tài liệu gốc thay đổi: chuyển lại sang Markdown, so sánh
diff, và cập nhật `docs/business-rules.md` / `docs/decisions.md` nếu quy tắc đổi.

| File | Nội dung | Tra cứu khi |
| --- | --- | --- |
| `SRS.md` | 19 FR, 24 use case, luồng thay thế, trường dữ liệu đầu vào | Cần câu chữ thông báo, luồng ngoại lệ của một UC |
| `SDD.md` | Kiến trúc, 26 bảng, quy tắc tính tiền, 73 API, webhook, socket | Cần request/response/lỗi cụ thể của API-xx |

Script CSDL nằm ở `database/sporthub_init.sql` (không đặt ở đây).
