<#
.SYNOPSIS
    Sao lưu cơ sở dữ liệu SQL Server SportHub có nén, kiểm tra checksum và tự động dọn bản cũ.

.DESCRIPTION
    Thực thi BACKUP DATABASE ... WITH COMPRESSION, CHECKSUM, INIT thông qua sqlcmd,
    kiểm tra tính toàn vẹn bằng RESTORE VERIFYONLY ... WITH CHECKSUM,
    sau đó xóa các file .bak cũ hơn RetentionDays (chỉ xóa khi sao lưu và xác minh thành công).

.PARAMETER ServerInstance
    Tên SQL Server instance (mặc định: 'localhost').

.PARAMETER Database
    Tên database cần sao lưu (mặc định: 'SportHub').

.PARAMETER BackupDir
    Thư mục lưu file .bak (mặc định: 'C:\Backups\SportHub').

.PARAMETER RetentionDays
    Số ngày giữ lại bản sao lưu .bak (mặc định: 14).

.PARAMETER TrustServerCertificate
    Bật cờ -C cho sqlcmd khi kết nối SQL Server dùng chứng chỉ tự ký.
#>
[CmdletBinding()]
param(
    [string]$ServerInstance = 'localhost',

    [ValidatePattern('^[A-Za-z0-9_]+$')]
    [string]$Database = 'SportHub',

    [string]$BackupDir = 'C:\Backups\SportHub',

    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 14,

    [switch]$TrustServerCertificate
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command sqlcmd -ErrorAction SilentlyContinue)) {
    throw 'Không tìm thấy lệnh sqlcmd trong PATH. Vui lòng cài đặt SQL Server Command Line Utilities.'
}

if (-not (Test-Path -LiteralPath $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$resolvedBackupDir = (Resolve-Path -LiteralPath $BackupDir).Path
$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$backupFileName = "${Database}_${timestamp}.bak"
$backupPath = Join-Path -Path $resolvedBackupDir -ChildPath $backupFileName
$escapedBackupPath = $backupPath.Replace("'", "''")

$sqlCmdBaseArgs = @(
    '-S', $ServerInstance,
    '-d', 'master',
    '-E',
    '-b'
)

if ($TrustServerCertificate) {
    $sqlCmdBaseArgs += '-C'
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Bắt đầu sao lưu database [$Database] trên [$ServerInstance]..."
$backupQuery = "BACKUP DATABASE [$Database] TO DISK = N'$escapedBackupPath' WITH COMPRESSION, CHECKSUM, INIT;"
& sqlcmd @sqlCmdBaseArgs -Q $backupQuery
if ($LASTEXITCODE -ne 0) {
    throw "Sao lưu database [$Database] thất bại (sqlcmd exit code: $LASTEXITCODE)."
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Đang kiểm tra tính toàn vẹn file sao lưu: $backupPath"
$verifyQuery = "RESTORE VERIFYONLY FROM DISK = N'$escapedBackupPath' WITH CHECKSUM;"
& sqlcmd @sqlCmdBaseArgs -Q $verifyQuery
if ($LASTEXITCODE -ne 0) {
    throw "Kiểm tra RESTORE VERIFYONLY thất bại cho file '$backupPath' (sqlcmd exit code: $LASTEXITCODE)."
}

$cutoffDate = (Get-Date).AddDays(-$RetentionDays)
$expiredBackups = Get-ChildItem -LiteralPath $resolvedBackupDir -Filter '*.bak' -File |
    Where-Object { $_.LastWriteTime -lt $cutoffDate }

$prunedCount = 0
foreach ($file in $expiredBackups) {
    Remove-Item -LiteralPath $file.FullName -Force
    $prunedCount++
}

Write-Host "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Hoàn tất sao lưu: $backupPath (đã dọn $prunedCount file cũ hơn $RetentionDays ngày)."
