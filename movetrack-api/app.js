// Load environment variables from .env file
require('dotenv').config();

// Nexus Moves API Server
// Deployment: 2025-11-10-v2
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
const helmet = require('helmet');

// Rate limiting configuration
const rateLimits = require('./config/rateLimits');

// Application-level authentication gate (default-deny)
const { requireAuth } = require('./middleware/auth');

// Health/readiness probes (public)
var healthRouter = require('./routes/health');

// ── Root ──────────────────────────────────────────────────────────────────────
var indexRouter = require('./routes/index');

// ── api/ ─────────────────────────────────────────────────────────────────────
var inventoryRouter = require('./routes/api/inventory');
var userRouter = require('./routes/api/user');
var moveRouter = require('./routes/api/move');
var agentsRouter = require('./routes/api/agents');
var clientEventsRouter = require('./routes/api/clientEvents');

// ── auth/ ─────────────────────────────────────────────────────────────────────
var authRouter = require('./routes/auth/auth');

// ── admin/ ────────────────────────────────────────────────────────────────────
var adminAnalyticsRouter = require('./routes/admin/analytics');
var adminMaintenanceRouter = require('./routes/admin/maintenance');
var adminEmailRouter = require('./routes/admin/email');

// ── billing/ ──────────────────────────────────────────────────────────────────
var billingRouter = require('./routes/billing/billing');

// ── api/vision/ ───────────────────────────────────────────────────────────────
var visionRouter = require('./routes/api/vision');

var publicShareRouter = require('./routes/public/share');

// ── internal/ (service-to-service, OIDC-verified — see middleware/auth.js) ────
var internalScanJobsRouter = require('./routes/internal/scanJobs');

// ── experimental/ (admin-only sandboxes — each route file gates via ensureAdmin) ──
var visionLabRouter = require('./routes/experimental/visionLab');
var visionLabVideoRouter = require('./routes/experimental/visionLabVideo');

var app = express();
app.set('trust proxy', 1);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
// POST /billing/webhook — Stripe webhook (raw body required for signature verification)
// Implementation pending; see routes/billing.js for endpoint description.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ── Health / readiness (public, mounted before rate-limiting so probes are never throttled) ──
app.use('/health', healthRouter);

var corsOptions = {
  origin: [
    'http://localhost:4050', 
    'http://localhost:5173', 
    'http://localhost:5174', 
    'https://movetrack-app-7hwn7ggbiq-uc.a.run.app',
    'https://movetrack-app-203537990119.us-central1.run.app'
  ],
  // allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
  optionsSuccessStatus: 200
}
app.use(cors(corsOptions));

const frontendOrigins = [
  process.env.FRONTEND_URL,
  process.env.APP_BASE_URL,
  'http://localhost:5173',
  'http://localhost:5174',
  'https://movetrack-app-7hwn7ggbiq-uc.a.run.app',
  'https://movetrack-app-203537990119.us-central1.run.app'
].filter(Boolean);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://maps.googleapis.com',
        'https://maps.gstatic.com'
      ],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        'https://fonts.googleapis.com'
      ],
      imgSrc: [
        "'self'",
        'data:',
        'https:',
        'blob:'
      ],
      connectSrc: ["'self'", ...frontendOrigins, 'https://maps.googleapis.com'],
      fontSrc: [
        "'self'",
        'data:',
        'https://fonts.gstatic.com'
      ],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
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

// ========================================
// RATE LIMITING
// ========================================
// Apply global rate limiter to all routes
// Skips static files and webhook endpoints automatically
app.use(rateLimits.globalLimiter);

// ========================================
// AUTHENTICATION (default-deny)
// ========================================
// Every route below requires a valid magic-link session token unless its path is
// on the public allowlist in middleware/auth.js (/auth, /health, root, OPTIONS).
app.use(requireAuth);

// ── Root ─────────────────────────────────────────────────────────────────────
app.use('/', indexRouter);

// ── API — Inventory ──────────────────────────────── /items /collections /locations /containers /snapshot
app.use('/', inventoryRouter);

// ── API — User ───────────────────────────────────── /users /onboarding /imports /file
app.use('/', userRouter);

// ── API — Move ───────────────────────────────────── /api/move /api/saved-moves /api/move-day /api/waypoints
app.use('/api', moveRouter);

// ── API — Vision ─────────────────────────────────── /api/vision /api/vision/video
app.use('/api/vision', rateLimits.visionLimiter, visionRouter);

// ── API — Agents ─────────────────────────────────── /api/agents/nexus /api/agents/census /api/agents/vector
app.use('/api/agents', agentsRouter);

// ── API — Client events ──────────────────────────── /api/client-events (not an AI call — outside the agents
// router so it isn't gated by enforceAiBudget; a budget-capped user must still be able to report a failed turn)
app.use('/api/client-events', clientEventsRouter);

// ── Public (unauthenticated, token-scoped) ───────────── /public/inventory/:token
app.use('/public', publicShareRouter);

// ── Internal (Cloud Tasks push target, OIDC-verified) ── /internal/scan-jobs/process
app.use('/internal/scan-jobs', internalScanJobsRouter);

// ── Auth ─────────────────────────────────────────────────────────────────────
app.use('/auth', rateLimits.authLimiter, authRouter);

// ── Billing ──────────────────────────────────────────────────────────────────
app.use('/billing', billingRouter);

// ── Admin ─────────────────────────────────────────────────────────────────────
app.use('/admin/analytics', adminAnalyticsRouter);
app.use('/admin/maintenance', adminMaintenanceRouter);
app.use('/', rateLimits.emailLimiter, adminEmailRouter);
app.use('/admin/vision-lab', visionLabRouter);
app.use('/admin/vision-lab-video', visionLabVideoRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// Server startup is handled by bin/www.js
// Do not call app.listen() here as it will conflict with www.js

module.exports = app;
