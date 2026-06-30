const express = require('express');
const router = express.Router();
const { verifyToken } = require('../../../services/infra/jwtMiddleware');

router.use('/collections', require('./collections'));
router.use('/containers', require('./containers'));
router.use('/items', verifyToken, require('./items'));
router.use('/locations', require('./locations'));
router.use('/snapshot', require('./snapshot'));
router.use('/shares', require('./shares'));

module.exports = router;
