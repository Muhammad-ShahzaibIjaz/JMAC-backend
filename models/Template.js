const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");


const Template = sequelize.define(
  'Template',
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
    campusId: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: '96bd9812-3955-4d08-8513-b007f7e0bed6',
    }
  },
  {
    tableName: 'Template',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id"],
      },
    ],
  }
);


module.exports = Template;