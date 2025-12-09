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
    userId: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      allowNull: true,
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

