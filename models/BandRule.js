const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const BandRule = sequelize.define(
  'BandRule',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    templateId: {
        type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'Template',
            key: 'id',
        },
    },
    name: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    conditions: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    inputHeader: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    outputHeader: {
        type: DataTypes.STRING,
        allowNull: false,
    },
},
  {
    tableName: 'BandRule',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = BandRule;