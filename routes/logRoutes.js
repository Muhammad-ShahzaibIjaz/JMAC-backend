const express = require('express');
const router = express.Router();
const logController = require('../controllers/logController');
const { verifyToken, verifyAdmin, verifyUserActive } = require('../middlewares/authMiddleware');

router.get('/logs', verifyToken, verifyUserActive, verifyAdmin, logController.getLogs);

module.exports = router;