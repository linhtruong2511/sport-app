# SportApp Backend (NestJS + TypeScript + SQL Server)

Backend cho dự án **SportApp**, xây dựng trên **NestJS 12**, kết nối trực tiếp tới SQL Server (`LINHTRUONG\SQLEXPRESS`, database `SportApp`).

## Cấu trúc thư mục

```text
backend/
├── src/
│   ├── common/
│   │   └── all-exceptions.filter.ts  # Chuẩn hóa response lỗi (404 / 500)
│   ├── config/
│   │   ├── env.ts                    # Đọc biến môi trường từ .env
│   │   └── database.ts               # SQL Server connection pool (Windows Auth / SQL Auth)
│   ├── database/
│   │   ├── database.module.ts        # Global module cung cấp DatabaseService
│   │   └── database.service.ts       # Kiểm tra kết nối, đóng pool khi shutdown
│   ├── health/
│   │   ├── health.controller.ts      # GET /api/health, GET /api/health/db
│   │   └── health.module.ts
│   ├── scripts/
│   │   └── testDb.ts                 # Script kiểm tra kết nối SQL Server độc lập
│   ├── app.module.ts                 # Root module
│   └── main.ts                       # Entry point (bootstrap Nest, CORS, prefix /api)
├── .env                              # Cấu hình máy hiện tại
├── .env.example                      # Mẫu cấu hình môi trường
├── nest-cli.json
├── package.json
└── tsconfig.json
```

Thêm module mới: tạo thư mục trong `src/` với `*.module.ts`, `*.controller.ts`, `*.service.ts`, rồi import module đó vào `AppModule`. Mọi route đều tự có prefix `/api`.

## Cấu hình kết nối SQL Server

File `.env` mặc định đang cấu hình cho máy thử nghiệm (SQL Server chỉ bật Windows Authentication):

```env
DB_AUTH_TYPE=windows
DB_SERVER=LINHTRUONG\SQLEXPRESS
DB_DATABASE=SportApp
DB_ODBC_DRIVER=ODBC Driver 17 for SQL Server
DB_TRUST_SERVER_CERTIFICATE=true
DB_ENCRYPT=false
```

Nếu sau này chuyển sang dùng tài khoản SQL Login, đổi `DB_AUTH_TYPE=sql` và điền `DB_USER`, `DB_PASSWORD`.

## Chạy lệnh

```bash
# Cài đặt dependencies
npm install

# Kiểm tra kết nối tới SQL Server
npm run db:test

# Chạy server ở chế độ development (watch mode)
npm run dev

# Build sang dist/
npm run build

# Chạy bản build production
npm start
```

## Endpoints kiểm tra

- `GET /api/health` — Kiểm tra trạng thái backend.
- `GET /api/health/db` — Kiểm tra kết nối live tới `LINHTRUONG\SQLEXPRESS` / `SportApp` (503 nếu mất kết nối).
