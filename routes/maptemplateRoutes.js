const express = require('express');
const router = express.Router();
const maptemplateController = require('../controllers/maptemplateController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/map-template/:templateId', verifyToken, verifyUserActive, maptemplateController.createMappingTemplate);
router.delete('/map-template/:id', verifyToken, verifyUserActive, maptemplateController.deleteMappingTemplate);
router.get('/map-template/:id', verifyToken, verifyUserActive, maptemplateController.getMappingTemplates);
router.put('/map-template', verifyToken, verifyUserActive, maptemplateController.updateMappingTemplate);

module.exports = router;