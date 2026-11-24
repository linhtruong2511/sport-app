# SportHub Production Deployment Runbook

Tài liệu hướng dẫn triển khai và vận hành SportHub trên môi trường production (SQL Server 2016 SP1+, Node.js LTS + PM2, Nginx, Windows Task Scheduler cho backup).

## 1. Chuẩn bị biến môi trường

1. Tạo file `backend/.env` từ mẫu [`backend/.env.example`](../backend/.env.example).
2. Cập nhật đầy đủ các giá trị production (không commit `.env` lên Git):
   - `NODE_ENV=production`
   - `PORT=3000`
   - `CORS_ORIGIN=https://<domain-cua-ban>`
   - `COOKIE_SECURE=true`
   - `JWT_ACCESS_SECRET` (chuỗi ngẫu nhiên đủ mạnh)
   - `SEPAY_WEBHOOK_API_KEY`, `SEPAY_API_TOKEN`
   - Cấu hình SQL Server (`DB_AUTH_TYPE`, `DB_SERVER`, `DB_DATABASE=SportHub`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`, `DB_TRUST_SERVER_CERTIFICATE`)

## 2. Build ứng dụng

Tại thư mục gốc repo:

```bash
npm ci
npm run build
```

Lệnh `npm run build` thực hiện lần lượt:
- Build `@sporthub/shared` (`packages/shared/dist`)
- Build backend NestJS (`backend/dist/main.js`)
- Build frontend React SPA (`app/dist`)

Copy thư mục `app/dist` sang `/var/www/sporthub/app/dist` (hoặc cấu hình đường dẫn tương ứng trong Nginx).

## 3. Khởi tạo & Migration SQL Server

- **Cài đặt lần đầu (chưa có DB):** chạy [`database/sporthub_init.sql`](../database/sporthub_init.sql) bằng `sqlcmd` hoặc SSMS (đặt `@SeedSample = 0` trên production để không nạp dữ liệu mẫu).
- **Cập nhật schema cho môi trường đang chạy:**

```bash
npm run db:migrate
```

Script migration (`backend/src/scripts/dbMigrate.ts`) đọc tuần tự các file `.sql` chưa áp dụng trong `database/migrations/` và ghi lịch sử vào bảng `dbo.SchemaMigrations`.

## 4. Khởi chạy Backend với PM2

Cấu hình nằm tại [`ecosystem.config.cjs`](../ecosystem.config.cjs) (chế độ `fork`, `instances: 1` để đảm bảo Socket.IO in-memory rooms và `node-cron` + `sp_getapplock` chạy nhất quán).

```bash
# Khởi động chế độ production
pm2 start ecosystem.config.cjs --env production

# Kiểm tra trạng thái & log
pm2 status
pm2 logs sporthub-api

# Lưu danh sách tiến trình và cấu hình tự khởi động cùng hệ điều hành
pm2 save
pm2 startup
```

Khi cập nhật bản build mới:

```bash
npm run build && npm run db:migrate && pm2 reload ecosystem.config.cjs --env production
```

## 5. Cấu hình Nginx

File mẫu nằm tại [`deploy/nginx.conf`](./nginx.conf).

1. Cập nhật `server_name`, đường dẫn chứng chỉ SSL (`ssl_certificate`, `ssl_certificate_key`) và đường dẫn `root` (`/var/www/sporthub/app/dist`).
2. Cập nhật IP allowlist cho webhook SePay (xem mục 6).
3. Kích hoạt cấu hình và kiểm tra cú pháp trước khi reload:

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/sporthub
sudo ln -sf /etc/nginx/sites-available/sporthub /etc/nginx/sites-enabled/sporthub
sudo nginx -t
sudo systemctl reload nginx
```

## 6. Bảo trì SePay Webhook IP Allowlist

Endpoint `= /api/v1/webhooks/bank/sepay` được bảo vệ hai lớp: API key tại backend (`SEPAY_WEBHOOK_API_KEY`) và IP allowlist tại Nginx.

1. Lấy danh sách IP/CIDR chính thức từ tài liệu hoặc cổng quản trị SePay.
2. Mở `/etc/nginx/sites-available/sporthub` (và cập nhật tương ứng trong [`deploy/nginx.conf`](./nginx.conf)), thay thế placeholder `allow 127.0.0.1;` bằng các dòng `allow <IP_OR_CIDR>;` của SePay, giữ nguyên `deny all;` ở cuối.
3. Kiểm tra và nạp lại Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 7. Sao lưu & Khôi phục SQL Server (Windows Task Scheduler)

Hai script nằm tại [`database/scripts/backup.ps1`](../database/scripts/backup.ps1) và [`database/scripts/restore.ps1`](../database/scripts/restore.ps1).

### Chạy thủ công

```powershell
# Sao lưu (mặc định giữ 14 ngày trong C:\Backups\SportHub)
powershell -NoProfile -ExecutionPolicy Bypass -File .\database\scripts\backup.ps1 -ServerInstance "localhost" -Database "SportHub" -BackupDir "C:\Backups\SportHub" -RetentionDays 14 -TrustServerCertificate

# Khôi phục từ file .bak
powershell -NoProfile -ExecutionPolicy Bypass -File .\database\scripts\restore.ps1 -ServerInstance "localhost" -Database "SportHub" -BackupFile "C:\Backups\SportHub\SportHub_20261125_020000.bak" -TrustServerCertificate
```

### Lên lịch tự động bằng Windows Task Scheduler

Tạo tác vụ chạy hằng ngày (ví dụ `02:00` sáng — giờ thấp điểm) với tài khoản có quyền `db_backupoperator` / `sysadmin` trên SQL Server và quyền ghi vào thư mục backup:

```powershell
$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "D:\Jobs\Sports\database\scripts\backup.ps1" -ServerInstance "localhost" -Database "SportHub" -BackupDir "C:\Backups\SportHub" -RetentionDays 14 -TrustServerCertificate'

$trigger = New-ScheduledTaskTrigger -Daily -At 2:00AM
Register-ScheduledTask -TaskName 'SportHub-SQLBackup-Daily' -Action $action -Trigger $trigger -RunLevel Highest
```
