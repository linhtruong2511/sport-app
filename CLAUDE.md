# SportHub — Hệ thống quản lý & đặt lịch sân thể thao

Hệ thống đặt sân **nhiều cơ sở** cho 3 vai trò:
- **Khách hàng (CUSTOMER)**: tìm sân, đặt online, trả bằng VietQR, xem/hủy đơn của mình, nhận thông báo.
- **Nhân viên (STAFF)**: POS tại quầy (khách vãng lai, thu tiền mặt/QR, tất toán, nhận sân). Chỉ thao tác trong **cơ sở được phân công**.
- **Chủ sân (OWNER)**: quản trị toàn hệ thống (cơ sở, sân, bảng giá, giờ mở cửa, nhân viên, khuyến mãi, báo cáo).

Hệ thống ngoài: **SePay** (webhook báo có chuyển khoản), Email/SMS/Zalo (giai đoạn đầu chỉ stub).

## Nguồn sự thật — thứ tự ưu tiên khi mâu thuẫn

1. `docs/decisions.md` — mâu thuẫn đã chốt (R-xx) và câu hỏi còn mở (Q-xx). **Đọc trước khi động vào đặt sân, thanh toán, hủy, báo cáo.**
2. `docs/specs/SRS.md` — yêu cầu nghiệp vụ (*cái gì*). Đoạn ghi "Bổ sung ngày …" ghi đè phần cũ.
3. `docs/specs/SDD.md` — thiết kế (*làm thế nào*): kiến trúc, CSDL, 73 API, webhook, socket.
4. `database/sporthub_init.sql` — tên bảng/cột/ràng buộc **chính xác**. Code khớp script, không khớp chữ trong SDD
   (vd. bảng `PaymentRequest` số ít, cột `Channel`, `CreatedAt`, `MaxDiscountAmount`).

Bản tóm tắt dùng hằng ngày:
- `docs/business-rules.md` — trạng thái đơn, tính tiền, khuyến mãi, cọc, hoàn tiền, doanh thu, ca kiểm thử bắt buộc.
- `docs/architecture.md` — module, lớp, xác thực, chống trùng lịch, thanh toán, job nền, realtime.
- `docs/api-conventions.md` — định dạng response/lỗi, Idempotency-Key, version, chỉ mục 73 API theo module.
- `docs/database.md` — quy ước CSDL, múi giờ, migration.
- `docs/roadmap.md` — thứ tự triển khai và Definition of Done từng giai đoạn.

Gặp mâu thuẫn **chưa có** trong `decisions.md`: dừng lại, hỏi người dùng, rồi ghi kết luận thành một mục R-xx mới. Không tự chọn một bên.

## Stack

| Tầng | Công nghệ | Nguồn |
| --- | --- | --- |
| Backend | Node.js LTS + **TypeScript**, Express, Socket.IO, node-cron, PM2 | SDD 2.x (TS/Express: đề xuất – Q-13) |
| Validation | zod (schema dùng chung cho route) | đề xuất – Q-13 |
| CSDL | SQL Server 2016 SP1+ (script dùng `CREATE OR ALTER`, filtered index, `ROWVERSION`) | SDD 3 |
| Data access | Xem **Q-01** (Prisma coi `DATETIME2` là UTC → lệch 7 giờ nếu dùng ngây thơ) | SDD 2.3 |
| Frontend | React SPA + Vite + TypeScript, React Router, TanStack Query, socket.io-client, `qrcode.react` | SDD 4, 2.6 (Vite/TanStack: đề xuất) |
| Hạ tầng | Nginx (reverse proxy, HTTPS, rate limit, IP allowlist webhook), PM2 | SDD 2.2 |
| Test | Vitest (unit), integration test chạy trên SQL Server thật (Docker) | đề xuất |

## Cấu trúc repo (đích)

```
apps/api/          Backend modular monolith — xem apps/api/CLAUDE.md
apps/web/          React SPA — xem apps/web/CLAUDE.md
packages/shared/   Enum, nhãn tiếng Việt, kiểu DTO, zod schema dùng chung FE/BE
database/          sporthub_init.sql + migrations/ — xem database/CLAUDE.md
docs/              Tài liệu ràng buộc; docs/specs/ chứa SRS.md, SDD.md
.claude/           settings.json + slash command (/implement-api, /new-module, /review-rules)
```

## Lệnh (tạo ở giai đoạn M0 – roadmap)

```bash
docker compose up -d mssql          # SQL Server dev (cổng 1433)
npm run db:reset                    # chạy database/sporthub_init.sql — XÓA SẠCH DB dev rồi seed lại
npm install
npm run dev                         # api (:4000) + web (:5173)
npm run lint && npm run typecheck   # bắt buộc xanh trước khi báo xong
npm test                            # unit test toàn repo
npm run test:int -w apps/api        # integration test cần DB đang chạy
```

Tài khoản seed: Chủ sân `0900000001` / `Owner@123`; nhân viên `0933445577` / `Nv123456` (CS01);
khách `0987654321` / `An123456`. Chỉ dùng cho dev.

