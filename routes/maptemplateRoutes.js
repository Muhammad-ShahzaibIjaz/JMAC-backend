const express = require('express');
const router = express.Router();
const maptemplateController = require('../controllers/maptemplateController');

router.post('/map-template/:templateId', maptemplateController.createMappingTemplate);
router.delete('/map-template/:id', maptemplateController.deleteMappingTemplate);
router.get('/map-template/:id', maptemplateController.getMappingTemplates);

module.exports = router;