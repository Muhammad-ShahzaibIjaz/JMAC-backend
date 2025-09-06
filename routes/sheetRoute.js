const express = require('express');
const router = express.Router();
const sheetController = require('../controllers/sheetController');

router.post('/sheet', sheetController.createSheet);
router.get('/sheets', sheetController.getSheets);
router.get('/sheets/:templateId', sheetController.getSheetsByTemplateId);
router.delete('/sheet/:id', sheetController.deleteSheet);

module.exports = router;