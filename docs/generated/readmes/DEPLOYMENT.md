# MoveTrack GCP Deployment Guide

This guide walks you through deploying MoveTrack to Google Cloud Platform using Cloud Run.

## Prerequisites

1. **GCP Account** with billing enabled
2. **gcloud CLI** installed ([Install Guide](https://cloud.google.com/sdk/docs/install))
3. **GitHub Repository** for your code
4. **SendGrid Account** for email delivery

## Step 1: Set Up GCP Project

```bash
# Set your project ID
export PROJECT_ID="your-project-id"

# Set the project
gcloud config set project $PROJECT_ID

# Enable required APIs
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com
```

## Step 2: Create Cloud SQL PostgreSQL Instance

```bash
# Create the instance (this takes ~5-10 minutes)
gcloud sql instances create movetrack-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --root-password=CHANGE_THIS_PASSWORD

# Create the database
gcloud sql databases create movetrack_db \
  --instance=movetrack-db

# Create the user
gcloud sql users create movetrack_user \
  --instance=movetrack-db \
  --password=CHANGE_THIS_PASSWORD

# Get the connection name (save this!)
gcloud sql instances describe movetrack-db --format="value(connectionName)"
```

## Step 3: Run Database Migrations

```bash
# Connect to Cloud SQL via proxy
cloud_sql_proxy -instances=YOUR_CONNECTION_NAME=tcp:5432

# In a new terminal, run migrations
cd movetrack-api
MT_DATALAYER_HOSTNAME=localhost \
MT_DATALAYER_PORT=5432 \
MT_DATALAYER_DATABASE=movetrack_db \
MT_DATALAYER_USERNAME=movetrack_user \
MT_DATALAYER_PASSWORD=YOUR_PASSWORD \
node bin/migrate.js
```

## Step 4: Store Secrets in Secret Manager

```bash
# Database password
echo -n "YOUR_DB_PASSWORD" | gcloud secrets create movetrack-db-password \
  --data-file=- \
  --replication-policy="automatic"

# JWT Secret (generate a strong random string)
echo -n "$(openssl rand -base64 32)" | gcloud secrets create movetrack-jwt-secret \
  --data-file=- \
  --replication-policy="automatic"

# SendGrid API Key
echo -n "YOUR_SENDGRID_API_KEY" | gcloud secrets create sendgrid-api-key \
  --data-file=- \
  --replication-policy="automatic"

# Grant Cloud Run access to secrets
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## Step 5: Set Up Cloud Build Trigger

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers)
2. Click "Connect Repository" and connect your GitHub repo
3. Create a new trigger:
   - **Name**: `movetrack-deploy`
   - **Event**: Push to branch
   - **Branch**: `^main$`
   - **Configuration**: Cloud Build configuration file
   - **Location**: `/cloudbuild.yaml`

4. Add substitution variables:
   - `_CLOUD_SQL_CONNECTION`: Your connection name from Step 2
   - `_DB_NAME`: `movetrack_db`
   - `_DB_USER`: `movetrack_user`

## Step 6: Update Frontend Environment Variables

The frontend needs to know the API URL. After deploying the API, update the frontend:

1. Get your API URL:
```bash
gcloud run services describe movetrack-api --region=us-central1 --format="value(status.url)"
```

2. Update `movetrack-app/src/components/Login.vue` and other files that reference `core_url`:
```typescript
const core_url = import.meta.env.MODE == 'development'
  ? 'http://localhost:3050'
  : 'https://YOUR-API-URL.run.app';
```

## Step 7: Deploy

### Option A: Deploy via Git Push (Recommended)
```bash
git add .
git commit -m "Add deployment configuration"
git push origin main
```

Cloud Build will automatically build and deploy both services.

### Option B: Manual Deploy
```bash
# Build and deploy manually
gcloud builds submit --config=cloudbuild.yaml
```

## Step 8: Configure Custom Domain (Optional)

```bash
# Map custom domain to frontend
gcloud run domain-mappings create \
  --service=movetrack-app \
  --domain=www.yourdomain.com \
  --region=us-central1

# Map custom domain to API
gcloud run domain-mappings create \
  --service=movetrack-api \
  --domain=api.yourdomain.com \
  --region=us-central1
```

Then add the DNS records shown in the output to your domain registrar.

## Step 9: Update CORS Settings

Update `movetrack-api/app.js` to include your production URLs:

```javascript
var corsOptions = {
  origin: [
    'http://localhost:4050',
    'http://localhost:5173',
    'https://www.yourdomain.com',
    'https://yourdomain.com',
    'https:/movetrack-app-XXXXX.run.app' // Your Cloud Run URL
  ],
  credentials: true,
  optionsSuccessStatus: 200
}
```

## Monitoring and Logs

```bash
# View API logs
gcloud run services logs read movetrack-api --region=us-central1

# View Frontend logs
gcloud run services logs read movetrack-app --region=us-central1

# Monitor Cloud Build
gcloud builds list --limit=10
```

## Cost Optimization

- **Cloud Run**: Free tier includes 2 million requests/month
- **Cloud SQL**: Consider stopping instance when not in use (dev/staging)
- **Container Registry**: Set up lifecycle policies to delete old images

```bash
# Stop Cloud SQL instance (dev/staging only!)
gcloud sql instances patch movetrack-db --activation-policy=NEVER

# Start it again when needed
gcloud sql instances patch movetrack-db --activation-policy=ALWAYS
```

## Troubleshooting

### Database Connection Issues
```bash
# Check Cloud SQL instance status
gcloud sql instances describe movetrack-db

# Test connection
gcloud sql connect movetrack-db --user=movetrack_user --database=movetrack_db
```

### Secrets Not Working
```bash
# List secrets
gcloud secrets list

# Check IAM permissions
gcloud projects get-iam-policy $PROJECT_ID
```

### Build Failures
```bash
# Check build logs
gcloud builds list --limit=1 --format="value(id)"
gcloud builds log BUILD_ID
```

## Environment Variables Reference

### API (Cloud Run)
- `NODE_ENV`: `production`
- `MT_DATALAYER_HOSTNAME`: `/cloudsql/YOUR_CONNECTION_NAME`
- `MT_DATALAYER_PORT`: `5432`
- `MT_DATALAYER_DATABASE`: `movetrack_db`
- `MT_DATALAYER_USERNAME`: `movetrack_user`
- `MT_DATALAYER_PASSWORD`: (from Secret Manager)
- `JWT_SECRET`: (from Secret Manager)
- `SMTP_HOST`: `smtp.sendgrid.net`
- `SMTP_PORT`: `587`
- `SMTP_USER`: `apikey`
- `SMTP_PASS`: (from Secret Manager)
- `EMAIL_FROM`: `noreply@yourdomain.com`
- `PORT`: `8080`

## Security Checklist

- [ ] Changed all default passwords
- [ ] Generated strong JWT secret
- [ ] Configured SendGrid API key
- [ ] Set up CORS with production URLs only
- [ ] Enabled Cloud Armor (optional, for DDoS protection)
- [ ] Set up Cloud CDN (optional, for frontend caching)
- [ ] Configure SSL certificates (automatic with Cloud Run)
- [ ] Review IAM permissions

## Next Steps

1. Set up monitoring and alerting
2. Configure automatic backups for Cloud SQL
3. Set up a staging environment
4. Implement CI/CD testing pipeline
5. Configure Cloud CDN for better performance
