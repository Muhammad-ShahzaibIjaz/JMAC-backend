const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const Format = sequelize.define(
  'Rule',
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
    conditions: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    assignments: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    headers: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: [],
    },
    templateId: {
        type: DataTypes.UUID,
        allowNull: false,
    }
  },
  {
    tableName: 'Rule',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id"],
      }
    ]
  }
);

module.exports = Format;