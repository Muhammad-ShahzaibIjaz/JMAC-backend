const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CustomField = sequelize.define(
  "CustomField",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    label: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    value: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    type: {
      type: DataTypes.ENUM("text", "email"),
      allowNull: false,
    },
    campusId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "Campus",
        key: "id",
      },
      onDelete: "CASCADE",
    },
  },
  {
    tableName: "CustomFields",
    timestamps: true,
    indexes: [
      { fields: ["id"] },
    ],
  }
);

module.exports = CustomField;