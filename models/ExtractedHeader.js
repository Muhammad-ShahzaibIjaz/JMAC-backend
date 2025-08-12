const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ExtractedHeader = sequelize.define(
  'ExtractedHeader',
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
      type: DataTypes.ENUM('text', 'integer', 'decimal', 'Date', 'Y/N', 'character'),
      allowNull: false,
      defaultValue: 'text',
    },
    mappingTemplateId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    fileBelongsTo: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    tableName: 'ExtractedHeader',
    timestamps: true,
    indexes: [
      {
        fields: ['id'],
      },
    ],
  }
);

module.exports = ExtractedHeader;