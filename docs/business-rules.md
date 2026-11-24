# Quy tắc nghiệp vụ SportHub

Bản tóm tắt có thẩm quyền để code và test. Mỗi quy tắc ghi nguồn (SRS = đặc tả yêu cầu, SDD = thiết kế, R-xx = đã chốt
trong `decisions.md`). Khi sửa code chạm vào một quy tắc ở đây, giữ hoặc bổ sung ca kiểm thử ở mục 14.

---

## 1. Vai trò và phạm vi dữ liệu (SDD 2.4)

| Chức năng | CUSTOMER | STAFF | OWNER |
| --- | --- | --- | --- |
| Xem chi nhánh, sân, lịch trống, KM công khai | ✔ | ✔ | ✔ |
| Đặt sân online, thanh toán QR | ✔ | — | — |
| Xem lịch đặt, thông báo, hủy đơn | đơn của mình | cơ sở mình | ✔ |
| Đặt tại quầy, thu tiền, tất toán, nhận sân | — | cơ sở mình | ✔ |
| Dashboard trong ngày | — | cơ sở mình | ✔ (lọc/“all”) |
| Xử lý đơn bị ảnh hưởng | — | cơ sở mình | ✔ |
| Đối soát giao dịch cần xử lý | — | cơ sở mình | ✔ |
| Nhân viên, sân, bảng giá, giờ mở cửa, khóa sân, KM, báo cáo, hoàn tiền | — | — | ✔ |

- Mỗi STAFF thuộc đúng một cơ sở (`Users.BranchId`, CHECK `CK_Users_RoleBranch`). OWNER/CUSTOMER có `BranchId = NULL`.
- Middleware `branchScope`: với STAFF, mọi tham số `branchId` bị ép bằng `user.branchId`; mọi thao tác trên đơn theo mã
  phải kiểm tra `booking.BranchId = user.branchId`, sai → `403 BRANCH_FORBIDDEN`.
- CUSTOMER chỉ đọc/ghi đơn có `CustomerUserId = mình` → sai `403 BOOKING_FORBIDDEN`.
- STAFF không gọi được API đặt online (`POST /bookings` chỉ CUSTOMER); nhân viên đặt hộ dùng API tại quầy.

## 2. Mã trạng thái và nhãn hiển thị (SDD 3.4)

| Bookings.Status | Nhãn | | Bookings.PaymentStatus | Nhãn |
| --- | --- | --- | --- | --- |
| `PENDING_PAYMENT` | Chờ thanh toán | | `UNPAID` | Chưa thanh toán |
| `CONFIRMED` | Đã xác nhận | | `DEPOSITED` | Đã đặt cọc |
| `IN_USE` | Đang sử dụng | | `PAID` | Đã thanh toán (100%) |
| `COMPLETED` | Hoàn thành | | | |
| `CANCELED` | Đã hủy | | | |
| `EXPIRED` | Quá hạn thanh toán | | | |

`PaymentStatus` **suy ra từ tiền**, không gán tay: `PaidAmount = 0` → UNPAID; `0 < PaidAmount < TotalAmount` → DEPOSITED;
`PaidAmount ≥ TotalAmount` → PAID (SDD 3.5d). `COMPLETED`, `CANCELED`, `EXPIRED` là trạng thái cuối.

`CancelType`: `CUSTOMER_REQUEST` (khách báo hủy trước giờ), `NO_SHOW` (khách không đến), `BY_FACILITY` (cơ sở đóng đơn,
UC 021), `COUNTER_ABORT` (hủy tạo đơn tại quầy khi khách bỏ đi, chưa trả tiền).

`isOverdue` (chỉ tính, không lưu): `Status = CONFIRMED` và chưa nhận sân và `now ≥ StartAt + NO_SHOW_GRACE_MINUTES`.

## 3. Vòng đời đơn (SDD 2.7, sửa theo R-04)

