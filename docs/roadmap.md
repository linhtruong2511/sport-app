# Lộ trình triển khai

Mỗi giai đoạn kết thúc khi đạt **Definition of Done** chung + DoD riêng. Không bắt đầu giai đoạn sau khi giai đoạn trước
còn test đỏ. Đánh dấu `[x]` khi xong và ghi ngày.

**DoD chung:** lint + typecheck xanh · test của giai đoạn xanh (unit + integration trên SQL Server thật) · mọi mã lỗi trong
đặc tả SDD của các API thuộc giai đoạn có test · không TODO treo trong code nghiệp vụ · cập nhật `decisions.md` nếu phát sinh chốt mới.

---

## M0 — Nền móng
Chốt trước: **Q-01** (data access), **Q-13** (stack), **Q-02** (idempotency).
- [ ] npm workspaces: `apps/api`, `apps/web`, `packages/shared`; tsconfig strict; ESLint + Prettier; Vitest.
- [ ] `docker-compose.yml` SQL Server; script `db:reset` chạy `database/sporthub_init.sql`; migration runner đơn giản
      (bảng `SchemaMigrations`, chạy file `database/migrations/*.sql` theo thứ tự).
- [ ] `core/`: db pool + `withTransaction`, `AppError` + error middleware + envelope, `Clock`, `time`, `money`,
      `SettingsService`, `codes` (usp_NextCode), logger có `traceId`, `realtime` emitter thu sự kiện sau commit.
- [ ] `packages/shared`: enum + nhãn tiếng Việt, mã lỗi, zod validators dùng chung (mục 11 business-rules).
- [ ] FE: Vite + Router + layout trống `CustomerLayout`, `StaffLayout`, API client (bearer, refresh 1 lần, Idempotency-Key).
- DoD: `npm run dev` chạy; `GET /api/v1/health` đọc được DB; test integration mẫu tạo/rollback transaction.

## M1 — Xác thực & phân quyền
API 01, 02, 06, 09, 10 · middleware `authenticate`, `authorize`, `branchScope` · socket handshake + `auth.revoked`.
- MH.01, MH.03, header đăng xuất, điều hướng theo vai trò.
- DoD: các ca phân quyền + khóa tạm ở business-rules mục 14.

## M2 — Danh mục, lưới lịch, báo giá
API 03, 04, 07, 08, 11, 12, 24 · module `catalog`, `availability`, `pricing` (hàm thuần, phủ test cao nhất).
- MH.02 Trang chủ, MH.04 phần lưới + phiếu báo giá (chưa giữ chỗ).
- DoD: toàn bộ ca "Tiền" và "Khuyến mãi" (trừ ca tranh lượt) xanh.

## M3 — Đặt online & thanh toán QR
API 13, 14, 15, 16, 17, 18, 19, 20, webhook · VietQR payload · job `expireHolds`, `expireQr` · socket `slot.updated`,
`booking.*`, `payment_request.expired`.
- MH.04 hoàn chỉnh, MH.05, MH.06 (chưa có cột thông báo).
- DoD: ca "Trùng lịch & đồng thời", "Thanh toán", "Hủy & hoàn" xanh; demo end-to-end với SePay Test mode.

## M4 — POS tại quầy
API 25–35 · job `cancelNoShows`, `closePaidNoShows`, `autoComplete`, `sendReminders`.
- MH.07, MH.08 (chưa tab đơn bị ảnh hưởng).
- DoD: ca "Nhận sân" + no-show 2 nhánh (R-04) xanh.

## M5 — Thông báo
API 05, 21, 22, 23 · thông báo PAYMENT_RESULT, REMINDER, SCHEDULE_CHANGE · `notification.created`.
- Cột thông báo MH.06, chuông header.

## M6 — Quản trị sân & lịch
API 36–39, 47–58 · đơn bị ảnh hưởng, chuyển sân, đóng đơn BY_FACILITY · AuditLogs.
- MH.11.1, MH.11.2, MH.11.3, tab "Đơn bị ảnh hưởng" MH.08.

## M7 — Nhân viên & khuyến mãi
API 42–46, 59–65 · job `retryPromoNotify`.
- MH.10, MH.12.

## M8 — Dashboard, báo cáo, đối soát
API 40, 41, 66, 67–73.
- MH.09, MH.13, MH.14.
- DoD: số liệu khớp tính tay trên bộ seed (ca "Doanh thu").

## M9 — Cứng hóa
Rate limit, cấu hình Nginx, PM2, log, sao lưu DB, kiểm tra bảo mật (OWASP cơ bản), test tải tạo đơn đồng thời.

---

## API đã xong

| API | Trạng thái | Ghi chú |
| --- | --- | --- |
| — | — | — |
