const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Note = sequelize.define(
  "Note",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    content: {
      type: DataTypes.TEXT,
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
    tableName: "Notes",
    timestamps: true,
    indexes: [
      { fields: ["id"] },
    ],
  }
);

module.exports = Note;