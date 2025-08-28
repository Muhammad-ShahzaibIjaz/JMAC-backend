const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CrossReference = sequelize.define(
  'CrossReference',
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
    templateId: {
        type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'Template',
            key: 'id',
        },
    },
    inputHeaderIds: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false,
    },
    outputHeaderIds: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false,
    },
    dependentReferenceId: {
        type: DataTypes.UUID,
        allowNull: true,
    },
    },
  {
    tableName: 'CrossReference',
    timestamps: true,
    indexes: [
      {
        fields: ['id'],
      },
    ],
  }
);

module.exports = CrossReference;