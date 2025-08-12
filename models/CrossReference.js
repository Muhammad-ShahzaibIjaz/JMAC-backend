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
    inputHeaderId: {
        type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'Header',
            key: 'id',
        },
    },
    outputHeaderId: {
        type: DataTypes.UUID,
          allowNull: false,
          references: {
            model: 'Header',
            key: 'id',
        },
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