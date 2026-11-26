# BÁO CÁO RÀ SOÁT GIAO DIỆN PROTOTYPE SO VỚI SRS & THIẾT KẾ CHI TIẾT

- **Dự án:** Hệ thống Quản lý và Đặt lịch Sân thể thao (**Thể thao 88**)
- **Phạm vi rà soát:** **Chỉ rà soát phần giao diện Prototype (`app/`)** tại thời điểm trước khi triển khai `docs/03-ke-hoach-sua-doi-trien-khai.md` — chưa tính Backend API và CSDL SQL Server (dữ liệu mô phỏng trong `app/src/data.ts`, `app/src/store.tsx`).
- **Tiêu chí đánh giá:** Giao diện prototype phải **thể hiện và vận hành đầy đủ toàn bộ các nghiệp vụ, màn hình, trường nhập, ràng buộc kiểm tra, luồng trạng thái và báo cáo** đã nêu trong tài liệu SRS.
- **Tài liệu đối chiếu:**
  1. `docs/SRS.md` *(chuẩn nghiệp vụ: 19 FR, 24 UC: UC 001 – UC 023, UC 026 + tham chiếu UC 025)*
  2. `docs/SDD.md` *(Mục 1.5 Quyết định đã chốt, Mục 5.7 Thiết kế 11 màn hình Figma & Mục 5.9 Thành phần bổ sung chưa có trong Figma; bản `.docx` gốc trước đây ở `Documentation/`)*

---

## 1. Tóm tắt hiện trạng Giao diện Prototype (`app/`)

| Chỉ tiêu | Hiện trạng trên Prototype `app/` |
| --- | --- |
| **Số màn hình hiện có** | **11 trang** (`Login`, `Home`, `Booking`, `Payment`, `MyBookings`, `StaffBooking`, `StaffOrders`, `StaffStats`, `OwnerStaff`, `OwnerCourts`, `OwnerReports`) khớp bố cục 11 màn hình Figma trong `docs/SDD.md`. |
| **Build & Static Lint** | `npm run build` (`tsc -b && vite build`) **thành công (0 lỗi)**; `npm run lint` (`oxlint`) còn **9 cảnh báo** (`purity`, `immutability`, `only-export-components`). |
| **Mức độ phủ nghiệp vụ SRS trên UI** | **~58%** — Khung giao diện và các luồng chính (happy path) đã chạy được mượt mà; tuy nhiên còn **34 sai lệch/thiếu sót nghiệp vụ UI (`UI-01` – `UI-34`)** so với `docs/SRS.md` & Mục 5.9 của `docs/SDD.md`. |

### Các điểm đã được chốt trong `docs/SDD.md` (Mục 1.5) áp dụng cho Prototype
- **D1:** Hủy đơn áp dụng chính sách hoàn tiền bậc thang (**>= 5 ngày: 100%, 2 đến <5 ngày: 50%, <2 ngày / no-show: 0%**) trên phần tiền đã trả *ngoài tiền cọc*; tiền cọc luôn bị giữ.
- **D2 & D3:** Thời hạn giữ chỗ `HOLD_MINUTES = 10` phút; ngưỡng quá giờ nhận sân `NO_SHOW_GRACE_MINUTES = 30` phút.
- **D6:** Hình thức thanh toán mặc định ở màn Đặt sân phải là **Thanh toán 100% (`FULL`)** theo SRS (prototype hiện đang chọn sẵn Đặt cọc 30%).
- **D8:** Khối *"Tài khoản đăng nhập nhanh"* được giữ lại cho môi trường demo/prototype, nhưng form đăng nhập vẫn phải xác thực đúng tài khoản và tự nhận diện vai trò.
- **D9:** Nhập sai mật khẩu quá **5 lần liên tiếp** tạm khóa tài khoản **5 phút**.
- **D10:** Áp mã khuyến mãi chỉ tính thử (quote); lượt dùng trừ khi tạo đơn và **hoàn lại** khi đơn hết hạn giữ chỗ hoặc hủy trước khi phát sinh thanh toán.