| Chuyển | Ai thực hiện | Điều kiện bắt buộc | Tác động |
| --- | --- | --- | --- |
| (mới) → `PENDING_PAYMENT` | KH online; NV tại quầy khi thu QR | Mục 3.1 | Tạo `BookingSlots` (IsActive=1), `BookingPriceLines`, lịch sử; `HoldExpireAt = min(now + BOOKING_HOLD_MINUTES, StartAt)`; có mã → `UsedCount + 1` nguyên tử; online → tạo luôn `PaymentRequest` |
| (mới) → `CONFIRMED` | NV tại quầy kèm tiền mặt trong cùng request; hoặc `TotalAmount = 0` | Mục 3.1; tiền mặt = `AmountDueNow` | Như trên + `Payments`; `HoldExpireAt = NULL`; `TotalAmount = 0` → PAID, không sinh QR |
| `PENDING_PAYMENT` → `CONFIRMED` | Webhook / recheck / NV thu tiền mặt / đối soát khớp tay | Số tiền = `AmountDueNow`, `now ≤ HoldExpireAt` | `Payments`; `PaymentStatus` = DEPOSITED (đặt cọc) hoặc PAID; `HoldExpireAt = NULL`; QR → PAID; thông báo PAYMENT_RESULT |
| `PENDING_PAYMENT` → `EXPIRED` | Job `expireHolds` | `now > HoldExpireAt` | Slots IsActive=0; `UsedCount − 1`; QR PENDING → EXPIRED; socket `slot.updated` |
| `PENDING_PAYMENT` → `CANCELED` | KH/NV (`CUSTOMER_REQUEST`); NV (`COUNTER_ABORT`, chỉ đơn COUNTER, `PaidAmount = 0`) | — | Slots IsActive=0; `UsedCount − 1`; QR → CANCELED; `RefundRate = NULL` |
| `CONFIRMED`(DEPOSITED) → `CONFIRMED`(PAID) | NV tất toán; webhook QR phần còn lại | Số tiền = `RemainingAmount` | `Payments` Purpose=REMAINING |
| `CONFIRMED` → `IN_USE` | NV "Nhận sân" | `RemainingAmount = 0`; ngày chơi là hôm nay; sân không có đơn `IN_USE` khác | `CheckedInAt = now` |
| `IN_USE` → `COMPLETED` | Job `autoComplete` (`now ≥ EndAt`) hoặc NV "Kết thúc sớm" | — | `CheckedOutAt = now`; socket mở lại ô còn lại |
| `CONFIRMED` → `CANCELED` (`CUSTOMER_REQUEST`) | KH (đơn mình), NV, OWNER | `now < StartAt` | Mục 8 |
| `CONFIRMED`(DEPOSITED) → `CANCELED` (`NO_SHOW`) | Job `cancelNoShows` hoặc NV | `now ≥ StartAt + NO_SHOW_GRACE_MINUTES` | Không hoàn; giữ toàn bộ cọc; slots IsActive=0 |
| `CONFIRMED`(PAID) → `CANCELED` (`NO_SHOW`) | Job `closePaidNoShows` hoặc NV | `now ≥ EndAt` — **giữ sân tới hết giờ** (SRS bổ sung 24/11/2026, R-04) | Không hoàn; lý do "Khách không tới nhận sân" |
| `PENDING_PAYMENT`/`CONFIRMED` → `CANCELED` (`BY_FACILITY`) | NV/OWNER qua UC 021 | Đơn thuộc danh sách bị ảnh hưởng (mục 9) | Hoàn 100% `PaidAmount` kể cả cọc; loại khỏi doanh thu |

Không được: hủy đơn `IN_USE`; nhận sân khi chưa trả đủ (`422 PAYMENT_INCOMPLETE`, FE mở màn tất toán); nhận sân khi
sân còn đơn `IN_USE` (`409 COURT_IN_USE`, kèm `details.blockingBookingCode`); khách hủy sau `StartAt`.

### 3.1. Điều kiện tạo đơn (UC 004, UC 010, SDD 3.5a)

Kiểm tra trong **cùng transaction** với INSERT, theo thứ tự, trả mã lỗi tương ứng:
1. Sân tồn tại, `Courts.Status = ACTIVE`, không giao `CourtBlocks` hiệu lực → `422 COURT_UNAVAILABLE`.
2. Cơ sở `ACTIVE`; ngày không nằm trong `BranchHolidays`, `BranchOpeningHours.IsClosed = 0` → `422 BRANCH_CLOSED`.
3. `[StartAt, EndAt)` nằm trọn trong `[OpenTime, CloseTime)` → `422 OUTSIDE_OPENING_HOURS`.
4. `StartAt > now` → `422 BOOKING_IN_PAST`. `StartAt`, `EndAt` cùng ngày (CHECK `CK_Bookings_Time`).
5. Giờ bắt đầu và thời lượng là bội số `Sports.GridBlockMinutes` → `422 INVALID_TIME_STEP`.
6. Bảng giá phủ kín toàn bộ thời lượng → `422 PRICE_NOT_CONFIGURED`.
7. Mã khuyến mãi (nếu có) hợp lệ theo mục 5 → `422 PROMO_INVALID` (`details.reasonCode`).
8. `PaymentOption = DEPOSIT` nhưng cọc tính ra ≥ tổng tiền → `422 DEPOSIT_NOT_ALLOWED` (R-09).
9. INSERT `BookingSlots` — vi phạm unique → `409 SLOT_TAKEN`.
10. `UPDATE Promotions SET UsedCount += 1 WHERE … AND UsedCount < MaxUses` ảnh hưởng 0 dòng → rollback, `409 PROMO_EXHAUSTED`.

