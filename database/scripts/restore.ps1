<#
.SYNOPSIS
    Khôi phục cơ sở dữ liệu SQL Server SportHub từ file .bak một cách an toàn.

.DESCRIPTION
    Kiểm tra file sao lưu hợp lệ bằng RESTORE VERIFYONLY, chuyển database sang SINGLE_USER
    (nếu database đã tồn tại), thực hiện RESTORE DATABASE ... WITH REPLACE, STATS = 10,
    và luôn đưa database trở lại MULTI_USER trong khối finally.

.PARAMETER ServerInstance
    Tên SQL Server instance (mặc định: 'localhost').

.PARAMETER Database
    Tên database đích cần khôi phục (mặc định: 'SportHub').

.PARAMETER BackupFile
    Đường dẫn tới file .bak dùng để khôi phục (bắt buộc).

.PARAMETER TrustServerCertificate
    Bật cờ -C cho sqlcmd khi kết nối SQL Server dùng chứng chỉ tự ký.
#>
[CmdletBinding()]
param(
    [string]$ServerInstance = 'localhost',

    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string]$Database = 'SportHub',

    [Parameter(Mandatory = $true)]
    [string]$BackupFile,

    [switch]$TrustServerCertificate
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    throw 'Không tìm thấy lệnh sqlcmd trong PATH. Vui lòng cài đặt SQL Server Command Line Utilities.'
}

if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
    throw "Không tìm thấy file sao lưu: $BackupFile"
}

$resolvedBackupFile = (Resolve-Path -LiteralPath $BackupFile).Path
$escapedBackupFile = $resolvedBackupFile.Replace("'", "''")

$sqlCmdBaseArgs = @(
    '-S', $ServerInstance,
    '-d', 'master',
    '-E',
    '-b'
)

if ($TrustServerCertificate) {
    $sqlCmdBaseArgs += '-C'
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Kiểm tra file sao lưu trước khi khôi phục: $resolvedBackupFile"
$verifyQuery = "RESTORE VERIFYONLY FROM DISK = N'$escapedBackupFile' WITH CHECKSUM;"
& sqlcmd @sqlCmdBaseArgs -Q $verifyQuery
if ($LASTEXITCODE -ne 0) {
    throw "File sao lưu không hợp lệ hoặc bị hỏng: '$resolvedBackupFile' (sqlcmd exit code: $LASTEXITCODE)."
}

try {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Đang chuyển [$Database] sang SINGLE_USER (nếu tồn tại)..."
    $singleUserQuery = @"
IF DB_ID(N'$Database') IS NOT NULL
BEGIN
    ALTER DATABASE [$Database] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
END;
"@
    & sqlcmd @sqlCmdBaseArgs -Q $singleUserQuery
    if ($LASTEXITCODE -ne 0) {
        throw "Không thể chuyển [$Database] sang SINGLE_USER (sqlcmd exit code: $LASTEXITCODE)."
    }

    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Đang khôi phục [$Database] từ $resolvedBackupFile..."
    $restoreQuery = "RESTORE DATABASE [$Database] FROM DISK = N'$escapedBackupFile' WITH REPLACE, STATS = 10;"
    & sqlcmd @sqlCmdBaseArgs -Q $restoreQuery
    if ($LASTEXITCODE -ne 0) {
        throw "Khôi phục [$Database] thất bại (sqlcmd exit code: $LASTEXITCODE)."
    }

    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Khôi phục [$Database] thành công."
}
finally {
    Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Đảm bảo [$Database] ở chế độ MULTI_USER..."
    $multiUserQuery = @"
IF DB_ID(N'$Database') IS NOT NULL
BEGIN
    ALTER DATABASE [$Database] SET MULTI_USER;
END;
"@
    & sqlcmd @sqlCmdBaseArgs -Q $multiUserQuery
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Không thể đặt lại MULTI_USER cho [$Database] (sqlcmd exit code: $LASTEXITCODE). Cần kiểm tra thủ công."
    }
}