---

## 2. Đối chiếu nhanh 11 Màn hình + Thành phần bổ sung (Mục 5.9)

| # | Màn hình | Route (`app/`) | UC phục vụ | Đánh giá đáp ứng SRS trên UI |
| --- | --- | --- | --- | --- |
| 01 | Đăng nhập – Đăng ký | `/login` (`Login.tsx`) | UC 001, 002, 003 | **Thiếu/Sai nghiệp vụ** (KH đăng nhập bừa vẫn vào; mật khẩu lộ mặc định; thiếu khóa 5 lần; Email không bắt buộc khi đăng ký; không check trùng) |
| 02 | Trang chủ khách hàng | `/` (`Home.tsx`) | UC 004, 008, 026 | **Đạt một phần** (bị khóa với khách chưa đăng nhập; cụm sân & số giờ trống hardcode; bỏ qua bộ lọc khung giờ `frame`; hiện cả mã tạm dừng) |
| 03 | Đặt sân trực tuyến | `/booking` (`Booking.tsx`) | UC 004, 007, 008 | **Thiếu/Sai nghiệp vụ** (mặc định sai Đặt cọc; thiếu khung 10h–14h & không ăn theo giờ mở cửa; thiếu cảnh báo không hoàn cọc; không hoàn lượt mã khi hủy) |
| 04 | Thanh toán VietQR | `/payment/:id` (`Payment.tsx`) | UC 005, 025 | **Sai nghiệp vụ nghiêm trọng** (lỗi hardcode cọc 30% trong `store.tsx:138`; hết hạn giữ chỗ chuyển nhầm sang `Đã hủy` thay vì `Quá hạn thanh toán`; thiếu trạng thái biên nhận & mô phỏng đối soát; không kiểm tra chủ đơn) |
| 05 | Lịch đặt của tôi & Thông báo | `/my-bookings` (`MyBookings.tsx`) | UC 006, 009, 026 | **Thiếu/Sai nghiệp vụ nghiêm trọng** (thiếu hoàn tiền 100%/50%/0%; **khách hủy được đơn đang chơi/quá giờ**; thiếu 2 tab trạng thái & modal chi tiết đơn; thông báo hoàn toàn hardcode tĩnh) |
| 06 | Đặt sân tại quầy (POS) | `/staff/booking` (`StaffBooking.tsx`) | UC 010, 011, 012 | **Đạt một phần** (khung giờ 5 ô lệch pha với online; không tìm thấy hội viên mới đăng ký; QR quầy thiếu mã đơn/kiểm tra lại/tạo lại/hủy ngang; Chủ sân không chọn được chi nhánh) |
| 07 | Quản lý đơn & Bàn giao sân | `/staff/orders` (`StaffOrders.tsx`) | UC 013, 014, 009, 021 | **Thiếu/Sai nghiệp vụ nghiêm trọng** (tất toán chọn Quét QR không hiện mã QR; khóa cứng ngày `TODAY`; thiếu chặn sân đang chơi; thiếu Phân loại hủy & chặn no-show sớm; thiếu xử lý đơn bị ảnh hưởng UC 021) |
| 08 | Tổng quan vận hành ngày | `/staff/stats` (`StaffStats.tsx`) | UC 015 | **Đạt một phần** (Chủ sân không chọn được cơ sở; KPI không bấm drill-down; lệch tổng QR + Tiền mặt khi có cọc giữ lại; lọc sắp chơi cứng `>= 17:00`) |
| 09 | Quản lý nhân viên | `/owner/staff` (`OwnerStaff.tsx`) | UC 016 | **Đạt khá tốt** (thiếu tìm kiếm/lọc trạng thái; không sửa được NV đang khóa; không check trùng với TK khách/email; số đơn & doanh thu là seed cứng; thiếu confirm khi khóa) |
| 10 | Quản lý sân bãi (3 tab) | `/owner/courts` (`OwnerCourts.tsx`) | UC 017–021 | **Thiếu nghiệp vụ cốt lõi** (thiếu Mô tả sân & min cọc 10%; thiếu bảng giá nhiều khung; thiếu chặn đổi cơ sở khi còn đơn; Tab 2 không chặn `open >= close`, thiếu lịch Thứ 2–CN & khoảng ngày nghỉ; Tab 3 thiếu chế độ Ngừng khai thác & **thiếu hoàn toàn cảnh báo + xử lý đơn bị ảnh hưởng UC 021**) |
| 11 | Khuyến mãi & Báo cáo | `/owner/reports` (`OwnerReports.tsx`) | UC 022, 023 | **Sai nghiệp vụ nghiêm trọng** (Báo cáo 100% số liệu hardcode không phản ánh giao dịch trên prototype; thiếu lọc & bảng theo từng sân; Khuyến mãi thiếu nút Xóa/Ngừng áp dụng, thiếu giảm VNĐ, thiếu loại sân & đối tượng, ẩn mã quầy, thông báo giả) |
| Bổ sung | Đối soát giao dịch & Hoàn tiền | *(Chưa có — Mục 5.9)* | UC 005, 009, 012, 025 | **Chưa có giao diện** (bảng giao dịch `"Cần đối soát"` & danh sách khoản hoàn tiền chờ xử lý sau khi hủy đơn) |