Khách vãng lai (chỉ tại quầy): bắt buộc `GuestName` + `GuestPhone` (CHECK `CK_Bookings_Customer`).

## 4. Tiền thuê sân (SDD 3.5a)

Một khung giá `CourtPriceRules` được dùng khi thỏa **cả 4**:
1. Cùng `CourtId`.
2. Hiệu lực **tại thời điểm tạo đơn** (không phải ngày chơi — R-10): `EffectiveFrom ≤ now` và (`EffectiveTo IS NULL` hoặc `EffectiveTo > now`).
3. Bit của thứ ngày chơi bật trong `DayOfWeekMask` (bit 0 = Thứ 2 … bit 6 = CN; 127 = cả tuần).
4. `[StartTime, EndTime)` giao `[giờ StartAt, giờ EndAt)`.

Với mỗi khung giao, đoạn = `[max(StartAt, StartTime), min(EndAt, EndTime))`:

```
Amount_i   = ROUND(PricePerHour_i × phút_i / 60, 0)
BaseAmount = Σ Amount_i            -- mỗi đoạn là 1 dòng BookingPriceLines
```

Tổng phút được phủ phải bằng thời lượng đơn, thiếu → `PRICE_NOT_CONFIGURED`. Ví dụ: 15:00–17:00, giờ thường 150.000đ/h
đến 16:00, cao điểm 250.000đ/h từ 16:00 → 2 dòng, `BaseAmount = 400.000`.

Sửa giá (UC 018): đóng dòng cũ `EffectiveTo = now`, chèn dòng mới `EffectiveFrom = now`. Không UPDATE giá tại chỗ.
Các khung cùng sân, mặt nạ ngày giao nhau, cùng thời gian hiệu lực không được chồng giờ → `422 PRICE_RULE_OVERLAP`.

## 5. Khuyến mãi (SDD 3.5b–c, UC 008, UC 022)

**Kiểm tra theo đúng thứ tự, dừng ở điều kiện đầu tiên không đạt:**

| # | Điều kiện | reasonCode | Thông báo |
| --- | --- | --- | --- |
| 1 | Mã tồn tại (`Promotions.Code`) | `PROMO_NOT_FOUND` | Mã khuyến mãi không tồn tại. |
| 2 | `Status = ACTIVE` | `PROMO_INACTIVE` | Mã khuyến mãi đang tạm dừng hoặc đã ngừng áp dụng. |
| 3 | `StartDate ≤ ngày chơi ≤ EndDate` | `PROMO_OUT_OF_DATE` | Ngày chơi nằm ngoài thời gian áp dụng mã. |
| 4 | `TimeFrom ≤ giờ StartAt` và `giờ EndAt ≤ TimeTo` (bỏ qua nếu NULL) | `PROMO_OUT_OF_TIME` | Giờ chơi nằm ngoài khung giờ của mã. |
| 5 | `AllBranches = 1` hoặc cơ sở có trong `PromotionBranches` | `PROMO_WRONG_BRANCH` | Mã không áp dụng cho cơ sở này. |
| 6 | `AllSports = 1` hoặc môn có trong `PromotionSports` | `PROMO_WRONG_SPORT` | Mã không áp dụng cho môn thể thao của sân. |
| 7 | `AudienceType = ALL` hoặc khách có trong `PromotionCustomers` | `PROMO_WRONG_AUDIENCE` | Mã chỉ dành cho khách hàng được chỉ định. |
| 8 | `UsedCount < MaxUses` | `PROMO_EXHAUSTED` | Mã khuyến mãi đã hết lượt sử dụng. |

