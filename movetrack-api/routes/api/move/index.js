const express = require('express');
const router = express.Router();
const rateLimits = require('../../../config/rateLimits');

router.use(rateLimits.apiLimiter);

const moves = require('./moves');
router.use('/move', moves);           // POST /move/distance, truck CRUD
router.use('/api/saved-moves', moves); // saved-moves CRUD (same router, different base path)
router.use('/api/move-day', require('./moveCoordination'));
router.use('/api/waypoints', require('./routing'));

module.exports = router;
