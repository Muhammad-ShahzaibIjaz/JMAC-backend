const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Header = sequelize.define(
  'Header',
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
    criticalityLevel: {
      type: DataTypes.ENUM('1', '2', '3'),
      allowNull: false,
      defaultValue: '3',
    },
    columnType: {
      type: DataTypes.ENUM('text', 'integer', 'decimal', 'Date', 'Y/N', 'character', 'percentage'),
      allowNull: false,
      defaultValue: 'text',
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'Header',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = Header;