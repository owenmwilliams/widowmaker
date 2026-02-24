# Local Testing Guide

## 1. Set Up Local Database

```bash
# Start local PostgreSQL (if using Docker)
docker run --name movetrack-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:15

# Create database
docker exec movetrack-postgres psql -U postgres -c "CREATE DATABASE movetrack_db;"

# Run the init script
docker exec -i movetrack-postgres psql -U postgres -d movetrack_db < init-movetrack.sql
```

## 2. Configure Local Environment

Create `.env` file in `movetrack-api/`:

```env
NODE_ENV=development
MT_DATALAYER_HOSTNAME=localhost
MT_DATALAYER_PORT=5432
MT_DATALAYER_DATABASE=movetrack_db
MT_DATALAYER_USERNAME=postgres
MT_DATALAYER_PASSWORD=postgres
JWT_SECRET=local-test-secret-key-change-in-production

# SendGrid (optional for testing - will log to console if not set)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key-here
EMAIL_FROM=noreply@yourdomain.com
```

## 3. Start API Locally

```bash
cd movetrack-api
npm install
npm start
```

API will run on http://localhost:3050

## 4. Start Frontend Locally

```bash
cd movetrack-app
npm install
npm run dev
```

Frontend will run on http://localhost:5173

## 5. Test Magic Link Flow

1. Go to http://localhost:5173
2. Enter your email
3. Check console logs in the API terminal for the magic link
4. Copy the magic link and paste in browser
5. You should be logged in!

## 6. Check Logs

The magic link will be printed in the API console like:
```
================================================================================
MAGIC LINK
================================================================================
Email: test@example.com
Magic Link: http://localhost:5173/login?token=abc123...
Token: abc123...
Expires in: 15 minutes
================================================================================
```

## Common Issues

### Database Connection Failed
- Make sure PostgreSQL is running
- Check credentials in .env match your database

### Magic Link Doesn't Work
- Check token hasn't expired (15 minutes)
- Verify the URL matches (should be localhost:5173 for frontend)
- Check API logs for errors

### SendGrid Errors
- Verify your SendGrid API key is valid
- Make sure you're using 'apikey' as the username
- Check SendGrid dashboard for errors
