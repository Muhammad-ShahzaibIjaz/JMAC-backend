const express = require('express');
const router = express.Router();
const pellController = require('../controllers/pellRuleController');

router.post('/pell-rule', pellController.createPellRule);
router.put('/pell-rule/:pellId', pellController.updatePellRule);
router.get('/pell-rules', pellController.getPellRules);
router.get('/pell-rule/:id', pellController.getPellRuleById);
router.delete('/pell-rule', pellController.deletePellRule);

module.exports = router;