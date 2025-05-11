const express = require('express');
const router = express.Router();
const headerController = require('../controllers/headerController');

router.post('/headers', headerController.createHeader);
router.delete('/headers/:id', headerController.deleteHeader);
router.put('/headers/:id', headerController.updateHeader);
router.get('/headers/:id', headerController.getHeader);
router.post('/headers/export', headerController.exportHeaders);
router.get('/headers-with-mapping', headerController.getHeadersWithMapHeaders);


module.exports = router;