/* =============================================================================
   SPORTHUB – SCRIPT KHỞI TẠO CƠ SỞ DỮ LIỆU (SQL Server 2016+)
   Hệ thống quản lý và đặt lịch sân thể thao
   -----------------------------------------------------------------------------
   Nguồn: SDD – Mục 3 "Thiết kế cơ sở dữ liệu" (26 bảng, quy ước 3.2, danh mục 3.4)

   Cấu trúc script
     PHẦN 0. Tạo database, thiết lập phiên
     PHẦN 1. Xóa đối tượng cũ (chạy lại được nhiều lần)
     PHẦN 2. Tạo 26 bảng: PK, FK, CHECK, DEFAULT, UNIQUE
     PHẦN 3. Chỉ mục
     PHẦN 4. Thủ tục sinh mã nghiệp vụ dbo.usp_NextCode (CodeSequences)
     PHẦN 5. Dữ liệu ban đầu BẮT BUỘC (SystemSettings, Sports, tài khoản Chủ sân)
     PHẦN 6. Dữ liệu MẪU để dev/test (đặt @SeedSample = 0 để bỏ qua)
     PHẦN 7. Kiểm tra nhanh số dòng mỗi bảng

   ⚠ PHẦN 1 XÓA TOÀN BỘ BẢNG CŨ. Chỉ dùng cho môi trường dev/test hoặc lần cài đầu.

   Quy ước áp dụng (SDD 3.2)
     - PK: INT IDENTITY cho danh mục (Branches, Sports, Courts, Promotions…),
           BIGINT IDENTITY cho giao dịch / nhật ký.
     - Tiền: DECIMAL(18,0) VNĐ, không âm. Tỷ lệ/giá trị cọc, giảm giá: DECIMAL(18,2).
     - Thời điểm: DATETIME2(0) giờ Việt Nam (UTC+7). Giờ: TIME(0). Ngày: DATE.
     - Văn bản tiếng Việt: NVARCHAR; mã, SĐT, email, trạng thái: VARCHAR.
     - Trạng thái: VARCHAR(20) mã tiếng Anh viết hoa + CHECK (danh mục 3.4).
     - Mã nghiệp vụ: Tiền tố + yyyyMMdd + STT trong ngày (BK2026111001, PT2026111001)
       sinh qua CodeSequences. Mã không theo ngày (KH, NV, CH): Tiền tố + 6 chữ số.
     - CreatedAt mặc định SYSDATETIME(); UpdatedAt do tầng ứng dụng gán mỗi lần sửa
       (không dùng trigger để không làm lệch Bookings.RowVer – khóa lạc quan).
     - Đặt tên ràng buộc: PK_, FK_<Bảng>_<Cột>, CK_, DF_, UQ_, IX_ (thường), UX_ (duy nhất).

   Các điểm đã chuẩn hóa theo chính khuyến nghị trong SDD
     - CreateAt  → CreatedAt (RefreshTokens, Branches, BranchHolidays, PaymentRequest)
     - Chanel    → Channel   (Bookings, Payments)
     - MaxdiscountAmount → MaxDiscountAmount (Promotions)
     - Courts.Description chỉ giữ 1 cột
     - SystemSettings: PK = SettingKey; CodeSequences: PK = (Prefix, DateKey)
   ============================================================================= */


/* =============================================================================
   PHẦN 0. DATABASE & THIẾT LẬP PHIÊN
   ============================================================================= */
USE master;
GO
IF DB_ID(N'SportHub') IS NULL
    CREATE DATABASE SportHub COLLATE Vietnamese_100_CI_AS;
GO
USE SportHub;
GO
-- Bắt buộc cho chỉ mục có lọc (filtered index) và cột ROWVERSION
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET NUMERIC_ROUNDABORT OFF;
SET NOCOUNT ON;
GO


/* =============================================================================
   PHẦN 1. XÓA ĐỐI TƯỢNG CŨ (thứ tự con → cha)
   ============================================================================= */
