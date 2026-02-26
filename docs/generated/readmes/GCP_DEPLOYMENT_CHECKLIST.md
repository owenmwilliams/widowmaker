# GCP Deployment Checklist - Fresh Environment Setup

This guide details every configuration change needed to deploy MoveTrack to a new Google Cloud Platform project.

## Prerequisites

- [ ] Google Cloud account with billing enabled
- [ ] `gcloud` CLI installed and authenticated
- [ ] GitHub repository created
- [ ] SendGrid account with API key
- [ ] Domain name (optional, for custom URLs)

---

## Part 1: GCP Project Setup

### 1.1 Create/Select GCP Project

```bash
# Set your NEW project ID
export PROJECT_ID="your-new-project-id"  # CHANGE THIS

# Create project (or use existing)
gcloud projects create $PROJECT_ID --name="MoveTrack Production"

# Set as active project
gcloud config set project $PROJECT_ID

# Enable billing (required for Cloud Run, Cloud SQL)
# Visit: https://console.cloud.google.com/billing/linkedaccount?project=$PROJECT_ID
```

### 1.2 Enable Required APIs

```bash
gcloud services enable \
  cloudbuild.googleapis.com \
  run.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  containerregistry.googleapis.com \
  compute.googleapis.com
```

**Time estimate:** 2-3 minutes

---

## Part 2: Database Setup (Cloud SQL PostgreSQL)

### 2.1 Create Cloud SQL Instance

```bash
# IMPORTANT: Change the password!
export DB_ROOT_PASSWORD="CHANGE_ME_TO_SECURE_PASSWORD"  # CHANGE THIS
export DB_USER_PASSWORD="CHANGE_ME_TO_SECURE_PASSWORD"  # CHANGE THIS

# Create instance (takes 5-10 minutes)
gcloud sql instances create movetrack-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --root-password=$DB_ROOT_PASSWORD

# Create database
gcloud sql databases create movetrack_db \
  --instance=movetrack-db

# Create user
gcloud sql users create movetrack_user \
  --instance=movetrack-db \
  --password=$DB_USER_PASSWORD

# Get connection name (save this!)
export CLOUD_SQL_CONNECTION=$(gcloud sql instances describe movetrack-db --format="value(connectionName)")
echo "Cloud SQL Connection: $CLOUD_SQL_CONNECTION"
```

**Save these values:**
- Root password: `$DB_ROOT_PASSWORD`
- User password: `$DB_USER_PASSWORD`
- Connection name: `$CLOUD_SQL_CONNECTION` (format: `project:region:instance`)

### 2.2 Run Database Migrations

```bash
# Install Cloud SQL Proxy
# macOS:
brew install cloud-sql-proxy
# Other: https://cloud.google.com/sql/docs/postgres/sql-proxy

# Start proxy in background
cloud-sql-proxy $CLOUD_SQL_CONNECTION &
PROXY_PID=$!

# Wait for proxy to start
sleep 5

# Run migrations
cd movetrack-api
MT_DATALAYER_HOSTNAME=localhost \
MT_DATALAYER_PORT=5432 \
MT_DATALAYER_DATABASE=movetrack_db \
MT_DATALAYER_USERNAME=movetrack_user \
MT_DATALAYER_PASSWORD=$DB_USER_PASSWORD \
node bin/migrate.js

# Kill proxy
kill $PROXY_PID
cd ..
```

**Time estimate:** 10-15 minutes

---

## Part 3: Secrets Management

### 3.1 Create Secrets in Secret Manager

