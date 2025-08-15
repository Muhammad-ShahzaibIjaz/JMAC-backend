const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const SheetDataSnapshot = sequelize.define('SheetDataSnapshot', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  operationLogId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  headerId: {
    type: DataTypes.UUID,
    allowNull: false,
  },
  rowIndex: {
    type: DataTypes.INTEGER,
    allowNull: false,
  },
  originalValue: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  newValue: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  changeType: {
    type: DataTypes.ENUM('INSERT', 'UPDATE', 'DELETE'),
    allowNull: false,
    defaultValue: 'UPDATE',
  }
}, {
  tableName: 'SheetDataSnapshot',
  timestamps: true,
  indexes: [
    {
      fields: ['id']
    }
  ]
});


module.exports = SheetDataSnapshot;