const express = require('express');
const router = express.Router();
const visualDataController = require('../controllers/visualDataController');

router.post('/categorize', visualDataController.categorizer);
router.get('/get-categorize-data', visualDataController.getDataWithRange);
router.post('/category-breakdown', visualDataController.getCategoryStats);

module.exports = router;