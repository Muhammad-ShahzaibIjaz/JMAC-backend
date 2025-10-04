const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PopulationRule = sequelize.define(
  'PopulationRule',
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
    ruleName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    conditions: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    headers: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
    },
    ruleType: {
      type: DataTypes.ENUM('population', 'academic-band', 'financial-band'),
      allowNull: false,
      defaultValue: 'population',
    },
},
  {
    tableName: 'PopulationRule',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = PopulationRule;