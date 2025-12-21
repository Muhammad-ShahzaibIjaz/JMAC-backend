const express = require('express');
const router = express.Router();
const projectionController = require('../controllers/projectionController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/data-project', verifyToken, verifyUserActive, projectionController.dataProject);

module.exports = router;