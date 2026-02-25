const express = require('express');
const router = express.Router();
const referenceController = require('../controllers/crossReferenceController');
const referenceMappingController = require('../controllers/referenceMappingController');
const upload = require('../middlewares/fileUpload');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');


router.post('/cross-references', verifyToken, verifyUserActive, referenceController.addCrossReference);
router.post('/cross-references/duplicate', verifyToken, verifyUserActive, referenceController.duplicateCrossReference);
router.get('/cross-references', verifyToken, verifyUserActive, referenceController.getCrossReferences);
router.put('/cross-references', verifyToken, verifyUserActive, referenceController.updateCrossReferenceWithMapping);
router.get('/cross-references-without-mapping', verifyToken, verifyUserActive, referenceController.getCrossReferencesWithoutMapping);
router.delete('/cross-references', verifyToken, verifyUserActive, referenceController.deleteCrossReference);
router.post('/cross-reference-mappings', verifyToken, verifyUserActive, referenceMappingController.addReferenceMapping);
router.post('/apply-reference', verifyToken, verifyUserActive, referenceController.applyReference);
router.post('/get-mapping', verifyToken, verifyUserActive, referenceController.parseAndGetReferenceMapping);
router.post('/get-reference-header', verifyToken, verifyUserActive, upload, referenceController.getReferenceHeader);


module.exports = router;