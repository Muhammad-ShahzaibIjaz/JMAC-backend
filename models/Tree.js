const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Tree = sequelize.define(
  'Tree',
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
      allowNull: false,
    },
    treeData: {
      type: DataTypes.JSONB,
      allowNull: false,
    },
    baseHeader: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    sheetId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    totalDataCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    }
  },
  {
    tableName: 'DecisionTree',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
      {
        fields: ['templateId', 'isActive'],
      },
    ],
  }
);

module.exports = Tree;