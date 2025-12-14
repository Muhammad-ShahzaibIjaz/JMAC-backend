const express = require('express');
const router = express.Router();
const projectionController = require('../controllers/projectionController');

router.post('/data-project', projectionController.dataProject);

module.exports = router;