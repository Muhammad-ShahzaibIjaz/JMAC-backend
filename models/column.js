const { DataTypes } = require("sequelize");
const sequelize  = require("../config/database");
const Template = require("./template");

const Column = sequelize.define("Column", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  type: {
    type: DataTypes.ENUM("text", "integer", "decimal", "Date", "Y/N", "character"),
    allowNull: false,
  },
  criticalityLevel: {
    type: DataTypes.INTEGER,
    allowNull: false,
    validate: { min: 1, max: 3 },
  },
  templateId: {
    type: DataTypes.UUID,
    references: {
      model: Template,
      key: "id",
    },
  },
});

Template.hasMany(Column, { foreignKey: "templateId", onDelete: "CASCADE" });
Column.belongsTo(Template, { foreignKey: "templateId" });

module.exports = Column;