-- Chốt chặn chống xóa nhầm dữ liệu thật (C-3):
-- Mặc định @AllowReset = 0 sẽ từ chối chạy nếu bảng Users đã có dữ liệu.
-- Đặt @AllowReset = 1 hoặc dùng script db:reset ở môi trường test/dev để cho phép xóa lại từ đầu.
DECLARE @AllowReset BIT = 0;
IF @AllowReset = 0
   AND OBJECT_ID(N'dbo.Users', N'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.Users)
BEGIN
    RAISERROR(N'CẢNH BÁO: Database đã có dữ liệu Users. Đặt @AllowReset = 1 nếu chắc chắn muốn xóa toàn bộ dữ liệu.', 16, 1);
    SET NOEXEC ON;
END;
GO

DROP PROCEDURE IF EXISTS dbo.usp_NextCode;
DROP TABLE IF EXISTS dbo.Payments;
DROP TABLE IF EXISTS dbo.Refunds;
DROP TABLE IF EXISTS dbo.BankTransactions;
DROP TABLE IF EXISTS dbo.PaymentRequest;
DROP TABLE IF EXISTS dbo.BookingTransfers;
DROP TABLE IF EXISTS dbo.BookingStatusHistory;
DROP TABLE IF EXISTS dbo.BookingPriceLines;
DROP TABLE IF EXISTS dbo.BookingSlots;
DROP TABLE IF EXISTS dbo.Bookings;
DROP TABLE IF EXISTS dbo.PromotionCustomers;
DROP TABLE IF EXISTS dbo.PromotionSports;
DROP TABLE IF EXISTS dbo.PromotionBranches;
DROP TABLE IF EXISTS dbo.Promotions;
DROP TABLE IF EXISTS dbo.CourtBlocks;
DROP TABLE IF EXISTS dbo.CourtPriceRules;
DROP TABLE IF EXISTS dbo.Courts;
DROP TABLE IF EXISTS dbo.Sports;
DROP TABLE IF EXISTS dbo.BranchHolidays;
DROP TABLE IF EXISTS dbo.BranchOpeningHours;
DROP TABLE IF EXISTS dbo.Notifications;
DROP TABLE IF EXISTS dbo.AuditLogs;
DROP TABLE IF EXISTS dbo.RefreshTokens;
DROP TABLE IF EXISTS dbo.Users;
DROP TABLE IF EXISTS dbo.Branches;
DROP TABLE IF EXISTS dbo.SystemSettings;
DROP TABLE IF EXISTS dbo.CodeSequences;
GO


/* =============================================================================
   PHẦN 2. TẠO BẢNG
   ============================================================================= */

/* ---------------------------------------------------------------------------
   B. CHI NHÁNH & SÂN  (Branches tạo trước vì Users tham chiếu tới)
   --------------------------------------------------------------------------- */

-- Branches – Cơ sở
CREATE TABLE dbo.Branches (
    BranchId         INT            IDENTITY(1,1) NOT NULL,
    Code             VARCHAR(20)    NOT NULL,
    Name             NVARCHAR(150)  NOT NULL,
    Address          NVARCHAR(255)  NOT NULL,
    Phone            VARCHAR(15)    NULL,
    Description      NVARCHAR(1000) NULL,
    BankBin          VARCHAR(8)     NULL,
    BankName         NVARCHAR(100)  NULL,
    BankAccountNo    VARCHAR(30)    NULL,
    BankAccountName  NVARCHAR(100)  NULL,
    Status           VARCHAR(20)    NOT NULL CONSTRAINT DF_Branches_Status    DEFAULT ('ACTIVE'),
    CreatedAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_Branches_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_Branches_UpdatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Branches PRIMARY KEY (BranchId),
    CONSTRAINT UQ_Branches_Code UNIQUE (Code),
    CONSTRAINT CK_Branches_Status  CHECK (Status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT CK_Branches_BankBin CHECK (BankBin IS NULL OR (LEN(BankBin) = 6 AND BankBin NOT LIKE '%[^0-9]%'))
);
GO

/* ---------------------------------------------------------------------------
   A. NGƯỜI DÙNG, BẢO MẬT & THÔNG BÁO
   --------------------------------------------------------------------------- */

-- Users – Tài khoản người dùng
CREATE TABLE dbo.Users (
    UserId            BIGINT        IDENTITY(1,1) NOT NULL,
    Code              VARCHAR(20)   NOT NULL,
    FullName          NVARCHAR(100) NOT NULL,
    Phone             VARCHAR(10)   NOT NULL,
    Email             VARCHAR(255)  NULL,
    PasswordHash      VARCHAR(255)  NOT NULL,
    Role              VARCHAR(20)   NOT NULL,
    BranchId          INT           NULL,
    MemberTier        VARCHAR(20)   NULL,
    Status            VARCHAR(20)   NOT NULL CONSTRAINT DF_Users_Status           DEFAULT ('ACTIVE'),
    FailedLoginCount  TINYINT       NOT NULL CONSTRAINT DF_Users_FailedLoginCount DEFAULT (0),
    LockedUntil       DATETIME2(0)  NULL,
    TokenVersion      INT           NOT NULL CONSTRAINT DF_Users_TokenVersion     DEFAULT (0),
    LastLoginAt       DATETIME2(0)  NULL,
    CreatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_CreatedAt        DEFAULT (SYSDATETIME()),
    UpdatedAt         DATETIME2(0)  NOT NULL CONSTRAINT DF_Users_UpdatedAt        DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Users PRIMARY KEY (UserId),
    CONSTRAINT UQ_Users_Code  UNIQUE (Code),
    CONSTRAINT UQ_Users_Phone UNIQUE (Phone),
    CONSTRAINT FK_Users_BranchId FOREIGN KEY (BranchId) REFERENCES dbo.Branches (BranchId),
    CONSTRAINT CK_Users_FullName CHECK (LEN(FullName) >= 2),
    CONSTRAINT CK_Users_Phone    CHECK (LEN(Phone) = 10 AND Phone LIKE '0%' AND Phone NOT LIKE '%[^0-9]%'),
    CONSTRAINT CK_Users_Email    CHECK (Email IS NULL OR (Email LIKE '%_@_%._%' AND Email NOT LIKE '% %')),
    CONSTRAINT CK_Users_Role     CHECK (Role IN ('OWNER','STAFF','CUSTOMER')),
    CONSTRAINT CK_Users_Status   CHECK (Status IN ('ACTIVE','LOCKED')),
    -- STAFF bắt buộc có cơ sở; OWNER/CUSTOMER không gắn cơ sở
    CONSTRAINT CK_Users_RoleBranch CHECK (
        (Role = 'STAFF' AND BranchId IS NOT NULL) OR
        (Role IN ('OWNER','CUSTOMER') AND BranchId IS NULL)),
    -- Email bắt buộc với Khách hàng (UC 003)
    CONSTRAINT CK_Users_CustomerEmail CHECK (Role <> 'CUSTOMER' OR Email IS NOT NULL)
);
GO

-- RefreshTokens – Phiên đăng nhập
CREATE TABLE dbo.RefreshTokens (
    TokenId    BIGINT        IDENTITY(1,1) NOT NULL,
    UserId     BIGINT        NOT NULL,
    TokenHash  VARCHAR(128)  NOT NULL,
    ExpiresAt  DATETIME2(0)  NOT NULL,
    RevokedAt  DATETIME2(0)  NULL,
    UserAgent  NVARCHAR(500) NULL,
    IpAddress  VARCHAR(45)   NULL,
    CreatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_RefreshTokens_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_RefreshTokens PRIMARY KEY (TokenId),
    CONSTRAINT UQ_RefreshTokens_TokenHash UNIQUE (TokenHash),
    CONSTRAINT FK_RefreshTokens_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId)
);
GO

-- AuditLogs – Nhật ký thao tác
CREATE TABLE dbo.AuditLogs (
    AuditId     BIGINT        IDENTITY(1,1) NOT NULL,
    UserId      BIGINT        NULL,
    Action      VARCHAR(50)   NOT NULL,
    EntityType  VARCHAR(50)   NOT NULL,
    EntityId    VARCHAR(50)   NOT NULL,
    OldValue    NVARCHAR(MAX) NULL,
    NewValue    NVARCHAR(MAX) NULL,
    IpAddress   VARCHAR(45)   NULL,
    CreatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_AuditLogs_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_AuditLogs PRIMARY KEY (AuditId),
    CONSTRAINT FK_AuditLogs_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_AuditLogs_OldValue CHECK (OldValue IS NULL OR ISJSON(OldValue) = 1),
    CONSTRAINT CK_AuditLogs_NewValue CHECK (NewValue IS NULL OR ISJSON(NewValue) = 1)
);
GO

-- Notifications – Thông báo
CREATE TABLE dbo.Notifications (
    NotificationId  BIGINT         IDENTITY(1,1) NOT NULL,
    UserId          BIGINT         NOT NULL,
    Type            VARCHAR(20)    NOT NULL,
    Title           NVARCHAR(150)  NOT NULL,
    Body            NVARCHAR(1000) NOT NULL,
    LinkType        VARCHAR(20)    NULL,
    LinkRef         VARCHAR(50)    NULL,
    IsRead          BIT            NOT NULL CONSTRAINT DF_Notifications_IsRead    DEFAULT (0),
    ReadAt          DATETIME2(0)   NULL,
    CreatedAt       DATETIME2(0)   NOT NULL CONSTRAINT DF_Notifications_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Notifications PRIMARY KEY (NotificationId),
    CONSTRAINT FK_Notifications_UserId FOREIGN KEY (UserId) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_Notifications_Type     CHECK (Type IN ('PAYMENT_RESULT','REMINDER','PROMOTION','SCHEDULE_CHANGE')),
    CONSTRAINT CK_Notifications_LinkType CHECK (LinkType IS NULL OR LinkType IN ('BOOKING','PROMOTION')),
    CONSTRAINT CK_Notifications_Link     CHECK ((LinkType IS NULL AND LinkRef IS NULL) OR (LinkType IS NOT NULL AND LinkRef IS NOT NULL)),
    CONSTRAINT CK_Notifications_ReadAt   CHECK ((IsRead = 0 AND ReadAt IS NULL) OR (IsRead = 1 AND ReadAt IS NOT NULL))
);
GO

/* ---------------------------------------------------------------------------
   B. CHI NHÁNH & SÂN (tiếp)
   --------------------------------------------------------------------------- */

-- BranchOpeningHours – Giờ mở cửa theo ngày trong tuần (1 = Thứ 2 … 7 = Chủ nhật)
CREATE TABLE dbo.BranchOpeningHours (
    BranchId   INT     NOT NULL,
    DayOfWeek  TINYINT NOT NULL,
    OpenTime   TIME(0) NULL,
    CloseTime  TIME(0) NULL,
    IsClosed   BIT     NOT NULL CONSTRAINT DF_BranchOpeningHours_IsClosed DEFAULT (0),
    CONSTRAINT PK_BranchOpeningHours PRIMARY KEY (BranchId, DayOfWeek),
    CONSTRAINT FK_BranchOpeningHours_BranchId FOREIGN KEY (BranchId) REFERENCES dbo.Branches (BranchId),
    CONSTRAINT CK_BranchOpeningHours_DayOfWeek CHECK (DayOfWeek BETWEEN 1 AND 7),
    -- UC 020 luồng 2a: giờ mở < giờ đóng, trừ ngày nghỉ cố định
    CONSTRAINT CK_BranchOpeningHours_Time CHECK (
        IsClosed = 1 OR (OpenTime IS NOT NULL AND CloseTime IS NOT NULL AND OpenTime < CloseTime))
);
GO

-- BranchHolidays – Ngày nghỉ lễ, tạm nghỉ
CREATE TABLE dbo.BranchHolidays (
    HolidayId  INT           IDENTITY(1,1) NOT NULL,
    BranchId   INT           NOT NULL,
    StartDate  DATE          NOT NULL,
    EndDate    DATE          NOT NULL,
    Reason     NVARCHAR(255) NULL,
    CreatedBy  BIGINT        NOT NULL,
    CreatedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_BranchHolidays_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_BranchHolidays PRIMARY KEY (HolidayId),
    CONSTRAINT FK_BranchHolidays_BranchId  FOREIGN KEY (BranchId)  REFERENCES dbo.Branches (BranchId),
    CONSTRAINT FK_BranchHolidays_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_BranchHolidays_Range CHECK (StartDate <= EndDate)
);
GO

-- Sports – Môn thể thao
CREATE TABLE dbo.Sports (
    SportId           INT           IDENTITY(1,1) NOT NULL,
    Code              VARCHAR(20)   NOT NULL,
    Name              NVARCHAR(100) NOT NULL,
    Icon              VARCHAR(255)  NULL,
    GridBlockMinutes  SMALLINT      NOT NULL CONSTRAINT DF_Sports_GridBlockMinutes DEFAULT (30),
    SortOrder         INT           NOT NULL CONSTRAINT DF_Sports_SortOrder        DEFAULT (0),
    CONSTRAINT PK_Sports PRIMARY KEY (SportId),
    CONSTRAINT UQ_Sports_Code UNIQUE (Code),
    CONSTRAINT CK_Sports_GridBlockMinutes CHECK (GridBlockMinutes IN (15, 30, 60))
);
GO

-- Courts – Sân
CREATE TABLE dbo.Courts (
    CourtId       INT            IDENTITY(1,1) NOT NULL,
    Code          VARCHAR(20)    NOT NULL,
    BranchId      INT            NOT NULL,
    SportId       INT            NOT NULL,
    Name          NVARCHAR(100)  NOT NULL,
    CourtType     NVARCHAR(50)   NULL,
    Description   NVARCHAR(500)  NULL,
    DepositType   VARCHAR(10)    NOT NULL,
    DepositValue  DECIMAL(18,2)  NOT NULL,
    Status        VARCHAR(20)    NOT NULL CONSTRAINT DF_Courts_Status    DEFAULT ('ACTIVE'),
    CreatedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_Courts_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt     DATETIME2(0)   NOT NULL CONSTRAINT DF_Courts_UpdatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Courts PRIMARY KEY (CourtId),
    CONSTRAINT UQ_Courts_Code UNIQUE (Code),
    CONSTRAINT UQ_Courts_Branch_Name UNIQUE (BranchId, Name),          -- UC 017 luồng 1a
    CONSTRAINT FK_Courts_BranchId FOREIGN KEY (BranchId) REFERENCES dbo.Branches (BranchId),
    CONSTRAINT FK_Courts_SportId  FOREIGN KEY (SportId)  REFERENCES dbo.Sports (SportId),
    CONSTRAINT CK_Courts_Status      CHECK (Status IN ('ACTIVE','INACTIVE')),
    CONSTRAINT CK_Courts_DepositType CHECK (DepositType IN ('PERCENT','FIXED')),
    CONSTRAINT CK_Courts_DepositValue CHECK (
        (DepositType = 'PERCENT' AND DepositValue BETWEEN 10 AND 100) OR
        (DepositType = 'FIXED'   AND DepositValue > 0))
);
GO

-- CourtPriceRules – Bảng giá theo khung giờ (DayOfWeekMask: bit0 = Thứ 2 … bit6 = CN; 127 = mọi ngày)
CREATE TABLE dbo.CourtPriceRules (
    PriceRuleId    BIGINT        IDENTITY(1,1) NOT NULL,
    CourtId        INT           NOT NULL,
    Label          NVARCHAR(50)  NOT NULL,
    DayOfWeekMask  TINYINT       NOT NULL,
    StartTime      TIME(0)       NOT NULL,
    EndTime        TIME(0)       NOT NULL,
    PricePerHour   DECIMAL(18,0) NOT NULL,
    EffectiveFrom  DATETIME2(0)  NOT NULL,
    EffectiveTo    DATETIME2(0)  NULL,
    CONSTRAINT PK_CourtPriceRules PRIMARY KEY (PriceRuleId),
    CONSTRAINT FK_CourtPriceRules_CourtId FOREIGN KEY (CourtId) REFERENCES dbo.Courts (CourtId),
    CONSTRAINT CK_CourtPriceRules_Mask      CHECK (DayOfWeekMask BETWEEN 1 AND 127),
    CONSTRAINT CK_CourtPriceRules_Time      CHECK (StartTime < EndTime),
    CONSTRAINT CK_CourtPriceRules_Price     CHECK (PricePerHour > 0),
    CONSTRAINT CK_CourtPriceRules_Effective CHECK (EffectiveTo IS NULL OR EffectiveFrom < EffectiveTo)
);
GO

-- CourtBlocks – Lịch khóa sân
CREATE TABLE dbo.CourtBlocks (
    BlockId     BIGINT        IDENTITY(1,1) NOT NULL,
    CourtId     INT           NOT NULL,
    BlockType   VARCHAR(20)   NOT NULL,
    StartAt     DATETIME2(0)  NOT NULL,
    EndAt       DATETIME2(0)  NULL,
    Reason      NVARCHAR(255) NOT NULL,
    CreatedBy   BIGINT        NOT NULL,
    CreatedAt   DATETIME2(0)  NOT NULL CONSTRAINT DF_CourtBlocks_CreatedAt DEFAULT (SYSDATETIME()),
    ReleasedAt  DATETIME2(0)  NULL,
    ReleasedBy  BIGINT        NULL,
    CONSTRAINT PK_CourtBlocks PRIMARY KEY (BlockId),
    CONSTRAINT FK_CourtBlocks_CourtId    FOREIGN KEY (CourtId)    REFERENCES dbo.Courts (CourtId),
    CONSTRAINT FK_CourtBlocks_CreatedBy  FOREIGN KEY (CreatedBy)  REFERENCES dbo.Users (UserId),
    CONSTRAINT FK_CourtBlocks_ReleasedBy FOREIGN KEY (ReleasedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_CourtBlocks_BlockType CHECK (BlockType IN ('MAINTENANCE','DECOMMISSION')),
    CONSTRAINT CK_CourtBlocks_Range     CHECK (EndAt IS NULL OR StartAt < EndAt),
    -- MAINTENANCE bắt buộc EndAt; DECOMMISSION để NULL
    CONSTRAINT CK_CourtBlocks_TypeEnd   CHECK (
        (BlockType = 'MAINTENANCE'  AND EndAt IS NOT NULL) OR
        (BlockType = 'DECOMMISSION' AND EndAt IS NULL)),
    CONSTRAINT CK_CourtBlocks_Release   CHECK ((ReleasedAt IS NULL AND ReleasedBy IS NULL) OR (ReleasedAt IS NOT NULL AND ReleasedBy IS NOT NULL))
);
GO

/* ---------------------------------------------------------------------------
   C. ĐẶT SÂN
   --------------------------------------------------------------------------- */

-- Bookings – Đơn đặt sân
CREATE TABLE dbo.Bookings (
    BookingId        BIGINT        IDENTITY(1,1) NOT NULL,
    BookingCode      VARCHAR(20)   NOT NULL,
    BranchId         INT           NOT NULL,
    CourtId          INT           NOT NULL,
    CustomerUserId   BIGINT        NULL,
    GuestName        NVARCHAR(100) NULL,
    GuestPhone       VARCHAR(10)   NULL,
    StartAt          DATETIME2(0)  NOT NULL,
    EndAt            DATETIME2(0)  NOT NULL,
    BaseAmount       DECIMAL(18,0) NOT NULL,
    DiscountAmount   DECIMAL(18,0) NOT NULL CONSTRAINT DF_Bookings_DiscountAmount DEFAULT (0),
    TotalAmount      DECIMAL(18,0) NOT NULL,
    PaymentOption    VARCHAR(10)   NOT NULL CONSTRAINT DF_Bookings_PaymentOption  DEFAULT ('FULL'),
    DepositType      VARCHAR(10)   NULL,
    DepositValue     DECIMAL(18,2) NULL,
    DepositAmount    DECIMAL(18,0) NOT NULL CONSTRAINT DF_Bookings_DepositAmount  DEFAULT (0),
    AmountDueNow     DECIMAL(18,0) NOT NULL,
    PaidAmount       DECIMAL(18,0) NOT NULL CONSTRAINT DF_Bookings_PaidAmount     DEFAULT (0),
    RemainingAmount  DECIMAL(18,0) NOT NULL,
    Status           VARCHAR(20)   NOT NULL CONSTRAINT DF_Bookings_Status         DEFAULT ('PENDING_PAYMENT'),
    PaymentStatus    VARCHAR(20)   NOT NULL CONSTRAINT DF_Bookings_PaymentStatus  DEFAULT ('UNPAID'),
    HoldExpireAt     DATETIME2(0)  NULL,
    PromotionCode    VARCHAR(20)   NULL,
    CanceledBy       BIGINT        NULL,
    CanceledAt       DATETIME2(0)  NULL,
    CancelReason     NVARCHAR(255) NULL,
    CancelType       VARCHAR(20)   NULL,
    RefundRate       DECIMAL(5,2)  NULL,
    RefundAmount     DECIMAL(18,0) NULL,
    ReminderSentAt   DATETIME2(0)  NULL,
    Note             NVARCHAR(500) NULL,
    CreatedBy        BIGINT        NULL,
    CreatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_Bookings_CreatedAt DEFAULT (SYSDATETIME()),
    UpdatedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_Bookings_UpdatedAt DEFAULT (SYSDATETIME()),
    RowVer           ROWVERSION    NOT NULL,
    CheckedInAt      DATETIME2(0)  NULL,
    CheckedOutAt     DATETIME2(0)  NULL,
    Channel          VARCHAR(20)   NOT NULL,
    CONSTRAINT PK_Bookings PRIMARY KEY (BookingId),
    CONSTRAINT UQ_Bookings_BookingCode UNIQUE (BookingCode),
    CONSTRAINT FK_Bookings_BranchId       FOREIGN KEY (BranchId)       REFERENCES dbo.Branches (BranchId),
    CONSTRAINT FK_Bookings_CourtId        FOREIGN KEY (CourtId)        REFERENCES dbo.Courts (CourtId),
    CONSTRAINT FK_Bookings_CustomerUserId FOREIGN KEY (CustomerUserId) REFERENCES dbo.Users (UserId),
    CONSTRAINT FK_Bookings_CanceledBy     FOREIGN KEY (CanceledBy)     REFERENCES dbo.Users (UserId),
    CONSTRAINT FK_Bookings_CreatedBy      FOREIGN KEY (CreatedBy)      REFERENCES dbo.Users (UserId),
    -- Danh mục giá trị (3.4)
    CONSTRAINT CK_Bookings_Status        CHECK (Status IN ('PENDING_PAYMENT','CONFIRMED','IN_USE','COMPLETED','CANCELED','EXPIRED')),
    CONSTRAINT CK_Bookings_PaymentStatus CHECK (PaymentStatus IN ('UNPAID','DEPOSITED','PAID')),
    CONSTRAINT CK_Bookings_PaymentOption CHECK (PaymentOption IN ('FULL','DEPOSIT')),
    CONSTRAINT CK_Bookings_DepositType   CHECK (DepositType IS NULL OR DepositType IN ('PERCENT','FIXED')),
    CONSTRAINT CK_Bookings_CancelType    CHECK (CancelType IS NULL OR CancelType IN ('CUSTOMER_REQUEST','NO_SHOW','BY_FACILITY','COUNTER_ABORT')),
    CONSTRAINT CK_Bookings_Channel       CHECK (Channel IN ('ONLINE','COUNTER')),
    CONSTRAINT CK_Bookings_RefundRate    CHECK (RefundRate IS NULL OR RefundRate IN (0, 50, 100)),
    -- Khách có tài khoản hoặc khách vãng lai (đủ tên + SĐT)
    CONSTRAINT CK_Bookings_Customer      CHECK (CustomerUserId IS NOT NULL OR (GuestName IS NOT NULL AND GuestPhone IS NOT NULL)),
    CONSTRAINT CK_Bookings_GuestPhone    CHECK (GuestPhone IS NULL OR (LEN(GuestPhone) = 10 AND GuestPhone LIKE '0%' AND GuestPhone NOT LIKE '%[^0-9]%')),
    -- Thời gian: StartAt < EndAt, cùng ngày
    CONSTRAINT CK_Bookings_Time          CHECK (StartAt < EndAt AND CAST(StartAt AS DATE) = CAST(EndAt AS DATE)),
    CONSTRAINT CK_Bookings_CheckInOut    CHECK (CheckedOutAt IS NULL OR CheckedInAt IS NULL OR CheckedInAt <= CheckedOutAt),
    -- Quy tắc tính tiền (SDD 3.3 – Bookings)
    CONSTRAINT CK_Bookings_NonNegative   CHECK (BaseAmount >= 0 AND DiscountAmount >= 0 AND TotalAmount >= 0 AND DepositAmount >= 0
                                                AND AmountDueNow >= 0 AND PaidAmount >= 0 AND RemainingAmount >= 0
                                                AND (RefundAmount IS NULL OR RefundAmount >= 0)),
    CONSTRAINT CK_Bookings_Total         CHECK (TotalAmount = BaseAmount - DiscountAmount),
    CONSTRAINT CK_Bookings_Deposit       CHECK (DepositAmount <= TotalAmount),
    CONSTRAINT CK_Bookings_DueNow        CHECK (
        (PaymentOption = 'FULL'    AND DepositAmount = 0 AND AmountDueNow = TotalAmount) OR
        (PaymentOption = 'DEPOSIT' AND AmountDueNow = DepositAmount)),
    CONSTRAINT CK_Bookings_Remaining     CHECK (RemainingAmount = TotalAmount - PaidAmount),
    -- Đơn chờ thanh toán phải có hạn giữ chỗ
    CONSTRAINT CK_Bookings_Hold          CHECK (Status <> 'PENDING_PAYMENT' OR HoldExpireAt IS NOT NULL),
    -- Đơn đã hủy phải có loại hủy, lý do, thời điểm hủy (UC 009 luồng 2a)
    CONSTRAINT CK_Bookings_Cancel        CHECK (Status <> 'CANCELED' OR (CancelType IS NOT NULL AND CancelReason IS NOT NULL AND CanceledAt IS NOT NULL))
);
GO

-- BookingSlots – Ô lịch đã chiếm (chốt chặn trùng lịch ở mức CSDL)
CREATE TABLE dbo.BookingSlots (
    BookingId  BIGINT       NOT NULL,
    CourtId    INT          NOT NULL,
    SlotStart  DATETIME2(0) NOT NULL,
    IsActive   BIT          NOT NULL CONSTRAINT DF_BookingSlots_IsActive DEFAULT (1),
    CONSTRAINT PK_BookingSlots PRIMARY KEY (BookingId, CourtId, SlotStart),
    CONSTRAINT FK_BookingSlots_BookingId FOREIGN KEY (BookingId) REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_BookingSlots_CourtId   FOREIGN KEY (CourtId)   REFERENCES dbo.Courts (CourtId)
);
GO

-- BookingPriceLines – Chi tiết giá của đơn (bảo lưu đơn giá – FR 06)
CREATE TABLE dbo.BookingPriceLines (
    LineId        BIGINT        IDENTITY(1,1) NOT NULL,
    BookingId     BIGINT        NOT NULL,
    PriceRuleId   BIGINT        NOT NULL,
    StartAt       DATETIME2(0)  NOT NULL,
    EndAt         DATETIME2(0)  NOT NULL,
    PricePerHour  DECIMAL(18,0) NOT NULL,
    Amount        DECIMAL(18,0) NOT NULL,
    CONSTRAINT PK_BookingPriceLines PRIMARY KEY (LineId),
    CONSTRAINT FK_BookingPriceLines_BookingId   FOREIGN KEY (BookingId)   REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_BookingPriceLines_PriceRuleId FOREIGN KEY (PriceRuleId) REFERENCES dbo.CourtPriceRules (PriceRuleId),
    CONSTRAINT CK_BookingPriceLines_Time   CHECK (StartAt < EndAt),
    CONSTRAINT CK_BookingPriceLines_Amount CHECK (PricePerHour > 0 AND Amount >= 0)
);
GO

-- BookingStatusHistory – Lịch sử trạng thái đơn
CREATE TABLE dbo.BookingStatusHistory (
    HistoryId          BIGINT        IDENTITY(1,1) NOT NULL,
    BookingId          BIGINT        NOT NULL,
    FromStatus         VARCHAR(20)   NULL,
    ToStatus           VARCHAR(20)   NOT NULL,
    FromPaymentStatus  VARCHAR(20)   NULL,
    ToPaymentStatus    VARCHAR(20)   NULL,
    ChangedBy          BIGINT        NULL,
    ChangedAt          DATETIME2(0)  NOT NULL CONSTRAINT DF_BookingStatusHistory_ChangedAt DEFAULT (SYSDATETIME()),
    Note               NVARCHAR(500) NULL,
    CONSTRAINT PK_BookingStatusHistory PRIMARY KEY (HistoryId),
    CONSTRAINT FK_BookingStatusHistory_BookingId FOREIGN KEY (BookingId) REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_BookingStatusHistory_ChangedBy FOREIGN KEY (ChangedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_BookingStatusHistory_FromStatus CHECK (FromStatus IS NULL OR FromStatus IN ('PENDING_PAYMENT','CONFIRMED','IN_USE','COMPLETED','CANCELED','EXPIRED')),
    CONSTRAINT CK_BookingStatusHistory_ToStatus   CHECK (ToStatus IN ('PENDING_PAYMENT','CONFIRMED','IN_USE','COMPLETED','CANCELED','EXPIRED')),
    CONSTRAINT CK_BookingStatusHistory_FromPay    CHECK (FromPaymentStatus IS NULL OR FromPaymentStatus IN ('UNPAID','DEPOSITED','PAID')),
    CONSTRAINT CK_BookingStatusHistory_ToPay      CHECK (ToPaymentStatus   IS NULL OR ToPaymentStatus   IN ('UNPAID','DEPOSITED','PAID'))
);
GO

-- BookingTransfers – Nhật ký chuyển sân, đổi giờ (UC 021)
CREATE TABLE dbo.BookingTransfers (
    TransferId   BIGINT        IDENTITY(1,1) NOT NULL,
    BookingId    BIGINT        NOT NULL,
    OldCourtId   INT           NOT NULL,
    OldStartAt   DATETIME2(0)  NOT NULL,
    OldEndAt     DATETIME2(0)  NOT NULL,
    NewCourtId   INT           NOT NULL,
    NewStartAt   DATETIME2(0)  NOT NULL,
    NewEndAt     DATETIME2(0)  NOT NULL,
    PerformedBy  BIGINT        NOT NULL,
    Note         NVARCHAR(255) NULL,
    PerformedAt  DATETIME2(0)  NOT NULL CONSTRAINT DF_BookingTransfers_PerformedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_BookingTransfers PRIMARY KEY (TransferId),
    CONSTRAINT FK_BookingTransfers_BookingId   FOREIGN KEY (BookingId)   REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_BookingTransfers_OldCourtId  FOREIGN KEY (OldCourtId)  REFERENCES dbo.Courts (CourtId),
    CONSTRAINT FK_BookingTransfers_NewCourtId  FOREIGN KEY (NewCourtId)  REFERENCES dbo.Courts (CourtId),
    CONSTRAINT FK_BookingTransfers_PerformedBy FOREIGN KEY (PerformedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_BookingTransfers_OldTime CHECK (OldStartAt < OldEndAt),
    CONSTRAINT CK_BookingTransfers_NewTime CHECK (NewStartAt < NewEndAt)
);
GO

/* ---------------------------------------------------------------------------
   D. THANH TOÁN & HOÀN TIỀN
   --------------------------------------------------------------------------- */

-- PaymentRequest – Yêu cầu thanh toán QR
CREATE TABLE dbo.PaymentRequest (
    RequestId        BIGINT         IDENTITY(1,1) NOT NULL,
    BookingId        BIGINT         NOT NULL,
    Purpose          VARCHAR(20)    NOT NULL,
    Amount           DECIMAL(18,0)  NOT NULL,
    TransferContent  VARCHAR(50)    NOT NULL,
    QrPayload        VARCHAR(1000)  NOT NULL,
    ExpiresAt        DATETIME2(0)   NOT NULL,
    Status           VARCHAR(20)    NOT NULL CONSTRAINT DF_PaymentRequest_Status    DEFAULT ('PENDING'),
    CreatedBy        BIGINT         NULL,
    CreatedAt        DATETIME2(0)   NOT NULL CONSTRAINT DF_PaymentRequest_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_PaymentRequest PRIMARY KEY (RequestId),
    CONSTRAINT FK_PaymentRequest_BookingId FOREIGN KEY (BookingId) REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_PaymentRequest_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_PaymentRequest_Purpose CHECK (Purpose IN ('DEPOSIT','FULL','REMAINING')),
    CONSTRAINT CK_PaymentRequest_Amount  CHECK (Amount > 0),
    CONSTRAINT CK_PaymentRequest_Status  CHECK (Status IN ('PENDING','PAID','EXPIRED','CANCELED'))
);
GO

-- BankTransactions – Giao dịch ngân hàng nhận được (webhook)
CREATE TABLE dbo.BankTransactions (
    BankTxnId         BIGINT        IDENTITY(1,1) NOT NULL,
    Provider          VARCHAR(30)   NOT NULL,
    ProviderTxnId     VARCHAR(100)  NOT NULL,
    AccountNo         VARCHAR(30)   NOT NULL,
    Amount            DECIMAL(18,0) NOT NULL,
    Content           NVARCHAR(500) NULL,
    TransactionAt     DATETIME2(0)  NOT NULL,
    RawPayload        NVARCHAR(MAX) NOT NULL,
    MatchStatus       VARCHAR(20)   NOT NULL CONSTRAINT DF_BankTransactions_MatchStatus DEFAULT ('PENDING'),
    MatchedBookingId  BIGINT        NULL,
    ReceivedAt        DATETIME2(0)  NOT NULL CONSTRAINT DF_BankTransactions_ReceivedAt  DEFAULT (SYSDATETIME()),
    ResolvedBy        BIGINT        NULL,
    ResolvedAt        DATETIME2(0)  NULL,
    ResolveNote       NVARCHAR(500) NULL,
    CONSTRAINT PK_BankTransactions PRIMARY KEY (BankTxnId),
    CONSTRAINT UQ_BankTransactions_Provider_Txn UNIQUE (Provider, ProviderTxnId),   -- UC 005 luồng 2e
    CONSTRAINT FK_BankTransactions_MatchedBookingId FOREIGN KEY (MatchedBookingId) REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_BankTransactions_ResolvedBy       FOREIGN KEY (ResolvedBy)       REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_BankTransactions_Amount      CHECK (Amount >= 0),
    CONSTRAINT CK_BankTransactions_MatchStatus CHECK (MatchStatus IN ('PENDING','MATCHED','NEEDS_REVIEW','RESOLVED','IGNORED')),
    CONSTRAINT CK_BankTransactions_RawPayload  CHECK (ISJSON(RawPayload) = 1)
);
GO

-- Payments – Phiếu thu (nguồn tính doanh thu thực thu)
CREATE TABLE dbo.Payments (
    PaymentId    BIGINT        IDENTITY(1,1) NOT NULL,
    PaymentCode  VARCHAR(20)   NOT NULL,
    BookingId    BIGINT        NOT NULL,
    Purpose      VARCHAR(20)   NOT NULL,
    Method       VARCHAR(20)   NOT NULL,
    Channel      VARCHAR(20)   NOT NULL,
    Amount       DECIMAL(18,0) NOT NULL,
    RequestId    BIGINT        NULL,
    BankTxnId    BIGINT        NULL,
    CollectedBy  BIGINT        NULL,
    PaidAt       DATETIME2(0)  NOT NULL,
    CONSTRAINT PK_Payments PRIMARY KEY (PaymentId),
    CONSTRAINT UQ_Payments_PaymentCode UNIQUE (PaymentCode),
    CONSTRAINT FK_Payments_BookingId   FOREIGN KEY (BookingId)   REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_Payments_RequestId   FOREIGN KEY (RequestId)   REFERENCES dbo.PaymentRequest (RequestId),
    CONSTRAINT FK_Payments_BankTxnId   FOREIGN KEY (BankTxnId)   REFERENCES dbo.BankTransactions (BankTxnId),
    CONSTRAINT FK_Payments_CollectedBy FOREIGN KEY (CollectedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_Payments_Purpose CHECK (Purpose IN ('DEPOSIT','FULL','REMAINING')),
    CONSTRAINT CK_Payments_Method  CHECK (Method  IN ('CASH','BANK_TRANSFER')),
    CONSTRAINT CK_Payments_Channel CHECK (Channel IN ('ONLINE','COUNTER')),
    CONSTRAINT CK_Payments_Amount  CHECK (Amount > 0),
    -- CASH: không có QR/giao dịch NH; BANK_TRANSFER: bắt buộc có giao dịch NH
    CONSTRAINT CK_Payments_MethodRef CHECK (
        (Method = 'CASH'          AND BankTxnId IS NULL AND RequestId IS NULL) OR
        (Method = 'BANK_TRANSFER' AND BankTxnId IS NOT NULL)),
    -- Thu tại quầy phải ghi nhận nhân viên thu (UC 011)
    CONSTRAINT CK_Payments_Collector CHECK (Channel <> 'COUNTER' OR CollectedBy IS NOT NULL)
);
GO

-- Refunds – Hoàn tiền
CREATE TABLE dbo.Refunds (
    RefundId     BIGINT        IDENTITY(1,1) NOT NULL,
    BookingId    BIGINT        NOT NULL,
    Amount       DECIMAL(18,0) NOT NULL,
    Rate         DECIMAL(5,2)  NOT NULL,
    Reason       NVARCHAR(255) NULL,
    Status       VARCHAR(20)   NOT NULL CONSTRAINT DF_Refunds_Status    DEFAULT ('PENDING'),
    ProcessedBy  BIGINT        NULL,
    ProcessedAt  DATETIME2(0)  NULL,
    Note         NVARCHAR(500) NULL,
    CreatedAt    DATETIME2(0)  NOT NULL CONSTRAINT DF_Refunds_CreatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Refunds PRIMARY KEY (RefundId),
    CONSTRAINT FK_Refunds_BookingId   FOREIGN KEY (BookingId)   REFERENCES dbo.Bookings (BookingId),
    CONSTRAINT FK_Refunds_ProcessedBy FOREIGN KEY (ProcessedBy) REFERENCES dbo.Users (UserId),
    CONSTRAINT CK_Refunds_Amount CHECK (Amount > 0),
    CONSTRAINT CK_Refunds_Rate   CHECK (Rate IN (50, 100)),
    CONSTRAINT CK_Refunds_Status CHECK (Status IN ('PENDING','COMPLETED','FAILED')),
    CONSTRAINT CK_Refunds_Processed CHECK (Status <> 'COMPLETED' OR ProcessedAt IS NOT NULL)
);
GO

/* ---------------------------------------------------------------------------
   E. KHUYẾN MÃI
   --------------------------------------------------------------------------- */

-- Promotions – Chương trình khuyến mãi, mã tri ân
CREATE TABLE dbo.Promotions (
    PromotionId        INT            IDENTITY(1,1) NOT NULL,
    Code               VARCHAR(20)    NOT NULL,
    Name               NVARCHAR(150)  NOT NULL,
    Description        NVARCHAR(1000) NULL,
    DiscountType       VARCHAR(10)    NOT NULL,
    DiscountValue      DECIMAL(18,2)  NOT NULL,
    MaxDiscountAmount  DECIMAL(18,0)  NULL,
    AllBranches        BIT            NOT NULL CONSTRAINT DF_Promotions_AllBranches  DEFAULT (1),
    AllSports          BIT            NOT NULL CONSTRAINT DF_Promotions_AllSports    DEFAULT (1),
    TimeFrom           TIME(0)        NULL,
    TimeTo             TIME(0)        NULL,
    StartDate          DATE           NOT NULL,
    EndDate            DATE           NOT NULL,
    AudienceType       VARCHAR(20)    NOT NULL CONSTRAINT DF_Promotions_AudienceType DEFAULT ('ALL'),
    MaxUses            INT            NOT NULL,
    UsedCount          INT            NOT NULL CONSTRAINT DF_Promotions_UsedCount    DEFAULT (0),
    Status             VARCHAR(20)    NOT NULL CONSTRAINT DF_Promotions_Status       DEFAULT ('ACTIVE'),
    NotifyStatus       VARCHAR(20)    NOT NULL CONSTRAINT DF_Promotions_NotifyStatus DEFAULT ('NONE'),
    CreatedBy          BIGINT         NOT NULL,
    CreatedAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_Promotions_CreatedAt    DEFAULT (SYSDATETIME()),
    UpdatedAt          DATETIME2(0)   NOT NULL CONSTRAINT DF_Promotions_UpdatedAt    DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_Promotions PRIMARY KEY (PromotionId),
    CONSTRAINT UQ_Promotions_Code UNIQUE (Code),
    CONSTRAINT FK_Promotions_CreatedBy FOREIGN KEY (CreatedBy) REFERENCES dbo.Users (UserId),
    -- Mã 4–20 ký tự, chỉ chữ IN HOA và số (so sánh nhị phân để phân biệt hoa/thường)
    CONSTRAINT CK_Promotions_Code CHECK (LEN(Code) BETWEEN 4 AND 20 AND Code COLLATE Latin1_General_BIN NOT LIKE '%[^A-Z0-9]%'),
    CONSTRAINT CK_Promotions_Name CHECK (LEN(Name) BETWEEN 5 AND 150),
    CONSTRAINT CK_Promotions_DiscountType  CHECK (DiscountType IN ('PERCENT','FIXED')),
    CONSTRAINT CK_Promotions_DiscountValue CHECK (
        (DiscountType = 'PERCENT' AND DiscountValue BETWEEN 1 AND 100) OR
        (DiscountType = 'FIXED'   AND DiscountValue > 0)),
    CONSTRAINT CK_Promotions_MaxDiscount  CHECK (MaxDiscountAmount IS NULL OR MaxDiscountAmount > 0),
    CONSTRAINT CK_Promotions_TimeWindow   CHECK ((TimeFrom IS NULL AND TimeTo IS NULL) OR (TimeFrom IS NOT NULL AND TimeTo IS NOT NULL AND TimeFrom < TimeTo)),
    CONSTRAINT CK_Promotions_DateRange    CHECK (StartDate <= EndDate),
    CONSTRAINT CK_Promotions_AudienceType CHECK (AudienceType IN ('ALL','SPECIFIC')),
    CONSTRAINT CK_Promotions_MaxUses      CHECK (MaxUses > 0),
    CONSTRAINT CK_Promotions_UsedCount    CHECK (UsedCount >= 0 AND UsedCount <= MaxUses),
    CONSTRAINT CK_Promotions_Status       CHECK (Status IN ('ACTIVE','PAUSED','DISCONTINUED')),
    CONSTRAINT CK_Promotions_NotifyStatus CHECK (NotifyStatus IN ('NONE','PENDING','SENT','FAILED'))
);
GO

-- PromotionBranches – Cơ sở áp dụng (khi AllBranches = 0)
CREATE TABLE dbo.PromotionBranches (
    PromotionId INT NOT NULL,
    BranchId    INT NOT NULL,
    CONSTRAINT PK_PromotionBranches PRIMARY KEY (PromotionId, BranchId),
    CONSTRAINT FK_PromotionBranches_PromotionId FOREIGN KEY (PromotionId) REFERENCES dbo.Promotions (PromotionId),
    CONSTRAINT FK_PromotionBranches_BranchId    FOREIGN KEY (BranchId)    REFERENCES dbo.Branches (BranchId)
);
GO

-- PromotionSports – Môn áp dụng (khi AllSports = 0)
CREATE TABLE dbo.PromotionSports (
    PromotionId INT NOT NULL,
    SportId     INT NOT NULL,
    CONSTRAINT PK_PromotionSports PRIMARY KEY (PromotionId, SportId),
    CONSTRAINT FK_PromotionSports_PromotionId FOREIGN KEY (PromotionId) REFERENCES dbo.Promotions (PromotionId),
    CONSTRAINT FK_PromotionSports_SportId     FOREIGN KEY (SportId)     REFERENCES dbo.Sports (SportId)
);
GO

-- PromotionCustomers – Khách hàng được chỉ định (khi AudienceType = SPECIFIC)
CREATE TABLE dbo.PromotionCustomers (
    PromotionId INT    NOT NULL,
    CustomerId  BIGINT NOT NULL,
    CONSTRAINT PK_PromotionCustomers PRIMARY KEY (PromotionId, CustomerId),
    CONSTRAINT FK_PromotionCustomers_PromotionId FOREIGN KEY (PromotionId) REFERENCES dbo.Promotions (PromotionId),
    CONSTRAINT FK_PromotionCustomers_CustomerId  FOREIGN KEY (CustomerId)  REFERENCES dbo.Users (UserId)
);
GO

/* ---------------------------------------------------------------------------
   F. HỆ THỐNG
   --------------------------------------------------------------------------- */

-- SystemSettings – Tham số cấu hình
CREATE TABLE dbo.SystemSettings (
    SettingKey    VARCHAR(100)  NOT NULL,
    SettingValue  NVARCHAR(500) NOT NULL,
    Description   NVARCHAR(255) NULL,
    UpdatedAt     DATETIME2(0)  NOT NULL CONSTRAINT DF_SystemSettings_UpdatedAt DEFAULT (SYSDATETIME()),
    CONSTRAINT PK_SystemSettings PRIMARY KEY (SettingKey)
);
GO

-- CodeSequences – Bộ đếm sinh mã nghiệp vụ
CREATE TABLE dbo.CodeSequences (
    Prefix     VARCHAR(10) NOT NULL,
    DateKey    CHAR(8)     NOT NULL,
    LastValue  INT         NOT NULL CONSTRAINT DF_CodeSequences_LastValue DEFAULT (0),
    CONSTRAINT PK_CodeSequences PRIMARY KEY (Prefix, DateKey),
    CONSTRAINT CK_CodeSequences_DateKey   CHECK (DateKey NOT LIKE '%[^0-9]%'),
    CONSTRAINT CK_CodeSequences_LastValue CHECK (LastValue >= 0)
);
GO


/* =============================================================================
   PHẦN 3. CHỈ MỤC
   ============================================================================= */

-- Users
CREATE UNIQUE INDEX UX_Users_Email        ON dbo.Users (Email) WHERE Email IS NOT NULL;
CREATE INDEX        IX_Users_Branch_Role  ON dbo.Users (BranchId, Role);

-- RefreshTokens
CREATE INDEX IX_RefreshTokens_UserId ON dbo.RefreshTokens (UserId) INCLUDE (ExpiresAt, RevokedAt);

-- AuditLogs
CREATE INDEX IX_AuditLogs_Entity      ON dbo.AuditLogs (EntityType, EntityId);
CREATE INDEX IX_AuditLogs_User_Time   ON dbo.AuditLogs (UserId, CreatedAt);

-- Notifications: hộp thư, đếm chưa đọc, mới nhất trước
CREATE INDEX IX_Notifications_User_Read_Time ON dbo.Notifications (UserId, IsRead, CreatedAt DESC);

-- Chi nhánh & sân
CREATE INDEX IX_BranchHolidays_Branch_Date  ON dbo.BranchHolidays (BranchId, StartDate, EndDate);
CREATE INDEX IX_Courts_Branch_Sport         ON dbo.Courts (BranchId, SportId) INCLUDE (Status);
CREATE INDEX IX_CourtPriceRules_Court_Eff   ON dbo.CourtPriceRules (CourtId, EffectiveFrom, EffectiveTo);
CREATE INDEX IX_CourtBlocks_Court_Start     ON dbo.CourtBlocks (CourtId, StartAt) INCLUDE (EndAt, ReleasedAt, BlockType);

-- Bookings (theo SDD) + chỉ mục phục vụ các job nền
CREATE INDEX IX_Bookings_Branch_Start   ON dbo.Bookings (BranchId, StartAt);
CREATE INDEX IX_Bookings_Court_Start    ON dbo.Bookings (CourtId, StartAt);
CREATE INDEX IX_Bookings_Customer_Start ON dbo.Bookings (CustomerUserId, StartAt);
CREATE INDEX IX_Bookings_Status_Hold    ON dbo.Bookings (Status, HoldExpireAt);       -- expireHolds
CREATE INDEX IX_Bookings_Status_Start   ON dbo.Bookings (Status, StartAt, EndAt);     -- sendReminders, cancelNoShows, autoComplete

-- BookingSlots: CHỐT CHẶN TRÙNG LỊCH – 1 ô chỉ thuộc tối đa 1 đơn còn hiệu lực
CREATE UNIQUE INDEX UX_BookingSlots_Court_Slot ON dbo.BookingSlots (CourtId, SlotStart) WHERE IsActive = 1;

CREATE INDEX IX_BookingPriceLines_Booking    ON dbo.BookingPriceLines (BookingId);
CREATE INDEX IX_BookingStatusHistory_Booking ON dbo.BookingStatusHistory (BookingId, ChangedAt);
CREATE INDEX IX_BookingTransfers_Booking     ON dbo.BookingTransfers (BookingId);

-- PaymentRequest: mỗi đơn chỉ có 1 mã QR PENDING tại một thời điểm
CREATE UNIQUE INDEX UX_PaymentRequest_Booking_Pending ON dbo.PaymentRequest (BookingId) WHERE Status = 'PENDING';
CREATE INDEX        IX_PaymentRequest_Booking         ON dbo.PaymentRequest (BookingId);
CREATE INDEX        IX_PaymentRequest_Status_Expires  ON dbo.PaymentRequest (Status, ExpiresAt);   -- expireQr

-- BankTransactions
CREATE INDEX IX_BankTransactions_Match_Received ON dbo.BankTransactions (MatchStatus, ReceivedAt);
CREATE INDEX IX_BankTransactions_Booking        ON dbo.BankTransactions (MatchedBookingId);
CREATE INDEX IX_BankTransactions_Account_Time   ON dbo.BankTransactions (AccountNo, TransactionAt);

-- Payments: 1 yêu cầu QR / 1 giao dịch NH chỉ ghi nhận 1 lần
CREATE UNIQUE INDEX UX_Payments_RequestId ON dbo.Payments (RequestId) WHERE RequestId IS NOT NULL;
CREATE UNIQUE INDEX UX_Payments_BankTxnId ON dbo.Payments (BankTxnId) WHERE BankTxnId IS NOT NULL;
CREATE INDEX        IX_Payments_Booking   ON dbo.Payments (BookingId);
CREATE INDEX        IX_Payments_PaidAt    ON dbo.Payments (PaidAt) INCLUDE (Amount, Method, BookingId);   -- doanh thu theo ngày

-- Refunds
CREATE INDEX IX_Refunds_Booking ON dbo.Refunds (BookingId);
CREATE INDEX IX_Refunds_Status  ON dbo.Refunds (Status, CreatedAt);

-- Promotions
CREATE INDEX IX_Promotions_Status_Date ON dbo.Promotions (Status, StartDate, EndDate);
CREATE INDEX IX_Promotions_Notify      ON dbo.Promotions (NotifyStatus);              -- retryPromoNotify
CREATE INDEX IX_PromotionCustomers_Customer ON dbo.PromotionCustomers (CustomerId);
GO


/* =============================================================================
   PHẦN 4. THỦ TỤC SINH MÃ NGHIỆP VỤ
   -----------------------------------------------------------------------------
   EXEC dbo.usp_NextCode @Prefix='BK', @DateKey='20261110', @Code=@c OUTPUT  → BK2026111001
   EXEC dbo.usp_NextCode @Prefix='KH', @DateKey=NULL,       @Code=@c OUTPUT  → KH000001
   Gọi bên trong giao tác tạo đơn/phiếu thu: khóa (UPDLOCK, SERIALIZABLE) giữ tới
   khi giao tác ngoài commit ⇒ hai đơn đồng thời không bao giờ trùng mã.
   ============================================================================= */
CREATE OR ALTER PROCEDURE dbo.usp_NextCode
    @Prefix  VARCHAR(10),
    @DateKey CHAR(8) = NULL,           -- yyyyMMdd; NULL = mã không đánh theo ngày
    @Code    VARCHAR(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @Key   CHAR(8) = ISNULL(@DateKey, '00000000');
    DECLARE @Out   TABLE (LastValue INT);
    DECLARE @Value INT;

    BEGIN TRANSACTION;

    UPDATE dbo.CodeSequences WITH (UPDLOCK, SERIALIZABLE)
       SET LastValue = LastValue + 1
    OUTPUT inserted.LastValue INTO @Out
     WHERE Prefix = @Prefix AND DateKey = @Key;

    IF @@ROWCOUNT = 0
        INSERT INTO dbo.CodeSequences (Prefix, DateKey, LastValue)
        OUTPUT inserted.LastValue INTO @Out
        VALUES (@Prefix, @Key, 1);

    COMMIT TRANSACTION;

    SELECT @Value = LastValue FROM @Out;

    SET @Code = @Prefix +
        CASE WHEN @Key = '00000000'
             THEN RIGHT(REPLICATE('0', 6) + CAST(@Value AS VARCHAR(10)), 6)              -- KH000001
             ELSE @Key + CASE WHEN @Value < 100
                              THEN RIGHT('0' + CAST(@Value AS VARCHAR(10)), 2)           -- BK2026111001
                              ELSE CAST(@Value AS VARCHAR(10)) END                       -- BK20261110100
        END;
END;
GO


/* =============================================================================
   PHẦN 5. DỮ LIỆU BAN ĐẦU BẮT BUỘC
   ============================================================================= */
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* 5.1 SystemSettings – SDD 3.3 F. Các giá trị SRS "cần chốt" lấy theo mục 2.8/2.9 của SDD */
INSERT INTO dbo.SystemSettings (SettingKey, SettingValue, Description) VALUES
 ('BOOKING_HOLD_MINUTES',    N'10', N'Thời hạn giữ chỗ tạm thời của đơn Chờ thanh toán (phút) – UC 004. SDD 2.8: now + 10 phút'),
 ('REMINDER_BEFORE_MINUTES', N'60', N'Gửi nhắc lịch trước giờ chơi (phút) – FR 11'),
 ('NO_SHOW_GRACE_MINUTES',   N'30', N'Quá StartAt bao nhiêu phút thì tự hủy NO_SHOW – UC 007 luồng 4a. SDD 2.9: StartAt + 30 phút'),
 ('REFUND_FULL_DAYS',        N'5',  N'Hủy trước giờ chơi từ N ngày trở lên: hoàn 100% – FR 12'),
 ('REFUND_HALF_DAYS',        N'2',  N'Hủy trước giờ chơi từ N đến dưới REFUND_FULL_DAYS ngày: hoàn REFUND_HALF_RATE – FR 12'),
 ('REFUND_HALF_RATE',        N'50', N'Tỷ lệ hoàn (%) cho mốc hủy giữa – FR 12'),
 ('LOGIN_MAX_FAILED',        N'5',  N'Số lần sai mật khẩu liên tiếp trước khi khóa tạm – UC 001 luồng 2b'),
 ('LOGIN_LOCK_MINUTES',      N'5',  N'Thời gian khóa tạm tài khoản (phút) – UC 001 luồng 2b'),
 ('QR_EXPIRE_MINUTES',       N'10', N'Hiệu lực mã QR tạo tại quầy (phút), không vượt hạn giữ chỗ của đơn – UC 012'),
 ('CHECKIN_EARLY_MINUTES',   N'15', N'Cho phép nhận sân sớm nhất trước giờ chơi (phút) – Q-15 / R-12');

/* 5.2 Sports – 5 bộ môn theo SRS. GridBlockMinutes ∈ {15, 30, 60} theo CHECK của SDD */
INSERT INTO dbo.Sports (Code, Name, Icon, GridBlockMinutes, SortOrder) VALUES
 ('FOOTBALL',   N'Bóng đá mini', 'sport-football',   30, 1),
 ('BADMINTON',  N'Cầu lông',     'sport-badminton',  30, 2),
 ('TENNIS',     N'Tennis',       'sport-tennis',     60, 3),
 ('BASKETBALL', N'Bóng rổ',      'sport-basketball', 60, 4),
 ('PICKLEBALL', N'Pickleball',   'sport-pickleball', 60, 5);

/* 5.3 Tài khoản Chủ sân mặc định
   Đăng nhập: 0900000001 hoặc owner@sporthub.vn / Mật khẩu: Owner@123  (bcrypt, cost 10)
   ⚠ BẮT BUỘC đổi mật khẩu ngay sau lần đăng nhập đầu tiên trên môi trường thật. */
DECLARE @OwnerCode VARCHAR(20);
EXEC dbo.usp_NextCode @Prefix = 'CH', @DateKey = NULL, @Code = @OwnerCode OUTPUT;

INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, BranchId, Status)
VALUES (@OwnerCode, N'Chủ sân SportHub', '0900000001', 'owner@sporthub.vn',
        '$2b$10$fQbr13uKKDShxvD39gbKLuuw17WwkSJtZatWe9QmYRrLvT78VRyYC', 'OWNER', NULL, 'ACTIVE');

COMMIT TRANSACTION;
GO


/* =============================================================================
   PHẦN 6. DỮ LIỆU MẪU (dev/test) – đặt @SeedSample = 0 để bỏ qua
   -----------------------------------------------------------------------------
   Mốc thời gian tính tương đối theo ngày chạy script (@Today) để dữ liệu luôn
   "sống" khi demo. Tên, SĐT, số tài khoản là DỮ LIỆU GIẢ.
   Mật khẩu mẫu: Nhân viên = Nv123456 ; Khách hàng = An123456
   ============================================================================= */
DECLARE @SeedSample BIT = 1;
IF @SeedSample = 0 RETURN;

SET XACT_ABORT ON;
BEGIN TRANSACTION;

DECLARE @Now   DATETIME2(0) = CAST(SYSDATETIME() AS DATETIME2(0));
DECLARE @Today DATE         = CAST(@Now AS DATE);
DECLARE @D0    DATETIME2(0) = CAST(@Today AS DATETIME2(0));   -- 00:00 hôm nay
DECLARE @PwStaff    VARCHAR(255) = '$2b$10$2zQAqCMOCLgg8ZTI04KBz.IoWAs8ay99OSAh0G8SwbmPs9tHQppSe';  -- Nv123456
DECLARE @PwCustomer VARCHAR(255) = '$2b$10$H0STSxof8gI02J1wZlIhzu7oXUNLABQqUAK2gWExpIQd2jmwMGZ.W';  -- An123456
DECLARE @Code VARCHAR(20);

DECLARE @OwnerId BIGINT = (SELECT UserId FROM dbo.Users WHERE Role = 'OWNER' AND Phone = '0900000001');

/* ---------- 6.1 Cơ sở ---------- */
INSERT INTO dbo.Branches (Code, Name, Address, Phone, Description, BankBin, BankName, BankAccountNo, BankAccountName, Status) VALUES
 ('CS01', N'Cơ sở 1 - Cầu Giấy', N'Số 10 Trần Thái Tông, Cầu Giấy, Hà Nội', '02437001001',
  N'Cụm sân Pickleball, Cầu lông, Bóng rổ; có bãi gửi xe, căng tin, phòng thay đồ.',
  '970436', N'Vietcombank', '1012345678', N'CONG TY SPORTHUB CS1', 'ACTIVE'),
 ('CS02', N'Cơ sở 2 - Mỹ Đình',  N'Số 8 Lê Đức Thọ, Mỹ Đình, Hà Nội',        '02437002002',
  N'Cụm sân Bóng đá mini cỏ nhân tạo, Tennis, Pickleball; đèn chiếu sáng thi đấu buổi tối.',
  '970422', N'MB Bank',     '0201234567', N'CONG TY SPORTHUB CS2', 'ACTIVE');

DECLARE @CS01 INT = (SELECT BranchId FROM dbo.Branches WHERE Code = 'CS01');
DECLARE @CS02 INT = (SELECT BranchId FROM dbo.Branches WHERE Code = 'CS02');

/* ---------- 6.2 Giờ mở cửa: CS01 05:00–23:00 cả tuần; CS02 05:00–23:00 T2–T7, CN 06:00–22:00 ---------- */
INSERT INTO dbo.BranchOpeningHours (BranchId, DayOfWeek, OpenTime, CloseTime, IsClosed)
SELECT b.BranchId, d.n,
       CASE WHEN b.BranchId = @CS02 AND d.n = 7 THEN '06:00' ELSE '05:00' END,
       CASE WHEN b.BranchId = @CS02 AND d.n = 7 THEN '22:00' ELSE '23:00' END,
       0
FROM (VALUES (@CS01), (@CS02)) b(BranchId)
CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6),(7)) d(n);

/* ---------- 6.3 Ngày nghỉ lễ (áp cho tất cả cơ sở ⇒ mỗi cơ sở 1 dòng) ---------- */
INSERT INTO dbo.BranchHolidays (BranchId, StartDate, EndDate, Reason, CreatedBy)
SELECT b.BranchId, h.StartDate, h.EndDate, h.Reason, @OwnerId
FROM (VALUES (@CS01), (@CS02)) b(BranchId)
CROSS JOIN (VALUES
    (CAST('2027-01-01' AS DATE), CAST('2027-01-01' AS DATE), N'Nghỉ Tết Dương lịch'),
    (CAST('2027-02-05' AS DATE), CAST('2027-02-09' AS DATE), N'Nghỉ Tết Nguyên đán Đinh Mùi')
) h(StartDate, EndDate, Reason);

/* ---------- 6.4 Sân ---------- */
INSERT INTO dbo.Courts (Code, BranchId, SportId, Name, CourtType, Description, DepositType, DepositValue, Status)
SELECT c.Code, c.BranchId, s.SportId, c.Name, c.CourtType, c.Description, c.DepositType, c.DepositValue, c.Status
FROM (VALUES
  -- Cơ sở 1 - Cầu Giấy
  ('SAN_PB_01', @CS01, 'PICKLEBALL', N'Sân Pickleball 01', N'Sân tiêu chuẩn', N'Mặt sân acrylic, có mái che',      'PERCENT', 30.00,    'ACTIVE'),
  ('SAN_PB_02', @CS01, 'PICKLEBALL', N'Sân Pickleball 02', N'Sân tiêu chuẩn', N'Mặt sân acrylic, có mái che',      'PERCENT', 30.00,    'ACTIVE'),
  ('SAN_PB_03', @CS01, 'PICKLEBALL', N'Sân Pickleball 03', N'Sân tiêu chuẩn', N'Sân ngoài trời',                   'PERCENT', 30.00,    'ACTIVE'),
  ('SAN_CL_01', @CS01, 'BADMINTON',  N'Sân Cầu lông 01',   N'Sân đơn/đôi',    N'Thảm PVC, trần cao 9m',            'FIXED',   50000.00, 'ACTIVE'),
  ('SAN_CL_02', @CS01, 'BADMINTON',  N'Sân Cầu lông 02',   N'Sân đơn/đôi',    N'Thảm PVC, trần cao 9m',            'FIXED',   50000.00, 'ACTIVE'),
  ('SAN_BR_01', @CS01, 'BASKETBALL', N'Sân Bóng rổ 01',    N'Sân 3x3',        N'Sân trong nhà, sàn gỗ',            'PERCENT', 30.00,    'ACTIVE'),
  -- Cơ sở 2 - Mỹ Đình
  ('SAN_BD_01', @CS02, 'FOOTBALL',   N'Sân Bóng đá Mini 01', N'Sân 5 người',  N'Sân cỏ nhân tạo',                                    'PERCENT', 30.00, 'ACTIVE'),
  ('SAN_BD_02', @CS02, 'FOOTBALL',   N'Sân Bóng đá Mini 02', N'Sân 5 người',  N'Đã ngừng khai thác để cải tạo',                      'PERCENT', 30.00, 'INACTIVE'),
  ('SAN_BD_03', @CS02, 'FOOTBALL',   N'Sân Bóng đá Mini 03', N'Sân 7 người',  N'Sân cỏ nhân tạo, có hệ thống đèn chiếu sáng',        'PERCENT', 30.00, 'ACTIVE'),
  ('SAN_TN_01', @CS02, 'TENNIS',     N'Sân Tennis 01',       N'Sân cứng',     N'Mặt sân cứng tiêu chuẩn ITF',                        'PERCENT', 50.00, 'ACTIVE'),
  ('SAN_PB_04', @CS02, 'PICKLEBALL', N'Sân Pickleball 04',   N'Sân tiêu chuẩn', N'Sân ngoài trời',                                   'PERCENT', 30.00, 'ACTIVE')
) c(Code, BranchId, SportCode, Name, CourtType, Description, DepositType, DepositValue, Status)
JOIN dbo.Sports s ON s.Code = c.SportCode;

/* ---------- 6.5 Bảng giá: Giờ thường 05:00–16:00, Giờ cao điểm 16:00–23:00, mọi ngày (mask 127) ---------- */
DECLARE @PriceFrom DATETIME2(0) = '2026-01-01T00:00:00';

INSERT INTO dbo.CourtPriceRules (CourtId, Label, DayOfWeekMask, StartTime, EndTime, PricePerHour, EffectiveFrom, EffectiveTo)
SELECT c.CourtId, p.Label, 127, p.StartTime, p.EndTime, p.Price, @PriceFrom, NULL
FROM dbo.Courts c
JOIN dbo.Sports s ON s.SportId = c.SportId
JOIN (VALUES
    ('PICKLEBALL', N'Giờ thường',   CAST('05:00' AS TIME(0)), CAST('16:00' AS TIME(0)), CAST(150000 AS DECIMAL(18,0))),
    ('PICKLEBALL', N'Giờ cao điểm', '16:00', '23:00', 250000),
    ('BADMINTON',  N'Giờ thường',   '05:00', '16:00',  80000),
    ('BADMINTON',  N'Giờ cao điểm', '16:00', '23:00', 120000),
    ('BASKETBALL', N'Giờ thường',   '05:00', '16:00', 200000),
    ('BASKETBALL', N'Giờ cao điểm', '16:00', '23:00', 350000),
    ('TENNIS',     N'Giờ thường',   '05:00', '16:00', 200000),
    ('TENNIS',     N'Giờ cao điểm', '16:00', '23:00', 300000),
    ('FOOTBALL',   N'Giờ thường',   '05:00', '16:00', 300000)
) p(SportCode, Label, StartTime, EndTime, Price) ON p.SportCode = s.Code;

-- Bóng đá giờ cao điểm: minh họa đổi giá (FR 06) – dòng cũ đóng EffectiveTo, dòng mới áp dụng
INSERT INTO dbo.CourtPriceRules (CourtId, Label, DayOfWeekMask, StartTime, EndTime, PricePerHour, EffectiveFrom, EffectiveTo)
SELECT c.CourtId, N'Giờ cao điểm', 127, '16:00', '23:00', v.Price, v.EffFrom, v.EffTo
FROM dbo.Courts c
JOIN dbo.Sports s ON s.SportId = c.SportId AND s.Code = 'FOOTBALL'
CROSS JOIN (VALUES
    (CAST(600000 AS DECIMAL(18,0)), CAST('2026-01-01T00:00:00' AS DATETIME2(0)), CAST('2026-11-01T00:00:00' AS DATETIME2(0))),
    (650000,                        '2026-11-01T00:00:00',                       NULL)
) v(Price, EffFrom, EffTo);

/* ---------- 6.6 Nhân viên & khách hàng ---------- */
DECLARE @StaffTrang BIGINT, @StaffHung BIGINT, @StaffTuan BIGINT, @CusAn BIGINT, @CusBinh BIGINT;

EXEC dbo.usp_NextCode 'NV', NULL, @Code OUTPUT;
INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, BranchId)
VALUES (@Code, N'Phạm Thu Trang', '0933445577', 'trangpt@sporthub.vn', @PwStaff, 'STAFF', @CS01);
SET @StaffTrang = SCOPE_IDENTITY();

EXEC dbo.usp_NextCode 'NV', NULL, @Code OUTPUT;
INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, BranchId)
VALUES (@Code, N'Lê Văn Hùng', '0933445566', 'hunglv@sanbong.vn', @PwStaff, 'STAFF', @CS02);
SET @StaffHung = SCOPE_IDENTITY();

-- Nhân viên đã nghỉ việc: LOCKED, TokenVersion tăng (UC 016)
EXEC dbo.usp_NextCode 'NV', NULL, @Code OUTPUT;
INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, BranchId, Status, TokenVersion)
VALUES (@Code, N'Đỗ Minh Tuấn', '0933445588', NULL, @PwStaff, 'STAFF', @CS01, 'LOCKED', 1);
SET @StaffTuan = SCOPE_IDENTITY();

