const express = require('express');
const router = express.Router();
const viewGoalController = require('../controllers/viewGoalController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');


router.post('/view-goal', verifyToken, verifyUserActive, viewGoalController.createViewGoal);
router.put('/view-goal/:goalId', verifyToken, verifyUserActive, viewGoalController.updateViewGoal);
router.get('/view-goals', verifyToken, verifyUserActive, viewGoalController.getViewGoalsByTemplate);

module.exports = router;