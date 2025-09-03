const express = require('express');
const router = express.Router();
const sheetController = require('../controllers/sheetController');

router.post('/sheet', sheetController.createSheet);
router.get('/sheets', sheetController.getSheets);

module.exports = router;