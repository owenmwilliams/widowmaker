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
// const { expressjwt: jwt } = require('express-jwt');

// Rate limiting configuration
const rateLimits = require('./config/rateLimits');

var jwtLib = require('./services/infra/auth')

// ── Root ──────────────────────────────────────────────────────────────────────
var indexRouter = require('./routes/index');

// ── api/ ─────────────────────────────────────────────────────────────────────
var inventoryRouter = require('./routes/api/inventory');
var userRouter = require('./routes/api/user');
var moveRouter = require('./routes/api/move');
var agentsRouter = require('./routes/api/agents');

// ── auth/ ─────────────────────────────────────────────────────────────────────
var authRouter = require('./routes/auth/auth');
var googleRouter = require('./routes/auth/google');

// ── admin/ ────────────────────────────────────────────────────────────────────
var adminAnalyticsRouter = require('./routes/admin/analytics');
var adminMaintenanceRouter = require('./routes/admin/maintenance');
var adminEmailRouter = require('./routes/admin/email');

// ── billing/ ──────────────────────────────────────────────────────────────────
var billingRouter = require('./routes/billing/billing');

// ── api/vision/ ───────────────────────────────────────────────────────────────
var visionRouter = require('./routes/api/vision');

// ── experimental/ (admin-only sandboxes — each route file gates via ensureAdmin) ──
var visionLabRouter = require('./routes/experimental/visionLab');
var visionLabVideoRouter = require('./routes/experimental/visionLabVideo');

var app = express();
app.set('trust proxy', 1);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
// POST /billing/webhook — Stripe webhook (raw body required for signature verification)
// Implementation pending; see routes/billing.js for endpoint description.
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

//** UPDATE HERE TO ADD AUTH REQUIREMENT */
// app.use(process.env.NODE_ENV == 'development' ? jwtCheck.jwtDemoCheck : jwtCheck.jwtProdCheck)


if (process.env.NODE_ENV == 'development') {
  jwtCheck = jwtLib.jwtDemoCheck
} else {
  jwtCheck = jwtLib.jwtProdCheck
}

//** RE-ADD THIS BEFORE PUSHING TO PROD */
// app.use(jwtCheck)



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

//** MAKE SURE TO ADD THE jwtcheck BACK IN HERE */
app.use('/', indexRouter);
app.use('/', inventoryRouter);
app.use('/', userRouter);
app.use('/vision', rateLimits.visionLimiter, visionRouter);

app.use('/google', googleRouter)
app.use('/auth', rateLimits.authLimiter, authRouter)
app.use('/', moveRouter)
app.use('/billing', billingRouter)
app.use('/admin/analytics', adminAnalyticsRouter)
app.use('/admin/maintenance', adminMaintenanceRouter)
app.use('/', rateLimits.emailLimiter, adminEmailRouter)

// Experimental vision lab (admin-gated internally)
app.use('/vision-lab-video', visionLabVideoRouter);
app.use('/admin/vision-lab', visionLabRouter);

// Conversational agents
app.use('/', agentsRouter);

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
