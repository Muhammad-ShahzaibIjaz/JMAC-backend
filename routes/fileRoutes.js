const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');

router.delete('/file', fileController.deleteFile);
router.delete('/files', fileController.deleteFiles);

module.exports = router;