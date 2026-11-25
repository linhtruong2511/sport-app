-- M-4 / Q-15 / R-12: Đưa tham số thời gian cho phép nhận sân sớm (15 phút) vào SystemSettings
IF NOT EXISTS (
    SELECT 1
    FROM dbo.SystemSettings
    WHERE SettingKey = 'CHECKIN_EARLY_MINUTES'
)
BEGIN
    INSERT INTO dbo.SystemSettings (SettingKey, SettingValue, Description)
    VALUES (
        'CHECKIN_EARLY_MINUTES',
        N'15',
        N'Cho phép nhận sân sớm nhất trước giờ chơi (phút) – Q-15 / R-12'
    );
END;
GO
