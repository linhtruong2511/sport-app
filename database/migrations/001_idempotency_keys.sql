-- Q-02: Bảng lưu Idempotency-Key trong 24 giờ cho các API ghi quan trọng
IF OBJECT_ID(N'dbo.IdempotencyKeys', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.IdempotencyKeys (
        IdempotencyKey UNIQUEIDENTIFIER NOT NULL,
        UserId         BIGINT           NOT NULL CONSTRAINT DF_IdempotencyKeys_UserId DEFAULT (0),
        Method         VARCHAR(10)      NOT NULL,
        Path           VARCHAR(200)     NOT NULL,
        RequestHash    CHAR(64)         NOT NULL,
        StatusCode     INT              NOT NULL,
        ResponseBody   NVARCHAR(MAX)    NOT NULL,
        CreatedAt      DATETIME2(0)     NOT NULL CONSTRAINT DF_IdempotencyKeys_CreatedAt DEFAULT (SYSDATETIME()),
        ExpiresAt      DATETIME2(0)     NOT NULL,
        CONSTRAINT PK_IdempotencyKeys PRIMARY KEY (IdempotencyKey, UserId)
    );
END;
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE name = N'IX_IdempotencyKeys_ExpiresAt'
      AND object_id = OBJECT_ID(N'dbo.IdempotencyKeys')
)
BEGIN
    CREATE INDEX IX_IdempotencyKeys_ExpiresAt
        ON dbo.IdempotencyKeys (ExpiresAt);
END;
GO
