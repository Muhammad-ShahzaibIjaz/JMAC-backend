const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const PellRule = sequelize.define(
  'PellRule',
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
    pellSource: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    criteria: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    targetHeader: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    acceptanceStatus: {
        type: DataTypes.ARRAY(DataTypes.TEXT),
        allowNull: false,
        defaultValue: ['Accepted', 'Pending'],
    },
    templateId: {
        type: DataTypes.UUID,
        allowNull: false,
    }
  },
  {
    tableName: 'PellRule',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["id", "templateId"],
      }
    ]
  }
);

module.exports = PellRule;