const express = require("express");
const router = express.Router();
const { uploadAndGetHeaders, getFileSheets, processAndSaveSelectedSheets} = require('../controllers/excelController');
const upload = require('../middlewares/fileUpload');



router.post('/upload-and-get-headers', upload ,uploadAndGetHeaders);
router.post('/get-sheets', upload ,getFileSheets);
router.post('/upload-and-get-selected-headers', upload ,processAndSaveSelectedSheets);


module.exports = router;