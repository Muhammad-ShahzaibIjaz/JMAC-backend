const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SheetData = sequelize.define(
  'SheetData',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    rowIndex: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    value: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    headerId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'SheetData',
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ['headerId', 'rowIndex'],
      },
    ],
  }
);

module.exports = SheetData;