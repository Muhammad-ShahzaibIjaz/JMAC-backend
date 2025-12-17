const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken } = require('../middlewares/authMiddleware');

router.post('/user', userController.createUser);
router.post('/login', userController.login);
router.get('/me', verifyToken, userController.getMyInfo);

module.exports = router;