EXEC dbo.usp_NextCode 'KH', NULL, @Code OUTPUT;
INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, MemberTier)
VALUES (@Code, N'Nguyễn Văn An', '0987654321', 'nguyenvanan@gmail.com', @PwCustomer, 'CUSTOMER', NULL);
SET @CusAn = SCOPE_IDENTITY();

EXEC dbo.usp_NextCode 'KH', NULL, @Code OUTPUT;
INSERT INTO dbo.Users (Code, FullName, Phone, Email, PasswordHash, Role, MemberTier)
VALUES (@Code, N'Trần Thị Bình', '0912345678', 'khachhang@gmail.com', @PwCustomer, 'CUSTOMER', NULL);
SET @CusBinh = SCOPE_IDENTITY();

/* ---------- 6.7 Khóa sân ---------- */
DECLARE @PB01 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_PB_01');
DECLARE @PB02 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_PB_02');
DECLARE @PB03 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_PB_03');
DECLARE @CL02 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_CL_02');
DECLARE @BD02 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_BD_02');
DECLARE @BD03 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_BD_03');
DECLARE @TN01 INT = (SELECT CourtId FROM dbo.Courts WHERE Code = 'SAN_TN_01');

INSERT INTO dbo.CourtBlocks (CourtId, BlockType, StartAt, EndAt, Reason, CreatedBy) VALUES
 (@PB02, 'MAINTENANCE',  DATEADD(HOUR, 8,  DATEADD(DAY, 5, @D0)), DATEADD(HOUR, 18, DATEADD(DAY, 7, @D0)),
         N'Bảo trì mặt sân và thay lưới mới', @OwnerId),
 (@BD02, 'DECOMMISSION', DATEADD(DAY, -30, @D0), NULL,
         N'Ngừng khai thác để cải tạo mặt cỏ', @OwnerId);

