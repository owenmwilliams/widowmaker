#!/usr/bin/env bash
#
# One-time GCP setup for async scan processing (#42 Phase 2).
#
# Scans are processed via a Cloud Tasks push queue: the API enqueues a task per
# scan job, and Cloud Tasks POSTs the job id to /internal/scan-jobs/process on
# the API with a Google-signed OIDC token. This script creates the identity
# that token is minted for and grants the runtime the permissions to enqueue.
#
# The queue itself is created idempotently by the `ensure-scan-queue` step in
# cloudbuild.yaml on every deploy; SCAN_TASKS_* env vars are set on the service
# by the deploy step. Run this script ONCE per project (requires owner/IAM
# admin), before the first deploy that includes scan jobs:
#
#   ./infra/gcp/setup-scan-jobs.sh widowmaker-477505
#
set -euo pipefail

PROJECT_ID="${1:?usage: setup-scan-jobs.sh <project-id>}"
INVOKER_SA="scan-tasks-invoker@${PROJECT_ID}.iam.gserviceaccount.com"

# The service account Cloud Run runs the API as (default compute SA unless the
# service was deployed with a custom one).
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

echo "Enabling Cloud Tasks API..."
gcloud services enable cloudtasks.googleapis.com --project="$PROJECT_ID"

echo "Creating invoker service account ${INVOKER_SA} (idempotent)..."
gcloud iam service-accounts create scan-tasks-invoker \
  --project="$PROJECT_ID" \
  --display-name="Cloud Tasks → scan-jobs internal endpoint invoker" \
  2>/dev/null || echo "  already exists"

echo "Granting the API runtime SA (${RUNTIME_SA}) permission to enqueue tasks..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/cloudtasks.enqueuer" \
  --condition=None >/dev/null

echo "Granting the runtime SA permission to mint OIDC tokens as ${INVOKER_SA}..."
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${RUNTIME_SA}" \
  --role="roles/iam.serviceAccountUser" >/dev/null

cat <<EOF

Done. Notes:
 - The API verifies the OIDC token itself (audience + email check in
   routes/internal/scanJobs.js); the Cloud Run service stays
   --allow-unauthenticated, so no roles/run.invoker grant is needed.
 - Environment consumed by the API (set in cloudbuild.yaml deploy step):
     SCAN_TASKS_QUEUE=projects/${PROJECT_ID}/locations/us-central1/queues/scan-jobs
     SCAN_TASKS_TARGET_BASE_URL=<the API's public URL>
     SCAN_TASKS_SERVICE_ACCOUNT=${INVOKER_SA}
 - Local dev needs none of this: without SCAN_TASKS_* configured, jobs
   process inline in the API process.
EOF