---

## 3. Danh sách chi tiết 34 sai lệch & thiếu sót UI so với SRS (`UI-01` – `UI-34`)

### A. Màn hình 01 — Đăng nhập & Đăng ký (`app/src/pages/Login.tsx`, `app/src/store.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-01` | **Critical** | UC 001 | `store.tsx:100-120` | Khách hàng đăng nhập bằng bất kỳ SĐT/mật khẩu `>= 6` ký tự nào đều vào TK cố định `Nguyễn Văn An`. **Cần:** lưu danh sách tài khoản khách hàng trong store (gồm cả hội viên mới đăng ký) và đối chiếu đúng SĐT/Email + mật khẩu, tự nhận diện vai trò (nút chọn nhanh chỉ đóng vai trò auto-fill cho demo). |
| `UI-02` | **Critical** | UC 003 | `Login.tsx:31-39`, `store.tsx:121` | Đăng ký không lưu tài khoản mới (đăng xuất là mất), không kiểm tra trùng SĐT/Email (`Alt 2b`), để Email không bắt buộc (`req: false`), thiếu kiểm tra Họ tên 2–100 ký tự không chứa số/ký tự đặc biệt và Mật khẩu 6–32 ký tự không khoảng trắng. |
| `UI-03` | **High** | UC 001 | `store.tsx:100-120` | Thiếu cơ chế đếm sai mật khẩu 5 lần liên tiếp → tạm khóa 5 phút kèm thông báo chuẩn SRS (`Alt 2b`). |
| `UI-04` | **Medium** | UC 001 | `Login.tsx:18` | `useState(true)` làm ô mật khẩu hiện rõ văn bản thuần ngay khi mở trang → phải mặc định `false` (`type="password"`). |
| `UI-05` | **Medium** | UC 001/003 | `Login.tsx:52-53`, `App.tsx:20-24` | Nút *"← Quay lại Trang chủ"* không đi về `/` vì `/` đang bị bọc sau `<Guard min="customer" />`. **Cần:** mở `/` công khai (Guest mode) và điều hướng về `location.state.from` sau đăng nhập. |

