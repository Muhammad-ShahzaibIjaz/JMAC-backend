const express = require("express");
const router = express.Router();
const { uploadAndGetHeaders, getFileSheets, uploadAndProcessData ,getExtractedHeadersByTemplateId,
processAndGetHeaderSelectedSheets ,processAndSaveSelectedSheets, processAndCompareHeaders, processAndGetSheetMapHeaders, getMissingHeaders} = require('../controllers/excelController');
const upload = require('../middlewares/fileUpload');
const { parseAPI } = require("../services/parseService");
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');



router.post('/upload-and-get-headers', verifyToken, verifyUserActive, uploadAndGetHeaders);
router.post('/upload-and-get-missing-headers', verifyToken, verifyUserActive, getMissingHeaders);
router.post('/upload-and-process-data', verifyToken, verifyUserActive, uploadAndProcessData);
router.post('/get-sheets', verifyToken, verifyUserActive, upload ,getFileSheets);
router.post('/upload-and-get-selected-headers', verifyToken, verifyUserActive, processAndGetHeaderSelectedSheets);
router.post('/upload-and-get-selected-data', verifyToken, verifyUserActive, processAndSaveSelectedSheets);
router.post('/extract-map-headers/:mappingTemplateId', verifyToken, verifyUserActive, processAndCompareHeaders);
router.post('/extract-sheets-map-headers/:mappingTemplateId', verifyToken, verifyUserActive, processAndGetSheetMapHeaders);
router.get('/get-extracted-headers', verifyToken, verifyUserActive, getExtractedHeadersByTemplateId);
router.post('/parse-rule', verifyToken, verifyUserActive, parseAPI);


module.exports = router;