const express = require('express');
const router = express.Router();
const fileController = require('../controllers/fileController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.delete('/file', verifyToken, verifyUserActive, fileController.deleteFile);
router.delete('/files', verifyToken, verifyUserActive, fileController.deleteFiles);
router.get('/files', verifyToken, verifyUserActive, fileController.getFiles);
module.exports = router;