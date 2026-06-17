const express = require("express");
const router = express.Router();
const { verifyToken, verifyUserActive } = require('../middlewares/authMiddleware');

const {
  getCoa,
  saveCoa,
  deleteCoa,
  getFunnel,
  saveFunnel,
  deleteFunnel,
} = require("../controllers/onboardingController");

const {
  getInstitutionList,
  saveInstitutionList,
  deleteInstitutionList,
  copyInstitutionsFromForm,
} = require("../controllers/onboardingInstitutionController");

// NOTE: assumes the same auth middleware used elsewhere already runs and sets
// req.userId / req.userRole (mount this router behind that middleware, exactly
// like the template routes).

// ── Cost of Attendance ──────────────────────────────────────────────────────
router.get("/onboarding/coa/:campusId", getCoa);
router.put("/onboarding/coa/:campusId", verifyToken, verifyUserActive, saveCoa);
router.delete("/onboarding/coa/:campusId", verifyToken, verifyUserActive, deleteCoa);

// ── Historical Admission Funnel ─────────────────────────────────────────────
router.get("/onboarding/funnel/:campusId", getFunnel);
router.put("/onboarding/funnel/:campusId", verifyToken, verifyUserActive, saveFunnel);
router.delete("/onboarding/funnel/:campusId", verifyToken, verifyUserActive, deleteFunnel);

// ── Institution lists (competitor | crossApplicant | aspirant) ──────────────
router.get("/onboarding/institutions/:campusId/:formType", getInstitutionList);
router.put("/onboarding/institutions/:campusId/:formType", verifyToken, verifyUserActive, saveInstitutionList);
router.delete("/onboarding/institutions/:campusId/:formType", verifyToken, verifyUserActive, deleteInstitutionList);
router.post("/onboarding/institutions/:campusId/:formType/copy-from", verifyToken, verifyUserActive, copyInstitutionsFromForm);

module.exports = router;