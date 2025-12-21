const express = require('express');
const router = express.Router();
const sheetController = require('../controllers/sheetController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/sheet', verifyToken, verifyUserActive, sheetController.createSheet);
router.get('/sheets', verifyToken, verifyUserActive, sheetController.getSheets);
router.get('/sheets/:templateId', verifyToken, verifyUserActive, sheetController.getSheetsByTemplateId);
router.delete('/sheet/:id', verifyToken, verifyUserActive, sheetController.deleteSheet);

module.exports = router;