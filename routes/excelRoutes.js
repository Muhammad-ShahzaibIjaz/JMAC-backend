const express = require("express");
const router = express.Router();
const { handleHeaderProcessing, deleteUploadedFile, deleteUploadedFiles } = require('../controllers/excelController');
const upload = require('../middlewares/fileUpload');


router.post('/upload/header', upload.any(), handleHeaderProcessing);
router.delete('/upload/file', deleteUploadedFile );
router.delete('/upload/files', deleteUploadedFiles);


module.exports = router;