const express = require('express');
const router = express.Router();
const headerController = require('../controllers/headerController');

router.post('/headers', headerController.createHeader);
router.post('/base-headers', headerController.createBaseHeader);
router.delete('/headers/:id', headerController.deleteHeader);
router.put('/headers/:id', headerController.updateHeader);
router.get('/headers/:id', headerController.getHeader);
router.get('/qualified-headers/:id', headerController.getQualifiedHeaders);
router.post('/headers/export', headerController.exportHeaders);
router.get('/headers-with-mapping', headerController.getHeadersWithMapHeaders);
router.post('/runtimeheaders', headerController.createRunTimeHeader);

module.exports = router;