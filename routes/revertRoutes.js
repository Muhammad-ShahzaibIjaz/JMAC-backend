const express = require('express');
const router = express.Router();
const revertController = require('../controllers/revertController');

router.put('/undo/:templateId', revertController.undoLatestOperation);
router.get('/check-undo/:templateId', revertController.checkUndoOperationAvailable);

module.exports = router;