```bash
# Database password
echo -n "$DB_USER_PASSWORD" | gcloud secrets create movetrack-db-password \
  --data-file=- \
  --replication-policy="automatic"

# JWT secret (generate strong random value)
JWT_SECRET=$(openssl rand -base64 32)
echo -n "$JWT_SECRET" | gcloud secrets create movetrack-jwt-secret \
  --data-file=- \
  --replication-policy="automatic"

# SendGrid API key
export SENDGRID_API_KEY="SG.xxxxxxxxxxxxxxxxx"  # CHANGE THIS - Get from SendGrid
echo -n "$SENDGRID_API_KEY" | gcloud secrets create sendgrid-api-key \
  --data-file=- \
  --replication-policy="automatic"

# OpenAI API key (for vision features)
export OPENAI_API_KEY="sk-xxxxxxxxxxxxxxxxx"  # CHANGE THIS - Get from OpenAI
echo -n "$OPENAI_API_KEY" | gcloud secrets create openai-api-key \
  --data-file=- \
  --replication-policy="automatic"

# Google Books API key (optional, for book lookups)
export GOOGLE_BOOKS_API_KEY="AIzaxxxxxxxxxxxxxxxxx"  # CHANGE THIS - Get from GCP Console
echo -n "$GOOGLE_BOOKS_API_KEY" | gcloud secrets create google-books-api-key \
  --data-file=- \
  --replication-policy="automatic"
```

### 3.2 Grant Cloud Run Access to Secrets

```bash
# Get project number
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')

# Grant access to default compute service account
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Time estimate:** 5 minutes

---

## Part 4: Code Configuration Changes

### 4.1 Update cloudbuild.yaml

**File:** `/cloudbuild.yaml`

**Line 90:** Change substitution variable to match your project:
```yaml
substitutions:
  _CLOUD_SQL_CONNECTION: 'YOUR-PROJECT-ID:us-central1:movetrack-db'  # CHANGE THIS
  _DB_NAME: 'movetrack_db'
  _DB_USER: 'movetrack_user'
```

**Example:**
```yaml
substitutions:
  _CLOUD_SQL_CONNECTION: 'movetrack-prod-2025:us-central1:movetrack-db'
  _DB_NAME: 'movetrack_db'
  _DB_USER: 'movetrack_user'
```

### 4.2 Add Vision API Secrets to Cloud Build

**File:** `/cloudbuild.yaml`

**Line 60:** Update secrets list to include vision APIs:
```yaml
- '--set-secrets'
- 'MT_DATALAYER_PASSWORD=movetrack-db-password:latest,JWT_SECRET=movetrack-jwt-secret:latest,SMTP_PASS=sendgrid-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,GOOGLE_BOOKS_API_KEY=google-books-api-key:latest'
```

### 4.3 Update Frontend API URL

**CRITICAL:** The frontend needs to know your production API URL. This must be updated AFTER the first deployment.

**Files to update (all have same pattern):**

1. `movetrack-app/src/components/Login.vue` (line 16)
2. `movetrack-app/src/stores/InventoryStore.ts` (line 8)
3. `movetrack-app/src/components/Items.vue` (line 12)
4. `movetrack-app/src/components/Profile.vue` (line 10)
5. `movetrack-app/src/components/mobile/PhotoAdd.vue` (line 15)
6. `movetrack-app/src/components/mobile/BookcaseAdd.vue` (line 10)
7. And 6 more files (see list below)

**Current code:**
```typescript
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://api-endpoint.take-stock.app';
```

**Change to:**
```typescript
const core_url = import.meta.env.MODE == 'development' ? 'http://localhost:3050' : 'https://YOUR-API-URL.run.app';
```

**Full list of files with `core_url`:**
- movetrack-app/src/stores/InventoryStore.ts
- movetrack-app/src/components/mobile/PhotoAdd.vue
- movetrack-app/src/components/mobile/BookcaseAdd.vue
- movetrack-app/src/components/Profile.vue
- movetrack-app/src/components/Items.vue
- movetrack-app/src/components/mobile/MobileItems.vue
- movetrack-app/src/components/Login.vue
- movetrack-app/src/main.ts
- movetrack-app/src/components/desktop/DesktopItemTable.vue
- movetrack-app/src/components/home_components/DesktopEmail.vue
- movetrack-app/src/compositions/user-check.ts
- movetrack-app/src/components/home_components/MobileSignup.vue
- movetrack-app/src/components/home_components/DesktopSignup.vue

**⚠️ WORKFLOW:** You'll update these AFTER your first deployment in Part 6.

### 4.4 Update CORS Configuration

**File:** `movetrack-api/app.js`

After deployment, you'll need to add your Cloud Run URLs to CORS.

**Find this section (around line 40):**
```javascript
var corsOptions = {
  origin: [
    'http://localhost:4050',
    'http://localhost:5173',
    // ADD YOUR CLOUD RUN URLs HERE
  ],
  credentials: true,
  optionsSuccessStatus: 200
}
```

**Add your production URLs:**
```javascript
var corsOptions = {
  origin: [
    'http://localhost:4050',
    'http://localhost:5173',
    'https:/movetrack-app-xxxxxxxxx-uc.a.run.app',  // Your frontend URL
    'https://your-custom-domain.com',                 // If using custom domain
  ],
  credentials: true,
  optionsSuccessStatus: 200
}
```

### 4.5 Update SendGrid Email Configuration

**File:** `movetrack-api/routes/auth.js` (around line 90)

**Change the email sender and magic link domain:**
```javascript
// Line ~90
from: 'noreply@your-domain.com',  // CHANGE THIS

