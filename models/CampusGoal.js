const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

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
    populationGoals: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
    },
    goalType: {
      type: DataTypes.ENUM("consolidated", "view", "total"),
      allowNull: false,
      defaultValue: "view",
    },
    totalPopulationMappings: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
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