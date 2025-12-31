const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ConditionalRule = sequelize.define(
  'ConditionalRule',
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
    isGlobal: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
    ruleName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    conditions: {
        type: DataTypes.JSONB,
        allowNull: false,
    },
    targetHeaderName: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    targetValue: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    headers: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: [],
    }
},
  {
    tableName: 'ConditionalRule',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = ConditionalRule;