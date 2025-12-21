const express = require('express');
const router = express.Router();
const treeController = require('../controllers/treeController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/trees', verifyToken, verifyUserActive, treeController.createDecisionTree);
router.get('/trees/:templateId', verifyToken, verifyUserActive, treeController.getDecisionTreesByTemplate);
router.post('/trees/:treeId', verifyToken, verifyUserActive, treeController.getDecisionTreeById);
router.delete('/trees/:treeId', verifyToken, verifyUserActive, treeController.deleteDecisionTree);
router.put('/trees/:treeId', verifyToken, verifyUserActive, treeController.updateDecisionTree);
module.exports = router;