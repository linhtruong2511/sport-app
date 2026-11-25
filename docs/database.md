# Quy ước cơ sở dữ liệu (SDD 3 + `database/sporthub_init.sql`)

## 1. Nguồn sự thật

- `database/sporthub_init.sql` (kết hợp `database/migrations/001..004`) là schema chuẩn duy nhất: 26 bảng gốc + bảng/cột migration, CHECK, filtered index, `dbo.usp_NextCode`, seed (cơ sở dữ liệu mặc định `SportHub`, test `SportHub_Test`). Có chốt chặn `@AllowReset = 0` tránh xóa nhầm DB đã có dữ liệu `Users`.
- Tên trong code khớp script, kể cả chỗ SDD viết khác (R-02):

| SDD ghi | Script / code dùng |
| --- | --- |
| `PaymentRequests` | `PaymentRequest` (index `UX_PaymentRequest_Booking_Pending`) |
| `Chanel` | `Channel` (Bookings, Payments) |
| `CreateAt` | `CreatedAt` (RefreshTokens, Branches, BranchHolidays, PaymentRequest) |
| `MaxdiscountAmount` | `MaxDiscountAmount` |

- Thay đổi schema = file mới `database/migrations/NNN_mo_ta.sql` (3 chữ số, tăng dần), idempotent
  (`IF COL_LENGTH(...) IS NULL`, `IF NOT EXISTS (SELECT 1 FROM sys.indexes ...)`), có comment nguồn (Q-xx/R-xx).
  `sporthub_init.sql` chỉ sửa khi toàn đội đồng ý reset DB.

## 2. Kiểu dữ liệu và quy ước (SDD 3.2)

| Nội dung | Quy ước |
| --- | --- |
| Khóa chính | `INT IDENTITY` cho danh mục; `BIGINT IDENTITY` cho giao dịch/nhật ký |
| Tiền | `DECIMAL(18,0)` VNĐ, không âm. Trong JS là `number` nguyên (an toàn tới 2^53) |
| Tỷ lệ/giá trị cọc, giảm | `DECIMAL(18,2)` — có thể lẻ, không ép về số nguyên khi đọc |
| Thời điểm | `DATETIME2(0)` = giờ **Việt Nam**, không offset |
| Giờ / ngày | `TIME(0)` / `DATE` |
| Văn bản | `NVARCHAR` cho tiếng Việt; `VARCHAR` cho mã, SĐT, email, trạng thái |
| Trạng thái | `VARCHAR(20)` mã tiếng Anh viết hoa + CHECK |
| Mã nghiệp vụ | `usp_NextCode`: theo ngày `BK20261110` + `01` (≥ 100 thành 3 chữ số); không theo ngày `KH000001`. **Ngày = ngày tạo bản ghi** |
| `UpdatedAt` | Ứng dụng gán mỗi lần UPDATE. **Không dùng trigger** (làm lệch `RowVer`) |
| Collation | `Vietnamese_100_CI_AS` (so sánh không phân biệt hoa thường) |
| Tên ràng buộc | `PK_`, `FK_<Bảng>_<Cột>`, `CK_`, `DF_`, `UQ_`, `IX_` (thường), `UX_` (duy nhất) |

## 3. Múi giờ — dễ sai nhất

- Toàn bộ `DATETIME2` lưu giờ VN (wall-clock). Process Node chạy `TZ=Asia/Ho_Chi_Minh`.
- Driver `mssql`/tedious: đặt `options.useUTC = true` (R-11), và **mọi** đọc/ghi `DATETIME2` bắt buộc đi qua `backend/src/core/time.ts` (`toSqlDateTime`/`fromSqlDateTime` dịch `+07:00`) để hoạt động đồng nhất giữa tedious (`DB_AUTH_TYPE=sql`) và `msnodesqlv8` (`DB_AUTH_TYPE=windows` trên dev Windows).
- Chỉ dùng helper trong `backend/src/core/time.ts` để: lấy `now` (qua `Clock`), cộng phút, tách ngày/giờ, format ISO `+07:00`,
  tính thứ trong tuần theo quy ước 1 = Thứ 2 … 7 = CN (khác `Date.getDay()` 0 = CN).
- So sánh mốc thời gian nghiệp vụ trong SQL dùng tham số `@now` truyền từ app (để test được), không dùng `SYSDATETIME()`
  trong câu nghiệp vụ. `SYSDATETIME()` chỉ dùng cho DEFAULT `CreatedAt`.

## 4. Ràng buộc kết nối

Filtered index và `ROWVERSION` yêu cầu phiên có `ANSI_NULLS`, `QUOTED_IDENTIFIER`, `ANSI_PADDING`, `ANSI_WARNINGS`,
`ARITHABORT`, `CONCAT_NULL_YIELDS_NULL` = ON. tedious mặc định đã bật (giữ `enableArithAbort: true`). Nếu INSERT vào
`BookingSlots`/`PaymentRequest`/`Payments` báo lỗi 1934 → sai SET option của kết nối.

## 5. Những điều cấm

- Không xóa cứng Users, Branches, Courts, Promotions đã có giao dịch; không xóa dòng `CourtBlocks` (dùng `ReleasedAt`).
- Không UPDATE giá trong `CourtPriceRules` tại chỗ (đóng dòng cũ, chèn dòng mới).
- Không đổi `Sports.GridBlockMinutes` khi môn đã có đơn tương lai (R-05) — làm vỡ chốt chặn trùng lịch.
- Không tính tiền bằng `FLOAT/REAL`; không lưu số tiền đã định dạng chuỗi.
- Không dựa vào thứ tự mặc định — luôn `ORDER BY`.
- Không ghi `Bookings.PaymentStatus`, `PaidAmount`, `RemainingAmount` ngoài hàm cập nhật tiền dùng chung (đảm bảo CHECK
  `CK_Bookings_Remaining`, `CK_Bookings_DueNow`).

## 6. Bảng theo nhóm

| Nhóm | Bảng |
| --- | --- |
| Người dùng, bảo mật, thông báo | Users, RefreshTokens, AuditLogs, Notifications |
| Chi nhánh & sân | Branches, BranchOpeningHours, BranchHolidays, Sports, Courts, CourtPriceRules, CourtBlocks |
| Đặt sân | Bookings, BookingSlots, BookingPriceLines, BookingStatusHistory, BookingTransfers |
| Thanh toán & hoàn tiền | PaymentRequest, Payments, BankTransactions, Refunds |
| Khuyến mãi | Promotions, PromotionBranches, PromotionSports, PromotionCustomers |
| Hệ thống | SystemSettings, CodeSequences |

Bảng có thể thêm qua migration (chờ chốt): `IdempotencyKeys` (Q-02), cột `Sports.DisplayBlockMinutes` (Q-04),
`BranchHolidays.GroupKey` (Q-06).

## 7. Dữ liệu seed (dev)

2 cơ sở (CS01 Cầu Giấy, CS02 Mỹ Đình), 11 sân (1 sân INACTIVE + DECOMMISSION, 1 sân có lịch bảo trì D+5..D+7),
3 mã KM (SANGVUI20 ALL, TRIAN10 SPECIFIC, PICKLECS01 PAUSED), 5 đơn mẫu mỗi đơn một trạng thái, 2 giao dịch NEEDS_REVIEW,
1 khoản hoàn PENDING. Mốc thời gian tính tương đối theo ngày chạy script. Đặt `@SeedSample = 0` để bỏ dữ liệu mẫu.
