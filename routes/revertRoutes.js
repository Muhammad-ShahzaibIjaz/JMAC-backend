const express = require('express');
const router = express.Router();
const revertController = require('../controllers/revertController');
const { verifyToken,  verifyUserActive } = require('../middlewares/authMiddleware');

router.put('/undo/:templateId/:sheetId', verifyToken, verifyUserActive, revertController.undoLatestOperation);
router.get('/check-undo/:templateId/:sheetId', verifyToken, verifyUserActive, revertController.checkUndoOperationAvailable);

module.exports = router;