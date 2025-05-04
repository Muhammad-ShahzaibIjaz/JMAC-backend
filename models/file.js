const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Template = require("./template");

const File = sequelize.define("File", {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  r2Path: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  size: {
    type: DataTypes.BIGINT,
    allowNull: false,
  },
  uploadedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  templateId: {
    type: DataTypes.UUID,
    references: {
      model: Template,
      key: "id",
    },
  },
});

Template.hasMany(File, { foreignKey: "templateId", onDelete: "CASCADE" });
File.belongsTo(Template, { foreignKey: "templateId" });

module.exports = File;