const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, verifyAdmin, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/user', verifyToken, verifyUserActive, verifyAdmin,  userController.createUser);
router.put('/user', verifyToken, verifyUserActive, verifyAdmin, userController.updateUser);
router.put('/user/password', verifyToken, verifyUserActive, verifyAdmin, userController.updatePassword);
router.delete('/user', verifyToken, verifyUserActive, verifyAdmin, userController.deleteUser);
router.post('/login', userController.login);
router.post('/logout', verifyToken, userController.logout);
router.get('/me', verifyToken, verifyUserActive, userController.getMyInfo);
router.get('/users', verifyToken, verifyUserActive, verifyAdmin, userController.getUsersInfo);

module.exports = router;