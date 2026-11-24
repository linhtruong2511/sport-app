-- Q-04: Thêm Sports.DisplayBlockMinutes cho độ hạt ô hiển thị trên lưới lịch
IF COL_LENGTH(N'dbo.Sports', N'DisplayBlockMinutes') IS NULL
BEGIN
    ALTER TABLE dbo.Sports
        ADD DisplayBlockMinutes SMALLINT NOT NULL
            CONSTRAINT DF_Sports_DisplayBlockMinutes DEFAULT (60);
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.check_constraints
    WHERE name = N'CK_Sports_DisplayBlockMinutes'
      AND parent_object_id = OBJECT_ID(N'dbo.Sports')
)
BEGIN
    ALTER TABLE dbo.Sports
        ADD CONSTRAINT CK_Sports_DisplayBlockMinutes
            CHECK (DisplayBlockMinutes >= GridBlockMinutes AND DisplayBlockMinutes % GridBlockMinutes = 0);
END;
GO

UPDATE dbo.Sports
SET DisplayBlockMinutes = CASE Code
    WHEN 'PICKLEBALL' THEN 120
    WHEN 'FOOTBALL'   THEN 90
    WHEN 'BADMINTON'  THEN 60
    WHEN 'TENNIS'     THEN 60
    WHEN 'BASKETBALL' THEN 60
    ELSE DisplayBlockMinutes
END
WHERE Code IN ('PICKLEBALL', 'FOOTBALL', 'BADMINTON', 'TENNIS', 'BASKETBALL');
GO
