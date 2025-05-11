const express = require('express');
const router = express.Router();
const mapHeaderController = require('../controllers/mapheaderController');

router.put('/map-headers/:maptemplateId', mapHeaderController.updateMapHeader);
router.get('/map-headers', mapHeaderController.getMapHeader);

module.exports = router;