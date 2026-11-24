# SportHub — Mock API (MSW)

Bộ mock mô phỏng **toàn bộ 73 API REST, webhook SePay và 7 sự kiện realtime** trong tài liệu
*Thiết kế chi tiết hệ thống (SDD)*, để frontend chạy đầy đủ luồng khi chưa có backend.

- Đúng đường dẫn `/api/v1/...`, đúng định dạng `{ data, meta }` / `{ error: { code, message, details } }`, đúng mã lỗi.
- Có **nghiệp vụ thật**: tính tiền theo khung giá, áp mã khuyến mãi (8 điều kiện), tiền cọc, hoàn tiền 100/50/0%,
  chống trùng lịch (409 `SLOT_TAKEN`), khóa lạc quan (`version` → 409 `BOOKING_STATE_CHANGED`), `Idempotency-Key`,
  giữ chỗ 10 phút rồi tự chuyển `EXPIRED`, no-show, tự hoàn thành, nhắc lịch trước 1 giờ.
- Dữ liệu lưu trong `localStorage` → tải lại trang vẫn còn; **nhiều tab dùng chung dữ liệu** (mở tab khách + tab nhân viên để demo).
- Chuỗi `qrPayload` là **VietQR (EMVCo) hợp lệ**, vẽ bằng `qrcode.react` được.

---

## 1. Cài đặt (3 bước)

```bash
# trong thư mục app/
npm i -D msw
npx msw init public/ --save        # tạo public/mockServiceWorker.js
```

Tạo file `app/.env.development.local`:

```env
VITE_USE_MOCK=true
```

Sửa `src/main.tsx` — bọc phần render trong `enableMocking()`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { enableMocking } from './mocks';

enableMocking().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
```

Xong. Khi `VITE_USE_MOCK` khác `true` (hoặc build production), MSW không được tải.

> Gọi API theo đường dẫn tương đối `/api/v1/...` hoặc tuyệt đối `http://<bất kỳ>/api/v1/...` đều được —
> mock khớp mọi origin (`*/api/v1`).

## 2. Tài khoản demo (mật khẩu chung `123456`)

| Vai trò | Đăng nhập | Ghi chú |
| --- | --- | --- |
| Chủ sân | `0901000001` / `owner@sporthub.vn` | Xem tất cả chi nhánh |
| Nhân viên | `0933445566` / `hunglv@sporthub.vn` | Cơ sở 1 - Cầu Giấy |
| Nhân viên | `0933445588` | Cơ sở 2 - Thanh Xuân |
| Nhân viên (bị khóa) | `0933445599` | Thử lỗi 403 `ACCOUNT_LOCKED` |
| Khách hàng | `0987654321` / `khachhang@sporthub.vn` | Có mã tri ân `TRIAN10` |
| Khách hàng | `0933444555`, `0912223344`, `0988777666` | |

Mã khuyến mãi: `SANGVUI20` (6h–11h), `TRIAN10` (khách chỉ định), `SALEGIOVANG20` (10h–15h, Pickleball/Cầu lông),
`QUAYCG15` (chỉ Cơ sở 1), `GIAM50K` (đang tạm dừng), `HE2026` (đã ngừng).

Dữ liệu mẫu tính theo **ngày hiện tại**: có đơn hôm nay / ngày mai / quá khứ, 1 đơn đang chờ thanh toán,
sân Pickleball 02 đang bảo trì (sinh đơn bị ảnh hưởng), ngày nghỉ, 3 giao dịch "Cần đối soát", khoản hoàn tiền chờ xử lý.

## 3. Luồng xác thực

- `POST /auth/login` trả `accessToken` (dạng JWT, decode được, hết hạn 15 phút).
- Cookie refresh `sh_rt` (HttpOnly) được thay bằng `localStorage['sporthub_mock_session']` → frontend vẫn gọi
  `POST /auth/refresh` y như thật khi tải lại trang hoặc nhận `401 TOKEN_EXPIRED`.
- Khóa nhân viên ở MH.10 → token cũ nhận `401 TOKEN_REVOKED` + sự kiện `auth.revoked`.

## 4. Realtime (Socket.IO) — MH.04, 05, 07, 08, 09

MSW không chặn được WebSocket, nên dùng socket giả có API giống `socket.io-client`:

```ts
// src/utils/socket.ts
import { io, type Socket } from 'socket.io-client';
import { createMockSocket, isMockEnabled } from '../mocks';

export function connectSocket(accessToken: string | null) {
  if (isMockEnabled()) return createMockSocket({ auth: { token: accessToken } });
  return io(import.meta.env.VITE_SOCKET_URL, { auth: { token: accessToken } }) as Socket;
}

// dùng như thật
const socket = connectSocket(token);
socket.emit('subscribe', { channel: 'booking', bookingCode });
socket.on('booking.paid', (e) => { /* chuyển sang biên nhận */ });
```

Hỗ trợ `subscribe`/`unsubscribe` cho `availability`, `booking`, `branch`; tự vào phòng `user:{id}` và
`branch:{branchId}` (nhân viên) theo token. Sự kiện đồng bộ giữa các tab qua `BroadcastChannel`.

