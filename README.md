# SportHub — Hệ thống Quản lý & Đặt lịch Sân Thể thao

**SportHub** là nền tảng quản lý và đặt lịch sân thể thao **đa cơ sở**, hỗ trợ đặt sân trực tuyến kèm thanh toán VietQR tự động, nghiệp vụ POS tại quầy, đối soát chuyển khoản và quản trị chuỗi sân tập trung.

---

## Tính năng chính theo vai trò

### 1. Khách hàng (`CUSTOMER`)
- Tra cứu cơ sở, bộ môn (Pickleball, Cầu lông, Bóng đá, Tennis, Bóng rổ) và xem lưới lịch trống theo thời gian thực (Socket.IO).
- Báo giá minh bạch theo từng khung giờ, áp dụng mã khuyến mãi và chọn **Thanh toán đủ 100%** hoặc **Đặt cọc giữ chỗ**.
- Quét mã **VietQR** (chuẩn EMVCo NAPAS) tự động điền số tiền & nội dung chuyển khoản, nhận xác nhận tức thì qua webhook SePay.
- Quản lý lịch đặt cá nhân, xem chi tiết phiếu thu/bảo lưu giá, tự hủy đơn với xem trước số tiền hoàn và nhận thông báo nhắc lịch/ưu đãi.

### 2. Nhân viên thu ngân (`STAFF` — phạm vi cơ sở được phân công)
- **POS tại quầy:** Lập đơn nhanh cho khách hội viên hoặc khách vãng lai, thu tiền mặt hoặc tạo mã VietQR tại quầy, in/xem phiếu thu gần nhất.
- **Quản lý đơn & bàn giao sân:** Tất toán tiền còn thiếu, nhận sân (check-in), kết thúc sớm mở lại khung giờ trống, xử lý khách không đến (`NO_SHOW`).
- **Xử lý đơn bị ảnh hưởng:** Chuyển sân/đổi giờ giữ nguyên số tiền hoặc đóng đơn do cơ sở (`BY_FACILITY`, hoàn 100% kể cả tiền cọc).
- **Thống kê ca trực & Đối soát:** Theo dõi KPI/sơ đồ sân trong ngày và khớp tay giao dịch chuyển khoản sai tiền/sai nội dung.

### 3. Chủ hệ thống sân (`OWNER`)
- Quản trị toàn chuỗi chi nhánh, sân bãi, bảng giá theo khung giờ (bảo lưu đơn giá lịch cũ), mức đặt cọc, giờ mở cửa, ngày nghỉ và lịch bảo trì (`?dryRun=true` cảnh báo trước đơn bị ảnh hưởng).
- Quản lý tài khoản nhân viên (tạo mới, chuyển cơ sở, khóa/mở khóa thu hồi phiên đăng nhập tức thì, tra cứu lịch sử thu tiền).
- Quản lý chương trình khuyến mãi & mã tri ân (toàn hệ thống hoặc theo nhóm khách hàng chỉ định, gửi thông báo ưu đãi tự động).
- Báo cáo doanh thu thực thu, tỷ lệ lấp đầy sân theo chi nhánh/từng sân, hiệu quả khuyến mãi và xử lý danh sách hoàn tiền chờ duyệt.

---

## Công nghệ sử dụng

| Tầng | Công nghệ |
| --- | --- |
| **Backend** | Node.js LTS, TypeScript, NestJS 12 (Modular Monolith 4 lớp), Zod, Socket.IO, `node-cron` |
| **Cơ sở dữ liệu** | SQL Server 2016 SP1+ (`mssql` / `msnodesqlv8`), Filtered Unique Index, `ROWVERSION`, `sp_getapplock` |
| **Frontend** | React 19, Vite 8, TypeScript, React Router 7, TanStack Query, `socket.io-client`, `qrcode.react` |
| **Dùng chung** | `@sporthub/shared` (Enum, nhãn tiếng Việt, mã lỗi `ERROR_CATALOG`, DTO types, Zod schemas) |
| **Kiểm thử & Chất lượng** | Vitest (unit & SQL Server integration), Supertest, ESLint, `oxlint`, Prettier, Playwright (`e2e/`) |
| **Triển khai** | Nginx (HTTPS, rate limit, WebSocket, SePay IP allowlist), PM2 (`ecosystem.config.cjs`), Docker Compose |

