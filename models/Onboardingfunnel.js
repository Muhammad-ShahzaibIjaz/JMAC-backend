const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Historical Admission Funnel onboarding form.
 *
 * One row per campus. The set of funnel years rolls forward over time
 * (today: 2024, 2025, Year to Date <currentYear>), so years are NOT hardcoded
 * in the schema — they live inside `rows`.
 *
 * Expected shape:
 *   admissionsDatabase: "Slate"
 *   financialAidDatabase: "PowerFaids"
 *   rows: [
 *     {
 *       year: "2024",                       // label, e.g. "2024" or "Year to Date 2026"
 *       firstYear: { inquiries, applications, admits, deposits, matriculated },
 *       transfers: { inquiries, applications, admits, deposits, matriculated }
 *     },
 *     ...
 *   ]
 */
const OnboardingFunnel = sequelize.define(
  "OnboardingFunnel",
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
    admissionsDatabase: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    financialAidDatabase: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    rows: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "OnboardingFunnel",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["campusId"] },
    ],
  }
);

module.exports = OnboardingFunnel;