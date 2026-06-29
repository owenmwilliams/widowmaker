#!/usr/bin/env bash
#
# infra/gcp/enable-backups.sh
#
# Enable automated daily backups + point-in-time recovery (PITR) on the
# production Cloud SQL (PostgreSQL) instance. Idempotent — safe to re-run.
#
# Run with sufficient gcloud auth (Cloud SQL Admin). Override any value via env:
#   PROJECT=widowmaker-477505 INSTANCE=movetrack-db ./infra/gcp/enable-backups.sh
#
set -euo pipefail

PROJECT="${PROJECT:-widowmaker-477505}"
INSTANCE="${INSTANCE:-movetrack-db}"
# Daily backup start time, UTC (HH:MM). 09:00 UTC ≈ low-traffic early morning US.
BACKUP_START_TIME="${BACKUP_START_TIME:-09:00}"
# Keep this many automated backups, and this many days of transaction logs (PITR window).
RETAINED_BACKUPS="${RETAINED_BACKUPS:-30}"
RETAINED_TXLOG_DAYS="${RETAINED_TXLOG_DAYS:-7}"

echo "Enabling backups + PITR on ${PROJECT}:${INSTANCE}"
echo "  backup start (UTC): ${BACKUP_START_TIME}"
echo "  retained backups:   ${RETAINED_BACKUPS}"
echo "  tx-log days (PITR): ${RETAINED_TXLOG_DAYS}"

gcloud sql instances patch "${INSTANCE}" \
  --project="${PROJECT}" \
  --backup-start-time="${BACKUP_START_TIME}" \
  --enable-point-in-time-recovery \
  --retained-backups-count="${RETAINED_BACKUPS}" \
  --retained-transaction-log-days="${RETAINED_TXLOG_DAYS}"

echo
echo "Current backup configuration:"
gcloud sql instances describe "${INSTANCE}" \
  --project="${PROJECT}" \
  --format="yaml(settings.backupConfiguration)"

echo
echo "Done. Verify pointInTimeRecoveryEnabled=true and enabled=true above."
