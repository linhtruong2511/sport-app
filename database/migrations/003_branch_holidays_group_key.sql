-- Q-06: Thêm BranchHolidays.GroupKey để gom nhóm ngày nghỉ áp dụng toàn hệ thống
IF COL_LENGTH(N'dbo.BranchHolidays', N'GroupKey') IS NULL
BEGIN
    ALTER TABLE dbo.BranchHolidays
        ADD GroupKey VARCHAR(30) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_BranchHolidays_GroupKey'
      AND object_id = OBJECT_ID(N'dbo.BranchHolidays')
)
BEGIN
    CREATE INDEX IX_BranchHolidays_GroupKey
        ON dbo.BranchHolidays (GroupKey)
        WHERE GroupKey IS NOT NULL;
END;
GO
