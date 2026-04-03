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
    sheetId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'SheetData',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['headerId', 'rowIndex', 'sheetId'],
      },
      {
        fields: ['sheetId', 'headerId'],        // ← ADD: for UPDATE path
      },
      {
        fields: ['headerId', 'sheetId', 'rowIndex'],  // ← ADD: for INSERT LEFT JOIN
      },
      {
        fields: ['sheetId', 'headerId', 'value'],
      },
    ],
  }
);

module.exports = SheetData;