/* ---------- 6.8 Khuyến mãi ---------- */
DECLARE @PromoSang INT, @PromoTriAn INT, @PromoPickle INT;

INSERT INTO dbo.Promotions (Code, Name, Description, DiscountType, DiscountValue, MaxDiscountAmount,
                            AllBranches, AllSports, TimeFrom, TimeTo, StartDate, EndDate, AudienceType,
                            MaxUses, UsedCount, Status, NotifyStatus, CreatedBy)
VALUES ('SANGVUI20', N'Ưu đãi khung giờ vàng buổi sáng', N'Giảm 20% (tối đa 100.000đ) cho mọi sân trong khung 06:00 - 11:00.',
        'PERCENT', 20, 100000, 1, 1, '06:00', '11:00', DATEADD(DAY, -7, @Today), DATEADD(DAY, 30, @Today), 'ALL',
        200, 0, 'ACTIVE', 'SENT', @OwnerId);
SET @PromoSang = SCOPE_IDENTITY();

INSERT INTO dbo.Promotions (Code, Name, Description, DiscountType, DiscountValue, MaxDiscountAmount,
                            AllBranches, AllSports, TimeFrom, TimeTo, StartDate, EndDate, AudienceType,
                            MaxUses, UsedCount, Status, NotifyStatus, CreatedBy)
