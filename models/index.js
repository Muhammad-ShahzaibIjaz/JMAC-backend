const Template = require('./Template');
const File = require('./File');
const Header = require('./Header');
const SheetData = require('./SheetData');
const MappingTemplate = require('./MappingTemplate');
const MapHeader = require('./MapHeader');
const sequelize = require('../config/database');

// Define associations
Template.hasMany(File, { foreignKey: 'templateId', onDelete: 'CASCADE' });
File.belongsTo(Template, { foreignKey: 'templateId' });


Template.hasMany(Header, { foreignKey: 'templateId', onDelete: 'CASCADE' });
Header.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(MappingTemplate, { foreignKey: 'templateId', onDelete: 'CASCADE' });
MappingTemplate.belongsTo(Template, { foreignKey: 'templateId' });


MappingTemplate.hasMany(MapHeader, { foreignKey: "mappingTemplateId", onDelete: "CASCADE" });
MapHeader.belongsTo(MappingTemplate, { foreignKey: 'mappingTemplateId' });

MapHeader.belongsTo(Header, {foreignKey: "headerId"});
Header.hasMany(MapHeader, {foreignKey: "headerId"});


Header.hasMany(SheetData, { foreignKey: 'headerId', onDelete: 'CASCADE' });
SheetData.belongsTo(Header, { foreignKey: 'headerId' });

module.exports = {
  Template,
  File,
  Header,
  SheetData,
};