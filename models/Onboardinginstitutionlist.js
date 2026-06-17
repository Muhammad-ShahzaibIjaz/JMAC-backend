const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

/**
 * Institution-list onboarding form. One model backs all three forms:
 *   - "competitor"
 *   - "crossApplicant"
 *   - "aspirant"
 * distinguished by `formType`. Each campus has at most one row per formType.
 *
 * `institutions` shape:
 *   [ { name: "Greenville University", city: "Greenville", state: "IL" }, ... ]
 */
const OnboardingInstitutionList = sequelize.define(
  "OnboardingInstitutionList",
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
    formType: {
      type: DataTypes.ENUM("competitor", "crossApplicant", "aspirant"),
      allowNull: false,
    },
    institutions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "OnboardingInstitutionList",
    timestamps: true,
    indexes: [
      // one list per (campus, formType)
      { unique: true, fields: ["campusId", "formType"] },
    ],
  }
);

module.exports = OnboardingInstitutionList;