VALUES ('TRIAN10', N'Voucher tri ân khách hàng thân thiết', N'Giảm 50.000đ cho mỗi đơn, chỉ dành cho khách hàng được chỉ định.',
        'FIXED', 50000, NULL, 1, 1, NULL, NULL, @Today, DATEADD(DAY, 60, @Today), 'SPECIFIC',
        50, 0, 'ACTIVE', 'SENT', @OwnerId);
SET @PromoTriAn = SCOPE_IDENTITY();

INSERT INTO dbo.Promotions (Code, Name, Description, DiscountType, DiscountValue, MaxDiscountAmount,
                            AllBranches, AllSports, TimeFrom, TimeTo, StartDate, EndDate, AudienceType,
                            MaxUses, UsedCount, Status, NotifyStatus, CreatedBy)
VALUES ('PICKLECS01', N'Pickleball giờ thấp điểm tại Cơ sở 1', N'Giảm 15% (tối đa 50.000đ) sân Pickleball Cơ sở 1, khung 05:00 - 16:00.',
        'PERCENT', 15, 50000, 0, 0, '05:00', '16:00', @Today, DATEADD(DAY, 45, @Today), 'ALL',
        100, 0, 'PAUSED', 'NONE', @OwnerId);
SET @PromoPickle = SCOPE_IDENTITY();

