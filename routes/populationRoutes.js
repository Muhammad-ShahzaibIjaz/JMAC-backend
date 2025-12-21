const express = require('express');
const router = express.Router();
const populationController = require('../controllers/populationController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/ranges', verifyToken, verifyUserActive, populationController.categorizer);
router.post('/category-breakdown', verifyToken, verifyUserActive, populationController.getCategoryStats);
router.get('/count-students/:templateId/:sheetId', verifyToken, verifyUserActive, populationController.countStudentsByTemplate);

module.exports = router;