Khách vãng lai chỉ dùng được mã `ALL`. Mỗi đơn tối đa một mã. API báo giá trả mã không hợp lệ dưới dạng
`200` + `promotion.applied = false` + `reasonCode`; API tạo đơn trả `422 PROMO_INVALID`.

```
Giảm thô       = PERCENT ? ROUND(BaseAmount × DiscountValue / 100, 0) : DiscountValue
DiscountAmount = min(Giảm thô, MaxDiscountAmount ?? ∞, BaseAmount)
TotalAmount    = BaseAmount − DiscountAmount            -- CHECK CK_Bookings_Total
```

**Đếm lượt `UsedCount`:**

| Sự kiện | Thay đổi |
| --- | --- |
| Tạo đơn có mã hợp lệ | +1, câu UPDATE có điều kiện `UsedCount < MaxUses` |
| Đơn `PENDING_PAYMENT` bị hủy (mọi CancelType) hoặc `EXPIRED` | −1 |
| `BY_FACILITY` khi đơn chưa thu tiền | −1 |
| Đơn đã có tiền rồi mới hủy (CUSTOMER_REQUEST, NO_SHOW, BY_FACILITY có tiền) | Không đổi |

Báo giá (`/bookings/quote`) **không** giữ chỗ, **không** trừ lượt. Không đổi `Code` khi `UsedCount > 0`
(`422 PROMO_CODE_LOCKED`); không hạ `MaxUses` dưới `UsedCount`. Xóa mã đã có lượt dùng → chuyển `DISCONTINUED`.

## 6. Cọc và số tiền phải trả (SDD 3.5d, UC 007)

Mức cọc chụp từ `Courts.DepositType/DepositValue` vào đơn lúc tạo. Cọc tính trên **TotalAmount (sau giảm)**.

```
DepositAmount = FULL                 → 0
                DEPOSIT, PERCENT     → ROUND(TotalAmount × DepositValue / 100, 0)   -- DepositValue 10–100, có thể lẻ (50.5)
                DEPOSIT, FIXED       → min(DepositValue, TotalAmount)
AmountDueNow  = FULL ? TotalAmount : DepositAmount
RemainingAmount = TotalAmount − PaidAmount                                          -- CHECK CK_Bookings_Remaining
```

- Cọc tính ra ≥ `TotalAmount` → không cho chọn DEPOSIT: báo giá trả `deposit.fullPaymentRequired = true`, tạo đơn với
  DEPOSIT → `422 DEPOSIT_NOT_ALLOWED` (R-09). Đơn FULL luôn có `DepositAmount = 0` (CHECK `CK_Bookings_DueNow`).
- Khoản thu đầu = đúng `AmountDueNow`, trước `HoldExpireAt`. Khoản tất toán = đúng `RemainingAmount`. Không thu một phần.
- Sau mỗi `Payments`, cập nhật `PaidAmount`, `RemainingAmount`, `PaymentStatus` **trong cùng transaction**.

| Ví dụ | Mức cọc | Total | Cọc | Trả ngay | Thu khi nhận sân |
| --- | --- | --- | --- | --- | --- |
| Bóng đá Mini 03 09:00–10:30 (300k/h), SANGVUI20 −20%, đặt cọc | 30% | 360.000 | 108.000 | 108.000 | 252.000 |
| Cầu lông 17:00–18:00 (120k/h), đặt cọc | 50.000đ | 120.000 | 50.000 | 50.000 | 70.000 |
| Cầu lông, Total sau giảm 30.000, chọn đặt cọc | 50.000đ | 30.000 | — | `DEPOSIT_NOT_ALLOWED` → phải FULL | — |
| Pickleball 18:00–20:00 (250k/h), FULL | 30% | 500.000 | 0 | 500.000 | 0 |

## 7. Thanh toán QR và khớp giao dịch (SDD 2.6, 5.6)

**Sinh QR** (`PaymentRequest`):
- Chuỗi EMVCo/VietQR sinh ở backend từ `Branches.BankBin`, `BankAccountNo` của **cơ sở sở hữu sân**, số tiền, nội dung
  `THANHTOAN {BookingCode}`. FE vẽ bằng `qrcode.react`, không gọi dịch vụ ảnh ngoài.
