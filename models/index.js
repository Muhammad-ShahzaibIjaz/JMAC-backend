const Template = require('./Template');
const File = require('./File');
const Header = require('./Header');
const SheetData = require('./SheetData');
const MappingTemplate = require('./MappingTemplate');
const MapHeader = require('./MapHeader');
const ExtractedHeader = require('./ExtractedHeader');
const Rule = require('./Rule');
const SheetDataSnapshot = require('./SheetDataSnapShot');
const OperationLog = require('./OperationLog');
const sequelize = require('../config/database');

// Define associations
Template.hasMany(File, { foreignKey: 'templateId', onDelete: 'CASCADE' });
File.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(Header, { foreignKey: 'templateId', onDelete: 'CASCADE' });
Header.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(Rule, {foreignKey: 'templateId', onDelete: 'CASCADE'} );
Rule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(OperationLog, { foreignKey: 'templateId', onDelete: 'CASCADE' });
OperationLog.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(MappingTemplate, { foreignKey: 'templateId', onDelete: 'CASCADE' });
MappingTemplate.belongsTo(Template, { foreignKey: 'templateId' });

MappingTemplate.hasMany(MapHeader, { foreignKey: "mappingTemplateId", onDelete: "CASCADE" });
MapHeader.belongsTo(MappingTemplate, { foreignKey: 'mappingTemplateId' });

MapHeader.belongsTo(Header, {foreignKey: "headerId"});
Header.hasMany(MapHeader, {foreignKey: "headerId", onDelete: "CASCADE"});


Header.hasMany(SheetData, { foreignKey: 'headerId', onDelete: 'CASCADE' });
SheetData.belongsTo(Header, { foreignKey: 'headerId' });

MappingTemplate.hasMany(ExtractedHeader, { foreignKey: "mappingTemplateId", onDelete: 'CASCADE'});
ExtractedHeader.belongsTo(MappingTemplate, { foreignKey: "mappingTemplateId" });


OperationLog.hasMany(SheetDataSnapshot, { foreignKey: 'operationLogId', onDelete: 'CASCADE' });
SheetDataSnapshot.belongsTo(OperationLog, { foreignKey: 'operationLogId' });



module.exports = {
  Template,
  File,
  Header,
  SheetData,
  ExtractedHeader,
  MapHeader,
  MappingTemplate,
  Rule,
  OperationLog,
  SheetDataSnapshot
};