const express = require('express');
const router = express.Router();
const dataController = require('../controllers/dataController');

router.delete('/sheet-data', dataController.deleteSheetData);
router.get('/headers-with-validated-data', dataController.getHeadersWithValidatedData);
router.get('/headers-with-search-data', dataController.getFilteredHeaderData);
router.get('/headers-with-duplicate-data', dataController.getHeadersWithDuplicateData);
router.get('/pag-sheet-data', dataController.getValidatedPageData);
router.get('/export-data', dataController.getTemplateDataWithExcel);
router.put('/update-rows', dataController.updateRows);
router.put('/bulk-update', dataController.bulkUpdateData);
router.put('/padding', dataController.addPadding);
router.get('/get-matrixpop/:templateId', dataController.getMatrixPop);
router.put('/apply-calculation', dataController.applyCalculations);
router.post('/add-row/:templateId', dataController.addRow);
router.put('/find-zipcode', dataController.findZipCodes);
router.put('/score-conversion', dataController.scoreConversion);
router.put('/cip-conversion', dataController.cipConversion);
router.put('/zip-county-conversion', dataController.zipCountyConversion);
router.post('/apply-quality-rules', dataController.evaluateRulesAndReturnFilteredData);
router.delete('/delete-row/:templateId/:rowIndex', dataController.deleteRow);
router.put('/award-calculation', dataController.calculateAwardInfo);
router.put('/find-pell', dataController.calculatePellFlag);
router.put('/replace-value', dataController.bulkReplaceValues);

module.exports = router;