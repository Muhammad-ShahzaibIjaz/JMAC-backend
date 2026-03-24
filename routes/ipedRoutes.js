const express = require('express');
const router = express.Router();
const ipedController = require('../controllers/ipedController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');


router.get('/institutions', verifyToken, verifyUserActive, ipedController.getAllInstNames);

module.exports = router;