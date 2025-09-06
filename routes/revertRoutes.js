const express = require('express');
const router = express.Router();
const revertController = require('../controllers/revertController');

router.put('/undo/:templateId/:sheetId', revertController.undoLatestOperation);
router.get('/check-undo/:templateId/:sheetId', revertController.checkUndoOperationAvailable);

module.exports = router;