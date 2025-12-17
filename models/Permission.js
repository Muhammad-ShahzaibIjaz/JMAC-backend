const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Permission = sequelize.define("Permission", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  action: {
    type: DataTypes.ENUM("read", "write", "delete"),
    allowNull: false,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
  }
}, {
  tableName: "Permission",
  timestamps: true,
  indexes: [
    {
    fields: ['id', 'userId'],
    },
  ],
});

module.exports = Permission;