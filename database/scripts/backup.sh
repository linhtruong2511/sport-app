#!/usr/bin/env bash
set -euo pipefail

# SportHub SQL Server Backup Script (Linux / sqlcmd)
# Usage:
#   DB_SERVER="localhost" DB_USER="sa" DB_PASSWORD="..." ./database/scripts/backup.sh
# Optional env vars: DB_DATABASE (SportHub), BACKUP_DIR (/var/backups/sporthub), RETENTION_DAYS (14), SQLCMD_BIN (sqlcmd)

DB_SERVER="${DB_SERVER:-localhost}"
DB_DATABASE="${DB_DATABASE:-SportHub}"
DB_USER="${DB_USER:-sa}"
DB_PASSWORD="${DB_PASSWORD:?DB_PASSWORD must be set}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sporthub}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
SQLCMD_BIN="${SQLCMD_BIN:-sqlcmd}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${DB_DATABASE}_${TIMESTAMP}.bak"

echo "[$(date -Iseconds)] Starting backup of [${DB_DATABASE}] on ${DB_SERVER} -> ${BACKUP_FILE}"

"$SQLCMD_BIN" -S "$DB_SERVER" -U "$DB_USER" -P "$DB_PASSWORD" -C -b -Q \
  "BACKUP DATABASE [${DB_DATABASE}] TO DISK = N'${BACKUP_FILE}' WITH FORMAT, INIT, COMPRESSION, STATS = 10;"

echo "[$(date -Iseconds)] Backup completed: ${BACKUP_FILE}"

# Prune backups older than RETENTION_DAYS
find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DB_DATABASE}_*.bak" -mtime +"$RETENTION_DAYS" -print -delete
echo "[$(date -Iseconds)] Retention cleanup done (>${RETENTION_DAYS} days)."