## Bất biến — không được phá

Chi tiết và nguồn ở `docs/business-rules.md`. Code vi phạm một trong các điều dưới đây là lỗi nghiêm trọng.

1. **Không trùng lịch.** Hai đơn còn hiệu lực không bao giờ chiếm cùng sân cùng lúc. Chốt chặn là unique filtered index
   `UX_BookingSlots_Court_Slot`; lỗi SQL 2601/2627 → `409 SLOT_TAKEN`. Không thay bằng "SELECT kiểm tra rồi INSERT".
2. **Backend là nơi duy nhất tính** giá, khuyến mãi, cọc, số tiền cần thu, hoàn tiền, lưới lịch trống, KPI, doanh thu.
   Frontend chỉ hiển thị dữ liệu API trả về.
3. **Tiền là số nguyên VNĐ.** Không dùng phép tính float cho tiền; làm tròn `ROUND(x, 0)` đúng chỗ quy định.
4. **Snapshot lúc tạo đơn**: đơn giá (`BookingPriceLines`), mức cọc, mã + tiền giảm. Sửa giá/mã về sau không đổi đơn cũ.
5. **Tiền cọc không bao giờ hoàn**, trừ đơn đóng do cơ sở (`BY_FACILITY`) hoàn toàn bộ.
6. **Không nhận thanh toán một phần.** Khoản thu phải bằng đúng `AmountDueNow` hoặc `RemainingAmount`.
7. **Mọi lần đổi trạng thái đơn**: kiểm tra `version` (RowVer) → `409 BOOKING_STATE_CHANGED`; ghi `BookingStatusHistory`;
   tất cả trong **một transaction**; phát socket **sau khi commit**.
8. **Phạm vi cơ sở**: STAFF bị ép `branchId` = token; truy vấn đơn theo mã phải so `BranchId` → `403 BRANCH_FORBIDDEN`.
   CUSTOMER chỉ thấy đơn của mình → `403 BOOKING_FORBIDDEN`.
9. **Webhook SePay**: lưu `BankTransactions` trước, idempotent theo `(Provider, ProviderTxnId)`; chỉ tự xác nhận khi khớp
   chính xác mã đơn + số tiền + tài khoản + đơn còn hạn; còn lại `NEEDS_REVIEW`. Không bao giờ "đoán" khớp.
10. **Thời gian**: giờ Việt Nam, `DATETIME2` không offset; API trả ISO 8601 kèm `+07:00`; mọi mốc so sánh dùng giờ máy chủ.
11. **Không xóa cứng** Users, Branches, Courts, Promotions đã phát sinh giao dịch — chuyển `Status`.
12. **Tham số nghiệp vụ** (giữ chỗ, no-show, mốc hoàn tiền, khóa đăng nhập…) đọc từ `SystemSettings`, không hard-code.

## Quy ước code

- Backend 4 lớp **route → controller → service → repository**; lớp trên chỉ gọi lớp ngay dưới; module khác chỉ gọi
  qua **service** của module đó, không chạm repository của nhau.
- Định danh code bằng tiếng Anh. Thông báo lỗi hiển thị cho người dùng bằng tiếng Việt, **đúng câu chữ** trong đặc tả API
  của SDD (không có thì lấy SRS). Enum giữ mã tiếng Anh viết hoa như CSDL; JSON dùng camelCase.
- Ghi nguồn nghiệp vụ trong comment ở chỗ có quy tắc không hiển nhiên: `// UC 009-1c`, `// SDD 3.5e`, `// API-18`.
- Enum + nhãn tiếng Việt chỉ định nghĩa một lần trong `packages/shared`.
- Không thêm thư viện mới khi chưa nói lý do; ưu tiên thứ đã có trong stack.

## Cách làm việc

- Triển khai một API: dùng `/implement-api API-xx`. Đọc đặc tả API đó trong SDD, liệt kê đủ mã lỗi nghiệp vụ,
  viết test cho quy tắc tiền/trạng thái **trước**, rồi mới code.
- Thay đổi schema: tạo `database/migrations/NNN_mo_ta.sql` mới; không sửa `sporthub_init.sql` khi đã có người dùng chung DB.
- Trước khi báo xong: `npm run lint`, `npm run typecheck`, test liên quan đều xanh. Với thay đổi chạm tiền/trạng thái,
  chạy thêm `/review-rules`.
- Không commit `.env`, không log mật khẩu, access/refresh token, API key SePay.
- Commit nhỏ, thông điệp dạng `feat(bookings): …`, `fix(payments): …`.

## Ngoài phạm vi (không làm nếu không được yêu cầu)

- Gửi Email/SMS/Zalo thật — chỉ tạo adapter stub ghi log.
- Tính năng cộng đồng (tìm đối thủ, đội bóng), bản đồ, hạng hội viên có logic (Q-10).
- Các công cụ demo của prototype: "Tài khoản đăng nhập nhanh", "Khôi phục dữ liệu mẫu", "Mô phỏng chuyển sai số tiền".
