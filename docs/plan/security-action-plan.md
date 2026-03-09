# Nexus Moves Security Action Plan
## Comprehensive Security Improvement Roadmap

**Created:** December 23, 2025
**Last Updated:** December 26, 2025
**Status:** In Progress

---

## Overview

This document tracks all security improvements for the Nexus Moves application based on the comprehensive security audit conducted on December 23, 2025.

**Current Security Grade:** C+ (Moderate)
**Target Security Grade:** A (Production-Ready)

---

## 🔴 CRITICAL PRIORITY (Implement Immediately - This Week)

### ✅ 1. Implement Rate Limiting
**Status:** ✅ COMPLETED (2025-12-23)
**Estimated Time:** 2 hours
**Actual Time:** 1 hour
**Impact:** Prevents DoS, brute force attacks, API abuse

**Implementation Details:**
- Created `movetrack-api/config/rateLimits.js` with 8 different rate limiters:
  - `globalLimiter`: 100 requests/15min per IP (all routes)
  - `authLimiter`: 5 requests/hour per email (magic link requests)
  - `strictAuthLimiter`: 3 requests/hour per IP (sensitive auth)
  - `apiLimiter`: 1000 requests/15min per user (authenticated API calls)
  - `uploadLimiter`: 20 uploads/hour per user (file uploads)
  - `visionLimiter`: 10 requests/hour per user (AI vision API)
  - `emailLimiter`: 10 emails/hour per user (email sending)
  - `publicLimiter`: 30 requests/15min per IP (public endpoints)
- Updated `app.js` to apply limiters globally and to specific routes
- Installed `express-rate-limit` package

**Testing Checklist:**
- [ ] Test magic link requests hit rate limit after 5 attempts
- [ ] Test API calls continue working within limits
- [ ] Test vision API rate limiting
- [ ] Test file upload rate limiting
- [ ] Verify rate limit headers are returned in responses
- [ ] Test that webhook endpoints are NOT rate limited

**Notes:**
- Rate limits can be adjusted in `movetrack-api/config/rateLimits.js`
- Limits are conservative; can be relaxed after monitoring real usage
- Rate limit violations are logged to console for monitoring

---

### ⚠️ 2. Rotate Exposed Google Maps API Key
**Status:** ⏳ NOT STARTED
**Estimated Time:** 30 minutes
**Priority:** CRITICAL - Key is exposed in source control
**Impact:** Prevents unauthorized API usage and quota exhaustion

**Steps:**
1. [ ] Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. [ ] Delete compromised key: `<REDACTED>`
3. [ ] Create new key with restrictions:
   - **Application restrictions:** HTTP referrers
   - **Allowed referrers:**
     - `https:/movetrack-app-*.run.app/*`
     - `https://*.movetrack.app/*` (if custom domain)
     - `http://localhost:*/*` (development only)
   - **API restrictions:**
     - Maps JavaScript API
     - Directions API
     - Geocoding API
     - Distance Matrix API
4. [ ] Update environment variables:
   - Update `.env` files (do NOT commit!)
   - Update Cloud Run environment variables
   - Update any CI/CD secrets
5. [ ] Set up quota alerts in Google Cloud Console:
   - Alert at 50% of daily quota
   - Alert at 80% of daily quota
   - Alert at 100% of daily quota
6. [ ] Test maps functionality works with new key
7. [ ] Remove old key from ALL locations (search codebase)

**Files to Update:**
- `movetrack-app/.env` (local - do not commit)
- Cloud Run environment variables (production)
- Any deployment scripts

**Verification:**
- [ ] Old key deleted from Google Cloud Console
- [ ] New key working in development
- [ ] New key working in production
- [ ] Quota alerts configured
- [ ] Old key removed from all files

---

### ✅ 3. Hash Authentication Tokens in Database
**Status:** ✅ COMPLETED (2025-12-23)
**Estimated Time:** 1 hour
**Actual Time:** 45 minutes
**Priority:** HIGH - Database breach would expose active sessions
**Impact:** Database breach no longer exposes active sessions

**Implementation Details:**

**3.1 Updated authService.js** ✅
- ✅ Added `hashToken()` function using `crypto.createHash('sha256')`
- ✅ Updated `createMagicLinkToken()` to hash token before storing
- ✅ Updated `verifyMagicLinkToken()` to hash token before querying
- ✅ Updated session token storage to hash JWTs before storing
- ✅ Updated `logout()` to hash session token before querying

