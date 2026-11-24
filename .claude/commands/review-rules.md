---
description: Rà soát thay đổi hiện tại theo các bất biến nghiệp vụ SportHub
---

Rà soát thay đổi chưa commit (`git diff` và `git diff --staged`; nếu sạch thì so với nhánh chính) theo `CLAUDE.md`
mục "Bất biến" và `docs/business-rules.md`. Với từng mục dưới đây, ghi **Đạt / Vi phạm / Không liên quan**, kèm file:dòng:

1. Trùng lịch: tạo/chuyển đơn có đi qua INSERT `BookingSlots` và bắt 2601/2627 → `SLOT_TAKEN` không? Có chỗ nào kiểm tra
   bằng SELECT rồi INSERT thay cho unique index?
2. Đổi trạng thái đơn: qua `BookingStateService`, có `version`/UPDLOCK đúng chỗ, ghi `BookingStatusHistory`, cùng
   transaction, socket sau commit?
3. Tiền: số nguyên, `ROUND` đúng chỗ, cọc tính trên TotalAmount, không thu một phần, `PaymentStatus` suy từ tiền,
   cập nhật qua `applyPayment`?
4. Hoàn tiền: cọc không hoàn (trừ BY_FACILITY); mốc 5/2 ngày tính bằng giây; NO_SHOW tách DEPOSITED/PAID (R-04)?
5. Khuyến mãi: đủ 8 điều kiện đúng thứ tự; `UsedCount` tăng có điều kiện; trả lượt đúng sự kiện?
6. Snapshot: đơn giá, cọc, mã/tiền giảm lưu vào đơn; sửa giá không UPDATE dòng cũ?
7. Phân quyền: STAFF bị ép branch; truy vấn đơn theo mã kiểm tra BranchId/CustomerUserId?
8. Webhook: lưu BankTransactions trước, idempotent, chỉ tự khớp khi đúng tuyệt đối, còn lại NEEDS_REVIEW?
9. Thời gian: không `new Date()` trong service/repo/job; SQL dùng `@now`; ISO `+07:00`; thứ trong tuần 1 = Thứ 2?
10. Tham số nghiệp vụ đọc từ `SystemSettings`, không hard-code?
11. Thông báo lỗi đúng câu SDD; mã lỗi có trong `@sporthub/shared/errors`?
12. Test: mỗi quy tắc bị chạm có test; các ca liên quan ở `docs/business-rules.md` mục 14 đã có chưa?

Kết thúc bằng danh sách vi phạm xếp theo mức độ nghiêm trọng và đề xuất sửa. Không tự sửa khi chưa được yêu cầu.
