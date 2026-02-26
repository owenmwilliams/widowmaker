# Google Maps API Key Issue - Production Environment

## Problem Summary

**Issue**: Google Maps JavaScript API showing `InvalidKeyMapError` in production environment. The API key appears as the literal string `$GOOGLE_MAPS_API_KEY` instead of the actual key value.

**Error Message**:
```
Google Maps JavaScript API error: InvalidKeyMapError
js?key=$GOOGLE_MAPS_API_KEY&loading=async&libraries=places,marker&v=weekly:919
```

**Environment**:
- Production: Google Cloud Run (movetrack-app service)
- Build System: Google Cloud Build with Docker multi-stage builds
- Frontend: Vue.js + Vite
- Deployment: Automated via GitHub webhook trigger

---

## Root Cause Analysis

The Google Maps API key needs to be injected during the **Vite build process** (not at runtime) because Vite bundles environment variables into the JavaScript at build time using `import.meta.env.VITE_*` pattern.

### Build Flow:
1. Cloud Build triggers on git push to main branch
2. Docker builds the frontend app using multi-stage build
3. Vite build process needs `VITE_GOOGLE_MAPS_API_KEY` environment variable
4. Built static files are served by nginx in production
5. **Problem**: The environment variable is not being properly passed through this chain

---

## Environment & Configuration

### Secret Storage
- **Location**: GCP Secret Manager
- **Secret Name**: `GOOGLE_MAPS_API_KEY`
- **Project**: `widowmaker-477505`
- **Value**: Contains actual Google Maps API key (confirmed exists)

### IAM Permissions
- **Cloud Build Service Account**: `203537990119@cloudbuild.gserviceaccount.com`
- **Granted Role**: `roles/secretmanager.secretAccessor` on `GOOGLE_MAPS_API_KEY` secret
- **Verified**: Permission successfully added on 2025-11-29

### Cloud Build Trigger
- **Name**: `movetrack-deploy`
- **ID**: `f4cb4bc8-9f89-4581-838d-ff91dae9e207`
- **Source**: GitHub `owenmwilliams/widowmaker` (main branch)
- **Config File**: `cloudbuild.yaml`
- **Service Account**: Uses Compute Engine default service account (not Cloud Build service account) - **This may be part of the problem**

---

## Current Configuration

### cloudbuild.yaml (relevant section)
```yaml
  # Build Frontend Docker image
  - name: 'gcr.io/cloud-builders/docker'
    args:
      - 'build'
      - '--no-cache'
      - '--build-arg'
      - 'VITE_API_BASE_URL=https:/movetrack-api-7hwn7ggbiq-uc.a.run.app'
      - '--build-arg'
      - 'VITE_GOOGLE_MAPS_API_KEY=$$GOOGLE_MAPS_API_KEY'  # Double $$ to escape
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/movetrack-repomovetrack-app:$COMMIT_SHA'
      - '-t'
      - 'us-central1-docker.pkg.dev/$PROJECT_ID/movetrack-repomovetrack-app:latest'
      - './movetrack-app'
    secretEnv: ['GOOGLE_MAPS_API_KEY']
    id: 'build-app'

# ...

availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/GOOGLE_MAPS_API_KEY/versions/latest
      env: 'GOOGLE_MAPS_API_KEY'
```

### movetrack-app/Dockerfile (relevant section)
```dockerfile
# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Accept build arguments for environment variables
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_MAPS_API_KEY

# Export as environment variables for Vite build
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html
# ...
```

### Local Development (.env file) - WORKS CORRECTLY
```env
VITE_API_BASE_URL=http://localhost:3050
VITE_GOOGLE_MAPS_API_KEY=<REDACTED>
```

**Note**: `.env` file is excluded from Docker builds via `.dockerignore` (intentionally, for security)

---

## Attempted Solutions

### ✅ Solution 1: Added Build Arguments to Dockerfile
**Date**: 2025-11-29
**Files Modified**: `movetrack-app/Dockerfile`

Added `ARG` and `ENV` directives to accept and export build arguments:
```dockerfile
ARG VITE_API_BASE_URL
ARG VITE_GOOGLE_MAPS_API_KEY

ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
```

**Result**: Build succeeds, but API key still shows as `$GOOGLE_MAPS_API_KEY`

---

### ✅ Solution 2: Configured Cloud Build to Pass Build Args
**Date**: 2025-11-29
**Files Modified**: `cloudbuild.yaml`

Added build arguments to Docker build step:
```yaml
- '--build-arg'
- 'VITE_GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY'
```

Added secret configuration:
```yaml
secretEnv: ['GOOGLE_MAPS_API_KEY']

availableSecrets:
  secretManager:
    - versionName: projects/$PROJECT_ID/secrets/GOOGLE_MAPS_API_KEY/versions/latest
      env: 'GOOGLE_MAPS_API_KEY'
```

