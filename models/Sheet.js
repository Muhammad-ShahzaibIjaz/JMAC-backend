const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Sheet = sequelize.define(
  'Sheet',
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
    mappingTemplateId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: 'MappingTemplate',
            key: 'id',
        },
    },
    sheetName: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    sheetYear: {
       type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
    },
    isFreezed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
    },
  },
  {
    tableName: 'Sheet',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['id'],
      },
    ],
  }
);

module.exports = Sheet;