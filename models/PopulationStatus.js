const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PopulationStatus = sequelize.define(
  'PopulationStatus',
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
    statusName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    selectedStatuses: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
    },
    targetHeader: {
        type: DataTypes.TEXT,
        allowNull: false,
    }
},
  {
    tableName: 'PopulationStatus',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = PopulationStatus;