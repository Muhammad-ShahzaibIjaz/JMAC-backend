const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const ViewGoal = sequelize.define(
  "ViewGoal",
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
    goalYear: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    populationGoals: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
    },
  },
  {
    tableName: "ViewGoal",
    timestamps: true,
    indexes: [
      {
        fields: ["id", "templateId"],
      },
    ],
  }
);

module.exports = ViewGoal;