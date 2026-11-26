-- R-17: Chủ sân tự cấu hình tài khoản nhận chuyển khoản của cơ sở.
-- Webhook SePay xác định cơ sở theo số tài khoản nhận (payments.repository findBranchByBankAccountNo),
-- nên hai cơ sở không được dùng chung một STK — nếu trùng, giao dịch có thể bị gán nhầm cơ sở.
IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'UX_Branches_BankAccountNo'
      AND object_id = OBJECT_ID(N'dbo.Branches')
)
BEGIN
    CREATE UNIQUE INDEX UX_Branches_BankAccountNo
        ON dbo.Branches (BankAccountNo)
        WHERE BankAccountNo IS NOT NULL;
END;
GO
