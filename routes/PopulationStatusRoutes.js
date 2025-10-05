const express = require('express');
const router = express.Router();
const populationStatusController = require('../controllers/PopulationStatusController');

router.post('/save-status', populationStatusController.savePopulationStatus);
router.get('/status/:templateId', populationStatusController.getPopulationStatusByTemplateId);
router.put('/status', populationStatusController.updatePopulationStatus);
router.delete('/status/:id', populationStatusController.deletePopulationStatus);
router.post('/save-submission-date', populationStatusController.savePopulationSubmissionDate);
router.get('/submissions/:templateId', populationStatusController.getPopulationSubmissionsByTemplateId);
router.put('/submission', populationStatusController.updatePopulationSubmissionDate);
router.delete('/submission/:id', populationStatusController.deletePopulationSubmission);
router.post('/closest-dates', populationStatusController.findClosestPreviousDate);
router.post('/headcount-by-year', populationStatusController.getStudentHeadCountByYear);
router.post('/kpi-of-students', populationStatusController.getKPIOfStudents);
router.post('/financial-aids', populationStatusController.getFinancialAidsValues);
router.post('/fafsa-filer-summary', populationStatusController.getFAFSAFilerSummary);
router.post('/award-stats', populationStatusController.getAwardStats);
router.post('/stealth-headcount-by-year', populationStatusController.getStudentStealthCountByYear);
router.post('/exportable-student-data', populationStatusController.getExportableStudentData);

module.exports = router;