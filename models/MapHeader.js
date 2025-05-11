const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const MapHeader = sequelize.define(
  'MapHeader',
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
    mappingTemplateId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    headerId: {
      type: DataTypes.UUID,
      allowNull: false,
    }
  },
  {
    tableName: 'MapHeader',
    timestamps: false,
    indexes: [{ fields: ["mappingTemplateId", "headerId"] }],
  }
);

module.exports = MapHeader;