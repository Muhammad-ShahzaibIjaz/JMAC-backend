const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PopulationSubmission = sequelize.define(
  'PopulationSubmission',
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
    submissionDate: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    selectedSheet: {
        type: DataTypes.UUID,
        allowNull: false,
    }
},
  {
    tableName: 'PopulationSubmission',
    timestamps: true,
    indexes: [
      {
        fields: ['id', 'templateId'],
      },
    ],
  }
);

module.exports = PopulationSubmission;