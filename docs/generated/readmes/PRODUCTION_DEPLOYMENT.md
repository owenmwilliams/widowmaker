# Nexus Moves Production Deployment Guide

Complete guide for deploying Nexus Moves with Vision AI to production.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [API Key Setup](#api-key-setup)
3. [Backend Deployment](#backend-deployment)
4. [Frontend Deployment](#frontend-deployment)
5. [Environment Configuration](#environment-configuration)
6. [Testing](#testing)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- Google Cloud Platform account with billing enabled
- Cloud SQL PostgreSQL instance configured
- Cloud Run enabled in your GCP project
- Domain name configured (optional but recommended)
- Git repository with latest code

---

## API Key Setup

Nexus Moves supports three vision AI providers. You can configure one, two, or all three depending on your needs.

### 1. Google Gemini (Recommended for MVP)

**Why Choose Gemini:**
- ✅ Free tier: 15 requests/min, 1M tokens/day
- ✅ Fastest response time
- ✅ Good accuracy for most use cases
- ✅ No credit card required for free tier

**Setup Steps:**
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Get API Key"** or **"Create API Key"**
4. Select your project (or create a new one)
5. Copy the generated API key
6. Save as environment variable: `GOOGLE_AI_API_KEY`

**Cost:** FREE for development, ~$0.00-0.003 per image in production

---

### 2. Anthropic Claude 3.5 Sonnet (Best Accuracy)

**Why Choose Claude:**
- ✅ Highest accuracy for complex items
- ✅ Best at understanding context and details
- ✅ Superior reasoning capabilities
- ❌ No free tier

**Setup Steps:**
1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Create an account (requires email verification)
3. Navigate to **API Keys** section
4. Click **"Create Key"**
5. Give it a descriptive name (e.g., "Nexus Moves Production")
6. Copy the generated key (you won't see it again!)
7. Save as environment variable: `ANTHROPIC_API_KEY`

**Cost:** ~$0.005-0.015 per image

**Billing Setup:**
- Add payment method in Anthropic Console
- Set usage limits to prevent overcharges
- Monitor usage in the Console dashboard

---

### 3. OpenAI GPT-4o (Well-Rounded)

**Why Choose GPT-4:**
- ✅ Well-known and trusted platform
- ✅ Good balance of speed and accuracy
- ✅ Extensive documentation
- ❌ No free tier

**Setup Steps:**
1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign in or create an account
3. Navigate to **API Keys** (left sidebar)
4. Click **"Create new secret key"**
5. Give it a name (e.g., "Nexus Moves Production")
6. Copy the key immediately (you won't see it again!)
7. Save as environment variable: `OPENAI_API_KEY`

**Cost:** ~$0.01-0.03 per image

**Billing Setup:**
- Add payment method in OpenAI account settings
- Set monthly usage limits
- Enable email notifications for usage thresholds

---

## Backend Deployment (Google Cloud Run)

### Step 1: Configure Environment Variables

Create a `.env.production` file in `movetrack-api/`:

```bash
# Database Configuration
MT_DATALAYER_HOSTNAME=/cloudsql/YOUR-PROJECT-ID:REGION:INSTANCE-NAME
MT_DATALAYER_PORT=5432
MT_DATALAYER_DATABASE=movetrack_db
MT_DATALAYER_USERNAME=movetrack_user
MT_DATALAYER_PASSWORD=your-secure-password

# Application Settings
NODE_ENV=production
PORT=8080

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRY=7d

# SendGrid Email (for magic links)
SENDGRID_API_KEY=your-sendgrid-api-key
SENDER_EMAIL=owen@we3kings.dev

# Vision AI Configuration
VISION_PROVIDER=gemini

# API Keys (add the ones you want to use)
GOOGLE_AI_API_KEY=your-google-ai-api-key-here
ANTHROPIC_API_KEY=your-anthropic-api-key-here
OPENAI_API_KEY=your-openai-api-key-here
```

### Step 2: Build and Deploy Backend

```bash
cd movetrack-api

# Build the container
gcloud builds submit --tag gcr.io/YOUR-PROJECT-IDmovetrack-api

# Deploy to Cloud Run
gcloud run deploy movetrack-api \
  --image gcr.io/YOUR-PROJECT-IDmovetrack-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --add-cloudsql-instances YOUR-PROJECT-ID:REGION:INSTANCE-NAME \
  --set-env-vars NODE_ENV=production,VISION_PROVIDER=gemini \
  --set-secrets GOOGLE_AI_API_KEY=google-ai-key:latest,ANTHROPIC_API_KEY=anthropic-key:latest,OPENAI_API_KEY=openai-key:latest
```

**Important:** Store API keys in Google Cloud Secret Manager, not directly in environment variables!

### Step 3: Set up Secret Manager (Recommended)

```bash
# Create secrets for each API key
echo -n "your-google-ai-api-key" | gcloud secrets create google-ai-key --data-file=-
echo -n "your-anthropic-api-key" | gcloud secrets create anthropic-key --data-file=-
echo -n "your-openai-api-key" | gcloud secrets create openai-key --data-file=-

# Grant Cloud Run access to secrets
gcloud secrets add-iam-policy-binding google-ai-key \
  --member=serviceAccount:YOUR-SERVICE-ACCOUNT@PROJECT-ID.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

---

## Frontend Deployment (Google Cloud Run)

### Step 1: Configure Frontend Environment

Update `movetrack-app/.env.production`:

```bash
VITE_MODE=production
VITE_API_URL=https://your-backend-url.run.app
```

### Step 2: Build and Deploy Frontend

```bash
cd movetrack-app

# Build for production
npm run build

# Deploy to Cloud Run
gcloud builds submit --tag gcr.io/YOUR-PROJECT-IDmovetrack-app

gcloud run deploy movetrack-app \
  --image gcr.io/YOUR-PROJECT-IDmovetrack-app \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

---

## Environment Configuration

### Choosing Your Default Provider

Set `VISION_PROVIDER` in your backend `.env`:

**For Development/Testing:**
```bash
VISION_PROVIDER=gemini  # Use free tier
```

**For Production (Low Volume < 1000 images/day):**
```bash
VISION_PROVIDER=gemini  # Cost-effective, still good quality
```

**For Production (High Accuracy Required):**
```bash
VISION_PROVIDER=claude  # Best results, higher cost
```

**For Production (Enterprise - Let Users Choose):**
```bash
VISION_PROVIDER=gemini  # Default fallback
# Configure all three API keys
# Users can switch providers in the UI
```

### Multi-Provider Strategy

**Recommended Setup:**
1. **Primary:** Gemini (free/low cost)
2. **Fallback:** Claude or GPT-4 (if Gemini quota exceeded)
3. **User Choice:** Allow authenticated users to select preferred provider

---

## Testing

### 1. Test Vision Endpoints Locally

```bash
# Start backend locally
cd movetrack-api
npm start

# Test with curl (requires valid session token)
curl -X POST http://localhost:3050/vision/analyze-item \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -F "image=@test-image.jpg"
```

### 2. Test Each Provider

```bash
# Test Gemini
curl -X POST http://localhost:3050/vision/analyze-item?provider=gemini \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -F "image=@test-image.jpg"

# Test Claude
curl -X POST http://localhost:3050/vision/analyze-item?provider=claude \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -F "image=@test-image.jpg"

# Test GPT-4
curl -X POST http://localhost:3050/vision/analyze-item?provider=gpt4 \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -F "image=@test-image.jpg"
```

### 3. End-to-End Testing

1. Deploy to Cloud Run staging environment
2. Create a test user account
3. Log in and navigate to Items page
4. Open Vision AI Settings from menu
5. Test switching between providers
6. Take a test photo of an item
7. Verify AI correctly identifies the item
8. Check response includes all fields (name, material, dimensions, etc.)
9. Verify item is saved to inventory

---

## Monitoring & Maintenance

### 1. Monitor API Usage

**Google Gemini:**
- Visit [Google AI Studio](https://aistudio.google.com/)
- Check quota usage under your project
- Set up alerts for quota limits

**Anthropic Claude:**
- Visit [Anthropic Console](https://console.anthropic.com/)
- Monitor usage and costs in dashboard
- Set monthly spending limits

**OpenAI GPT-4:**
- Visit [OpenAI Platform](https://platform.openai.com/usage)
- Check usage and costs
- Set hard and soft limits

### 2. Set Up Cost Alerts

```bash
# Google Cloud Budget Alert
gcloud billing budgets create \
  --billing-account=YOUR-BILLING-ACCOUNT \
  --display-name="Nexus Moves Vision AI Budget" \
  --budget-amount=100 \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90 \
  --threshold-rule=percent=100
```

### 3. Application Logs

```bash
# View Cloud Run logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=movetrack-api" --limit 50

# Filter for vision-specific logs
gcloud logging read "resource.type=cloud_run_revision AND textPayload=~\"vision\"" --limit 50
```

### 4. Performance Monitoring

Monitor these metrics:
- **Response time** per provider (target: < 3 seconds)
- **Success rate** (target: > 95%)
- **Cost per image** (track against budget)
- **User satisfaction** (collect feedback on AI accuracy)

---

## Troubleshooting

### Issue: "No vision providers configured"

**Cause:** API keys not set or not accessible

**Solution:**
1. Check `.env` file has API keys
2. Verify secrets are created in Secret Manager
3. Restart Cloud Run service
4. Check logs: `gcloud logging read "resource.type=cloud_run_revision"`

---

### Issue: "Failed to analyze image"

**Cause:** API key invalid, quota exceeded, or network issue

**Solution:**
1. Verify API key is correct
2. Check provider dashboard for quota/billing status
3. Test API key with direct API call
4. Check Cloud Run has internet egress enabled

---

### Issue: "Authentication required"

**Cause:** User not logged in or session expired

**Solution:**
1. Ensure user is logged in
2. Check session token is being sent in Authorization header
3. Verify JWT middleware is working
4. Check token expiration settings

---

### Issue: High costs

**Cause:** Too many API calls or using expensive provider

**Solution:**
1. Switch default provider to Gemini (free tier)
2. Implement caching for repeated images
3. Add rate limiting per user
4. Set monthly budget caps in provider dashboards

---

### Issue: Provider not available

**Cause:** API key for that provider not configured

**Solution:**
1. Add the missing API key to `.env`
2. Add to Secret Manager if using secrets
3. Restart Cloud Run service
4. Verify key is accessible with: `echo $ANTHROPIC_API_KEY`

---

## Security Checklist

- [ ] All API keys stored in Secret Manager (not `.env`)
- [ ] Vision endpoints protected by authentication
- [ ] Rate limiting implemented per user
- [ ] HTTPS enforced (handled by Cloud Run)
- [ ] CORS configured for your frontend domain only
- [ ] Database credentials secured
- [ ] JWT secret is strong and unique
- [ ] Error messages don't leak sensitive info

---

## Cost Optimization Tips

1. **Start with Gemini** - Use the free tier for MVP and early users
2. **Implement caching** - Cache results for identical images
3. **User limits** - Limit free users to N photos per day
4. **Batch processing** - If users upload multiple items, batch API calls
5. **Monitor & adjust** - Track costs weekly and adjust provider strategy

---

## Support Resources

- **Nexus Moves Issues:** [GitHub Issues](https://github.com/anthropics/claude-code/issues)
- **Google Gemini:** [Google AI Docs](https://ai.google.dev/docs)
- **Anthropic Claude:** [Anthropic Docs](https://docs.anthropic.com/)
- **OpenAI GPT-4:** [OpenAI Docs](https://platform.openai.com/docs)

---

## Quick Reference

### Provider Selection Matrix

| Use Case | Recommended Provider | Why |
|----------|---------------------|-----|
| **MVP / Testing** | Gemini | Free tier, fast |
| **Production < 1K images/day** | Gemini | Cost-effective |
| **Production > 1K images/day** | Claude or GPT-4 | Better accuracy at scale |
| **Complex/valuable items** | Claude | Highest accuracy |
| **Enterprise users** | All three (user choice) | Flexibility |

### Deployment Commands

```bash
# Backend
gcloud run deploy movetrack-api --image gcr.io/PROJECTmovetrack-api --platform managed --region us-central1

# Frontend
gcloud run deploy movetrack-app --image gcr.io/PROJECTmovetrack-app --platform managed --region us-central1

# View logs
gcloud logging tail "resource.type=cloud_run_revision AND resource.labels.service_name=movetrack-api"
```

---

**Last Updated:** 2025-01-08
**Version:** 1.0.0
