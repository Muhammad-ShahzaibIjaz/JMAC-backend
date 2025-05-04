const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");


const Template = sequelize.define("Template", {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    }
},
{
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ["id"],
    },
  ],
});


module.exports = Template;

