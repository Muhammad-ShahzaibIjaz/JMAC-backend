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
    phoneNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    numberOfStudents: {
        type: DataTypes.INTEGER,
        allowNull: true,
    },
    principalName: {
        type: DataTypes.STRING(255),
        allowNull: true,
    },
    schoolType: {
        type: DataTypes.ENUM("Elementary", "Middle", "High", "K-12", "University", "Community College"),
        allowNull: false,
        defaultValue: "University",
    }
  },
  {
    tableName: "Campus",
    timestamps: true,
    indexes: [
      {
        fields: ["id"],
      },
    ],
  }
);

module.exports = Campus;