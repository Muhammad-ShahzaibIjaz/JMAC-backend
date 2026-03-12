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
const CrossReference = require('./CrossReference');
const CrossReferenceMapping = require('./CrossReferenceMappingAttributes');
const CalculationRule = require('./CalculationRule');
const Sheet = require('./Sheet');
const PellRule = require('./PellRule');
const ConditionalRule = require('./ConditionalRule');
const PopulationRule = require('./PopulationRule');
const PopulationStatus = require('./PopulationStatus');
const PopulationSubmission = require('./PopulationSubmission');
const Tree = require('./Tree');
const BandRule = require('./BandRule');
const User = require('./User');
const ElementMatrix = require('./ElementMatrix');
const TemplatePermission = require('./TemplatePermission');
const Log = require('./Log');
const CampusGoal = require('./CampusGoal');
const ViewGoal = require('./ViewGoal');
const Campus = require('./Campus');
const sequelize = require('../config/database');

// Campus.hasMany(Template, { foreignKey: 'campusId', onDelete: 'CASCADE' });
// Template.belongsTo(Campus, { foreignKey: 'campusId', onDelete: 'CASCADE' });

// Define associations
Template.hasMany(File, { foreignKey: 'templateId', onDelete: 'CASCADE' });
File.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(ViewGoal, { foreignKey: 'templateId', onDelete: 'CASCADE' });
ViewGoal.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(ElementMatrix, { foreignKey: 'templateId', onDelete: 'CASCADE' });
ElementMatrix.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(CrossReference, { foreignKey: 'templateId', onDelete: 'CASCADE' });
CrossReference.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(Header, { foreignKey: 'templateId', onDelete: 'CASCADE' });
Header.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(Rule, {foreignKey: 'templateId', onDelete: 'CASCADE'} );
Rule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(CalculationRule, { foreignKey: 'templateId', onDelete: 'CASCADE' });
CalculationRule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(OperationLog, { foreignKey: 'templateId', onDelete: 'CASCADE' });
OperationLog.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(PellRule, { foreignKey: 'templateId', onDelete: 'CASCADE' });
PellRule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(ConditionalRule, { foreignKey: 'templateId', onDelete: 'CASCADE' });
ConditionalRule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(PopulationRule, { foreignKey: 'templateId', onDelete: 'CASCADE' });
PopulationRule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(PopulationStatus, { foreignKey: 'templateId', onDelete: 'CASCADE' });
PopulationStatus.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(PopulationSubmission, { foreignKey: 'templateId', onDelete: 'CASCADE' });
PopulationSubmission.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(Tree, { foreignKey: 'templateId', onDelete: 'CASCADE' });
Tree.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(BandRule, { foreignKey: 'templateId', onDelete: 'CASCADE' });
BandRule.belongsTo(Template, { foreignKey: 'templateId' });

Template.hasMany(CampusGoal, { foreignKey: 'templateId', onDelete: 'CASCADE' });
CampusGoal.belongsTo(Template, { foreignKey: 'templateId' });

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

CrossReference.hasMany(CrossReferenceMapping, { foreignKey: 'crossReferenceId', onDelete: 'CASCADE', as: 'mappings' });
CrossReferenceMapping.belongsTo(CrossReference, { foreignKey: 'crossReferenceId' });

Template.hasMany(Sheet, { foreignKey: 'templateId', onDelete: 'CASCADE' });
Sheet.belongsTo(Template, { foreignKey: 'templateId' });

MappingTemplate.hasMany(Sheet, { foreignKey: 'mappingTemplateId', onDelete: 'CASCADE' });
Sheet.belongsTo(MappingTemplate, { foreignKey: 'mappingTemplateId' });

Template.hasMany(TemplatePermission, { foreignKey: 'templateId', as: 'permissions', onDelete: 'CASCADE' });
TemplatePermission.belongsTo(Template, { foreignKey: 'templateId' });

User.hasMany(TemplatePermission, { foreignKey: 'userId', as: 'templatePermissions', onDelete: 'CASCADE' });
TemplatePermission.belongsTo(User, { foreignKey: 'userId' });

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
  SheetDataSnapshot,
  Sheet,
  CrossReference,
  CrossReferenceMapping,
  PellRule,
  ConditionalRule,
  PopulationRule,
  PopulationStatus,
  PopulationSubmission,
  Tree,
  BandRule,
  User,
  ElementMatrix,
  TemplatePermission,
  Log,
  CampusGoal,
  ViewGoal,
  Campus,
};