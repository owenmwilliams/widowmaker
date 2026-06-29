# Backup & Disaster Recovery Runbook (B7)

Production data had **no backup/recovery story** — a bad migration or accidental
delete had no path back. This sets up automated backups + point-in-time recovery
(PITR) and documents how to restore and roll back.

> These commands run against **production** Cloud SQL and need Cloud SQL Admin
> auth. They are intentionally kept here (not in CI) so a human runs them.

## Target

| | |
|---|---|
| Project | `widowmaker-477505` |
| Instance | `movetrack-db` (us-central1, PostgreSQL) |
| Connection | `widowmaker-477505:us-central1:movetrack-db` |
| Database / user | `movetrack_db` / `movetrack_user` |

## 1. Enable automated backups + PITR (one-time)

```bash
./infra/gcp/enable-backups.sh
# or override defaults:
RETAINED_BACKUPS=30 RETAINED_TXLOG_DAYS=7 ./infra/gcp/enable-backups.sh
```

This sets: daily automated backups (09:00 UTC), 30 retained backups, and
point-in-time recovery with 7 days of transaction logs.

**Verify** (`pointInTimeRecoveryEnabled: true`, `enabled: true`):

```bash
gcloud sql instances describe movetrack-db --project=widowmaker-477505 \
  --format="yaml(settings.backupConfiguration)"
```

**Targets:** RPO ≈ minutes (PITR replays the transaction log to any point in the
7-day window). RTO ≈ time to clone + cut over (~10–30 min).

## 2. On-demand backup (before a risky change, e.g. a migration)

```bash
gcloud sql backups create --instance=movetrack-db --project=widowmaker-477505
gcloud sql backups list --instance=movetrack-db --project=widowmaker-477505
```

## 3. Recovery

### 3a. Point-in-time recovery — PREFERRED (non-destructive)

Clone to a **new** instance at a timestamp just before the bad event, verify,
then cut over. Never overwrite prod blind.

```bash
gcloud sql instances clone movetrack-db movetrack-db-recovered \
  --point-in-time='2026-06-29T11:55:00.000Z' \
  --project=widowmaker-477505

# Inspect the clone, then cut over by pointing the app's Cloud SQL connection at
# it (update _CLOUD_SQL_CONNECTION in the Cloud Build trigger / Cloud Run
# --add-cloudsql-instances) or promote/rename as appropriate.
```

### 3b. Restore a full backup

```bash
gcloud sql backups list --instance=movetrack-db --project=widowmaker-477505   # find BACKUP_ID
# Restore onto a NEW instance to inspect first (safer than overwriting prod):
gcloud sql backups restore BACKUP_ID \
  --restore-instance=movetrack-db-restored \
  --backup-instance=movetrack-db \
  --project=widowmaker-477505
```

> Restoring onto the **same** instance overwrites it and is destructive — only do
> that in a true outage, after confirming the backup is good.

## 4. Rollback runbook (bad deploy)

1. **App code** — roll Cloud Run back to the previous healthy revision:
   ```bash
   gcloud run revisions list --service=movetrack-api --region=us-central1 --project=widowmaker-477505
   gcloud run services update-traffic movetrack-api --region=us-central1 \
     --to-revisions=PREVIOUS_REVISION=100 --project=widowmaker-477505
   ```
2. **Schema/data** — only if a migration corrupted data: PITR-clone to just
   before the deploy (§3a), verify, cut over. The migration runner records
   applied migrations in `schema_migrations`, so you can see exactly what ran.
3. Confirm `GET /health/ready` returns 200 against the restored target.

## 5. Verification checklist (run after enabling, then monthly)

- [ ] `backupConfiguration.enabled = true` and `pointInTimeRecoveryEnabled = true`.
- [ ] At least one automated backup exists (`gcloud sql backups list`).
- [ ] **Test restore:** clone to a timestamp (§3a) into `movetrack-db-test`,
      connect, run a smoke query (`SELECT count(*) FROM users;`), then delete the
      clone: `gcloud sql instances delete movetrack-db-test --project=widowmaker-477505`.
- [ ] Schedule this test-restore monthly (Cloud Scheduler or a calendar reminder).
