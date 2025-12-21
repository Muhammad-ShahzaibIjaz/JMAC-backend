const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const TemplatePermission = sequelize.define(
  'TemplatePermission',
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
      onDelete: 'CASCADE',
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'User',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    accessLevel: {
      type: DataTypes.ENUM('read', 'write', 'none'),
      defaultValue: 'read',
    },
  },
  {
    tableName: 'TemplatePermission',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['templateId', 'userId'] },
    ],
  }
);

module.exports = TemplatePermission;