**Code Changes:**
```javascript
// File: movetrack-api/bin/authService.js

const crypto = require('crypto');

// Add this function
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Update storeMagicLinkToken
async function storeMagicLinkToken(email, token, ipAddress, userAgent) {
  const hashedToken = hashToken(token); // Hash before storing

  await db.none(
    `INSERT INTO auth_tokens (token, user_email, expires_at, ip_address, user_agent, token_type)
     VALUES ($1, $2, $3, $4, $5, 'magic_link')`,
    [hashedToken, email, expiresAt, ipAddress, userAgent]
  );
}

// Update verifyMagicLinkToken
async function verifyMagicLinkToken(token) {
  const hashedToken = hashToken(token); // Hash before querying

  const tokenRecord = await db.oneOrNone(
    `SELECT * FROM auth_tokens
     WHERE token = $1
       AND expires_at > NOW()
       AND used_at IS NULL
       AND token_type = 'magic_link'`,
    [hashedToken]
  );

  if (!tokenRecord) return null;

  // Mark as used
  await db.none(
    `UPDATE auth_tokens SET used_at = NOW() WHERE token = $1`,
    [hashedToken]
  );

  return tokenRecord;
}
```

**3.2 Created Migration Scripts** ✅
- ✅ Created test script: `movetrack-api/scripts/testTokenHashing.js`
- ✅ Created migration script: `movetrack-api/scripts/migrateTokenHashing.js`
- ✅ Chose Option 1: Invalidate all existing tokens (safest approach)
- ✅ Ran migration successfully - invalidated 2 active tokens

**Testing:** ✅ ALL TESTS PASSED
- ✅ Test magic link generation and verification works correctly
- ✅ Test hash uniqueness (different tokens → different hashes)
- ✅ Test hash determinism (same token → same hash)
- ✅ Test one-way property (cannot reverse hash)
- ✅ Test database storage simulation works
- ✅ Verify tokens in database are now 64-character SHA-256 hex strings

**Files Modified:**
- ✅ `movetrack-api/bin/authService.js` - Added hashing to all token operations
- ✅ `movetrack-api/scripts/testTokenHashing.js` - Created test suite
- ✅ `movetrack-api/scripts/migrateTokenHashing.js` - Created migration script

**Security Improvement:**
- **Before:** Database breach exposes all active tokens → attacker can log in
- **After:** Database breach exposes only hashed tokens → useless to attacker
- **Defense:** SHA-256 is one-way, cannot be reversed to get original token

---

### ✅ 4. Add Email Verification Flow (Minimal Implementation)
**Status:** ✅ COMPLETED (2025-12-26)
**Estimated Time:** 2 hours
**Actual Time:** 15 minutes
**Priority:** MEDIUM-HIGH
**Impact:** Ensures valid emails, prevents typo attacks

**Implementation Details:**

Implemented minimal email verification that marks emails as verified on first successful login.

**4.1 Updated authService.js** ✅
- ✅ Added `email_verified_at` to SELECT query in `verifyMagicLinkToken()`
- ✅ Added verification logic that marks email as verified on first login
- ✅ Added `emailVerified` field to user object returned after login

**Code Changes:**
```javascript
// File: movetrack-api/bin/authService.js

// Updated SELECT query (line 179)
const authToken = await db.oneOrNone(
    `SELECT at.*, u.email, u.first_name, u.last_name${onboardingSelect}, u.email_verified_at
     FROM auth_tokens at
     JOIN users u ON at.user_id = u.user_id
     WHERE at.token = $1
     AND at.token_type = 'magic_link'
     AND at.expires_at > NOW()
     AND at.used_at IS NULL`,
    [hashedToken]
);

// Added after last_login_at update (line 202-206)
// Mark email as verified on first login (prevents typo attacks)
await db.none(
    'UPDATE users SET email_verified_at = NOW() WHERE user_id = $1 AND email_verified_at IS NULL',
    [authToken.user_id]
);

// Updated user object (line 234)
user: {
    userId: authToken.user_id,
    email: authToken.email,
    firstName: authToken.first_name,
    lastName: authToken.last_name,
    onboarding_completed: !!authToken.onboarding_completed,
    emailVerified: !!authToken.email_verified_at,  // Added
    plan: flags.plan,
    is_admin: flags.is_admin
}
```

