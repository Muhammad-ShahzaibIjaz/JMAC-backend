const express = require('express');
const router = express.Router();
const populationController = require('../controllers/populationController');

router.get('/ranges', populationController.categorizer);
router.post('/category-breakdown', populationController.getCategoryStats);
router.get('/count-students/:templateId/:sheetId', populationController.countStudentsByTemplate);


module.exports = router;