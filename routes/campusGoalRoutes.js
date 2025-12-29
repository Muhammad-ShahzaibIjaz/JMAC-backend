const express = require('express');
const router = express.Router();
const campusController = require('../controllers/campusGoalController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');


router.post('/goal', verifyToken, verifyUserActive, campusController.createCampusGoal);
router.put('/goal/:goalId', verifyToken, verifyUserActive, campusController.updateCampusGoal);
router.delete('/goal', verifyToken, verifyUserActive, campusController.deleteCampusGoal);
router.get('/goals', verifyToken, verifyUserActive, campusController.getCampusGoalsByTemplate);


module.exports = router;