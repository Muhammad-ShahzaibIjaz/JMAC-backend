const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ElementMatrix = sequelize.define(
  'ElementMatrix',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    academicBands: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    financialBands: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    values: {
      type: DataTypes.JSONB, // stores your 2D array
      allowNull: false,
    },
    templateId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'Template',
            key: 'id',
        },
    }
  },
  {
    tableName: 'ElementMatrix',
    timestamps: true,
    indexes: [
      { fields: ['id', 'name'] },
    ],
  }
);

module.exports = ElementMatrix;