### B. Màn hình 02 — Trang chủ khách hàng (`app/src/pages/Home.tsx`, `app/src/layouts.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-06` | **High** | UC 004 | `Home.tsx:8-13,102-126` | `CLUSTERS` và số khung trống (`free: 5, 3, 6, 4`) bị hardcode tĩnh, không phản ánh thay đổi khi tạo/hủy đơn hay khóa sân. **Cần:** tính động từ `courts`, `bookings`, `locks`, `holidays` trong store. |
| `UI-07` | **Medium** | UC 004/008 | `Home.tsx:23-24,74,81` | • Bộ lọc `frame` gửi sang `/booking` nhưng `Booking.tsx` không đọc.<br>• Danh sách ưu đãi không lọc `p.active` nên mã đang tạm dừng vẫn hiện trên Trang chủ.<br>• Tiêu đề thẻ ưu đãi hardcode `p.percent === 10 ? 'Giảm 10% tất cả khung giờ'`. |
| `UI-08` | **Medium** | UC 026 | `layouts.tsx:38,60-65` | • Chấm đỏ trên chuông đếm đơn `pending` của **toàn bộ khách hàng** thay vì thông báo chưa đọc của `user` hiện tại.<br>• Avatar khách hàng hardcode `'AN'` thay vì `initials(user.name)`. |

### C. Màn hình 03 — Đặt sân trực tuyến (`app/src/pages/Booking.tsx`, `app/src/data.ts`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-09` | **Critical** | UC 004 | `data.ts:85-89`, `Booking.tsx:102-147` | `ONLINE_SLOTS` hardcode 7 khung cố định, bỏ trống `10:00–14:00` (mã buổi trưa `SALEGIOVANG20` 11h–15h gần như không áp được) và **không tuân theo giờ mở cửa `branch.open`–`branch.close`** mà Chủ sân chỉnh ở Tab 2. **Cần:** sinh khung giờ động theo giờ hoạt động từng ngày của chi nhánh và hỗ trợ chọn nhiều ô liền kề cùng sân (D7). |
| `UI-10` | **High** | UC 004 | `Booking.tsx:18` | Mặc định chọn `payMode = 'deposit'` trái với SRS UC 004 Bước 3 & Quyết định `D6` yêu cầu **mặc định `Thanh toán đủ 100%` (`full`)**. |
| `UI-11` | **High** | UC 007/008 | `Booking.tsx:50-61,174-190` | • Thiếu dòng cảnh báo bắt buộc *"Tiền cọc không được hoàn lại nếu hủy đơn hoặc không đến nhận sân đúng giờ"* khi chọn Đặt cọc.<br>• Chưa xử lý trường hợp sân cấu hình cọc `100%` (UC 007 `Alt 1a`).<br>• Quick chip khuyến mãi không lọc `p.active`; không hoàn lại `p.used` khi hủy đơn chưa thanh toán hoặc quá hạn giữ chỗ (UC 008 `Alt 3a`, D10).<br>• Không hiển thị thông báo *"Không còn khung giờ trống, vui lòng chọn ngày hoặc sân khác"* khi kín lịch (`Alt 1b`). |
| `UI-12` | **Medium** | UC 004 | `Booking.tsx:89,108` | Header bảng giá luôn lấy đơn giá từ `rows[0]` (sai nếu các sân cùng bộ môn có đơn giá khác nhau). |

### D. Màn hình 04 — Thanh toán VietQR (`app/src/pages/Payment.tsx`, `app/src/store.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-13` | **Critical** | UC 005/018 | `store.tsx:136-138`, `Payment.tsx:27` | **Lỗi nghiêm trọng tính tiền cọc:** `Payment.tsx` tính lại theo `court.deposit` hiện tại (mất bảo lưu giá/cọc cũ khi Chủ sân sửa sân), còn `store.tsx:138` lại **hardcode `0.3` (30%)**! Nếu sân cấu hình cọc 50%, khách trả 50% nhưng đơn chỉ ghi nhận 30%. **Cần:** lưu snapshot `depositAmount` trên `Booking` ngay lúc tạo. |
| `UI-14` | **Critical** | UC 005 | `store.tsx:88-98` | Hết thời gian giữ chỗ 10 phút chuyển sai thành `status: 'cancelled'` thay vì trạng thái thứ 6 **`expired` (`Quá hạn thanh toán`)** theo vòng đời SRS, và không hoàn lại lượt dùng mã khuyến mãi. |
| `UI-15` | **High** | UC 005/025 | `Payment.tsx:55-74` | • STK hiển thị cứng `1029384756` cho mọi chi nhánh (cần cấu hình STK riêng theo từng `Branch`).<br>• Thiếu màn hình trạng thái **Biên nhận thanh toán thành công** (Mục 5.9), thiếu mô phỏng kiểm tra giao dịch chưa nhận / sai tiền (đẩy sang màn Đối soát) và tự tạo thông báo kết quả thanh toán (UC 026).<br>• Thiếu kiểm tra chủ sở hữu đơn (`b.phone === user.phone`) nên khách hàng có thể mở `/payment/:id` của người khác. |

