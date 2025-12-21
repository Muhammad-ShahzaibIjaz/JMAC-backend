const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");


const Log = sequelize.define(
  'Log',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    action: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    username: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    performedBy: {
        type: DataTypes.STRING(255),
        allowNull: false,
    },
    details: {
        type: DataTypes.TEXT,
        allowNull: true,
    }
  },
  {
    tableName: 'Log',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id"],
      },
    ],
  }
);

module.exports = Log;