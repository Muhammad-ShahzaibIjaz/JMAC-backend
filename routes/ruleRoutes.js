const express = require('express');
const router = express.Router();
const ruleController = require('../controllers/RuleController');

router.delete('/rules/:id', ruleController.deleteRule);
router.post('/rules', ruleController.createRule);
router.put('/rules/:id', ruleController.updateRule);
router.get('/rules/:templateId', ruleController.getAllRules);
router.get('/rules', ruleController.getRuleById);
router.get('/bulk-rules', ruleController.getBulkRulesByTemplateId);
router.post('/bulk-rule', ruleController.createBulkRule);
router.put('/apply-bulk-rule', ruleController.applyBulkRule);
router.delete('/bulk-rule', ruleController.deleteBulkRule);

module.exports = router;