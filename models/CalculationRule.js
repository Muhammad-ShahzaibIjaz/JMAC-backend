const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CalculationRule = sequelize.define(
  "CalculationRule",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    header: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    isGlobal: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    assignments: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    RuleType: {
      type: DataTypes.ENUM("bulk-action", "reference-action"),
      allowNull: false,
      defaultValue: "bulk-action"
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "CalculationRule",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id"],
      },
    ],
  }
);

module.exports = CalculationRule;