const express = require('express');
const router = express.Router();
const treeController = require('../controllers/treeController');


router.post('/trees', treeController.createDecisionTree);
router.get('/trees/:templateId', treeController.getDecisionTreesByTemplate);
router.post('/trees/:treeId', treeController.getDecisionTreeById);
router.delete('/trees/:treeId', treeController.deleteDecisionTree);
router.put('/trees/:treeId', treeController.updateDecisionTree);

module.exports = router;