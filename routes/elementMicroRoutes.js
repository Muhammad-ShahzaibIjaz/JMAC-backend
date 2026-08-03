const express = require('express');
const router = express.Router();
const controller = require('../controllers/elementMicroController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

// Per-element-number micro aggregates for a population.
router.get(
  '/element-matrix/micro',
  verifyToken,
  verifyUserActive,
  controller.getElementMatrixMicroData
);

module.exports = router;