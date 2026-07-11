const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const CampusPermission = sequelize.define(
  "CampusPermission",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
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
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: "User",
        key: "id",
      },
      onDelete: "CASCADE",
    },
  },
  {
    tableName: "CampusPermission",
    timestamps: true,
    indexes: [
      { unique: true, fields: ["campusId", "userId"] },
    ],
  }
);

module.exports = CampusPermission;