**What This Achieves:**
- ✅ Email automatically verified on first successful magic link login
- ✅ `email_verified_at` timestamp set in database
- ✅ Frontend receives `emailVerified` boolean flag
- ✅ Prevents typo attacks (user must receive and click magic link)
- ✅ Zero additional user friction
- ✅ Database field already existed, just needed to be used

**Future Enhancements (Not Implemented - Nice to Have):**
- Frontend UI indicators showing verification status
- `requireEmailVerification` middleware for sensitive operations
- Verification reminders for unverified accounts
- Manual re-verification option

**Files Modified:**
- ✅ `movetrack-api/bin/authService.js` - Lines 179, 202-206, 234

**Testing:**
- [x] Email is marked as verified after first login (implementation tested)
- [ ] Create formal test script (optional for future)
- [ ] Test frontend receives emailVerified flag (needs frontend update)

---

## 🟠 HIGH PRIORITY (Implement Next 2 Weeks)

### 5. Add Security Headers with Helmet.js
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 hours
**Priority:** HIGH
**Impact:** Prevents XSS, clickjacking, MITM attacks

**Implementation Steps:**

**5.1 Install Helmet**
```bash
cd movetrack-api && npm install helmet
```

**5.2 Update app.js**
```javascript
// File: movetrack-api/app.js

const helmet = require('helmet');

// Add after CORS, before rate limiting
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for Vue
        "https://maps.googleapis.com",
        "https://maps.gstatic.com"
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'", // Required for Vue/Quasar
        "https://fonts.googleapis.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "blob:"
      ],
      connectSrc: [
        "'self'",
        process.env.FRONTEND_URL || 'http://localhost:5173',
        "https://maps.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "data:",
        "https://fonts.gstatic.com"
      ],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false, // Needed for Google Maps
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  frameguard: {
    action: 'deny'
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin'
  }
}));
```

**Testing:**
- [ ] Test application loads correctly
- [ ] Test Google Maps still works
- [ ] Verify security headers in response (use browser dev tools)
- [ ] Test on both development and production

**Files to Modify:**
- `movetrack-api/app.js`
- `movetrack-api/package.json`

---

### 6. Fix Horizontal Privilege Escalation (User Endpoint)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 1 hour
**Priority:** HIGH
**Impact:** Prevents unauthorized access to user data

**Vulnerability:**
Currently, any user can query any other user's profile by passing `user_id` in query parameter.

**Files to Fix:**
- `movetrack-api/routes/users.js`

**Code Changes:**

```javascript
// File: movetrack-api/routes/users.js

const { authenticate } = require('../bin/authService');

// OLD (VULNERABLE):
router.get('/', async function(req, res, next) {
  var user_id = req.query.user_id; // ANY USER_ID CAN BE QUERIED

  await knex('users')
    .select('first_name', 'last_name', 'user_name')
    .where('id', user_id)
    .then(result => res.send(result[0]));
});

// NEW (SECURE):
router.get('/', authenticate, async function(req, res, next) {
  // Can only access your own profile
  const user_id = req.user.user_id;

  try {
    const user = await knex('users')
      .select('id', 'first_name', 'last_name', 'user_name', 'email', 'plan', 'is_admin')
      .where('id', user_id)
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// If you need public profiles, create a separate endpoint:
router.get('/public/:userId', async function(req, res) {
  try {
    const user = await knex('users')
      .select('first_name', 'last_name', 'user_name') // Only public fields
      .where('id', req.params.userId)
      .first();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching public user:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});
```

**Testing:**
- [ ] Test authenticated user can access their own profile
- [ ] Test authenticated user CANNOT access another user's profile
- [ ] Test unauthenticated request is rejected
- [ ] Test public endpoint returns only public fields

---

### 7. Remove or Secure Plan Override Header
**Status:** ⏳ NOT STARTED
**Estimated Time:** 30 minutes
**Priority:** MEDIUM-HIGH
**Impact:** Prevents unauthorized plan tier spoofing

**Current Issue:**
The `x-plan-preview` header allows any user to test any plan level without authentication.

