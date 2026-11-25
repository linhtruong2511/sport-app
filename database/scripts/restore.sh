#!/usr/bin/env bash
set -euo pipefail

# SportHub SQL Server Restore Script (Linux / sqlcmd)
# Usage:
#   DB_SERVER="localhost" DB_USER="sa" DB_PASSWORD="..." ./database/scripts/restore.sh /var/backups/sporthub/SportHub_20261125_020000.bak

BACKUP_FILE="${1:?Usage: restore.sh <backup-file.bak>}"
DB_SERVER="${DB_SERVER:-localhost}"
DB_DATABASE="${DB_DATABASE:-SportHub}"
DB_USER="${DB_USER:-sa}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"
SQLCMD_BIN="${SQLCMD_BIN:-sqlcmd}"

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Backup file not found: $BACKUP_FILE" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Restoring [${DB_DATABASE}] on ${DB_SERVER} from ${BACKUP_FILE}"

"$SQLCMD_BIN" -S "$DB_SERVER" -U "$DB_USER" -P "$DB_PASSWORD" -C -b -Q "
USE master;
IF DB_ID(N'${DB_DATABASE}') IS NOT NULL
    ALTER DATABASE [${DB_DATABASE}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE;
RESTORE DATABASE [${DB_DATABASE}] FROM DISK = N'${BACKUP_FILE}' WITH REPLACE, STATS = 10;
ALTER DATABASE [${DB_DATABASE}] SET MULTI_USER;
"

echo "[$(date -Iseconds)] Restore completed successfully."
