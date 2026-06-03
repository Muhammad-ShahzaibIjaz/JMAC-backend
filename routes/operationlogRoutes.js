const express = require('express');
const router = express.Router();
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');
const { getSessionLog, getHistory } = require('../controllers/operationlogController');


router.get('/operation-logs/session/:sessionId', verifyToken, verifyUserActive, getSessionLog);
router.get('/operation-logs/history', verifyToken, verifyUserActive, getHistory);

module.exports = router;