**Result**: Build FAILED with error:
```
generic::invalid_argument: invalid value for 'build.substitutions':
key in the template "GOOGLE_MAPS_API_KEY" is not a valid built-in substitution
```

---

### ✅ Solution 3: Fixed Environment Variable Escaping
**Date**: 2025-11-29
**Files Modified**: `cloudbuild.yaml`

Changed from single `$` to double `$$` to prevent Cloud Build from treating it as a substitution variable:
```yaml
- 'VITE_GOOGLE_MAPS_API_KEY=$$GOOGLE_MAPS_API_KEY'
```

**Reason**: Cloud Build substitution variables must start with `_` (like `$_DB_NAME`). Using `$$` escapes the first `$` so Cloud Build passes `$GOOGLE_MAPS_API_KEY` to Docker, which then expands it from the environment.

**Result**: Build SUCCEEDS (Build ID: `7847279d-9dce-46de-a821-933526fef187`), but API key still shows as literal `$GOOGLE_MAPS_API_KEY` in production

---

### ✅ Solution 4: Granted Cloud Build Service Account Access to Secret
**Date**: 2025-11-29
**Command Executed**:
```bash
gcloud secrets add-iam-policy-binding GOOGLE_MAPS_API_KEY \
  --project=widowmaker-477505 \
  --member="serviceAccount:203537990119@cloudbuild.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Verification**:
```bash
gcloud secrets get-iam-policy GOOGLE_MAPS_API_KEY --project=widowmaker-477505
```

**Output**:
```yaml
bindings:
- members:
  - serviceAccount:203537990119-compute@developer.gserviceaccount.com
  - serviceAccount:203537990119@cloudbuild.gserviceaccount.com
  role: roles/secretmanager.secretAccessor
