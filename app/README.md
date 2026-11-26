# Thể thao 88 – Hệ thống đặt lịch sân thể thao (React)

Triển khai 12 màn hình từ Figma `Sports` + thành phần bổ sung SRS (Vite + React 19 + TypeScript + react-router, CSS thuần theo token Figma trong `src/index.css`).

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint     # oxlint
npm run build
```

## Tài khoản demo (nút "Tài khoản đăng nhập nhanh" tự điền sẵn)
| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Khách hàng | 0987654321 (hoặc 0912345678) | Matkhau123 |
| Nhân viên thu ngân | 0933445566 | Nv123456 |
| Chủ hệ thống sân | 0900000001 | Chu123456 |

Vai trò sau kế thừa giao diện vai trò trước (chủ sân → nhân viên → khách hàng).

## Màn hình ↔ route
| # | Màn hình | Route | Vai trò |
|---|---|---|---|
| 1 | Đăng nhập / đăng ký | `/login` | chung |
| 2 | Trang chủ – giới thiệu | `/` | khách (mở Guest) |
| 3 | Đặt sân | `/booking` | khách (mở Guest) |
| 4 | Thanh toán QR | `/payment/:id` | khách |
| 5 | Quản lý đơn đặt (Lịch đặt của tôi) | `/my-bookings` | khách |
| 6 | Đặt sân tại quầy | `/staff/booking` | nhân viên |
| 7 | Quản lý đơn & nhận sân | `/staff/orders` | nhân viên |
| 8 | Thống kê trong ngày | `/staff/stats` | nhân viên |
| 9 | Quản lý nhân viên | `/owner/staff` | chủ sân |
| 10 | Quản lý sân bãi (3 tab) | `/owner/courts` | chủ sân |
| 11 | Khuyến mãi & báo cáo chuyên sâu | `/owner/reports` | chủ sân |
| 12 | Đối soát giao dịch & hoàn tiền | `/owner/reconciliation` | chủ sân (NV xem cơ sở mình) |

Dữ liệu là mock lưu trong `src/data.ts`, `src/store.tsx` (đồng bộ `localStorage`), cùng các hàm nghiệp vụ thuần trong `src/domain/` và component dùng chung trong `src/components/`; ngày demo cố định là 12/11/2026 để khớp thiết kế.