### E. Màn hình 05 — Lịch đặt của tôi & Thông báo (`app/src/pages/MyBookings.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-16` | **Critical** | UC 009 | `MyBookings.tsx:115-130`, `store.tsx:131-135` | **Thiếu hoàn toàn chính sách hoàn tiền bậc thang (FR 12 / D1):** Luôn giữ 100% `paid`, không tính tỷ lệ hoàn `100%` (`>= 5 ngày`), `50%` (`2–<5 ngày`), `0%` (`< 2 ngày`) trên phần tiền ngoài cọc; không hiển thị tỷ lệ & số tiền hoàn dự kiến trên hộp thoại hủy và trên thẻ đơn đã hủy. |
| `UI-17` | **Critical** | UC 009 | `MyBookings.tsx:73-94` | **Lỗi phân quyền thao tác:** Nút *"Hủy lịch đặt"* vẫn xuất hiện cho các đơn `playing` (Đang sử dụng) và `overdue` (Quá giờ), cho phép khách hàng hủy đơn đang chơi! Phải ẩn/chặn hủy với `playing`, `completed`, `expired`, `cancelled`, `overdue`. |
| `UI-18` | **High** | UC 006 | `MyBookings.tsx:7,23,28,39-41,81` | • Chỉ có 5 tab trạng thái (thiếu `Đang sử dụng` và `Quá hạn thanh toán`).<br>• Không kiểm tra `from > to` để báo *"Khoảng thời gian tra cứu không hợp lệ"* (`Alt 2b`).<br>• Thiếu **Modal chi tiết đơn** (địa chỉ cơ sở, giá thuê, khuyến mãi, lịch sử trạng thái — Mục 5.9).<br>• Hardcode `Math.round(b.total * 0.3)` và chữ `(30%)` ở dòng 81. |
| `UI-19` | **High** | UC 026 | `MyBookings.tsx:98-112` | Khối Thông báo hoàn toàn là JSX hardcode tĩnh (`"3 mới"`, `"17:00 Hôm nay"`, 2 thẻ ưu đãi cố định). **Cần:** lưu danh sách `notifications[]` trong store (tự sinh khi thanh toán thành công, phát hành khuyến mãi có gửi thông báo, đổi sân UC 021, nhắc lịch 1h), hỗ trợ lọc theo loại & trạng thái đọc, đánh dấu `Đã đọc`, cập nhật số chưa đọc trên chuông và deep-link kiểm tra mã hết hạn (`Alt 3a`). |
| `UI-20` | **Medium** | UC 009 | `MyBookings.tsx:120-123` | Chọn *"Lý do khác"* không hiện ô nhập văn bản (bắt buộc không rỗng, tối đa 255 ký tự). |