// Line ~95 (magic link URL)
const magicLink = `https://your-frontend-url.run.app/login?token=${token}`;  // CHANGE THIS
```

**Time estimate:** 15-20 minutes (coding changes)

---

## Part 5: GitHub Repository Setup

### 5.1 Connect GitHub to Cloud Build

1. Visit Cloud Build Triggers: https://console.cloud.google.com/cloud-build/triggers
2. Click **"Connect Repository"**
3. Select **GitHub** as source
4. Authenticate with GitHub
5. Select your repository
6. Click **"Connect"**

### 5.2 Create Cloud Build Trigger

1. Click **"Create Trigger"**
2. Configure:
   - **Name:** `movetrack-deploy`
   - **Event:** Push to branch
   - **Branch:** `^main$` (or `^master$`)
   - **Configuration:** Cloud Build configuration file
   - **Location:** `/cloudbuild.yaml`

3. Add substitution variables:
   - Click **"Show Included"** under **"Substitution variables"**
   - Add variables:
     - `_CLOUD_SQL_CONNECTION`: Your connection name from Part 2.1
     - `_DB_NAME`: `movetrack_db`
     - `_DB_USER`: `movetrack_user`

4. Click **"Create"**

**Time estimate:** 10 minutes

---

## Part 6: First Deployment

### 6.1 Deploy Manually (First Time)

```bash
# From project root
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_CLOUD_SQL_CONNECTION=$CLOUD_SQL_CONNECTION,_DB_NAME=movetrack_db,_DB_USER=movetrack_user
```

**This will:**
- Build Docker images for API and frontend
- Push to Container Registry
- Deploy to Cloud Run
- Takes 10-15 minutes

### 6.2 Get Your Cloud Run URLs

```bash
# Get API URL
export API_URL=$(gcloud run services describe movetrack-api --region=us-central1 --format="value(status.url)")
echo "API URL: $API_URL"

# Get Frontend URL
export FRONTEND_URL=$(gcloud run services describe movetrack-app --region=us-central1 --format="value(status.url)")
echo "Frontend URL: $FRONTEND_URL"
```

**Save these URLs!**

### 6.3 Update Code with Production URLs

Now go back to Part 4.3 and 4.4:

1. **Update all `core_url` references** in the frontend files with your `$API_URL`
2. **Update CORS in `app.js`** with your `$FRONTEND_URL`
3. **Update email configuration** with your `$FRONTEND_URL`

### 6.4 Commit and Push (Triggers Auto-Deployment)

```bash
git add .
git commit -m "Configure production URLs for GCP deployment"
git push origin main
```

This will trigger Cloud Build automatically. Monitor at:
https://console.cloud.google.com/cloud-build/builds

**Time estimate:** 20-30 minutes

---

## Part 7: Post-Deployment Configuration

### 7.1 Test the Application

1. Visit your frontend URL: `$FRONTEND_URL`
2. Try to create an account (test email delivery)
3. Check magic link email
4. Log in and test features

### 7.2 Configure Custom Domain (Optional)

```bash
# Map domain to frontend
gcloud run domain-mappings create \
  --service=movetrack-app \
  --domain=app.your-domain.com \
  --region=us-central1

# Map domain to API
gcloud run domain-mappings create \
  --service=movetrack-api \
  --domain=api.your-domain.com \
  --region=us-central1