```

**Result**: Build succeeds, but API key still shows as `$GOOGLE_MAPS_API_KEY`

---

### ✅ Solution 5: Fixed Frontend API Endpoint Calls
**Date**: 2025-11-29
**Files Modified**: `movetrack-app/src/components/desktop/DesktopMovePlanning.vue`

**Issue**: Frontend was using relative URL `/api/calculate-distance` which resolved to the APP service instead of API service, causing 405 errors.

**Fix Applied** (line 966):
```javascript
// BEFORE:
const response = await fetch('/api/calculate-distance', {

// AFTER:
const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/calculate-distance`, {
```

**Result**: ✅ API endpoint calls now work correctly. This fix is unrelated to the Maps API key issue.

---

## Current Status

### What Works
- ✅ Build completes successfully without errors
- ✅ Application deploys to Cloud Run
- ✅ API endpoint calls work (using `VITE_API_BASE_URL`)
- ✅ Cloud Build has permission to access the secret
- ✅ Secret exists in Secret Manager with correct value
- ✅ Local development works perfectly with `.env` file

### What Doesn't Work
- ❌ Google Maps API key shows as literal `$GOOGLE_MAPS_API_KEY` in production
- ❌ Maps integration fails with `InvalidKeyMapError`

### Evidence of Failure
**Production URL Check**:
```bash
curl -s https:/movetrack-app-7hwn7ggbiq-uc.a.run.app | grep -o 'js?key=[^"&]*'
```
**Output**:
```
js?key=$GOOGLE_MAPS_API_KEY
```

**Expected**:
```
js?key=<REDACTED>
```

---

## Debugging Questions / Potential Issues

### 1. Service Account Mismatch?
The Cloud Build **trigger** is using the Compute Engine default service account (`203537990119-compute@developer.gserviceaccount.com`), not the Cloud Build service account (`203537990119@cloudbuild.gserviceaccount.com`).

**Question**: Does the trigger's service account need the secret access, or the build's service account?

**Evidence**:
```bash
gcloud builds triggers describe movetrack-deploy
```
```yaml
serviceAccount: projects/widowmaker-477505/serviceAccounts/203537990119-compute@developer.gserviceaccount.com
```

### 2. Secret Environment Variable Not Being Set?
When Cloud Build declares `secretEnv: ['GOOGLE_MAPS_API_KEY']`, it should:
1. Fetch the secret from Secret Manager
2. Set it as an environment variable in the build step
3. Docker build should receive it via `--build-arg`

**Question**: Is the environment variable actually being set during the build? How can we verify?

**Potential Test**: Add a debug step to cloudbuild.yaml:
```yaml
- name: 'gcr.io/google.com/cloudsdktool/cloud-sdk'
  entrypoint: 'sh'
  args:
    - '-c'
    - 'echo "GOOGLE_MAPS_API_KEY value: $GOOGLE_MAPS_API_KEY"'
  secretEnv: ['GOOGLE_MAPS_API_KEY']
```

### 3. Docker Build Arg Not Being Passed Through?
The syntax `--build-arg 'VITE_GOOGLE_MAPS_API_KEY=$$GOOGLE_MAPS_API_KEY'` should:
1. Cloud Build sees `$$` and escapes it to single `$`
2. Passes `VITE_GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY` to docker
3. Docker expands `$GOOGLE_MAPS_API_KEY` from its environment

**Question**: Is Docker actually receiving the environment variable to expand?

**Potential Test**: Build locally with:
```bash
export GOOGLE_MAPS_API_KEY="test-key"
docker build --build-arg VITE_GOOGLE_MAPS_API_KEY=$GOOGLE_MAPS_API_KEY -t test ./movetrack-app
```

### 4. Vite Build Not Using Environment Variable?
The Vite build process should read `VITE_GOOGLE_MAPS_API_KEY` from environment and embed it in the built JavaScript.

**Question**: Does the Vite build process have access to the environment variable during the `RUN npm run build` step?

**Check**: Look at the actual built bundle to see if the key is embedded

### 5. Alternative: Use Runtime Configuration?
**Question**: Should we inject the API key at runtime instead of build time?

This would require:
- Serve a config endpoint from the API
- Frontend fetches config on startup
- More complex but avoids build-time secret injection

---

## Technical Notes

### Cloud Build Secret Substitution Rules
- Built-in substitutions: `$PROJECT_ID`, `$BUILD_ID`, `$COMMIT_SHA`, etc.
- Custom substitutions: Must start with `_` (e.g., `$_DB_NAME`)
- To use a `$` literally: Use `$$` (escapes to single `$`)
- `secretEnv` variables: Available as environment variables, not substitutions

### Docker ARG vs ENV
- `ARG`: Build-time only, available during `RUN` commands
- `ENV`: Persists in the built image, available at runtime
- For Vite: Need `ENV` to be available during `RUN npm run build`
- Multi-stage builds: ARG/ENV from builder stage don't persist to final stage

### Vite Environment Variables
- Pattern: `VITE_*` prefix required
- Access: `import.meta.env.VITE_*`
- Embedded at **build time** (not runtime)
- Replaced in code during build process
- Not available after build (static files only)

---

## Successful Build Logs Reference

**Latest Successful Build**: `7847279d-9dce-46de-a821-933526fef187`
**Status**: SUCCESS
**Date**: 2025-11-29 18:33 UTC
**Deployed**: Yes (movetrack-app-00054-jmr revision)

**View Build**:
```bash
gcloud builds describe 7847279d-9dce-46de-a821-933526fef187
```

---

## Related Files

### Configuration
- `<repo-root>/cloudbuild.yaml` (lines 15-30, 120-123)
- `<repo-root>/movetrack-app/Dockerfile` (lines 15-24)
- `<repo-root>/movetrack-app/.dockerignore` (excludes `.env`)

### Frontend Code
- `<repo-root>/movetrack-app/.env` (local development only)
- Any Vue component using Google Maps (references `import.meta.env.VITE_GOOGLE_MAPS_API_KEY`)

---

## Questions for Senior Dev

1. **Is our secret injection approach correct?** Using `secretEnv` + `--build-arg` + `$$` escaping?

2. **Should the Cloud Build trigger use a different service account?** Currently uses Compute Engine default instead of Cloud Build service account.

3. **How can we verify the environment variable is actually set during the Docker build?** Need debugging strategy.

4. **Is there a better pattern for injecting secrets into Vite builds?** Perhaps using Cloud Build substitution variables differently?

5. **Should we consider runtime configuration instead?** Inject API key via API call rather than build-time embedding?

6. **Could the issue be with how nginx serves the built files?** Is there some caching or configuration issue?

7. **Is there a way to inspect the actual Docker build process?** See what environment variables Docker sees during build?

---

## Reproduction Steps

### To Verify the Issue:
1. Visit: https:/movetrack-app-7hwn7ggbiq-uc.a.run.app
2. Open browser DevTools → Console
3. Observe error: `Google Maps JavaScript API error: InvalidKeyMapError`
4. Check Network tab → Look for Google Maps script URL
5. URL shows: `js?key=$GOOGLE_MAPS_API_KEY` (literal string, not actual key)

### To Trigger a Build:
1. Make any commit to main branch: `git commit --allow-empty -m "test build"`
2. Push: `git push`
3. Monitor: `gcloud builds list --limit=1`
4. Check deployment: `gcloud run revisions list --service=movetrack-app --region=us-central1`

### To Test Locally:
1. Ensure `.env` file exists with `VITE_GOOGLE_MAPS_API_KEY=<actual-key>`
2. Run: `npm run dev` in `movetrack-app/` directory
3. Maps work correctly in local development

---

## Contact Information

**Developer**: Owen Williams
**Date Reported**: 2025-11-29
**Priority**: High (blocks production Maps functionality)
**Assistant**: Claude Code (Anthropic)

---

## Appendix: Complete Build Configuration

See attached files:
- `cloudbuild.yaml` (full)
- `movetrack-app/Dockerfile` (full)
- `movetrack-app/vite.config.ts`
