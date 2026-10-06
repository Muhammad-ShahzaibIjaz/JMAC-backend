const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");


const BandLabel = sequelize.define(
  "BandLabel",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "Template", key: "id" },
    },
    bandType: {
      type: DataTypes.ENUM("financial", "academic"),
      allowNull: false,
    },
    bandIndex: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    label: {
      type: DataTypes.STRING(255),
      allowNull: false,
      defaultValue: "",
    },
  },
  {
    tableName: "BandLabel",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["templateId", "bandType", "bandIndex"] },
    ],
  }
);

module.exports = BandLabel;