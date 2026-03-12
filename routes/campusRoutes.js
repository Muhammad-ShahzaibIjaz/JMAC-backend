const express = require('express');
const router = express.Router();
const campusController = require('../controllers/campusController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');


router.post('/campus', verifyToken, verifyUserActive, campusController.createCampus);
router.put('/campus/:campusId', verifyToken, verifyUserActive, campusController.updateCampus);
router.delete('/campus', verifyToken, verifyUserActive, campusController.deleteCampus);
router.get('/campuses', verifyToken, verifyUserActive, campusController.getAllCampuses);


module.exports = router;