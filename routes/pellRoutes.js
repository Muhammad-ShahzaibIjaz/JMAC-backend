const express = require('express');
const router = express.Router();
const pellController = require('../controllers/pellRuleController');

router.post('/pell-rule', pellController.createPellRule);
router.get('/pell-rules', pellController.getPellRules);
router.get('/pell-rule/:id', pellController.getPellRuleById);

module.exports = router;