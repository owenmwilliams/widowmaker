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
// const { expressjwt: jwt } = require('express-jwt');

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
var coinsRouter = require('./routes/coins');
var gptRouter = require('./routes/gpt');
var encryptRouter = require('./routes/encrypt');
var googleRouter = require('./routes/google');
var emailRouter = require('./routes/email');
var authRouter = require('./routes/auth');

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
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

//** MAKE SURE TO ADD THE jwtcheck BACK IN HERE */
app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/locations', locationsRouter);
app.use('/collections', collectionsRouter);
app.use('/containers', containersRouter);
app.use('/items', verifyToken, itemsRouter);
app.use('/public', publicRouter)
app.use('/file', fileRouter);
app.use('/lists', listsRouter);
app.use('/vision', visionRouter);
app.use('/coins', coinsRouter);
app.use('/gpt', gptRouter);
app.use('/secure', encryptRouter);
app.use('/google', googleRouter)
app.use('/email', emailRouter)
app.use('/auth', authRouter)

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

// app.listen(3050, () => console.log('Server is up and running'))

app.listen(process.env.PORT || 3050)

module.exports = app;
