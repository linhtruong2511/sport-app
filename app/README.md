# SportHub – Hệ thống đặt lịch sân thể thao (React)

Triển khai 11 màn hình từ Figma `Sports` (Vite + React 19 + TypeScript + react-router, CSS thuần theo token Figma).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Tài khoản demo (nút "Tài khoản đăng nhập nhanh" tự điền sẵn)
| Vai trò | Tài khoản | Mật khẩu |
|---|---|---|
| Khách hàng | 0912345678 | Matkhau123 |
| Nhân viên thu ngân | 0933445566 | Nv123456 |
| Chủ hệ thống sân | 0900000001 | Chu123456 |

Vai trò sau kế thừa giao diện vai trò trước (chủ sân → nhân viên → khách hàng).

## Màn hình ↔ route
| # | Màn hình | Route | Vai trò |
|---|---|---|---|
| 1 | Đăng nhập / đăng ký | `/login` | chung |
| 2 | Trang chủ – giới thiệu | `/` | khách |
| 3 | Đặt sân | `/booking` | khách |
| 4 | Thanh toán QR | `/payment/:id` | khách |
| 5 | Quản lý đơn đặt (Lịch đặt của tôi) | `/my-bookings` | khách |
| 6 | Đặt sân tại quầy | `/staff/booking` | nhân viên |
| 7 | Quản lý đơn & nhận sân | `/staff/orders` | nhân viên |
| 8 | Thống kê trong ngày | `/staff/stats` | nhân viên |
| 9 | Quản lý nhân viên | `/owner/staff` | chủ sân |
| 10 | Quản lý sân bãi (3 tab) | `/owner/courts` | chủ sân |
| 11 | Khuyến mãi & báo cáo chuyên sâu | `/owner/reports` | chủ sân |

Dữ liệu là mock lưu trong bộ nhớ (`src/data.ts`, `src/store.tsx`); ngày demo cố định là 12/11/2026 để khớp thiết kế.