---

## Cấu trúc thư mục

```text
├── app/                # React SPA (12 màn hình MH.01 – MH.14)
├── backend/            # NestJS API Server (73 API, SePay webhook, 8 job nền, Socket.IO)
├── packages/shared/    # Enum, nhãn, mã lỗi, DTO & schema dùng chung FE/BE
├── database/           # sporthub_init.sql, migrations/ và scripts sao lưu/khôi phục SQL Server
├── deploy/             # Cấu hình Nginx production và tài liệu vận hành (deploy/README.md)
├── docs/               # SRS, SDD, business-rules, architecture, decisions, roadmap
├── e2e/                # Bộ kiểm thử giao diện Playwright
├── ecosystem.config.cjs# Cấu hình chạy PM2 production
├── docker-compose.yml  # SQL Server 2022 container cho môi trường dev
└── report.md           # Báo cáo tiến độ hoàn thiện M0 – M9
```

---

## Hướng dẫn cài đặt & chạy cục bộ

### Yêu cầu môi trường
- **Node.js** 20+ và **npm** 10+
- **SQL Server** (SQL Server Express cục bộ hoặc chạy qua `docker compose up -d mssql`)

### 1. Cài đặt dependencies & cấu hình biến môi trường
```bash
npm install
```
Tạo file `backend/.env` từ mẫu `backend/.env.example` và điền thông tin kết nối SQL Server phù hợp (`DB_AUTH_TYPE=windows` hoặc `DB_AUTH_TYPE=sql`).

### 2. Khởi tạo cơ sở dữ liệu & dữ liệu mẫu
```bash
# Khởi tạo sạch schema + dữ liệu mẫu + chạy toàn bộ migrations (chỉ dùng cho DB dev)
npm run db:reset

# Hoặc chỉ chạy các file migration mới
npm run db:migrate
```

### 3. Build gói dùng chung & chạy ứng dụng
```bash
# Build @sporthub/shared
npm run build:shared

# Chạy Backend NestJS (mặc định :3000)
npm run dev -w sportapp-backend

# Chạy Frontend Vite (mặc định :5173, tự proxy /api và /socket.io sang :3000)
npm run dev -w app
```

Truy cập giao diện tại `http://localhost:5173` và kiểm tra sức khỏe API tại `http://localhost:3000/api/v1/health`.

---

## Tài khoản mẫu (Môi trường phát triển)

Được nạp sẵn bởi `database/sporthub_init.sql`:

| Vai trò | Số điện thoại / Email | Mật khẩu |
| --- | --- | --- |
| **Chủ hệ thống (`OWNER`)** | `0900000001` / `owner@sporthub.vn` | `Owner@123` |
| **Nhân viên CS01 (`STAFF`)** | `0933445577` | `Nv123456` |
| **Nhân viên CS02 (`STAFF`)** | `0933445566` | `Nv123456` |
| **Khách hàng (`CUSTOMER`)** | `0987654321` hoặc `0912345678` | `An123456` |

---

## Lệnh kiểm thử & kiểm tra chất lượng

```bash
npm run build        # Build toàn bộ shared, backend và app
npm run lint         # Chạy ESLint (backend) và oxlint (app)
npm run typecheck    # Kiểm tra kiểu TypeScript toàn repo
npm test             # Chạy toàn bộ unit test (51 tests)
npm run test:int     # Chạy toàn bộ integration test trên SQL Server SportHub_Test (85 tests)
```

---

## Tài liệu tham khảo

- [Báo cáo tiến độ dự án](report.md)
- [Lộ trình triển khai (M0 – M9)](docs/roadmap.md)
- [Kiến trúc hệ thống](docs/architecture.md)
- [Quy tắc nghiệp vụ & Bất biến](docs/business-rules.md)
- [Hướng dẫn triển khai Production (Nginx, PM2, Backup DB)](deploy/README.md)
