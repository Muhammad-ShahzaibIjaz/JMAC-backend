const express = require("express");
const router = express.Router();
const { uploadAndGetHeaders, getFileSheets, uploadAndProcessData ,getExtractedHeadersByTemplateId,
processAndGetHeaderSelectedSheets ,processAndSaveSelectedSheets, processAndCompareHeaders, processAndGetSheetMapHeaders, getMissingHeaders} = require('../controllers/excelController');
const upload = require('../middlewares/fileUpload');
const { parseAPI } = require("../services/parseService");



router.post('/upload-and-get-headers', uploadAndGetHeaders);
router.post('/upload-and-get-missing-headers', getMissingHeaders);
router.post('/upload-and-process-data', uploadAndProcessData);
router.post('/get-sheets', upload ,getFileSheets);
router.post('/upload-and-get-selected-headers', processAndGetHeaderSelectedSheets);
router.post('/upload-and-get-selected-data', processAndSaveSelectedSheets);
router.post('/extract-map-headers/:mappingTemplateId', processAndCompareHeaders);
router.post('/extract-sheets-map-headers/:mappingTemplateId', processAndGetSheetMapHeaders);
router.get('/get-extracted-headers', getExtractedHeadersByTemplateId);
router.post('/parse-rule', parseAPI);


module.exports = router;