```

Then add DNS records shown in output to your registrar.

After custom domain is set up, update all URLs in Part 4.3 and 4.4 again.

### 7.3 Set Up Cloud SQL Backups

```bash
# Enable automated backups
gcloud sql instances patch movetrack-db \
  --backup-start-time=03:00 \
  --enable-bin-log
```

### 7.4 Set Up Monitoring & Alerts

1. Visit Cloud Console Monitoring: https://console.cloud.google.com/monitoring
2. Create alert for:
   - Cloud Run error rate > 5%
   - Cloud SQL CPU > 80%
   - Cloud Run instance count

---

## Part 8: Vision API Setup (Optional but Recommended)

### 8.1 Google Cloud Vision API

```bash
# Enable Vision API
gcloud services enable vision.googleapis.com

# Create service account
gcloud iam service-accounts create vision-api-sa \
  --display-name="Vision API Service Account"

# Grant permissions
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:vision-api-sa@$PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/cloudvision.admin"

# Create key (download JSON)
gcloud iam service-accounts keys create vision-api-key.json \
  --iam-account=vision-api-sa@$PROJECT_ID.iam.gserviceaccount.com

# Store in Secret Manager
gcloud secrets create google-vision-credentials \
  --data-file=vision-api-key.json \
  --replication-policy="automatic"
```

### 8.2 Update Cloud Build to Include Vision Credentials

**File:** `/cloudbuild.yaml` line 60:
```yaml
- '--set-secrets'
- 'MT_DATALAYER_PASSWORD=movetrack-db-password:latest,JWT_SECRET=movetrack-jwt-secret:latest,SMTP_PASS=sendgrid-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,GOOGLE_VISION_CREDENTIALS=google-vision-credentials:latest'
```

---

## Quick Reference: All Values You Need to Change

| Item | Location | What to Change |
|------|----------|----------------|
| **Project ID** | All gcloud commands | `your-project-id` |
| **Cloud SQL Connection** | cloudbuild.yaml:90 | `your-project:us-central1:movetrack-db` |
| **DB Root Password** | Part 2.1 | Strong password |
| **DB User Password** | Part 2.1 | Strong password |
| **SendGrid API Key** | Part 3.1 | Get from SendGrid |
| **OpenAI API Key** | Part 3.1 | Get from OpenAI |
| **API URL** | 13 frontend files | After first deploy |
| **Frontend URL** | app.js CORS + email | After first deploy |
| **Email Sender** | routes/auth.js | `noreply@your-domain.com` |

---

## Troubleshooting

### Build Fails

```bash
# Check build logs
gcloud builds list --limit=1
gcloud builds log <BUILD_ID>
```

### Database Connection Fails

```bash
# Verify Cloud SQL is running
gcloud sql instances describe movetrack-db

# Test connection via proxy
cloud-sql-proxy $CLOUD_SQL_CONNECTION
psql "host=127.0.0.1 user=movetrack_user dbname=movetrack_db"
```

### Secrets Not Found

```bash
# List all secrets
gcloud secrets list

# Verify IAM permissions
gcloud projects get-iam-policy $PROJECT_ID
```

### CORS Errors

- Ensure frontend URL is in app.js CORS config
- Redeploy API after CORS changes
- Clear browser cache

---

## Estimated Total Time

- **Initial setup:** 1-2 hours
- **First deployment:** 30 minutes
- **Testing & refinement:** 30-60 minutes
- **Total:** 2-4 hours

---

## Next Steps After Deployment

1. Set up monitoring dashboards
2. Configure log exports to BigQuery (for analytics)
3. Set up staging environment
4. Configure CDN for frontend assets
5. Implement rate limiting
6. Set up automated testing pipeline

---

## Cost Estimates (Monthly)

- **Cloud Run** (low traffic): $0-5
- **Cloud SQL** (db-f1-micro): ~$10
- **Container Registry**: ~$1
- **Secret Manager**: ~$0.10
- **Cloud Build**: $0 (120 min/day free tier)

**Total:** ~$10-15/month for low traffic

---

## Support

If you encounter issues:
1. Check [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guides
2. Review Cloud Build logs
3. Check Cloud Run logs: `gcloud run services logs read movetrack-api --region=us-central1`