INSERT INTO dbo.PromotionBranches  (PromotionId, BranchId)   VALUES (@PromoPickle, @CS01);
INSERT INTO dbo.PromotionSports    (PromotionId, SportId)    SELECT @PromoPickle, SportId FROM dbo.Sports WHERE Code = 'PICKLEBALL';
INSERT INTO dbo.PromotionCustomers (PromotionId, CustomerId) VALUES (@PromoTriAn, @CusAn), (@PromoTriAn, @CusBinh);

/* ---------- 6.9 Đơn đặt sân mẫu (mỗi đơn minh họa 1 trạng thái) ----------
   B1 COMPLETED  – An, online, Pickleball 01, D-3 18:00–20:00, 100%, QR
   B2 CONFIRMED  – An, online, Bóng đá Mini 03, D+2 09:00–10:30, đặt cọc 30%, mã SANGVUI20
   B3 CONFIRMED  – khách vãng lai, tại quầy, Cầu lông 02, D+1 17:00–19:00, 100%, tiền mặt
   B4 EXPIRED    – Bình, online, Pickleball 03, D-1 15:00–17:00 (vắt 2 khung giá), quá hạn giữ chỗ
   B5 CANCELED   – Bình, online, Tennis 01, D+10 07:00–09:00, hủy trước ≥ 5 ngày ⇒ hoàn 100%
   -------------------------------------------------------------------------- */
