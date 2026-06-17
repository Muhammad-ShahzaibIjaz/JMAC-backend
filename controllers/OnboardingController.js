const sequelize = require("../config/database");
const OnboardingCoa = require("../models/Onboardingcoa");
const OnboardingFunnel = require("../models/Onboardingfunnel");
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require("./userController");

/* ──────────────────────────────────────────────────────────────────────────
 *  COST OF ATTENDANCE
 * ──────────────────────────────────────────────────────────────────────── */

// GET /api/onboarding/coa/:campusId
async function getCoa(req, res) {
  const { campusId } = req.params;
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    const coa = await OnboardingCoa.findOne({ where: { campusId } });
    if (!coa) {
      // No form yet — return an empty shell so the frontend can render a blank form.
      return res.status(200).json(null);
    }
    res.json({
      id: coa.id,
      campusId: coa.campusId,
      schoolType: coa.schoolType,
      data: coa.data,
    });
  } catch (error) {
    console.error("Error fetching COA:", error);
    res.status(500).json({ error: error.message });
  }
}

// PUT /api/onboarding/coa/:campusId  (upsert — create on first save, update after)
async function saveCoa(req, res) {
  const { campusId } = req.params;
  const { schoolType, data } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (data === undefined || data === null || typeof data !== "object") {
      return res.status(400).json({ error: "data is required and must be an object" });
    }

    const result = await sequelize.transaction(async (t) => {
      const existing = await OnboardingCoa.findOne({ where: { campusId }, transaction: t });
      if (existing) {
        existing.schoolType = schoolType ?? existing.schoolType;
        existing.data = data;
        await existing.save({ transaction: t });
        return { record: existing, created: false };
      }
      const record = await OnboardingCoa.create(
        { campusId, schoolType: schoolType ?? null, data },
        { transaction: t }
      );
      return { record, created: true };
    });

    await createLog({
      action: result.created ? "CREATE_ONBOARDING_COA" : "UPDATE_ONBOARDING_COA",
      username,
      performedBy: req.userRole,
      details: `Cost of Attendance ${result.created ? "created" : "updated"} for campus ${campusId}`,
    });

    res.status(result.created ? 201 : 200).json({
      id: result.record.id,
      campusId: result.record.campusId,
      schoolType: result.record.schoolType,
      data: result.record.data,
    });
  } catch (error) {
    await createLog({ action: "SAVE_ONBOARDING_COA_FAILED", username, performedBy: req.userRole, details: `Failed to save COA for campus '${campusId}': ${error.message}` });
    console.error("Error saving COA:", error);
    res.status(500).json({ error: error.message });
  }
}

// DELETE /api/onboarding/coa/:campusId
async function deleteCoa(req, res) {
  const { campusId } = req.params;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    const count = await OnboardingCoa.destroy({ where: { campusId } });
    if (count === 0) {
      return res.status(404).json({ error: "Cost of Attendance form not found" });
    }
    await createLog({ action: "DELETE_ONBOARDING_COA", username, performedBy: req.userRole, details: `Cost of Attendance deleted for campus ${campusId}` });
    res.status(200).json({ deleted: true });
  } catch (error) {
    await createLog({ action: "DELETE_ONBOARDING_COA_FAILED", username, performedBy: req.userRole, details: `Failed to delete COA for campus '${campusId}': ${error.message}` });
    console.error("Error deleting COA:", error);
    res.status(500).json({ error: error.message });
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 *  HISTORICAL ADMISSION FUNNEL
 * ──────────────────────────────────────────────────────────────────────── */

// GET /api/onboarding/funnel/:campusId
async function getFunnel(req, res) {
  const { campusId } = req.params;
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    const funnel = await OnboardingFunnel.findOne({ where: { campusId } });
    if (!funnel) {
      return res.status(200).json(null);
    }
    res.json({
      id: funnel.id,
      campusId: funnel.campusId,
      admissionsDatabase: funnel.admissionsDatabase,
      financialAidDatabase: funnel.financialAidDatabase,
      rows: funnel.rows,
    });
  } catch (error) {
    console.error("Error fetching funnel:", error);
    res.status(500).json({ error: error.message });
  }
}

// PUT /api/onboarding/funnel/:campusId  (upsert)
async function saveFunnel(req, res) {
  const { campusId } = req.params;
  const { admissionsDatabase, financialAidDatabase, rows } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (!Array.isArray(rows)) {
      return res.status(400).json({ error: "rows is required and must be an array" });
    }

    const result = await sequelize.transaction(async (t) => {
      const existing = await OnboardingFunnel.findOne({ where: { campusId }, transaction: t });
      if (existing) {
        existing.admissionsDatabase = admissionsDatabase ?? existing.admissionsDatabase;
        existing.financialAidDatabase = financialAidDatabase ?? existing.financialAidDatabase;
        existing.rows = rows;
        await existing.save({ transaction: t });
        return { record: existing, created: false };
      }
      const record = await OnboardingFunnel.create(
        {
          campusId,
          admissionsDatabase: admissionsDatabase ?? null,
          financialAidDatabase: financialAidDatabase ?? null,
          rows,
        },
        { transaction: t }
      );
      return { record, created: true };
    });

    await createLog({
      action: result.created ? "CREATE_ONBOARDING_FUNNEL" : "UPDATE_ONBOARDING_FUNNEL",
      username,
      performedBy: req.userRole,
      details: `Historical Admission Funnel ${result.created ? "created" : "updated"} for campus ${campusId}`,
    });

    res.status(result.created ? 201 : 200).json({
      id: result.record.id,
      campusId: result.record.campusId,
      admissionsDatabase: result.record.admissionsDatabase,
      financialAidDatabase: result.record.financialAidDatabase,
      rows: result.record.rows,
    });
  } catch (error) {
    await createLog({ action: "SAVE_ONBOARDING_FUNNEL_FAILED", username, performedBy: req.userRole, details: `Failed to save funnel for campus '${campusId}': ${error.message}` });
    console.error("Error saving funnel:", error);
    res.status(500).json({ error: error.message });
  }
}

// DELETE /api/onboarding/funnel/:campusId
async function deleteFunnel(req, res) {
  const { campusId } = req.params;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    const count = await OnboardingFunnel.destroy({ where: { campusId } });
    if (count === 0) {
      return res.status(404).json({ error: "Historical Admission Funnel form not found" });
    }
    await createLog({ action: "DELETE_ONBOARDING_FUNNEL", username, performedBy: req.userRole, details: `Historical Admission Funnel deleted for campus ${campusId}` });
    res.status(200).json({ deleted: true });
  } catch (error) {
    await createLog({ action: "DELETE_ONBOARDING_FUNNEL_FAILED", username, performedBy: req.userRole, details: `Failed to delete funnel for campus '${campusId}': ${error.message}` });
    console.error("Error deleting funnel:", error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getCoa,
  saveCoa,
  deleteCoa,
  getFunnel,
  saveFunnel,
  deleteFunnel,
};