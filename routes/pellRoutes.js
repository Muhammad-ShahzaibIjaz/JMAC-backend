const express = require('express');
const router = express.Router();
const pellController = require('../controllers/pellRuleController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/pell-rule', verifyToken, verifyUserActive, pellController.createPellRule);
router.put('/pell-rule/:pellId', verifyToken, verifyUserActive, pellController.updatePellRule);
router.get('/pell-rules', verifyToken, verifyUserActive, pellController.getPellRules);
router.get('/pell-rule/:id', verifyToken, verifyUserActive, pellController.getPellRuleById);
router.delete('/pell-rule', verifyToken, verifyUserActive, pellController.deletePellRule);

module.exports = router;