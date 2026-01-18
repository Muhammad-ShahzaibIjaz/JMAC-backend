const express = require('express');
const router = express.Router();
const populationStatusController = require('../controllers/PopulationStatusController');
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

router.post('/save-status', verifyToken, verifyUserActive, populationStatusController.savePopulationStatus);
router.get('/status/:templateId', verifyToken, verifyUserActive, populationStatusController.getPopulationStatusByTemplateId);
router.put('/status', verifyToken, verifyUserActive, populationStatusController.updatePopulationStatus);
router.delete('/status/:id', verifyToken, verifyUserActive, populationStatusController.deletePopulationStatus);
router.post('/save-submission-date', verifyToken, verifyUserActive, populationStatusController.savePopulationSubmissionDate);
router.get('/submissions/:templateId', verifyToken, verifyUserActive, populationStatusController.getPopulationSubmissionsByTemplateId);
router.put('/submission', verifyToken, verifyUserActive, populationStatusController.updatePopulationSubmissionDate);
router.delete('/submission/:id', verifyToken, verifyUserActive, populationStatusController.deletePopulationSubmission);
router.post('/closest-dates', verifyToken, verifyUserActive, populationStatusController.findClosestPreviousDate);
router.post('/headcount-by-year', verifyToken, verifyUserActive, populationStatusController.getStudentHeadCountByYear);
router.post('/kpi-of-students', verifyToken, verifyUserActive, populationStatusController.getKPIOfStudents);
router.post('/financial-aids', verifyToken, verifyUserActive, populationStatusController.getFinancialAidsValues);
router.post('/fafsa-filer-summary', verifyToken, verifyUserActive, populationStatusController.getFAFSAFilerSummary);
router.post('/award-stats', verifyToken, verifyUserActive, populationStatusController.getAwardStats);
router.post('/stealth-headcount-by-year', verifyToken, verifyUserActive, populationStatusController.getStudentStealthCountByYear);
router.post('/exportable-student-data', verifyToken, verifyUserActive, populationStatusController.getExportableStudentData);
router.post('/data-by-state-county', verifyToken, verifyUserActive, populationStatusController.getDatabyStateCounty);
router.post('/previous-census-stats', populationStatusController.getPreviousCensusStats);

module.exports = router;