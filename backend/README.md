# SportApp Backend (Node.js + Express + TypeScript + SQL Server)

Backend Node.js cho dự án **SportApp**, kết nối trực tiếp tới SQL Server (`LINHTRUONG\SQLEXPRESS`, database `SportApp`).

## Cấu trúc thư mục

```text
backend/
├── src/
│   ├── config/
│   │   ├── env.ts          # Đọc biến môi trường từ .env
│   │   └── database.ts     # SQL Server connection pool (Windows Auth / SQL Auth)
│   ├── routes/
│   │   └── health.route.ts # Endpoint kiểm tra server & kết nối DB
│   ├── scripts/
│   │   └── testDb.ts       # Script kiểm tra kết nối SQL Server độc lập
│   ├── app.ts              # Khởi tạo Express app & middleware
│   └── index.ts            # Entry point khởi động server
├── .env                    # Cấu hình máy hiện tại
├── .env.example            # Mẫu cấu hình môi trường
├── package.json
└── tsconfig.json
```

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

# Chạy server ở chế độ development (hot-reload)
npm run dev

# Build TypeScript sang JavaScript
npm run build

# Chạy bản build production
npm start
```

## Endpoints kiểm tra

- `GET /api/health` — Kiểm tra trạng thái backend.
- `GET /api/health/db` — Kiểm tra kết nối live tới `LINHTRUONG\SQLEXPRESS` / `SportApp`.
