const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

router.delete('/sheet-data', dataController.deleteSheetData);
router.get('/headers-with-validated-data', dataController.getHeadersWithValidatedData);
router.get('/pag-sheet-data', dataController.getValidatedPageData);
router.get('/export-data', dataController.getTemplateDataWithExcel);


module.exports = router;