const sequelize = require("../config/database");
const OnboardingInstitutionList = require("../models/OnboardingInstitutionList");
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require("./userController");

const VALID_FORM_TYPES = ["competitor", "crossApplicant", "aspirant"];
const FORM_LABELS = {
  competitor: "Competitor Institutions",
  crossApplicant: "Cross-Applicant Institutions",
  aspirant: "Aspirant Institutions",
};

function isValidFormType(t) {
  return VALID_FORM_TYPES.includes(t);
}

// Normalize an institutions payload into [{name, city, state}] and drop empties.
function sanitizeInstitutions(institutions) {
  if (!Array.isArray(institutions)) return [];
  return institutions
    .map((i) => ({
      name: typeof i?.name === "string" ? i.name.trim() : "",
      city: typeof i?.city === "string" ? i.city.trim() : "",
      state: typeof i?.state === "string" ? i.state.trim() : "",
    }))
    .filter((i) => i.name || i.city || i.state);
}

// GET /api/onboarding/institutions/:campusId/:formType
async function getInstitutionList(req, res) {
  const { campusId, formType } = req.params;
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (!isValidFormType(formType)) {
      return res.status(400).json({ error: `formType must be one of: ${VALID_FORM_TYPES.join(", ")}` });
    }
    const list = await OnboardingInstitutionList.findOne({ where: { campusId, formType } });
    if (!list) {
      return res.status(200).json(null);
    }
    res.json({
      id: list.id,
      campusId: list.campusId,
      formType: list.formType,
      institutions: list.institutions,
    });
  } catch (error) {
    console.error("Error fetching institution list:", error);
    res.status(500).json({ error: error.message });
  }
}

// PUT /api/onboarding/institutions/:campusId/:formType  (upsert)
async function saveInstitutionList(req, res) {
  const { campusId, formType } = req.params;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (!isValidFormType(formType)) {
      return res.status(400).json({ error: `formType must be one of: ${VALID_FORM_TYPES.join(", ")}` });
    }
    const institutions = sanitizeInstitutions(req.body.institutions);

    const result = await sequelize.transaction(async (t) => {
      const existing = await OnboardingInstitutionList.findOne({ where: { campusId, formType }, transaction: t });
      if (existing) {
        existing.institutions = institutions;
        await existing.save({ transaction: t });
        return { record: existing, created: false };
      }
      const record = await OnboardingInstitutionList.create(
        { campusId, formType, institutions },
        { transaction: t }
      );
      return { record, created: true };
    });

    await createLog({
      action: result.created ? "CREATE_ONBOARDING_INSTITUTIONS" : "UPDATE_ONBOARDING_INSTITUTIONS",
      username,
      performedBy: req.userRole,
      details: `${FORM_LABELS[formType]} ${result.created ? "created" : "updated"} for campus ${campusId} (${institutions.length} institutions)`,
    });

    res.status(result.created ? 201 : 200).json({
      id: result.record.id,
      campusId: result.record.campusId,
      formType: result.record.formType,
      institutions: result.record.institutions,
    });
  } catch (error) {
    await createLog({ action: "SAVE_ONBOARDING_INSTITUTIONS_FAILED", username, performedBy: req.userRole, details: `Failed to save ${formType} institutions for campus '${campusId}': ${error.message}` });
    console.error("Error saving institution list:", error);
    res.status(500).json({ error: error.message });
  }
}

// DELETE /api/onboarding/institutions/:campusId/:formType
async function deleteInstitutionList(req, res) {
  const { campusId, formType } = req.params;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (!isValidFormType(formType)) {
      return res.status(400).json({ error: `formType must be one of: ${VALID_FORM_TYPES.join(", ")}` });
    }
    const count = await OnboardingInstitutionList.destroy({ where: { campusId, formType } });
    if (count === 0) {
      return res.status(404).json({ error: `${FORM_LABELS[formType]} form not found` });
    }
    await createLog({ action: "DELETE_ONBOARDING_INSTITUTIONS", username, performedBy: req.userRole, details: `${FORM_LABELS[formType]} deleted for campus ${campusId}` });
    res.status(200).json({ deleted: true });
  } catch (error) {
    await createLog({ action: "DELETE_ONBOARDING_INSTITUTIONS_FAILED", username, performedBy: req.userRole, details: `Failed to delete ${formType} institutions for campus '${campusId}': ${error.message}` });
    console.error("Error deleting institution list:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * POST /api/onboarding/institutions/:campusId/:formType/copy-from
 * body: { sourceFormType }
 *
 * Copies the institutions from sourceFormType into the target form. This is the
 * "Copy institutions from another form?" → pick a form → Apply feature.
 * Institutions already present in the target (matched on name+city+state,
 * case-insensitive) are not duplicated.
 */
async function copyInstitutionsFromForm(req, res) {
  const { campusId, formType } = req.params; // target form
  const { sourceFormType } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!campusId || typeof campusId !== "string") {
      return res.status(400).json({ error: "campusId is required" });
    }
    if (!isValidFormType(formType)) {
      return res.status(400).json({ error: `formType must be one of: ${VALID_FORM_TYPES.join(", ")}` });
    }
    if (!isValidFormType(sourceFormType)) {
      return res.status(400).json({ error: `sourceFormType must be one of: ${VALID_FORM_TYPES.join(", ")}` });
    }
    if (sourceFormType === formType) {
      return res.status(400).json({ error: "Source form must be different from the target form" });
    }

    const source = await OnboardingInstitutionList.findOne({ where: { campusId, formType: sourceFormType } });
    if (!source || !Array.isArray(source.institutions) || source.institutions.length === 0) {
      return res.status(404).json({ error: `No institutions found in ${FORM_LABELS[sourceFormType]}` });
    }

    const result = await sequelize.transaction(async (t) => {
      const target = await OnboardingInstitutionList.findOne({ where: { campusId, formType }, transaction: t });
      const existing = target ? sanitizeInstitutions(target.institutions) : [];

      const key = (i) => `${i.name}|${i.city}|${i.state}`.toLowerCase();
      const seen = new Set(existing.map(key));
      const incoming = sanitizeInstitutions(source.institutions).filter((i) => !seen.has(key(i)));
      const merged = [...existing, ...incoming];

      let record;
      let created = false;
      if (target) {
        target.institutions = merged;
        await target.save({ transaction: t });
        record = target;
      } else {
        record = await OnboardingInstitutionList.create(
          { campusId, formType, institutions: merged },
          { transaction: t }
        );
        created = true;
      }
      return { record, created, copiedCount: incoming.length };
    });

    await createLog({
      action: "COPY_ONBOARDING_INSTITUTIONS",
      username,
      performedBy: req.userRole,
      details: `Copied ${result.copiedCount} institutions from ${FORM_LABELS[sourceFormType]} into ${FORM_LABELS[formType]} for campus ${campusId}`,
    });

    res.status(200).json({
      id: result.record.id,
      campusId: result.record.campusId,
      formType: result.record.formType,
      institutions: result.record.institutions,
      copiedCount: result.copiedCount,
    });
  } catch (error) {
    await createLog({ action: "COPY_ONBOARDING_INSTITUTIONS_FAILED", username, performedBy: req.userRole, details: `Failed to copy institutions into ${formType} for campus '${campusId}': ${error.message}` });
    console.error("Error copying institutions:", error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  getInstitutionList,
  saveInstitutionList,
  deleteInstitutionList,
  copyInstitutionsFromForm,
};