- Cơ sở thiếu thông tin ngân hàng → `422 BRANCH_BANK_NOT_CONFIGURED`.
- `Purpose`: `DEPOSIT`/`FULL` (theo `PaymentOption`, đơn chờ) hoặc `REMAINING` (đơn CONFIRMED + DEPOSITED).
- `ExpiresAt`: online = `HoldExpireAt`; tại quầy = `min(now + QR_EXPIRE_MINUTES, HoldExpireAt nếu đơn đang chờ)`.
- Mỗi đơn chỉ một QR `PENDING` (`UX_PaymentRequest_Booking_Pending`): tạo mới thì QR cũ → `EXPIRED` trước; hủy đơn → `CANCELED`.

**Webhook `POST /api/v1/webhooks/bank/sepay`:**
1. Xác thực `Authorization: Apikey …` (hoặc HMAC) + IP allowlist ở Nginx. Sai → `401`, không ghi gì.
2. INSERT `BankTransactions` (MatchStatus=PENDING, `RawPayload` nguyên văn). Trùng `(Provider, ProviderTxnId)` → trả `200` ngay.
3. `transferType = out` → `IGNORED`.
4. Tách mã đơn bằng `/BK\d{10,}/i` sau khi bỏ khoảng trắng; tìm cơ sở theo `AccountNo = Branches.BankAccountNo`.
5. Khóa đơn `WITH (UPDLOCK, ROWLOCK)` (không dùng RowVer — không được bỏ sót tiền).
6. Khớp tự động khi và chỉ khi:
   - đơn `PENDING_PAYMENT`, `now ≤ HoldExpireAt`, số tiền = `AmountDueNow`, tài khoản đúng cơ sở của đơn → xác nhận; hoặc
   - đơn `CONFIRMED` + `DEPOSITED`, số tiền = `RemainingAmount` → tất toán (PAID).
   Khi khớp: INSERT `Payments` (BANK_TRANSFER, `BankTxnId`, `RequestId`), cập nhật đơn, QR → PAID, MatchStatus=MATCHED.
7. Mọi trường hợp khác → `NEEDS_REVIEW` với `issue`: `WRONG_AMOUNT`, `UNKNOWN_CONTENT`, `LATE_PAYMENT` (đơn đã
   EXPIRED/CANCELED), `ACCOUNT_MISMATCH`. Không đổi đơn. Phát `reconciliation.created` tới `branch:{branchId}`.
8. Phản hồi `200 {"success": true}` khi đã lưu được giao dịch; lỗi CSDL → `5xx` để SePay gửi lại.
9. Sau commit: thông báo PAYMENT_RESULT cho khách có tài khoản; socket `booking.paid`.

`/payment-requests/{id}/recheck` là đường dự phòng: truy vấn SePay, nếu thấy giao dịch chưa ghi nhận thì đi đúng
luồng 2–9 ở trên. Giới hạn 1 lần/5 giây/đơn. **Không bao giờ** xác nhận đơn chỉ vì khách bấm "Tôi đã chuyển khoản".

Đối soát tay (MH.14): khớp vào đơn chỉ khi số tiền bằng đúng số cần thu; không thì "Hoàn lại khách" (ghi chú bắt buộc)
hoặc "Bỏ qua".

## 8. Hủy đơn và hoàn tiền (FR 12, UC 009, SDD 3.5e)

Chỉ hủy được `PENDING_PAYMENT` hoặc `CONFIRMED`. Lý do hủy bắt buộc, 1–255 ký tự.

```
T            = (StartAt − CanceledAt) tính bằng giây / 86 400         -- số ngày, có phần lẻ
RefundRate   = T ≥ REFUND_FULL_DAYS(5)                     → 100
               REFUND_HALF_DAYS(2) ≤ T < REFUND_FULL_DAYS  → REFUND_HALF_RATE(50)
               T < 2 hoặc NO_SHOW                          → 0
               đơn PENDING_PAYMENT                         → NULL (chưa thu tiền)
DepositKept      = DEPOSIT ? min(PaidAmount, DepositAmount) : 0
RefundableBase   = max(PaidAmount − DepositAmount, 0)
RefundAmount     = ROUND(RefundableBase × RefundRate / 100, 0)
```