### F. Màn hình 06 — Đặt sân tại quầy POS (`app/src/pages/StaffBooking.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-21` | **High** | UC 010 | `data.ts:90-94`, `StaffBooking.tsx:58-70` | `COUNTER_SLOTS` chỉ có 5 khung cứng lệch pha với `ONLINE_SLOTS` (`15–17` cắt ngang `14–16`) và không ăn theo giờ mở cửa chi nhánh. |
| `UI-22` | **High** | UC 010/012 | `StaffBooking.tsx:19,37-56,173-178` | • Tra cứu hội viên chỉ đọc mảng tĩnh 5 người `MEMBERS` (không thấy hội viên mới đăng ký ở `/login`), không báo lỗi định dạng SĐT khi bấm Tra cứu (`Alt 2c`), và gán nhầm `member: true` nếu chọn tab Hội viên mà không tra ra.<br>• QR tại quầy thiếu mã đơn thực (`THANHTOAN <Mã đơn>`), thiếu đếm ngược, nút *"Kiểm tra lại giao dịch"*, *"Tạo lại mã QR"*, *"Chuyển thu tiền mặt"*, *"Hủy tạo đơn"* (UC 011 `2a`, UC 012 `3a–3c`).<br>• Mặc định gán mã `QUAYCG15` cho mọi cơ sở; không ghi nhận lịch sử giao dịch vào thống kê của nhân viên. |
| `UI-23` | **Medium** | Kế thừa | `layouts.tsx:94-96`, `StaffBooking.tsx:9` | Chủ sân truy cập các màn hình `/staff/*` bị khóa cứng vào `branches[0]`, không có dropdown đổi chi nhánh làm việc trên topbar. |

### G. Màn hình 07 — Quản lý đơn & Bàn giao sân (`app/src/pages/StaffOrders.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-24` | **Critical** | UC 013/012 | `StaffOrders.tsx:108-119` | Khi thu tất toán nhận sân và chọn **📱 Quét QR**, giao diện **không hề hiển thị mã VietQR** và không lưu tách giao dịch tất toán (ghi đè `booking.method` làm mất phương thức đặt cọc ban đầu). |
| `UI-25` | **Critical** | UC 021 | `StaffOrders.tsx` *(chưa có)* | Thiếu hoàn toàn tab/khối **Đơn đặt sân bị ảnh hưởng** cùng thao tác *"Chuyển sân / Đổi giờ"* và *"Đóng đơn do cơ sở"* (UC 021). |
| `UI-26` | **High** | UC 014 | `StaffOrders.tsx:15,78,117` | • Khóa cứng danh sách ở ngày `TODAY` (thiếu bộ chọn ngày tra cứu).<br>• Không chặn thao tác *"Nhận sân"* khi cùng sân đang có đơn khác ở trạng thái `playing` (UC 014 `Alt 2c`).<br>• Không lưu/hiển thị thời điểm nhận sân & trả sân thực tế. |
| `UI-27` | **High** | UC 009 | `StaffOrders.tsx:124-147` | Panel hủy đơn của nhân viên thiếu trường bắt buộc **Phân loại hủy** (*Khách báo hủy trước giờ* vs *Khách không đến nhận sân – Quá giờ*), thiếu kiểm tra chặn chọn *Không đến nhận sân* khi chưa quá 30 phút (`Alt 2c`), và thiếu tính hoàn tiền theo mốc 5 ngày / 2 ngày. |

### H. Màn hình 08 — Tổng quan vận hành ngày (`app/src/pages/StaffStats.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-28` | **High** | UC 015 | `StaffStats.tsx:9,21-26,32-41` | • Chủ sân không lọc được theo chi nhánh / toàn hệ thống.<br>• `qrSum + cashSum` không khớp `revenue` khi có khoản cọc giữ lại từ đơn hủy.<br>• 4 thẻ KPI không bấm được để chuyển/xem chi tiết danh sách đơn tương ứng (UC 015 Bước 3).<br>• Danh sách sắp nhận sân lọc cứng `start >= '17:00'` và nút hành động chuyển trang nhưng không truyền sẵn `bookingId`/`courtId`. |

### I. Màn hình 09 — Quản lý nhân viên (`app/src/pages/OwnerStaff.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-29` | **Medium** | UC 016 | `OwnerStaff.tsx:25-33,76-82` | • Thiếu ô tìm kiếm & lọc trạng thái; ẩn nút `Sửa` với NV đã khóa; thiếu hộp thoại xác nhận khi khóa tài khoản.<br>• Không kiểm tra trùng Email hoặc trùng SĐT với Chủ sân/Khách hàng.<br>• Số đơn và tổng thu lấy từ seed cứng thay vì cộng dồn từ giao dịch thực tế NV đã thu trên prototype; chưa bấm xem được lịch sử giao dịch chi tiết. |

