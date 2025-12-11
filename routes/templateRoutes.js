const express = require('express');
const router = express.Router();
const templateController = require('../controllers/templateController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/templates', templateController.createTemplate);
router.delete('/templates/:id', templateController.deleteTemplate);
router.get('/templates' , templateController.getTemplates);
router.get('/template/:id', templateController.getTemplateByID);

module.exports = router;