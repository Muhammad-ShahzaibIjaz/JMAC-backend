const express = require('express');
const router = express.Router();
const headerController = require('../controllers/headerController');
const { verifyToken,  verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/headers', verifyToken, verifyUserActive, headerController.createHeader);
router.post('/base-headers', verifyToken, verifyUserActive, headerController.createBaseHeader);
router.delete('/headers/:id', verifyToken, verifyUserActive, headerController.deleteHeader);
router.put('/headers/:id', verifyToken, verifyUserActive, headerController.updateHeader);
router.get('/headers/:id', verifyToken, verifyUserActive, headerController.getHeader);
router.get('/qualified-headers/:id', verifyToken, verifyUserActive, headerController.getQualifiedHeaders);
router.post('/headers/export', verifyToken, verifyUserActive, headerController.exportHeaders);
router.get('/headers-with-mapping', verifyToken, verifyUserActive, headerController.getHeadersWithMapHeaders);
router.post('/runtimeheaders', verifyToken, verifyUserActive, headerController.createRunTimeHeader);

module.exports = router;