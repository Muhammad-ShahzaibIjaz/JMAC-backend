const express = require('express');
const router = express.Router();
const mapHeaderController = require('../controllers/mapheaderController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.put('/map-headers/:maptemplateId', verifyToken, verifyUserActive, mapHeaderController.updateMapHeader);
router.get('/map-headers', verifyToken, verifyUserActive, mapHeaderController.getMapHeader);
router.get('/export-mapping', verifyToken, verifyUserActive, mapHeaderController.exportHeaderMapping);
module.exports = router;