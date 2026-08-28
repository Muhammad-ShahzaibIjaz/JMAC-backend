const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

// The awarding-goal upgrade stores its richer shape inside populationGoals
// (JSONB), so no column change is required. For an awarding goal each entry is:
//   populationGoals[ruleName] = {
//     coa: { year2026: {...7 items}, year2027: {...7 items} },
//     enrollment: { admitted, netConfirmed, nacuboDiscountRate }
//   }
// View/consolidated goals keep their existing shapes. JSONB absorbs both.
const CampusGoal = sequelize.define(
  "CampusGoal",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "Template",
        key: "id",
      },
    },
    goalName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    // The year this goal is built FOR (e.g. "2027"). Stored as a string to match
    // the frontend (String(targetYear)) and ViewGoal.goalYear. The COA base year
    // is goalYear - 1. Nullable so pre-existing rows and view/consolidated goals
    // are unaffected.
    goalYear: {
      type: DataTypes.STRING(4),
      allowNull: true,
    },
    // Locks the data snapshot (Sheet) this goal's 2026 actuals were built from,
    // so re-opening the goal always reads the SAME base-year data even if the
    // campus "Current Snapshot" later changes. Nullable for pre-existing rows.
    sheetId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    populationGoals: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },
    goalType: {
      type: DataTypes.ENUM("consolidated", "awarding"),
      allowNull: false,
      defaultValue: "awarding",
    },
    totalPopulationMappings: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: [],
    },
  },
  {
    tableName: "CampusGoal",
    timestamps: true,
    indexes: [
      {
        fields: ["id", "templateId"],
      },
    ],
  }
);

module.exports = CampusGoal;