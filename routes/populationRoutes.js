const express = require('express');
const router = express.Router();
const populationController = require('../controllers/populationController');

router.get('/ranges', populationController.categorizer);
router.get('/get-categorize-data', populationController.getDataWithRange);
router.post('/category-breakdown', populationController.getCategoryStats);
router.get('/count-students/:templateId', populationController.countStudentsByTemplate);


module.exports = router;