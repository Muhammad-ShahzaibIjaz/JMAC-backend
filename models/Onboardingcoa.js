const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Cost of Attendance onboarding form.
 *
 * One row per campus. `data` holds the full COA grid as JSON so the shape can
 * evolve without migrations. The form only stores the school-type section that
 * applies to the campus (e.g. a private school like Greenville only fills the
 * "Private" block), but the JSON can hold whichever sections are relevant.
 *
 * Expected `data` shape:
 * {
 *   "In-State Public": {
 *     "Dependent":   { "Resident": {2024,2025,2026}, "Commuter": {...}, "Living with Parent": {...}, "Independent with Dependent(s)": {...} },
 *     "Independent": { ...same four living arrangements... }
 *   },
 *   "Out of State Public": { ... },
 *   "Private": { ... }
 * }
 * where each {2024,2025,2026} is an object of year -> numeric value.
 */
const OnboardingCoa = sequelize.define(
  "OnboardingCoa",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    campusId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Which COA section applies to this campus. Mirrors Campus.schoolType.
    schoolType: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    data: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {},
    },
  },
  {
    tableName: "OnboardingCoa",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["campusId"] },
    ],
  }
);

module.exports = OnboardingCoa;