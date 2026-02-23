// Load environment variables from .env file
require('dotenv').config();

// MoveTrack API Server
// Deployment: 2025-11-10-v2
var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors');
var bodyParser = require('body-parser');
const helmet = require('helmet');
// const { expressjwt: jwt } = require('express-jwt');

// Rate limiting configuration
const rateLimits = require('./config/rateLimits');

var jwtLib = require('./bin/auth')
const { verifyToken } = require('./bin/jwtMiddleware');
var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var locationsRouter = require('./routes/locations');
var collectionsRouter = require('./routes/collections');
var containersRouter = require('./routes/containers');
var itemsRouter = require('./routes/items');
var listsRouter = require('./routes/lists');
var fileRouter = require('./routes/files');
var visionRouter = require('./routes/vision');
var publicRouter = require('./routes/public');
var gptRouter = require('./routes/gpt');
var googleRouter = require('./routes/google');
var emailRouter = require('./routes/email');
var authRouter = require('./routes/auth');
var distanceRouter = require('./routes/distance');
var savedMovesRouter = require('./routes/savedMoves');
var moveDayRouter = require('./routes/moveDay');
var waypointsRouter = require('./routes/waypoints');
var billingRouter = require('./routes/billing');
var billingWebhook = require('./routes/billingWebhook');
var onboardingRouter = require('./routes/onboarding');
var importsRouter = require('./routes/imports');
var visionLabRouter = require('./routes/visionLab');
var adminRouter = require('./routes/admin');
var reloprepRouter = require('./routes/reloprep');

var app = express();
app.set('trust proxy', 1);

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.post('/billing/webhook', bodyParser.raw({ type: 'application/json' }), billingWebhook);
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
app.use('/users', usersRouter);
app.use('/locations', locationsRouter);
app.use('/collections', collectionsRouter);
app.use('/containers', containersRouter);
app.use('/items', verifyToken, itemsRouter);
app.use('/imports', verifyToken, importsRouter);
app.use('/onboarding', verifyToken, onboardingRouter);
app.use('/public', rateLimits.publicLimiter, publicRouter)
app.use('/file', rateLimits.uploadLimiter, fileRouter);
app.use('/lists', listsRouter);
app.use('/vision', rateLimits.visionLimiter, visionRouter);
app.use('/gpt', gptRouter);
app.use('/google', googleRouter)
app.use('/email', rateLimits.emailLimiter, emailRouter)
app.use('/auth', rateLimits.authLimiter, authRouter)
app.use('/api', rateLimits.apiLimiter, distanceRouter)
app.use('/api/saved-moves', rateLimits.apiLimiter, savedMovesRouter)
app.use('/api/move-day', rateLimits.apiLimiter, moveDayRouter)
app.use('/api/waypoints', rateLimits.apiLimiter, waypointsRouter)
app.use('/billing', billingRouter)
app.use('/admin', adminRouter)
app.use('/reloprep', reloprepRouter)

if (process.env.NODE_ENV === 'development') {
  const visionLabVideoRouter = require('./routes/visionLabVideo');
  app.use('/vision-lab-video', visionLabVideoRouter);

  const video12labsRouter = require('./routes/video12labs');
  app.use('/video-12labs', video12labsRouter);
}

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