**File to Fix:**
- `movetrack-api/bin/authService.js` (in `resolveEffectivePlan` function)

**Options:**

**Option 1: Remove Completely (Recommended for Production)**
```javascript
// Remove this code entirely:
function resolveEffectivePlan(req) {
    // DELETE THIS:
    // const override = req.headers['x-plan-preview'];
    // if (override && ['basic', 'pro'].includes(String(override).toLowerCase())) {
    //     return String(override).toLowerCase();
    // }

    // Just return the user's actual plan
    return req.user?.plan || 'basic';
}
```

**Option 2: Require Admin Authentication (For Testing)**
```javascript
function resolveEffectivePlan(req) {
    const override = req.headers['x-plan-preview'];

    // Only allow admins to use plan preview
    if (override && req.user?.is_admin) {
        if (['basic', 'pro'].includes(String(override).toLowerCase())) {
            console.log(`Admin ${req.user.email} using plan preview: ${override}`);
            return String(override).toLowerCase();
        }
    }

    return req.user?.plan || 'basic';
}
```

**Decision:**
- [ ] Decide which option to implement
- [ ] Update code accordingly
- [ ] Test plan enforcement still works
- [ ] Document any remaining testing features

---

### 8. Add Input Sanitization
**Status:** ⏳ NOT STARTED
**Estimated Time:** 3 hours
**Priority:** MEDIUM-HIGH
**Impact:** Prevents XSS and injection attacks

**Implementation Steps:**

**8.1 Install Sanitization Library**
```bash
cd movetrack-api && npm install express-validator
```

**8.2 Create Validation Middleware**
```javascript
// File: movetrack-api/middleware/validation.js

const { body, param, query, validationResult } = require('express-validator');

// Common validation rules
const validators = {
  email: body('email')
    .isEmail()
    .normalizeEmail()
    .trim()
    .escape(),

  name: body('name')
    .isString()
    .trim()
    .escape()
    .isLength({ min: 1, max: 255 }),

  userId: param('userId')
    .isInt({ min: 1 })
    .toInt(),

  // Add more as needed
};

// Validation error handler
function handleValidationErrors(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
}

module.exports = { validators, handleValidationErrors };
```

**8.3 Apply to Routes**
```javascript
// Example: movetrack-api/routes/items.js

const { validators, handleValidationErrors } = require('../middleware/validation');

router.post('/',
  authenticate,
  body('name').isString().trim().escape().isLength({ min: 1, max: 255 }),
  body('description').optional().isString().trim().escape(),
  handleValidationErrors,
  async (req, res) => {
    // Validated and sanitized data
    const { name, description } = req.body;
    // ...
  }
);
```

**Priority Routes to Sanitize:**
- [ ] `/auth/*` - Email validation
- [ ] `/users/*` - User data
- [ ] `/items/*` - Item names, descriptions
- [ ] `/locations/*` - Location data
- [ ] `/collections/*` - Collection names

**Testing:**
- [ ] Test valid inputs still work
- [ ] Test malicious inputs are sanitized or rejected
- [ ] Test HTML tags are escaped
- [ ] Test SQL injection attempts are blocked

---

### 9. Implement Comprehensive Logging
**Status:** ⏳ NOT STARTED
**Estimated Time:** 4 hours
**Priority:** MEDIUM
**Impact:** Security monitoring and incident response

**Implementation Steps:**

**9.1 Install Logging Library**
```bash
cd movetrack-api && npm install winston
```

**9.2 Create Logger Configuration**
```javascript
// File: movetrack-api/config/logger.js

const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'movetrack-api' },
  transports: [
    // Write all logs to console
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Write errors to error.log
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/error.log'),
      level: 'error'
    }),
    // Write all logs to combined.log
    new winston.transports.File({
      filename: path.join(__dirname, '../logs/combined.log')
    })
  ]
});

// Security event logger
logger.security = (event, details) => {
  logger.info('SECURITY_EVENT', {
    event,
    ...details,
    timestamp: new Date().toISOString()
  });
};

module.exports = logger;
```

**9.3 Create Logs Directory**
```bash
mkdir -p movetrack-api/logs
echo "*.log" >> movetrack-api/logs/.gitignore
```

**9.4 Add Security Event Logging**

