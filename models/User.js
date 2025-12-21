const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const User = sequelize.define("User", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  username: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true,
  },
  passwordHash: {
    type: DataTypes.STRING(255),
    allowNull: false,
  },
  role: {
    type: DataTypes.ENUM("Admin", "Creator", "Consultant", "Campus"),
    allowNull: false,
    defaultValue: "Creator",
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  }
}, {
  tableName: "User",
  timestamps: true,
});

module.exports = User;