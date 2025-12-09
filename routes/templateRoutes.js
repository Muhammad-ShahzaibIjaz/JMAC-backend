const express = require('express');
const router = express.Router();
const templateController = require('../controllers/templateController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/templates', verifyToken, templateController.createTemplate);
router.delete('/templates/:id', verifyToken, templateController.deleteTemplate);
router.get('/templates' , verifyToken, templateController.getTemplates);
router.get('/template/:id', verifyToken, templateController.getTemplateByID);

module.exports = router;