> Nếu dự án không dùng `socket.io-client`, chỉ cần `createMockSocket()` — import ở trên là ví dụ.

## 5. Mô phỏng thanh toán

| Cách | Kết quả |
| --- | --- |
| Bấm **"Tôi đã hoàn tất chuyển khoản"** / **"Kiểm tra lại giao dịch"** (API-17) | Coi như đã nhận tiền (tắt bằng `MOCK_CONFIG.recheckAutoPay = false`) |
| Console: `sporthubMock.pay('BK2026112501')` | Giả lập SePay chuyển đúng số tiền → `booking.paid` |
| Console: `sporthubMock.pay('BK…', { amount: 1000 })` | Sai số tiền → giao dịch "Cần đối soát" (MH.14) |
| `POST /api/v1/__mock/bookings/{code}/pay` body `{ amount?, content? }` | Như trên, gọi từ code/Postman |
| `POST /api/v1/webhooks/bank/sepay` + header `Authorization: Apikey x` | Gửi payload SePay thật (mục 5.6) |

## 6. Công cụ dev

Trong DevTools console:

```js
sporthubMock.accounts()     // bảng tài khoản demo
sporthubMock.reset()        // khôi phục dữ liệu mẫu (nút "Khôi phục dữ liệu mẫu (demo)")
sporthubMock.latency(0)     // tắt độ trễ mạng giả (mặc định 150–450 ms)
sporthubMock.db()           // xem toàn bộ "CSDL"
```

Endpoint dev: `GET /__mock/accounts`, `POST /__mock/reset`, `POST /__mock/run-jobs`, `GET /__mock/db`.

## 7. Cấu trúc

```
src/mocks/
├── index.ts            enableMocking(), createMockSocket, sporthubMock (console)
├── browser.ts          setupWorker
├── config.ts           độ trễ, tham số SystemSettings (giữ chỗ 10', no-show 30'...)
├── realtime.ts         socket giả + publish()
├── jobs.ts             expireHolds, cancelNoShows, autoComplete, sendReminders, expireQr
├── db/
│   ├── types.ts        kiểu dữ liệu theo 26 bảng (mục 3)
│   ├── seed.ts         dữ liệu mẫu
│   └── store.ts        lưu localStorage, CodeSequences (BK…, PT…, KH…, NV…)
├── lib/
│   ├── http.ts         route(): trễ → nạp DB → job → xử lý → lưu; JWT giả, phân quyền, Idempotency-Key
│   ├── pricing.ts      mục 3.5: tiền sân, khuyến mãi, cọc, hoàn tiền
│   ├── schedule.ts     giờ mở cửa, ngày nghỉ, khóa sân, chống trùng, đơn bị ảnh hưởng
│   ├── ops.ts          tạo đơn, QR, ghi nhận thanh toán, hủy, nhận sân, chuyển sân, khớp webhook
│   ├── mappers.ts      BookingSummary, BookingDetail, PaymentRequest, Receipt... (mục 5.3)
│   └── vietqr.ts       sinh chuỗi EMVCo + CRC16
└── handlers/
    ├── auth.ts          API-01, 02, 06, 09, 10
    ├── catalog.ts       API-03, 04, 07, 08, 24
    ├── bookings.ts      API-11 → 20
    ├── notifications.ts API-05, 21 → 23
    ├── pos.ts           API-25 → 35
    ├── operations.ts    API-36 → 41
    ├── admin.ts         API-42 → 65
    ├── finance.ts       API-66 → 73
    └── system.ts        webhook + /__mock/*
```

## 8. Chuyển dần sang backend thật

Khi backend xong một module, xóa nhóm handler tương ứng trong `handlers/index.ts` — request sẽ tự đi tới
server thật (`onUnhandledRequest: 'bypass'`). Nếu backend chạy ở cổng khác, thêm proxy trong `vite.config.ts`:

```ts
server: { proxy: { '/api': 'http://localhost:3000' } }
```

Tắt hẳn mock: đặt `VITE_USE_MOCK=false` (hoặc xóa dòng trong `.env.development.local`).

## 9. Dùng trong test (Vitest)

```ts
// src/test/server.ts
import { setupServer } from 'msw/node';
import { handlers } from '../mocks/handlers';
export const server = setupServer(...handlers);
```

## 10. Khác biệt so với backend thật

- Mật khẩu lưu thô, token không ký thật, không giới hạn tần suất login (chỉ giới hạn recheck 5 giây).
- Job nền chạy ở trình duyệt (đầu mỗi request và mỗi 15 giây), chỉ khi app đang mở.
- Không gửi Email/SMS/Zalo; thông báo chỉ tạo trong hộp thư in-app.
- Các điểm SDD chưa chốt (mục 5.8) được mock theo giả định: `slotMinutes` theo bộ môn
  (Pickleball/Tennis 120', Bóng đá 90', Cầu lông/Bóng rổ 60'), `QR_EXPIRE_MINUTES = 15`.
