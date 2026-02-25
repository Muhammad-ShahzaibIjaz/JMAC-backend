const express = require('express');
const router = express.Router();
const pellController = require('../controllers/pellRuleController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/pell-rule', verifyToken, verifyUserActive, pellController.createPellRule);
router.post('/pell-rule/duplicate', verifyToken, verifyUserActive, pellController.duplicatePellRule);
router.put('/pell-rule/:pellId', verifyToken, verifyUserActive, pellController.updatePellRule);
router.get('/pell-rules', verifyToken, verifyUserActive, pellController.getPellRules);
router.get('/pell-rule/:id', verifyToken, verifyUserActive, pellController.getPellRuleById);
router.delete('/pell-rule', verifyToken, verifyUserActive, pellController.deletePellRule);

module.exports = router;