| CancelType | Khi nào | Tiền hoàn |
| --- | --- | --- |
| `CUSTOMER_REQUEST` | KH/NV/OWNER hủy, `now < StartAt` | Theo công thức |
| `NO_SHOW` – đơn DEPOSITED | `now ≥ StartAt + NO_SHOW_GRACE_MINUTES` (30') | 0, giữ toàn bộ cọc |
| `NO_SHOW` – đơn PAID | `now ≥ EndAt` (R-04) | 0 |
| `COUNTER_ABORT` | Đơn COUNTER, PENDING_PAYMENT, chưa thu tiền | Không xét |
| `BY_FACILITY` | Đóng đơn do cơ sở (UC 021) | 100% `PaidAmount`, kể cả cọc |

- `RefundAmount > 0` → INSERT `Refunds` (Status=PENDING, `Rate` 50/100). Hoàn tiền thực hiện **ngoài hệ thống**,
  OWNER đánh dấu `COMPLETED`/`FAILED` (Q-12). Lỗi hoàn không chặn việc hủy đơn (UC 009-3a).
- Khi hủy: lưu `CancelType`, `CancelReason`, `CanceledBy` (NULL nếu job), `CanceledAt`; slots IsActive=0;
  QR PENDING → CANCELED; ghi lịch sử. NV/OWNER hủy đơn của khách có tài khoản → thông báo SCHEDULE_CHANGE.
- NV chọn NO_SHOW khi chưa đủ điều kiện → `422 NO_SHOW_NOT_ELIGIBLE`.
- `GET /bookings/{code}/cancel-preview` dùng **cùng hàm tính** với API hủy (không viết hai lần).

## 9. Đơn bị ảnh hưởng (UC 019–021, API-36..39)

Đơn `PENDING_PAYMENT`/`CONFIRMED` có `StartAt ≥ now` và thỏa ít nhất một: giao `CourtBlocks` chưa giải phóng; rơi vào
`BranchHolidays`; nằm ngoài `BranchOpeningHours` hiện tại; sân `INACTIVE`. Danh sách **tính trực tiếp**, không có cột cờ.
Mỗi đơn kèm `affectedReasons[]` (`COURT_BLOCK | HOLIDAY | OPENING_HOURS | COURT_INACTIVE`).

- Khóa sân / đổi giờ mở cửa / thêm ngày nghỉ **không tự hủy** đơn; chỉ trả `affectedCount` + danh sách để xử lý.
  Các API này hỗ trợ `?dryRun=true` để xem trước.
- **Chuyển sân/đổi giờ**: cùng cơ sở, cùng môn, sân ACTIVE, không khóa, **cùng thời lượng**, không trùng. Giữ nguyên mã đơn,
  giá trị đơn, số tiền đã đóng, **không tính lại tiền**. Slots cũ IsActive=0, chèn slots mới; ghi `BookingTransfers`;
  `ReminderSentAt = NULL`; thông báo SCHEDULE_CHANGE; socket cho cả ô cũ và mới.
- **Đóng đơn do cơ sở**: `BY_FACILITY`, `RefundRate = 100`, `RefundAmount = PaidAmount`, tạo `Refunds` nếu > 0.

## 10. Doanh thu thực thu (SDD 3.5f, UC 015, UC 023)

```
Thực thu(kỳ) = Σ Payments.Amount có PaidAt trong kỳ
             − Σ Bookings.RefundAmount của đơn có CanceledAt trong kỳ (Q-14)
             -- loại bỏ hoàn toàn đơn CancelType = BY_FACILITY (cả phiếu thu lẫn hoàn)
```

- Nguồn là `Payments`, **không** phải `TotalAmount`. Tách `cash`/`bankTransfer` theo `Payments.Method`.
- Báo cáo tách: `fromCompleted` (đơn COMPLETED + IN_USE), `fromUpcoming` (tiền đã thu của đơn CONFIRMED),
  `fromCanceled` (tiền giữ lại của đơn hủy không hoàn đủ).
- KPI "tổng lượt đặt hôm nay" đếm đơn có ngày chơi = hôm nay, loại CANCELED/EXPIRED.
- Công suất = Σ giờ đặt (CONFIRMED/IN_USE/COMPLETED) ÷ Σ giờ mở cửa của sân ACTIVE trong kỳ (trừ ngày nghỉ).
- Khoảng ngày tra cứu: `from ≤ to`, tối đa 366 ngày → `400 INVALID_DATE_RANGE`.

## 11. Tài khoản và bảo mật (UC 001–003, UC 016, SDD 2.4)

- Đăng nhập bằng SĐT **hoặc** email (không phân biệt hoa thường). bcrypt cho mật khẩu.
- `LockedUntil > now` → `423 ACCOUNT_TEMP_LOCKED` (`details.lockedUntil`). `Status = LOCKED` → `403 ACCOUNT_LOCKED`.
- Sai mật khẩu: `FailedLoginCount + 1`; đạt `LOGIN_MAX_FAILED` (5) → `LockedUntil = now + LOGIN_LOCK_MINUTES` (5) và đặt
  lại bộ đếm (R-07). Đúng → bộ đếm = 0, `LastLoginAt = now`.
- Access token JWT 15 phút (`sub, role, branchId, tv`), trả trong body. Refresh token ngẫu nhiên 7 ngày trong cookie
  `sh_rt` (HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth), lưu SHA-256 trong `RefreshTokens`, **xoay vòng** mỗi lần refresh.
- Khóa NV / đổi cơ sở NV / đặt lại mật khẩu → `TokenVersion + 1`, thu hồi mọi refresh token, socket `auth.revoked`.
  Middleware so `tv` với DB → `401 TOKEN_REVOKED`. Lịch sử đơn và phiếu thu của NV giữ nguyên.

**Validation dùng chung** (zod trong `packages/shared` khi tách workspace ở M0, BE kiểm lại toàn bộ):

| Trường | Quy tắc |
| --- | --- |
| Số điện thoại | `^0\d{9}$`, duy nhất toàn bộ Users |
| Email | định dạng email, không khoảng trắng; bắt buộc với CUSTOMER, tùy chọn với STAFF; duy nhất nếu có |
| Họ tên | 2–100 ký tự, chỉ chữ cái (Unicode, có dấu) và khoảng trắng |
| Mật khẩu | 6–32 ký tự, không khoảng trắng |
| Mã khuyến mãi | `^[A-Z0-9]{4,20}$` (FE viết hoa trước khi gửi) |
| Tên chương trình KM | 5–150 ký tự |
| Lý do hủy / ghi chú xử lý | bắt buộc, ≤ 255 ký tự |
| Mô tả sân | ≤ 500 ký tự; tên sân ≤ 100, duy nhất trong cơ sở |
| Mức cọc | PERCENT 10–100; FIXED > 0 |
| Mức giảm | PERCENT 1–100; FIXED > 0 |
| Ngày nghỉ | `startDate ≥ hôm nay`, 1–60 ngày liên tiếp |

## 12. Thông báo (UC 026, SDD 3.3a)

- Chỉ khách **có tài khoản** nhận (`Notifications.UserId`, Role = CUSTOMER). Khách vãng lai nhận phiếu thu tại quầy.
- Loại: `PAYMENT_RESULT`, `REMINDER`, `PROMOTION`, `SCHEDULE_CHANGE`. `Body` dựng sẵn lúc gửi.
- Nhắc lịch: đơn CONFIRMED, `ReminderSentAt IS NULL`, `StartAt ≤ now + REMINDER_BEFORE_MINUTES` → nội dung gồm giờ nhận
  sân, địa chỉ cơ sở, tên sân, **số tiền còn thiếu**; đặt `ReminderSentAt = now`.
- Thông báo KM "tất cả khách" được nhân bản thành từng dòng theo UserId. `NotifyStatus`: PENDING → SENT/FAILED;
  job `retryPromoNotify` gửi lại FAILED. Lỗi gửi không chặn việc phát hành mã.
- Mỗi lần tạo thông báo → socket `notification.created` kèm `unreadCount`.

## 13. Tham số hệ thống (`SystemSettings`, seed trong SQL)

| Key | Giá trị | Dùng ở |
| --- | --- | --- |
| `BOOKING_HOLD_MINUTES` | 10 | Hạn giữ chỗ đơn chờ (R-03) |
| `REMINDER_BEFORE_MINUTES` | 60 | Nhắc lịch |
| `NO_SHOW_GRACE_MINUTES` | 30 | No-show đơn đặt cọc, `isOverdue` |
| `REFUND_FULL_DAYS` | 5 | Mốc hoàn 100% |
| `REFUND_HALF_DAYS` | 2 | Mốc hoàn 50% |
| `REFUND_HALF_RATE` | 50 | Tỷ lệ mốc giữa |
| `LOGIN_MAX_FAILED` | 5 | Khóa tạm |
| `LOGIN_LOCK_MINUTES` | 5 | Khóa tạm |
| `QR_EXPIRE_MINUTES` | 10 | QR tại quầy |

Đọc qua một `SettingsService` có cache ngắn (≤ 60 giây). Test phải truyền giá trị tường minh, không phụ thuộc DB.

## 14. Ca kiểm thử bắt buộc

Mỗi ca dưới đây phải có test tự động (unit cho hàm thuần, integration cho luồng có CSDL). Dùng đồng hồ giả (inject clock).

**Tiền**
- [ ] Đơn vắt 2 khung giá 15:00–17:00 → 2 price line, Base 400.000.
- [ ] Thiếu bảng giá cho một đoạn → PRICE_NOT_CONFIGURED.
- [ ] Giá được chọn theo thời điểm tạo đơn khi có 2 dòng hiệu lực trước/sau (bóng đá 600k → 650k từ 01/11).
- [ ] PERCENT có trần: 20% của 600.000 trần 100.000 → giảm 100.000. FIXED lớn hơn Base → giảm = Base, Total = 0 → CONFIRMED + PAID, không QR.
- [ ] 4 dòng ví dụ ở mục 6, kể cả DEPOSIT_NOT_ALLOWED. DepositValue lẻ (50.5%) làm tròn đúng.

**Khuyến mãi**
- [ ] Mỗi reasonCode trong 8 điều kiện, đúng thứ tự ưu tiên (mã vừa hết hạn vừa sai cơ sở → OUT_OF_DATE).
- [ ] Khách vãng lai dùng mã SPECIFIC → WRONG_AUDIENCE.
- [ ] Hai request song song tranh lượt cuối → đúng một thành công, một PROMO_EXHAUSTED.
- [ ] UsedCount −1 khi đơn chờ hủy/hết hạn; không đổi khi hủy đơn đã có tiền.

**Trùng lịch & đồng thời**
- [ ] Hai request tạo đơn trùng ô song song → một 201, một 409 SLOT_TAKEN.
- [ ] Đơn EXPIRED/CANCELED giải phóng ô; đặt lại được ngay.
- [ ] Hủy với `version` cũ → 409 BOOKING_STATE_CHANGED.
- [ ] Cùng Idempotency-Key gửi 2 lần → cùng kết quả, 1 đơn; cùng key khác body → 409 IDEMPOTENCY_CONFLICT.

**Thanh toán**
- [ ] Webhook khớp đơn cọc → CONFIRMED + DEPOSITED; khớp phần còn lại → PAID.
- [ ] Webhook trùng `id` → 200, không tạo Payments thứ hai.
- [ ] Sai số tiền / không có mã / đơn EXPIRED / sai tài khoản → NEEDS_REVIEW, đơn không đổi.
- [ ] Webhook đến khi đơn vừa hết hạn (now > HoldExpireAt nhưng job chưa chạy) → NEEDS_REVIEW (LATE_PAYMENT).

**Hủy & hoàn**
- [ ] T = đúng 5 ngày → 100%; 4 ngày 23:59:59 → 50%; đúng 2 ngày → 50%; 1,99 ngày → 0%.
- [ ] Đơn FULL 400.000 hủy trước 10 ngày → hoàn 400.000. Đơn cọc chưa tất toán hủy trước 10 ngày → hoàn 0, giữ cọc.
- [ ] Đơn cọc đã tất toán (Paid = Total) hủy 3 ngày trước → hoàn 50% × (Paid − Deposit).
- [ ] NO_SHOW đơn DEPOSITED tại StartAt+30' → hủy, slots giải phóng. Đơn PAID tại StartAt+30' → **không** hủy; tại EndAt → hủy NO_SHOW.
- [ ] BY_FACILITY hoàn cả cọc và bị loại khỏi doanh thu.
- [ ] Khách hủy sau StartAt → BOOKING_NOT_CANCELABLE.

**Nhận sân**
- [ ] Nhận sân khi DEPOSITED → PAYMENT_INCOMPLETE. Sân còn đơn IN_USE → COURT_IN_USE (kiểm tra **trước** khi thu tiền ở API settle).
- [ ] autoComplete tại EndAt.

**Phân quyền**
- [ ] STAFF CS01 gửi branchId=CS02 → bị ép CS01 / thao tác đơn CS02 → 403 BRANCH_FORBIDDEN.
- [ ] CUSTOMER đọc đơn người khác → 403 BOOKING_FORBIDDEN.
- [ ] NV bị khóa: request kế tiếp với token cũ → 401 TOKEN_REVOKED.
- [ ] Sai mật khẩu lần 5 → 423, đăng nhập đúng trong 5 phút vẫn 423.

**Doanh thu**
- [ ] Bộ seed hiện tại: tính tay và so với `/reports/revenue`, `/dashboard/daily`.
