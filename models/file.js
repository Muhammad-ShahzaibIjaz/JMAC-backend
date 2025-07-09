const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const File = sequelize.define(
  'File',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    filename: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: 'File',
    timestamps: true,
    indexes: [
      {
        fields: ['templateId'],
      },
    ],
  }
);

module.exports = File;