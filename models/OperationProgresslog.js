const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OperationProgressLog = sequelize.define(
  'OperationProgressLog',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    templateId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Template', key: 'id' },
    },
    sheetId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: 'Sheet', key: 'id' },
    },
    sessionId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    kind: {
      type: DataTypes.ENUM('SESSION', 'STEP'),
      allowNull: false,
      defaultValue: 'STEP',
    },
    operationType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    stepNumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('INFO', 'SUCCESS', 'WARNING', 'ERROR', 'RUNNING', 'DONE', 'FAILED'),
      allowNull: false,
      defaultValue: 'INFO',
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    triggeredBy: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
  },
  {
    tableName: 'OperationProgressLog',
    timestamps: true,
    indexes: [
      { fields: ['sessionId'] },
      { fields: ['sheetId', 'operationType'] },
      { fields: ['templateId', 'operationType'] },
    ],
  }
);

module.exports = OperationProgressLog;