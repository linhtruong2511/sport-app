/**
 * PM2 Ecosystem Configuration for SportHub API
 *
 * Theo Q-03 & docs/architecture.md (§7, §8):
 * - Chạy duy nhất 1 instance (fork mode) để Socket.IO in-memory rooms
 *   và node-cron (kết hợp SQL Server sp_getapplock) hoạt động nhất quán
 *   khi chưa triển khai Redis adapter.
 * - Múi giờ tiến trình: Asia/Ho_Chi_Minh (UTC+7).
 */
module.exports = {
  apps: [
    {
      name: 'sporthub-api',
      script: 'backend/dist/main.js',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      kill_timeout: 10000,
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: 'development',
        TZ: 'Asia/Ho_Chi_Minh',
      },
      env_production: {
        NODE_ENV: 'production',
        TZ: 'Asia/Ho_Chi_Minh',
      },
    },
  ],
};
