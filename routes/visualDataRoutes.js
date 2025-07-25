const express = require('express');
const router = express.Router();
const visualDataController = require('../controllers/visualDataController');

router.get('/ranges', visualDataController.categorizer);
router.get('/get-categorize-data', visualDataController.getDataWithRange);
router.post('/category-breakdown', visualDataController.getCategoryStats);
router.get('/count-students/:templateId', visualDataController.countStudentsByTemplate);


module.exports = router;