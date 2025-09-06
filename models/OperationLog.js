const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const OperationLog = sequelize.define(
    'OperationLog',
    {
        id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        templateId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        sheetId: {
            type: DataTypes.UUID,
            allowNull: false,
        },
        operationType: {
            type: DataTypes.ENUM('BULK_UPDATE', 'CALCULATION', 'GPA', 'ZIPCODE', 'ADD_ROW', 'UPDATE_ROW', 'DELETE_ROW' ,'PADDING_UPDATE', 'CONVERSION', 'ADD_HEADER'),
            allowNull: false,
            defaultValue: 'CALCULATION',
        },
    },{
        tableName: 'OperationLog',
        timestamps: true,
        indexes: [
            {
                unique: true,
                fields: ["id"],
            }
        ]
    }
);

module.exports = OperationLog;