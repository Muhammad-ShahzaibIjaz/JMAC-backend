const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const CrossReferenceMapping = sequelize.define(
  'CrossReferenceMapping',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    crossReferenceId: {
          type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'CrossReference',
            key: 'id',
        },
    },
    inputValue: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    outputValue: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
  },
  {
    tableName: 'CrossReferenceMapping',
    timestamps: true,
    indexes: [
      {
        fields: ['id'],
      },
    ],
  }
);

module.exports = CrossReferenceMapping;