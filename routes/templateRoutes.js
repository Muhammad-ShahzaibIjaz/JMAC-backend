const express = require('express');
const router = express.Router();
const templateController = require('../controllers/templateController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/templates', verifyToken, verifyUserActive, templateController.createTemplate);
router.delete('/templates/:id', verifyToken, verifyUserActive, templateController.deleteTemplate);
router.get('/templates', verifyToken, verifyUserActive, templateController.getTemplates);
router.get('/templates/:campusId', verifyToken, verifyUserActive, templateController.getTemplatesByCampus);
router.get('/template/:id', verifyToken, verifyUserActive, templateController.getTemplateByID);
router.get('/template/permission/status', verifyToken, verifyUserActive, templateController.getTemplatePermissionStatus);

module.exports = router;