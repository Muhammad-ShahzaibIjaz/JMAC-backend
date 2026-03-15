const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Campus = sequelize.define(
  "Campus",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    campusName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    city: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    state: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    zipCode: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    campusMainNumber: {
      type: DataTypes.STRING(20),
      allowNull: true,
    },
    presidentEmail: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    undergradStudents: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    gradStudents: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    presidentName: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    schoolType: {
      type: DataTypes.ENUM(
        "Community College",
        "4 Year Public University",
        "4 Year Private University",
        "Other"
      ),
      allowNull: false,
      defaultValue: "Other",
    },
  },
  {
    tableName: "Campus",
    timestamps: true,
    indexes: [
      { fields: ["id"] },
    ],
  }
);

module.exports = Campus;