### J. Màn hình 10 — Quản lý sân bãi (`app/src/pages/OwnerCourts.tsx`)

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-30` | **Critical** | UC 017/018 | `OwnerCourts.tsx:29-44,91-113` | • Thiếu trường **Mô tả sân** (<= 500 ký tự).<br>• Cho phép đặt cọc `0%` (SRS yêu cầu `10%–100%` hoặc số tiền cố định `> 0`).<br>• Bảng giá cố định 2 khung và nhãn mâu thuẫn (`05h–16h` vs `06:00–16:00`, hàm `rateAt` tự giảm 20% sau 21h).<br>• **Không chặn đổi cơ sở** khi sân đang có đơn tương lai `Chờ thanh toán` / `Đã xác nhận` (UC 018 `Alt 2b`). |
| `UI-31` | **Critical** | UC 019/020/021 | `OwnerCourts.tsx:118-188` | • **Tab 2:** Không kiểm tra `Giờ đóng cửa > Giờ mở cửa` (`Alt 2a`); chưa có bảng giờ theo Thứ 2–Chủ nhật; ngày nghỉ chưa hỗ trợ khoảng `Từ ngày – Đến ngày` & phạm vi chi nhánh; không quét cảnh báo đơn bị ảnh hưởng (`Alt 2b`).<br>• **Tab 3:** Thiếu chế độ **Ngừng khai thác (không thời hạn)**; cho bỏ trống lý do khóa (`Alt 1a`); **không liệt kê danh sách đơn bị ảnh hưởng và không có luồng UC 021 (Chuyển sân / Đóng đơn do cơ sở)**. |

### K. Màn hình 11 — Khuyến mãi & Báo cáo doanh thu (`app/src/pages/OwnerReports.tsx`) + Đối soát

| Mã | Mức độ | UC | Vị trí mã nguồn | Hiện trạng & Yêu cầu SRS cần đạt trên Prototype |
| --- | --- | --- | --- | --- |
| `UI-32` | **Critical** | UC 023 | `OwnerReports.tsx:9-44,86-123` | **Báo cáo 100% số liệu hardcode giả lập** (không thay đổi khi tạo/hoàn thành/hủy đơn trên prototype; tỷ lệ QR/Tiền mặt hardcode `74.1%/25.9%`; số sân hardcode `{8,10,6}`). Thiếu bộ lọc & bảng so sánh theo **từng sân**, thiếu loại trừ đơn *"Đóng đơn do cơ sở"*, thiếu thông báo *"Không có dữ liệu phát sinh trong khoảng thời gian đã chọn"* (`Alt 2a`). |
| `UI-33` | **High** | UC 022 | `OwnerReports.tsx:44,51-70,126-168` | • Ẩn mã tại quầy (`QUAYCG15`).<br>• **Thiếu nút Xóa** (`used === 0` xóa hẳn / `used > 0` chuyển `Ngừng áp dụng`, `Alt 1c`).<br>• Chỉ có 6 mức `%` cố định; thiếu loại giảm **số tiền cố định (VNĐ)**, phạm vi **loại sân**, **đối tượng khách hàng**, khung giờ tùy chỉnh; regex mã `4–16` thay vì `4–20` & chưa kiểm tra tên `5–150`; tích *"Gửi thông báo"* không thực sự tạo thông báo sang UC 026. |
| `UI-34` | **Medium** | UC 005/009/025 | *(Chưa có — Mục 5.9)* | Chưa có màn hình/tab bổ sung **Đối soát giao dịch & Hoàn tiền chờ xử lý** để nhân viên/chủ sân mô phỏng xử lý các giao dịch chuyển sai tiền/sai nội dung/trễ hạn và các khoản hoàn tiền `PENDING` sau khi khách hủy đơn theo mốc 5d/2d. |
