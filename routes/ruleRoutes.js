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
router.put('/bulk-rule/:id', ruleController.updateBulkRule);
router.put('/apply-bulk-rule', ruleController.applyBulkRule);
router.delete('/bulk-rule', ruleController.deleteBulkRule);
router.post('/conditional-rule', ruleController.createConditionalRule);
router.put('/conditional-rule', ruleController.updateConditionalRule);
router.get('/conditional-rules/:templateId', ruleController.getAllConditionalRules);
router.get('/conditional-rule', ruleController.getConditionalRuleById);
router.delete('/conditional-rule', ruleController.deleteConditionalRule);
router.post('/population-rule', ruleController.createPopulationRule);
router.get('/population-rules/:templateId/:ruleType', ruleController.getPopulationRuleByTemplateId);
router.get('/population-rule', ruleController.getPopulationRuleById);
router.delete('/population-rule', ruleController.deletePopulationRule);
router.put('/population-rule', ruleController.updatePopulationRule);
router.post('/auto-population-rule', ruleController.autoPopulationRule);

module.exports = router;