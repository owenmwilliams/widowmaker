# Infra configuration (applied manually, tracked here)

## GCS bucket CORS — `movetrack-item-photos`

The company-capture page (`/c/{token}`) uploads video from the BROWSER
straight to GCS via signed PUT URLs (`mediaAssetService.reserveUpload`).
Browsers require the bucket to answer CORS preflights for that; native iOS
uploads never did, so the bucket shipped without a CORS policy and web
uploads failed ("Upload didn't go through").

Apply (Cloud Shell, after any origin change):

    gcloud storage buckets update gs://movetrack-item-photos --cors-file=infra/gcs-cors.json

Add new origins to `gcs-cors.json` when the web app gains a domain
(e.g. a custom domain). CORS here is browser plumbing, not authorization —
the signed URL remains the only thing that permits a write.
