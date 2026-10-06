const express = require('express');
const router = express.Router();
const controller = require('../controllers/bandlabelController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.get('/band-labels', verifyToken, verifyUserActive, controller.getBandLabels);
router.put('/band-labels', verifyToken, verifyUserActive, controller.saveBandLabels);

module.exports = router;