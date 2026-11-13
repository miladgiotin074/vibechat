#!/usr/bin/env bash
# Nightly logical backup of Postgres (run on the data node from cron):
#   0 3 * * * /opt/vibechat/deploy/scripts/backup.sh >> /var/log/vibechat-backup.log 2>&1
# Keeps 14 days locally. For off-site copies, add an rclone line to your R2/S3 bucket, e.g.:
#   rclone copy "$FILE" r2:vibe-backups/db/
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=/var/backups/vibechat
mkdir -p "$DIR"
FILE="$DIR/vibe-$(date -u +%Y%m%d-%H%M).dump"
docker compose exec -T postgres pg_dump -U vibe -d vibe --format=custom --compress=9 > "$FILE"
find "$DIR" -name 'vibe-*.dump' -mtime +14 -delete
echo "$(date -u +%FT%TZ) backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
# Restore: docker compose exec -T postgres pg_restore -U vibe -d vibe --clean --if-exists < file.dump