DECLARE @B1 BIGINT, @B2 BIGINT, @B3 BIGINT, @B4 BIGINT, @B5 BIGINT;
DECLARE @t DATETIME2(0), @Start DATETIME2(0), @End DATETIME2(0);
DECLARE @Req BIGINT, @Txn BIGINT, @Content VARCHAR(50), @dk CHAR(8);

-- Giá đang hiệu lực theo sân + khung
DECLARE @PrPB01Peak BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @PB01 AND StartTime = '16:00' AND EffectiveTo IS NULL);
DECLARE @PrPB03Norm BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @PB03 AND StartTime = '05:00' AND EffectiveTo IS NULL);
DECLARE @PrPB03Peak BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @PB03 AND StartTime = '16:00' AND EffectiveTo IS NULL);
DECLARE @PrCL02Peak BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @CL02 AND StartTime = '16:00' AND EffectiveTo IS NULL);
DECLARE @PrBD03Norm BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @BD03 AND StartTime = '05:00' AND EffectiveTo IS NULL);
DECLARE @PrTN01Norm BIGINT = (SELECT PriceRuleId FROM dbo.CourtPriceRules WHERE CourtId = @TN01 AND StartTime = '05:00' AND EffectiveTo IS NULL);

/* ===== B1: COMPLETED – 2h × 250.000 = 500.000, thanh toán 100% qua QR ===== */
SET @t     = DATEADD(HOUR, 10, DATEADD(DAY, -4, @D0));                 -- tạo đơn D-4 10:00
SET @Start = DATEADD(HOUR, 18, DATEADD(DAY, -3, @D0));
SET @End   = DATEADD(HOUR, 20, DATEADD(DAY, -3, @D0));
SET @dk = CONVERT(CHAR(8), @t, 112);                                 -- mã đơn đánh theo NGÀY TẠO ĐƠN
EXEC dbo.usp_NextCode 'BK', @dk, @Code OUTPUT;

INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
    BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
    Status, PaymentStatus, HoldExpireAt, ReminderSentAt, CreatedBy, CreatedAt, UpdatedAt, CheckedInAt, CheckedOutAt, Channel)
VALUES (@Code, @CS01, @PB01, @CusAn, @Start, @End,
    500000, 0, 500000, 'FULL', 0, 500000, 500000, 0,
    'COMPLETED', 'PAID', NULL, DATEADD(HOUR, -1, @Start), @CusAn, @t, @End,
    DATEADD(MINUTE, -5, @Start), @End, 'ONLINE');
SET @B1 = SCOPE_IDENTITY();

INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
VALUES (@B1, @PrPB01Peak, @Start, @End, 250000, 500000);

SET @Content = 'THANHTOAN ' + @Code;
INSERT INTO dbo.PaymentRequest (BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedBy, CreatedAt)
VALUES (@B1, 'FULL', 500000, @Content, 'DEMO_QR|970436|1012345678|500000|' + @Content, DATEADD(MINUTE, 10, @t), 'PAID', NULL, @t);
SET @Req = SCOPE_IDENTITY();

INSERT INTO dbo.BankTransactions (Provider, ProviderTxnId, AccountNo, Amount, Content, TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt)
VALUES ('SEPAY', 'SP' + CONVERT(VARCHAR(8), @t, 112) + '0001', '1012345678', 500000, @Content, DATEADD(MINUTE, 3, @t),
        N'{"gateway":"Vietcombank","transferType":"in","transferAmount":500000,"content":"' + @Content + N'"}',
        'MATCHED', @B1, DATEADD(MINUTE, 3, @t));
SET @Txn = SCOPE_IDENTITY();

SET @dk = CONVERT(CHAR(8), DATEADD(MINUTE, 3, @t), 112);
EXEC dbo.usp_NextCode 'PT', @dk, @Code OUTPUT;
INSERT INTO dbo.Payments (PaymentCode, BookingId, Purpose, Method, Channel, Amount, RequestId, BankTxnId, CollectedBy, PaidAt)
VALUES (@Code, @B1, 'FULL', 'BANK_TRANSFER', 'ONLINE', 500000, @Req, @Txn, NULL, DATEADD(MINUTE, 3, @t));

INSERT INTO dbo.BookingStatusHistory (BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus, ChangedBy, ChangedAt, Note) VALUES
 (@B1, NULL,              'PENDING_PAYMENT', NULL,     'UNPAID', @CusAn,      @t,                         N'Khách đặt trực tuyến'),
 (@B1, 'PENDING_PAYMENT', 'CONFIRMED',       'UNPAID', 'PAID',   NULL,        DATEADD(MINUTE, 3, @t),     N'Webhook SEPAY – khớp giao dịch'),
 (@B1, 'CONFIRMED',       'IN_USE',          'PAID',   'PAID',   @StaffTrang, DATEADD(MINUTE, -5, @Start), N'Nhận sân'),
 (@B1, 'IN_USE',          'COMPLETED',       'PAID',   'PAID',   NULL,        @End,                       N'Tự hoàn thành khi hết giờ');

/* ===== B2: CONFIRMED + DEPOSITED – 1,5h × 300.000 = 450.000; SANGVUI20 −20% = −90.000; cọc 30% của 360.000 = 108.000 ===== */
SET @t     = DATEADD(HOUR, -2, @Now);
SET @Start = DATEADD(MINUTE, 9 * 60,      DATEADD(DAY, 2, @D0));
SET @End   = DATEADD(MINUTE, 10 * 60 + 30, DATEADD(DAY, 2, @D0));
SET @dk = CONVERT(CHAR(8), @t, 112);
EXEC dbo.usp_NextCode 'BK', @dk, @Code OUTPUT;

INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
    BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositType, DepositValue, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
    Status, PaymentStatus, HoldExpireAt, PromotionCode, CreatedBy, CreatedAt, UpdatedAt, Channel)
VALUES (@Code, @CS02, @BD03, @CusAn, @Start, @End,
    450000, 90000, 360000, 'DEPOSIT', 'PERCENT', 30, 108000, 108000, 108000, 252000,
    'CONFIRMED', 'DEPOSITED', NULL, 'SANGVUI20', @CusAn, @t, DATEADD(MINUTE, 2, @t), 'ONLINE');
SET @B2 = SCOPE_IDENTITY();
UPDATE dbo.Promotions SET UsedCount = UsedCount + 1 WHERE PromotionId = @PromoSang AND UsedCount < MaxUses;

INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
VALUES (@B2, @PrBD03Norm, @Start, @End, 300000, 450000);

SET @Content = 'THANHTOAN ' + @Code;
INSERT INTO dbo.PaymentRequest (BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedBy, CreatedAt)
VALUES (@B2, 'DEPOSIT', 108000, @Content, 'DEMO_QR|970422|0201234567|108000|' + @Content, DATEADD(MINUTE, 10, @t), 'PAID', NULL, @t);
SET @Req = SCOPE_IDENTITY();

INSERT INTO dbo.BankTransactions (Provider, ProviderTxnId, AccountNo, Amount, Content, TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt)
VALUES ('SEPAY', 'SP' + CONVERT(VARCHAR(8), @t, 112) + '0002', '0201234567', 108000, @Content, DATEADD(MINUTE, 2, @t),
        N'{"gateway":"MBBank","transferType":"in","transferAmount":108000,"content":"' + @Content + N'"}',
        'MATCHED', @B2, DATEADD(MINUTE, 2, @t));
SET @Txn = SCOPE_IDENTITY();

SET @dk = CONVERT(CHAR(8), DATEADD(MINUTE, 2, @t), 112);
EXEC dbo.usp_NextCode 'PT', @dk, @Code OUTPUT;
INSERT INTO dbo.Payments (PaymentCode, BookingId, Purpose, Method, Channel, Amount, RequestId, BankTxnId, CollectedBy, PaidAt)
VALUES (@Code, @B2, 'DEPOSIT', 'BANK_TRANSFER', 'ONLINE', 108000, @Req, @Txn, NULL, DATEADD(MINUTE, 2, @t));

INSERT INTO dbo.BookingStatusHistory (BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus, ChangedBy, ChangedAt, Note) VALUES
 (@B2, NULL,              'PENDING_PAYMENT', NULL,     'UNPAID',    @CusAn, @t,                     N'Khách đặt trực tuyến, áp mã SANGVUI20, chọn đặt cọc'),
 (@B2, 'PENDING_PAYMENT', 'CONFIRMED',       'UNPAID', 'DEPOSITED', NULL,   DATEADD(MINUTE, 2, @t), N'Webhook SEPAY – nhận tiền cọc');

/* ===== B3: CONFIRMED + PAID – khách vãng lai, 2h × 120.000 = 240.000, tiền mặt tại quầy ===== */
SET @t     = DATEADD(MINUTE, -30, @Now);
SET @Start = DATEADD(HOUR, 17, DATEADD(DAY, 1, @D0));
SET @End   = DATEADD(HOUR, 19, DATEADD(DAY, 1, @D0));
SET @dk = CONVERT(CHAR(8), @t, 112);
EXEC dbo.usp_NextCode 'BK', @dk, @Code OUTPUT;

INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, GuestName, GuestPhone, StartAt, EndAt,
    BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
    Status, PaymentStatus, HoldExpireAt, CreatedBy, CreatedAt, UpdatedAt, Channel)
VALUES (@Code, @CS01, @CL02, NULL, N'Trần Minh Hoàng', '0905112233', @Start, @End,
    240000, 0, 240000, 'FULL', 0, 240000, 240000, 0,
    'CONFIRMED', 'PAID', NULL, @StaffTrang, @t, DATEADD(MINUTE, 1, @t), 'COUNTER');
SET @B3 = SCOPE_IDENTITY();

INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
VALUES (@B3, @PrCL02Peak, @Start, @End, 120000, 240000);

SET @dk = CONVERT(CHAR(8), DATEADD(MINUTE, 1, @t), 112);
EXEC dbo.usp_NextCode 'PT', @dk, @Code OUTPUT;
INSERT INTO dbo.Payments (PaymentCode, BookingId, Purpose, Method, Channel, Amount, RequestId, BankTxnId, CollectedBy, PaidAt)
VALUES (@Code, @B3, 'FULL', 'CASH', 'COUNTER', 240000, NULL, NULL, @StaffTrang, DATEADD(MINUTE, 1, @t));

INSERT INTO dbo.BookingStatusHistory (BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus, ChangedBy, ChangedAt, Note) VALUES
 (@B3, NULL,              'PENDING_PAYMENT', NULL,     'UNPAID', @StaffTrang, @t,                     N'Đặt tại quầy – khách vãng lai'),
 (@B3, 'PENDING_PAYMENT', 'CONFIRMED',       'UNPAID', 'PAID',   @StaffTrang, DATEADD(MINUTE, 1, @t), N'Thu tiền mặt tại quầy');

/* ===== B4: EXPIRED – 15:00–16:00 × 150.000 + 16:00–17:00 × 250.000 = 400.000; chuyển khoản đến muộn ⇒ NEEDS_REVIEW ===== */
SET @t     = DATEADD(HOUR, 14, DATEADD(DAY, -1, @D0));
SET @Start = DATEADD(HOUR, 15, DATEADD(DAY, -1, @D0));
SET @End   = DATEADD(HOUR, 17, DATEADD(DAY, -1, @D0));
SET @dk = CONVERT(CHAR(8), @t, 112);
EXEC dbo.usp_NextCode 'BK', @dk, @Code OUTPUT;

INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
    BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
    Status, PaymentStatus, HoldExpireAt, CreatedBy, CreatedAt, UpdatedAt, Channel)
VALUES (@Code, @CS01, @PB03, @CusBinh, @Start, @End,
    400000, 0, 400000, 'FULL', 0, 400000, 0, 400000,
    'EXPIRED', 'UNPAID', DATEADD(MINUTE, 10, @t), @CusBinh, @t, DATEADD(MINUTE, 10, @t), 'ONLINE');
SET @B4 = SCOPE_IDENTITY();

INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount) VALUES
 (@B4, @PrPB03Norm, @Start,                     DATEADD(HOUR, 1, @Start), 150000, 150000),
 (@B4, @PrPB03Peak, DATEADD(HOUR, 1, @Start),   @End,                     250000, 250000);

SET @Content = 'THANHTOAN ' + @Code;
INSERT INTO dbo.PaymentRequest (BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedBy, CreatedAt)
VALUES (@B4, 'FULL', 400000, @Content, 'DEMO_QR|970436|1012345678|400000|' + @Content, DATEADD(MINUTE, 10, @t), 'EXPIRED', NULL, @t);

-- Tiền đến sau khi đơn đã quá hạn (UC 005 luồng 2d) ⇒ không tự xác nhận
INSERT INTO dbo.BankTransactions (Provider, ProviderTxnId, AccountNo, Amount, Content, TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt)
VALUES ('SEPAY', 'SP' + CONVERT(VARCHAR(8), @t, 112) + '0003', '1012345678', 400000, @Content, DATEADD(MINUTE, 25, @t),
        N'{"gateway":"Vietcombank","transferType":"in","transferAmount":400000,"content":"' + @Content + N'"}',
        'NEEDS_REVIEW', @B4, DATEADD(MINUTE, 25, @t));

INSERT INTO dbo.BookingStatusHistory (BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus, ChangedBy, ChangedAt, Note) VALUES
 (@B4, NULL,              'PENDING_PAYMENT', NULL,     'UNPAID', @CusBinh, @t,                      N'Khách đặt trực tuyến'),
 (@B4, 'PENDING_PAYMENT', 'EXPIRED',         'UNPAID', 'UNPAID', NULL,     DATEADD(MINUTE, 10, @t), N'Job expireHolds – hết hạn giữ chỗ');

-- Giao dịch sai nội dung, không xác định được đơn (UC 005 luồng 2c)
INSERT INTO dbo.BankTransactions (Provider, ProviderTxnId, AccountNo, Amount, Content, TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt)
VALUES ('SEPAY', 'SP' + CONVERT(VARCHAR(8), @Today, 112) + '0004', '1012345678', 200000, N'CHUYEN TIEN DAT SAN', DATEADD(MINUTE, -45, @Now),
        N'{"gateway":"Vietcombank","transferType":"in","transferAmount":200000,"content":"CHUYEN TIEN DAT SAN"}',
        'NEEDS_REVIEW', NULL, DATEADD(MINUTE, -45, @Now));

/* ===== B5: CANCELED – 2h × 200.000 = 400.000 trả 100%, hủy trước ~10 ngày ⇒ hoàn 100% ===== */
SET @t     = DATEADD(HOUR, 9, DATEADD(DAY, -2, @D0));
SET @Start = DATEADD(HOUR, 7, DATEADD(DAY, 10, @D0));
SET @End   = DATEADD(HOUR, 9, DATEADD(DAY, 10, @D0));
SET @dk = CONVERT(CHAR(8), @t, 112);
EXEC dbo.usp_NextCode 'BK', @dk, @Code OUTPUT;

INSERT INTO dbo.Bookings (BookingCode, BranchId, CourtId, CustomerUserId, StartAt, EndAt,
    BaseAmount, DiscountAmount, TotalAmount, PaymentOption, DepositAmount, AmountDueNow, PaidAmount, RemainingAmount,
    Status, PaymentStatus, HoldExpireAt, CanceledBy, CanceledAt, CancelReason, CancelType, RefundRate, RefundAmount,
    CreatedBy, CreatedAt, UpdatedAt, Channel)
VALUES (@Code, @CS02, @TN01, @CusBinh, @Start, @End,
    400000, 0, 400000, 'FULL', 0, 400000, 400000, 0,
    'CANCELED', 'PAID', NULL, @CusBinh, DATEADD(MINUTE, -10, @Now), N'Bận công việc đột xuất không thể tham gia', 'CUSTOMER_REQUEST', 100, 400000,
    @CusBinh, @t, DATEADD(MINUTE, -10, @Now), 'ONLINE');
SET @B5 = SCOPE_IDENTITY();

INSERT INTO dbo.BookingPriceLines (BookingId, PriceRuleId, StartAt, EndAt, PricePerHour, Amount)
VALUES (@B5, @PrTN01Norm, @Start, @End, 200000, 400000);

SET @Content = 'THANHTOAN ' + @Code;
INSERT INTO dbo.PaymentRequest (BookingId, Purpose, Amount, TransferContent, QrPayload, ExpiresAt, Status, CreatedBy, CreatedAt)
VALUES (@B5, 'FULL', 400000, @Content, 'DEMO_QR|970422|0201234567|400000|' + @Content, DATEADD(MINUTE, 10, @t), 'PAID', NULL, @t);
SET @Req = SCOPE_IDENTITY();

INSERT INTO dbo.BankTransactions (Provider, ProviderTxnId, AccountNo, Amount, Content, TransactionAt, RawPayload, MatchStatus, MatchedBookingId, ReceivedAt)
VALUES ('SEPAY', 'SP' + CONVERT(VARCHAR(8), @t, 112) + '0005', '0201234567', 400000, @Content, DATEADD(MINUTE, 4, @t),
        N'{"gateway":"MBBank","transferType":"in","transferAmount":400000,"content":"' + @Content + N'"}',
        'MATCHED', @B5, DATEADD(MINUTE, 4, @t));
SET @Txn = SCOPE_IDENTITY();

SET @dk = CONVERT(CHAR(8), DATEADD(MINUTE, 4, @t), 112);
EXEC dbo.usp_NextCode 'PT', @dk, @Code OUTPUT;
INSERT INTO dbo.Payments (PaymentCode, BookingId, Purpose, Method, Channel, Amount, RequestId, BankTxnId, CollectedBy, PaidAt)
VALUES (@Code, @B5, 'FULL', 'BANK_TRANSFER', 'ONLINE', 400000, @Req, @Txn, NULL, DATEADD(MINUTE, 4, @t));

INSERT INTO dbo.Refunds (BookingId, Amount, Rate, Reason, Status, CreatedAt)
VALUES (@B5, 400000, 100, N'Khách hủy trước giờ chơi từ 5 ngày trở lên – hoàn 100%', 'PENDING', DATEADD(MINUTE, -10, @Now));

INSERT INTO dbo.BookingStatusHistory (BookingId, FromStatus, ToStatus, FromPaymentStatus, ToPaymentStatus, ChangedBy, ChangedAt, Note) VALUES
 (@B5, NULL,              'PENDING_PAYMENT', NULL,     'UNPAID', @CusBinh, @t,                         N'Khách đặt trực tuyến'),
 (@B5, 'PENDING_PAYMENT', 'CONFIRMED',       'UNPAID', 'PAID',   NULL,     DATEADD(MINUTE, 4, @t),     N'Webhook SEPAY – khớp giao dịch'),
 (@B5, 'CONFIRMED',       'CANCELED',        'PAID',   'PAID',   @CusBinh, DATEADD(MINUTE, -10, @Now), N'Khách hủy – hoàn 100%');

/* ---------- 6.10 Ô lịch (BookingSlots) cho mọi đơn, chia theo Sports.GridBlockMinutes ---------- */
;WITH N AS (
    SELECT TOP (96) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
    FROM sys.all_objects
)
INSERT INTO dbo.BookingSlots (BookingId, CourtId, SlotStart, IsActive)
SELECT b.BookingId, b.CourtId,
       DATEADD(MINUTE, N.n * s.GridBlockMinutes, b.StartAt),
       CASE WHEN b.Status IN ('CANCELED','EXPIRED') THEN 0 ELSE 1 END
FROM dbo.Bookings b
JOIN dbo.Courts c ON c.CourtId = b.CourtId
JOIN dbo.Sports s ON s.SportId = c.SportId
JOIN N ON N.n < DATEDIFF(MINUTE, b.StartAt, b.EndAt) / s.GridBlockMinutes;

/* ---------- 6.11 Thông báo cho khách hàng ---------- */
INSERT INTO dbo.Notifications (UserId, Type, Title, Body, LinkType, LinkRef, IsRead, ReadAt, CreatedAt)
SELECT @CusAn, 'PAYMENT_RESULT', N'Thanh toán thành công',
       N'Đơn ' + b.BookingCode + N' đã nhận 500.000đ. Trạng thái: Đã thanh toán. Còn lại: 0đ.',
       'BOOKING', CAST(b.BookingId AS VARCHAR(50)), 1, DATEADD(MINUTE, 10, b.CreatedAt), DATEADD(MINUTE, 3, b.CreatedAt)
FROM dbo.Bookings b WHERE b.BookingId = @B1
UNION ALL
SELECT @CusAn, 'PAYMENT_RESULT', N'Đặt cọc thành công',
       N'Đơn ' + b.BookingCode + N' đã nhận tiền cọc 108.000đ. Số tiền còn lại thanh toán khi nhận sân: 252.000đ.',
       'BOOKING', CAST(b.BookingId AS VARCHAR(50)), 0, NULL, DATEADD(MINUTE, 2, b.CreatedAt)
FROM dbo.Bookings b WHERE b.BookingId = @B2
UNION ALL
SELECT @CusBinh, 'PAYMENT_RESULT', N'Thanh toán thành công',
       N'Đơn ' + b.BookingCode + N' đã nhận 400.000đ. Trạng thái: Đã thanh toán.',
       'BOOKING', CAST(b.BookingId AS VARCHAR(50)), 1, DATEADD(HOUR, 1, b.CreatedAt), DATEADD(MINUTE, 4, b.CreatedAt)
FROM dbo.Bookings b WHERE b.BookingId = @B5
UNION ALL
SELECT u.UserId, 'PROMOTION', N'Ưu đãi khung giờ vàng buổi sáng',
       N'Nhập mã SANGVUI20 giảm 20% (tối đa 100.000đ) cho khung 06:00 - 11:00, áp dụng mọi cơ sở.',
       'PROMOTION', CAST(@PromoSang AS VARCHAR(50)), 0, NULL, DATEADD(DAY, -7, @Now)
FROM dbo.Users u WHERE u.Role = 'CUSTOMER'
UNION ALL
SELECT pc.CustomerId, 'PROMOTION', N'Voucher tri ân dành riêng cho bạn',
       N'Mã TRIAN10 giảm 50.000đ cho mỗi đơn đặt sân, hạn dùng 60 ngày.',
       'PROMOTION', CAST(@PromoTriAn AS VARCHAR(50)), 0, NULL, DATEADD(HOUR, -3, @Now)
FROM dbo.PromotionCustomers pc WHERE pc.PromotionId = @PromoTriAn;

/* ---------- 6.12 Nhật ký thao tác ---------- */
INSERT INTO dbo.AuditLogs (UserId, Action, EntityType, EntityId, OldValue, NewValue, IpAddress, CreatedAt) VALUES
 (@OwnerId, 'CREATE', 'Promotions', CAST(@PromoSang AS VARCHAR(50)), NULL,
  N'{"Code":"SANGVUI20","DiscountType":"PERCENT","DiscountValue":20,"MaxUses":200}', '127.0.0.1', DATEADD(DAY, -7, @Now)),
 (@OwnerId, 'UPDATE', 'CourtPriceRules', 'SAN_BD_03', N'{"Label":"Giờ cao điểm","PricePerHour":600000}',
  N'{"Label":"Giờ cao điểm","PricePerHour":650000}', '127.0.0.1', '2026-11-01T00:00:00'),
 (@OwnerId, 'LOCK',   'Users', CAST(@StaffTuan AS VARCHAR(50)), N'{"Status":"ACTIVE","TokenVersion":0}',
  N'{"Status":"LOCKED","TokenVersion":1}', '127.0.0.1', DATEADD(DAY, -3, @Now));

COMMIT TRANSACTION;
GO


/* =============================================================================
   PHẦN 7. KIỂM TRA NHANH
   ============================================================================= */
SELECT t.name AS TableName, SUM(p.rows) AS [Rows]
FROM sys.tables t
JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE t.is_ms_shipped = 0
GROUP BY t.name
ORDER BY t.name;

SELECT BookingCode, Status, PaymentStatus, TotalAmount, PaidAmount, RemainingAmount, StartAt, EndAt
FROM dbo.Bookings ORDER BY BookingId;
GO

SET NOEXEC OFF;
GO
