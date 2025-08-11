const express = require('express');
const router = express.Router();
const referenceController = require('../controllers/crossReferenceController');
const referenceMappingController = require('../controllers/referenceMappingController');
const upload = require('../middlewares/fileUpload');


router.post('/cross-references', referenceController.addCrossReference);
router.get('/cross-references', referenceController.getCrossReferences);
router.put('/cross-references', referenceController.updateCrossReferenceWithMapping);
router.get('/cross-references-without-mapping', referenceController.getCrossReferencesWithoutMapping);
router.delete('/cross-references', referenceController.deleteCrossReference);
router.post('/cross-reference-mappings', referenceMappingController.addReferenceMapping);
router.post('/apply-reference', referenceController.applyReference);
router.post('/get-mapping', referenceController.parseAndGetReferenceMapping);
router.post('/get-reference-header', upload, referenceController.getReferenceHeader);


module.exports = router;