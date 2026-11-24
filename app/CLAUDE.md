# apps/web — React SPA SportHub

Đọc kèm: `docs/api-conventions.md` (envelope, lỗi, allowedActions), `docs/business-rules.md` (để hiểu, **không** để tính lại).

## Nguyên tắc số 1

Frontend **không tính** giá, khuyến mãi, cọc, tiền hoàn, ô trống, KPI, doanh thu, trạng thái được phép. Mọi con số và
nút thao tác lấy từ API (`/bookings/quote`, `/availability`, `/cancel-preview`, `allowedActions`, `/dashboard/daily`…).
Prototype cũ có `slotsFor()`, `evalPromo()`, `depositFor()`, `calculateRefund()`, `computeDailyStats()`,
`computeRevenueReport()` — **không port** các hàm này; thay bằng gọi API tương ứng.

## Route và màn hình

| Route | Màn | Vai trò | Layout |
| --- | --- | --- | --- |
| `/login` | MH.01 Đăng nhập · MH.03 Đăng ký (tab) | PUBLIC | — |
| `/` | MH.02 Trang chủ | PUBLIC | CustomerLayout |
| `/booking` | MH.04 Đặt sân online (`?branchId&sportId&date&promo`) | PUBLIC; giữ chỗ cần CUSTOMER | CustomerLayout |
| `/payment/:bookingCode` | MH.05 Thanh toán | CUSTOMER | CustomerLayout |
| `/my-bookings` | MH.06 Lịch đặt + thông báo (cột phải) | CUSTOMER | CustomerLayout |
| `/staff/booking` | MH.07 Đặt sân tại quầy | STAFF, OWNER | StaffLayout |
| `/staff/orders` | MH.08 Quản lý đơn & nhận sân (`?q=`) | STAFF, OWNER | StaffLayout |
| `/staff/stats` | MH.09 Thống kê trong ngày | STAFF, OWNER | StaffLayout |
| `/owner/staff` | MH.10 Nhân viên | OWNER | StaffLayout |
| `/owner/courts` | MH.11.1/2/3 Sân, khóa sân, giờ mở cửa (tab) | OWNER | StaffLayout |
| `/owner/reports` | MH.13 Báo cáo (trái) + MH.12 Khuyến mãi (phải) | OWNER | StaffLayout |
| `/owner/reconciliation` | MH.14 Đối soát & hoàn tiền | OWNER (STAFF: tab giao dịch cơ sở mình) | StaffLayout |

Sau đăng nhập: CUSTOMER → `/` (hoặc trang trước đó), STAFF → `/staff/booking`, OWNER → `/owner/staff`.

## Xác thực

- Access token chỉ giữ **trong bộ nhớ** (không localStorage/sessionStorage). Tải lại trang: gọi `POST /auth/refresh`
  (cookie) rồi `GET /auth/me`.
- API client: nhận `401 TOKEN_EXPIRED` → refresh **một lần** (gộp các request đang chờ), gửi lại; refresh lỗi hoặc
  `TOKEN_REVOKED` → xóa state, về `/login`. Socket `auth.revoked` → như trên.
- `credentials: 'include'` cho các call `/auth/*`.

## Gọi API

- Server state dùng TanStack Query; query key theo tài nguyên + tham số (`['availability', branchId, sportId, date]`).
- **Idempotency-Key**: sinh UUID một lần cho mỗi *hành động người dùng* (lúc mở form/bấm nút lần đầu), giữ nguyên khi
  retry do lỗi mạng; sinh key mới khi người dùng sửa dữ liệu. Áp cho API 13, 16, 28, 29, 33.
- **version**: luôn gửi `version` của lần đọc gần nhất. Nhận `409 BOOKING_STATE_CHANGED` → hiện
  "Trạng thái đơn đã thay đổi, vui lòng tải lại" và refetch đơn.
- Hiển thị lỗi: in nguyên `error.message`; lỗi trường (`details[].field`) gắn vào ô nhập tương ứng.
- Báo giá ở MH.04/MH.07 gọi lại khi đổi ô/mã/hình thức, debounce ~300 ms; hủy request cũ.
- `slotAvailable = false` trong báo giá hoặc `409 SLOT_TAKEN` → bỏ chọn ô, refetch lưới.

## Thời gian và tiền

- Đồng hồ đếm ngược (giữ chỗ, QR) tính theo `meta.serverTime`: lưu `offset = serverTime − Date.now()` mỗi response,
  hiển thị `holdExpireAt − (Date.now() + offset)`. Không tin đồng hồ máy khách.
- Hiển thị giờ từ chuỗi ISO `+07:00` bằng formatter dùng chung, cố định `timeZone: 'Asia/Ho_Chi_Minh'`.
- Tiền: `Intl.NumberFormat('vi-VN')` → `450.000 đ`. Chỉ format, không tính.

## Realtime

- `socket.io-client` một kết nối dùng chung (context), `auth: { token }`; token đổi → reconnect.
- Vào màn nào thì `subscribe` phòng màn đó, rời màn `unsubscribe`:
  MH.02/04 → `availability:{branchId}:{date}`; MH.05 → `booking:{code}`; MH.07/08/09 → phòng chi nhánh (STAFF tự động,
  OWNER `subscribe branch`).
- Sự kiện chỉ là tín hiệu: vá cache nhỏ (`slot.updated`) hoặc `invalidateQueries`. Kết nối lại → refetch màn hiện tại.

## Giao diện

- Enum → nhãn tiếng Việt và màu trạng thái lấy từ `@sporthub/shared` (một nguồn duy nhất).
- Nút thao tác trên đơn hiện/ẩn theo `allowedActions`, không theo `status` tự suy.
- Bộ chọn chi nhánh: STAFF cố định theo `user.branchId` (ẩn hoặc disabled); OWNER chọn được, có "Tất cả" ở MH.09/MH.13.
- Design token (màu, chữ, khoảng cách, bo góc) lấy từ Figma, khai báo một lần ở `src/styles/tokens.css`; component không
  hard-code mã màu.
- QR vẽ bằng `qrcode.react` từ `qrPayload`; có nút "Sao chép STK" và hiển thị nội dung chuyển khoản.
- Trạng thái rỗng, đang tải, lỗi có ở mọi danh sách; câu chữ theo SRS (vd. "Bạn chưa có lịch đặt sân nào").
- Không đưa các công cụ demo của prototype vào bản build (đăng nhập nhanh, khôi phục dữ liệu mẫu, mô phỏng chuyển sai).

## Lệnh

```bash
npm run dev     # Vite :5173, proxy /api và /socket.io → :4000
npm test        # Vitest + Testing Library
```