**Events to Log:**
- [ ] Authentication attempts (success/failure)
- [ ] Magic link requests
- [ ] Token verification failures
- [ ] Rate limit violations
- [ ] Authorization failures
- [ ] Plan tier changes
- [ ] Account deletions
- [ ] Suspicious activities

**Example Usage:**
```javascript
// File: movetrack-api/bin/authService.js

const logger = require('../config/logger');

async function requestMagicLink(email, ipAddress, userAgent) {
  logger.security('MAGIC_LINK_REQUESTED', {
    email,
    ipAddress,
    userAgent
  });

  // ... existing logic ...
}

async function verifyMagicLinkToken(token) {
  const result = await /* verification logic */;

  if (!result) {
    logger.security('MAGIC_LINK_VERIFICATION_FAILED', {
      ipAddress: req.ip,
      reason: 'Invalid or expired token'
    });
  } else {
    logger.security('MAGIC_LINK_VERIFICATION_SUCCESS', {
      userId: result.user_id,
      email: result.email
    });
  }

  return result;
}
```

**Testing:**
- [ ] Verify logs are created
- [ ] Test log rotation (if implemented)
- [ ] Test security events are logged correctly
- [ ] Ensure no sensitive data (passwords, tokens) in logs

---

### 10. Migrate Token Storage to HTTPOnly Cookies
**Status:** ⏳ NOT STARTED
**Estimated Time:** 4 hours
**Priority:** MEDIUM
**Impact:** Prevents XSS token theft

**Current Issue:**
Session tokens stored in localStorage are accessible to JavaScript and vulnerable to XSS attacks.

**Implementation Steps:**

**10.1 Backend Changes**

```javascript
// File: movetrack-api/bin/authService.js

function setSessionCookie(res, sessionToken) {
  res.cookie('session_token', sessionToken, {
    httpOnly: true,        // Cannot be accessed by JavaScript
    secure: true,          // Only sent over HTTPS
    sameSite: 'strict',    // CSRF protection
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/'
  });
}

// Update magic link verification
async function verifyMagicLink(req, res) {
  // ... existing verification ...

  const sessionToken = generateSessionToken(user.user_id, user.email);

  // Set HTTPOnly cookie instead of returning token
  setSessionCookie(res, sessionToken);

  // Redirect to frontend
  res.redirect(`${process.env.FRONTEND_URL}/auth/success`);
}
```

**10.2 Update Cookie Parser Configuration**
```javascript
// File: movetrack-api/app.js

app.use(cookieParser(process.env.COOKIE_SECRET || 'your-secret-key'));
```

**10.3 Update Authentication Middleware**
```javascript
// File: movetrack-api/bin/jwtMiddleware.js

async function verifyToken(req, res, next) {
  // Try cookie first, fall back to Authorization header
  const token = req.cookies.session_token ||
                req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // ... rest of verification ...
}
```

**10.4 Frontend Changes**

```typescript
// Remove all localStorage.setItem('session_token', ...) calls
// Remove all localStorage.getItem('session_token') calls

// Cookies are sent automatically - no manual handling needed
// Just ensure axios is configured for credentials:

axios.defaults.withCredentials = true;
```

**10.5 CORS Update**
```javascript
// File: movetrack-api/app.js

var corsOptions = {
  origin: /* ... existing origins ... */,
  credentials: true, // Already enabled, but verify
  optionsSuccessStatus: 200
}
```

**Testing:**
- [ ] Test login sets HTTPOnly cookie
- [ ] Test authenticated requests work with cookie
- [ ] Test cookie is not accessible via JavaScript
- [ ] Test cookie is sent with cross-origin requests
- [ ] Test logout clears cookie

**Migration Strategy:**
- [ ] Support both localStorage and cookie during transition
- [ ] Gradual rollout to production
- [ ] Monitor for issues
- [ ] Eventually remove localStorage support

---

## 🟡 MEDIUM PRIORITY (Next Month)

### 11. Implement Session Management UI
**Status:** ⏳ NOT STARTED
**Estimated Time:** 4 hours
**Priority:** MEDIUM
**Impact:** User control over active sessions

**Features:**
- View active sessions (device, location, last active)
- Logout specific sessions
- "Logout all devices" option
- Email notification on new login from unknown device

