const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");


const Mapping_Template = sequelize.define(
  'MappingTemplate',
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
    }
  },
  {
    tableName: 'MappingTemplate',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id"],
      },
    ],
  }
);


module.exports = Mapping_Template;