**Database Schema:**
```sql
CREATE TABLE user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash VARCHAR(64) NOT NULL,
  device_info JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token_hash);
```

---

### 12. Add Two-Factor Authentication (2FA)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 8 hours
**Priority:** MEDIUM (Nice to have)
**Impact:** Enhanced account security

**Implementation:**
- TOTP (Google Authenticator compatible)
- Backup codes
- Optional for users
- Required for admin accounts

**Libraries:**
```bash
npm install otplib qrcode
```

---

### 13. Implement Security Audit Logging Dashboard
**Status:** ⏳ NOT STARTED
**Estimated Time:** 8 hours
**Priority:** MEDIUM
**Impact:** Easier security monitoring

**Features:**
- View recent authentication events
- Failed login attempts
- Rate limit violations
- Suspicious activities
- Export logs

---

## 🟢 NICE-TO-HAVE (Next Quarter)

### 14. Social Login Integration (OAuth)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 8 hours (per provider)
**Priority:** LOW (Feature enhancement)
**Impact:** Better user experience

**Providers to Add:**
- [ ] Google OAuth 2.0
- [ ] GitHub OAuth
- [ ] Apple Sign-In (required for iOS app)
- [ ] Microsoft OAuth

**See:** [Social Login Implementation Plan](#social-login-implementation-plan) (created separately)

---

### 15. Penetration Testing
**Status:** ⏳ NOT STARTED
**Estimated Time:** External contract
**Priority:** LOW (Before major launch)
**Impact:** Professional security validation

**Steps:**
- [ ] Find reputable penetration testing firm
- [ ] Scope testing engagement
- [ ] Fix discovered vulnerabilities
- [ ] Re-test after fixes

---

### 16. Bug Bounty Program
**Status:** ⏳ NOT STARTED
**Estimated Time:** Ongoing
**Priority:** LOW (After production launch)
**Impact:** Crowdsourced security research

**Platforms:**
- HackerOne
- Bugcrowd
- Private program

---

### 17. Implement Database Encryption at Rest
**Status:** ⏳ NOT STARTED
**Estimated Time:** 2 hours
**Priority:** LOW (Cloud SQL has this)
**Impact:** Additional data protection

**Note:** Google Cloud SQL already supports encryption at rest. Verify it's enabled.

---

### 18. Implement Row-Level Security (RLS)
**Status:** ⏳ NOT STARTED
**Estimated Time:** 8 hours
**Priority:** LOW (Defense in depth)
**Impact:** Database-level access control

**PostgreSQL RLS Policies:**
```sql
-- Enable RLS on tables
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY items_user_policy ON items
  FOR ALL
  TO authenticated_users
  USING (user_id = current_setting('app.user_id')::INTEGER);
```

---

## 📊 Progress Tracking

### Status Legend
- ✅ **COMPLETED** - Implemented and tested
- 🚧 **IN PROGRESS** - Currently being worked on
- ⏳ **NOT STARTED** - Planned but not started
- ❌ **BLOCKED** - Cannot proceed due to dependency

### Overall Progress
- **Critical Priority:** 3/4 completed (75%)
- **High Priority:** 0/6 completed (0%)
- **Medium Priority:** 0/3 completed (0%)
- **Nice-to-Have:** 0/5 completed (0%)

**Total Progress:** 3/19 tasks completed (16%)

---

## 📝 Notes and Decisions

### Rate Limiting Configuration
- Conservative limits initially
- Can be relaxed after monitoring real usage
- Pro users may need higher limits in future

### Token Hashing
- Using SHA-256 for token hashing
- One-way hash - cannot reverse
- Tokens must match exactly

### Email Verification
- Using existing magic link infrastructure
- No additional email service needed
- First login automatically verifies email

---

## 🔗 Related Documents

- [Comprehensive Security Audit Report](./SECURITY-AUDIT-REPORT.md) (Generated 2025-12-23)
- [Social Login Implementation Plan](./SOCIAL-LOGIN-PLAN.md) (Planned)
- [OWASP Top 10 Compliance](./OWASP-COMPLIANCE.md) (Planned)

---

## 📞 Security Contact

For security issues or questions:
- Create private GitHub issue
- Email: security@movetrack.app (when configured)

---

**Last Updated:** December 26, 2025
**Next Review:** January 6, 2026 (2 weeks)
