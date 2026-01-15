const Rule = require("../models/Rule");
const CalculationRule = require("../models/CalculationRule");
const { v4: uuidv4 } = require("uuid");
const { Header, ConditionalRule, PopulationRule, BandRule, ElementMatrix } = require("../models");
const {extractHeaderValues} = require("./dataController");
const { bulkUpdates } = require("./dataController");
const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

const createRule = async (req, res) => {
  const { name, conditions, assignments, headers, templateId } = req.body;
  const username = await getUserName(req.userId);
  try {

    // Validate input
    if (!name || !conditions || !assignments || !headers || !templateId) {
      return res.status(400).json({ error: "All fields (name, conditions, assignments, headers, templateId) are required" });
    }

    const uniqueHeaders = [...new Set(headers)];

    const rule = await Rule.create({
      id: uuidv4(),
      name,
      conditions,
      assignments,
      headers: uniqueHeaders,
      templateId
    });
    await createLog({ action: 'CREATE_RULE', username, performedBy: req.userId, details: `Rule '${name}' created with ID: ${rule.id}` });
    return res.status(201).json({ message: "Rule created successfully", rule });
  } catch (error) {
    console.error("Error creating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const createConditionalRule = async (req, res) => {
  const { ruleName, conditions, headers, targetHeaderName, targetValue, templateId, isGlobal=false } = req.body;
  const username = await getUserName(req.userId);
  try {

    // Validate input
    if (!ruleName || !conditions || !headers || !targetHeaderName || !targetValue || !templateId) {
      return res.status(400).json({ error: "All fields (ruleName, conditions, headers, targetHeaderName, targetValue, templateId) are required" });
    }

    const uniqueHeaders = [...new Set(headers)];

    const rule = await ConditionalRule.create({
      id: uuidv4(),
      ruleName,
      conditions,
      targetHeaderName,
      targetValue,
      headers: uniqueHeaders,
      templateId,
      isGlobal
    });
    await createLog({ action: 'CREATE_CONDITIONAL_RULE', username, performedBy: req.userId, details: `Conditional Rule '${ruleName}' created with ID: ${rule.id}` });
    return res.status(201).json({ id: rule.id, ruleName: rule.ruleName, conditions: Array.isArray(conditions.all)
  ? conditions.all.length
  : Array.isArray(conditions.any)
    ? conditions.any.length
    : 0, targetHeaderName: rule.targetHeaderName, targetValue: rule.targetValue, isGlobal: rule.isGlobal });
  } catch (error) {
    await createLog({ action: 'CREATE_CONDITIONAL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to create conditional rule '${ruleName}': ${error.message}` });
    console.error("Error creating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateConditionalRule = async (req, res) => {
  const { id, ruleName, conditions, headers, targetHeaderName, targetValue, templateId, isGlobal=false } = req.body;
  const username = await getUserName(req.userId);
  try {

    // Validate input
    if (!id || !ruleName || !conditions || !headers || !targetHeaderName || !targetValue || !templateId) {
      return res.status(400).json({
        error: "All fields (id, ruleName, conditions, headers, targetHeaderName, targetValue, templateId) are required"
      });
    }

    const uniqueHeaders = [...new Set(headers)];

    const rule = await ConditionalRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.update({
      ruleName,
      conditions,
      targetHeaderName,
      targetValue,
      headers: uniqueHeaders,
      templateId,
      isGlobal
    });

    // Transform updated rule to match getAllConditionalRules format
    const conditionBlock = rule.conditions;
    const combinatorKey = Object.keys(conditionBlock)[0];
    const conditionList = conditionBlock[combinatorKey];
    const conditionCount = Array.isArray(conditionList) ? conditionList.length : 0;

    const transformedRule = {
      id: rule.id,
      ruleName: rule.ruleName,
      conditions: conditionCount,
      headers: rule.headers,
      targetHeaderName: rule.targetHeaderName,
      targetValue: rule.targetValue,
      isGlobal: rule.isGlobal
    };
    await createLog({ action: 'UPDATE_CONDITIONAL_RULE', username, performedBy: req.userId, details: `Conditional Rule '${ruleName}' with ID: ${id} updated` });
    return res.status(200).json(transformedRule);
  } catch (error) {
    await createLog({ action: 'UPDATE_CONDITIONAL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update conditional rule ID '${id}': ${error.message}` });
    console.error("Error updating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.params;
    const { name, conditions, assignments, headers } = req.body;

    // Validate input
    if (!name || !conditions || !assignments || !headers) {
      return res.status(400).json({ error: "All fields (name, conditions, assignments, headers, templateId) are required" });
    }
    
    const uniqueHeaders = [...new Set(headers)];

    const rule = await Rule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.update({
      name,
      conditions,
      assignments,
      headers: uniqueHeaders,
    });
    await createLog({ action: 'UPDATE_RULE', username, performedBy: req.userId, details: `Rule '${name}' with ID: ${id} updated` });
    return res.status(200).json({ message: "Rule updated successfully", rule });
  } catch (error) {
    await createLog({ action: 'UPDATE_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update rule ID '${req.params.id}': ${error.message}` });
    console.error("Error updating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deleteRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.params;

    const rule = await Rule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    await createLog({ action: 'DELETE_RULE', username, performedBy: req.userId, details: `Rule with ID: ${id} deleted` });
    return res.status(200).json({ message: "Rule deleted successfully" });
  } catch (error) {
    await createLog({ action: 'DELETE_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete rule ID '${req.params.id}': ${error.message}` });
    console.error("Error deleting rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getAllRules = async (req, res) => {
  try {
    const { templateId } = req.params;
    const rules = await Rule.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'conditions', 'assignments'],
      order: [['createdAt', 'DESC']]
    });

    const transformedRules = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      conditions: rule.conditions.length,
      assignments: rule.assignments.length
    }));
    return res.status(200).json(transformedRules);
  } catch (error) {
    console.error("Error fetching rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getAllConditionalRules = async (req, res) => {
  try {
    const { templateId } = req.params;
    const rules = await ConditionalRule.findAll({
      where: { [Op.or]: [{templateId: templateId}, {isGlobal: true}] },
      attributes: ['id', 'ruleName', 'conditions', 'headers', 'targetHeaderName', 'targetValue', 'isGlobal'],
      order: [['createdAt', 'DESC']]
    });

    const transformedRules = rules.map((rule) => {
      const conditionBlock = rule.conditions;
      const combinatorKey = Object.keys(conditionBlock)[0];
      const conditionList = conditionBlock[combinatorKey];

      const conditionCount = Array.isArray(conditionList) ? conditionList.length : 0;

      return {
        id: rule.id,
        ruleName: rule.ruleName,
        conditions: conditionCount,
        headers: rule.headers,
        targetHeaderName: rule.targetHeaderName,
        targetValue: rule.targetValue,
        isGlobal: rule.isGlobal
      };
    });
    return res.status(200).json(transformedRules);
  } catch (error) {
    console.error("Error fetching rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const getRuleById = async (req, res) => {
  try {
    const { id } = req.query;

    const rule = await Rule.findByPk(id, {
      attributes: ['id', 'name', 'conditions', 'assignments', 'headers', 'templateId'],
      raw: true
    });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    return res.status(200).json(rule);
  } catch (error) {
    console.error("Error fetching rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getConditionalRuleById = async (req, res) => {
  try {
    const { id } = req.query;

    const rule = await ConditionalRule.findByPk(id, {
      attributes: ['id', 'ruleName', 'conditions', 'headers', 'targetHeaderName', 'targetValue'],
      raw: true
    });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    return res.status(200).json(rule);
  } catch (error) {
    console.error("Error fetching rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const getBulkRulesByTemplateId = async (req, res) => {
  try {
    const { id } = req.query;
    const rules = await CalculationRule.findAll({
      where: {
    [Op.or]: [
      { templateId: id },
      { isGlobal: true }
    ]
  },
      attributes: ['id', 'name', 'header', 'assignments', 'isGlobal'],
      order: [['createdAt', 'DESC']]
    });

    const transformedRules = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      headerName: rule.header,
      assignment: rule.assignments,
      isGlobal: rule.isGlobal
    }));
    return res.status(200).json(transformedRules);
  } catch (error) {
    console.error("Error fetching rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const createBulkRule = async (req, res) => {
  const { headerName, value, name, templateId, isGlobal=false } = req.body;
  const username = await getUserName(req.userId);
  try{
    // Validate input
    if (!headerName || !name || !templateId) {
      return res.status(400).json({ error: "All fields (headerName, name, templateId) are required" });
    }
    const isRuleExist = await CalculationRule.findOne({
      where: { header: headerName, templateId, name }
    });
    if (isRuleExist) {
      return res.status(409).json({ error: "Bulk rule already exists" });
    }
    const rule = await CalculationRule.create({
      name: name,
      header: headerName,
      assignments: value,
      isGlobal: isGlobal,
      templateId
    });
    await createLog({ action: 'CREATE_BULK_RULE', username, performedBy: req.userId, details: `Bulk Rule '${name}' created with ID: ${rule.id}` });
    return res.status(201).json({ id: rule.id, name: rule.name, headerName, assignment: value, isGlobal: rule.isGlobal });
  } catch (error) {
    await createLog({ action: 'CREATE_BULK_RULE_FAILED', username, performedBy: req.userId, details: `Failed to create bulk rule '${name}': ${error.message}` });
    console.error("Error creating bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const updateBulkRule = async (req, res) => {
  const { id } = req.params;
  const { headerName, value, name, templateId, isGlobal=false } = req.body;
  const username = await getUserName(req.userId);
  try {
    const rule = await CalculationRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Bulk rule not found" });
    }
    rule.templateId = templateId;
    rule.name = name;
    rule.header = headerName;
    rule.assignments = value;
    rule.isGlobal = isGlobal;
    await rule.save();
    await createLog({ action: 'UPDATE_BULK_RULE', username, performedBy: req.userId, details: `Bulk Rule '${name}' with ID: ${id} updated` });
    return res.status(200).json({ id: rule.id, name: rule.name, headerName: rule.header, assignment: rule.assignments });
  } catch (error) {
    await createLog({ action: 'UPDATE_BULK_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update bulk rule ID '${id}': ${error.message}` });
    console.error("Error updating bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const applyBulkRule = async (req, res) => {
  const { id } = req.query;
  const { sheetId } = req.body;
  const username = await getUserName(req.userId);
  try {
    const isBulkRuleExist = await CalculationRule.findByPk(id);
    if (!isBulkRuleExist) {
      return res.status(404).json({ error: "Bulk rule not found" });
    }

    const headerId = await Header.findOne({ where: { templateId: isBulkRuleExist.templateId, name: isBulkRuleExist.header } });
    if (!headerId) {
      return res.status(404).json({ error: "Header not found" });
    }

    await bulkUpdates(headerId.id, isBulkRuleExist.assignments, isBulkRuleExist.templateId, sheetId);
    await createLog({ action: 'APPLY_BULK_RULE', username, performedBy: req.userId, details: `Bulk Rule with ID: ${id} applied to sheet ID: ${sheetId}` });
    return res.status(200).json({ message: "Bulk rule applied successfully" });
  } catch (error) {
    await createLog({ action: 'APPLY_BULK_RULE_FAILED', username, performedBy: req.userId, details: `Failed to apply bulk rule ID '${id}': ${error.message}` });
    console.error("Error applying bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const deleteBulkRule = async (req, res) => {
  const { id } = req.query;
  const username = await getUserName(req.userId);
  try{
    const isBulkRuleExist = await CalculationRule.findByPk(id);
    if (!isBulkRuleExist) {
      return res.status(404).json({ error: "Bulk rule not found" });
    }
    await isBulkRuleExist.destroy();
    await createLog({ action: 'DELETE_BULK_RULE', username, performedBy: req.userId, details: `Bulk Rule with ID: ${id} deleted` });
    return res.status(200).json({ message: "Bulk rule deleted successfully" });
  } catch(error) {
    await createLog({ action: 'DELETE_BULK_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete bulk rule ID '${id}': ${error.message}` });
    console.error("Error deleting bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const deleteConditionalRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.query;

    const rule = await ConditionalRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    await createLog({ action: 'DELETE_CONDITIONAL_RULE', username, performedBy: req.userId, details: `Conditional Rule with ID: ${id} deleted` });
    return res.status(200).json({ message: "Rule deleted successfully" });
  } catch (error) {
    await createLog({ action: 'DELETE_CONDITIONAL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete conditional rule ID '${req.params.id}': ${error.message}` });
    console.error("Error deleting rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const createPopulationRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { ruleName, conditions, headers, templateId, ruleType = 'population', populationType = 'view' } = req.body;

    if (!ruleName || !conditions || !headers || !templateId) {
      return res.status(400).json({ error: "All fields (ruleName, conditions, headers, templateId) are required" });
    }

    const uniqueHeaders = [...new Set(headers)];

    const existingRule = await PopulationRule.findOne({ where: { ruleName, templateId, ruleType } });
    if (existingRule) {
      return res.status(409).json({ error: "Population rule with the same name already exists for this template" });
    }

    const rule = await PopulationRule.create({
      ruleName,
      conditions,
      headers: uniqueHeaders,
      templateId,
      ruleType,
      populationType
    });
    await createLog({ action: 'CREATE_POPULATION_RULE', username, performedBy: req.userId, details: `Population Rule '${ruleName}' created with ID: ${rule.id}` });
    return res.status(201).json({ id: rule.id, ruleName: rule.ruleName, ruleType: rule.ruleType, conditions: Array.isArray(conditions.all)
  ? conditions.all.length
  : Array.isArray(conditions.any)
    ? conditions.any.length
    : 0, populationType: rule.populationType });
  } catch (error) {
    await createLog({ action: 'CREATE_POPULATION_RULE_FAILED', username, performedBy: req.userId, details: `Failed to create population rule '${req.body.ruleName}': ${error.message}` });
    console.error("Error creating population rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updatePopulationRule = async (req, res) => {
  const { id, ruleName, conditions, headers, ruleType, populationType } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!id || !ruleName || !conditions || !headers || !ruleType) {
      return res.status(400).json({
        error: "All fields (id, ruleName, conditions, headers, ruleType) are required"
      });
    }

    const uniqueHeaders = [...new Set(headers)];

    const rule = await PopulationRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Population rule not found" });
    }

    await rule.update({
      ruleName,
      conditions,
      headers: uniqueHeaders,
      ruleType,
      populationType
    });
    await createLog({ action: 'UPDATE_POPULATION_RULE', username, performedBy: req.userId, details: `Population Rule '${ruleName}' with ID: ${id} updated` });
    // ✅ Match createPopulationRule response format
    return res.status(200).json({
      id: rule.id,
      ruleName: rule.ruleName,
      ruleType: rule.ruleType,
      conditions: Array.isArray(conditions.all)
        ? conditions.all.length
        : Array.isArray(conditions.any)
        ? conditions.any.length
        : 0,
      populationType: rule.populationType
    });
  } catch (error) {
    await createLog({ action: 'UPDATE_POPULATION_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update population rule ID '${id}': ${error.message}` });
    console.error("Error updating population rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const getPopulationRuleByTemplateId = async (req, res) => {
  const { templateId, ruleType } = req.params;
  try {
    const rules = await PopulationRule.findAll({
      where: { templateId, ruleType },
      attributes: ['id', 'ruleName', 'conditions', 'ruleType', 'populationType'],
      order: [['createdAt', 'DESC']]
    });
    const transformedRules = rules.map((rule) => {
      const conditionBlock = rule.conditions;
      const combinatorKey = Object.keys(conditionBlock)[0];
      const conditionList = conditionBlock[combinatorKey];

      const conditionCount = Array.isArray(conditionList) ? conditionList.length : 0;

      return {
        id: rule.id,
        ruleName: rule.ruleName,
        conditions: conditionCount,
        ruleType: rule.ruleType,
        populationType: rule.populationType
      };
    });
    return res.status(200).json(transformedRules);
  } catch (error) {
    console.error("Error fetching population rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const getPopulationRuleById = async (req, res) => {
  const { id } = req.query;
  try {
    const rule = await PopulationRule.findByPk(id, {
      attributes: ['id', 'ruleName', 'conditions', 'headers', 'ruleType', 'populationType'],
      raw: true
    });
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }
    return res.status(200).json(rule);
  } catch (error) {
    console.error("Error fetching rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deletePopulationRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.query;

    const rule = await PopulationRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    await createLog({ action: 'DELETE_POPULATION_RULE', username, performedBy: req.userId, details: `Population Rule with ID: ${id} deleted` });
    return res.status(200).json({ message: "Rule deleted successfully" });
  } catch (error) {
    await createLog({ action: 'DELETE_POPULATION_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete population rule ID '${req.params.id}': ${error.message}` });
    console.error("Error deleting rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const autoPopulationRule = async (req, res) => {
  const { templateId, sheetId, targetHeader } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !sheetId || !targetHeader) {
      return res.status(400).json({ error: "All fields (templateId, sheetId, targetHeader) are required" });
    }

    const header = await Header.findOne({ where: { templateId, name: targetHeader } });
    if (!header) {
      return res.status(404).json({ error: "Header not found" });
    }

    const uniqueValues = await extractHeaderValues(header.id, sheetId);

    const existingRules = await PopulationRule.findAll({
      where: {
        templateId,
        headers: {
          [Op.contains]: [targetHeader]
        },
        ruleType: 'population'
      }
    });

    const existingConditions = new Set(
      existingRules.map(rule => JSON.stringify(rule.conditions))
    );

    const newRules = [];

    for (const value of uniqueValues) {
      const isValidValue = /[a-zA-Z0-9]/.test(value);
      if (!isValidValue) continue;
      const condition = {
        all: [
          {
            field: targetHeader,
            value: value,
            operator: "equal"
          }
        ]
      };

      if (!existingConditions.has(JSON.stringify(condition))) {
        const ruleName = `${value}`;
        const newRule = await PopulationRule.create({
          templateId,
          ruleName,
          conditions: condition,
          headers: [targetHeader]
        });
        newRules.push(newRule);
      }
    }

    const transformedRules = newRules.map((rule) => {
      const conditionBlock = rule.conditions;
      const combinatorKey = Object.keys(conditionBlock)[0];
      const conditionList = conditionBlock[combinatorKey];

      const conditionCount = Array.isArray(conditionList) ? conditionList.length : 0;

      return {
        id: rule.id,
        ruleName: rule.ruleName,
        conditions: conditionCount,
      };
    });
    await createLog({ action: 'AUTO_POPULATION_RULE', username, performedBy: req.userId, details: `Auto population rules created for template ID: ${templateId} and header: ${targetHeader}` });
    return res.status(200).json(transformedRules);

  } catch (error) {
    await createLog({ action: 'AUTO_POPULATION_RULE_FAILED', username, performedBy: req.userId, details: `Failed to auto populate rules for template ID '${req.body.templateId}': ${error.message}` });
    console.error("Error in auto population rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const createBandRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { name, conditions, inputHeader, outputHeader, templateId, targetHeader, selectedValues, isGlobal=false } = req.body;
    if (!name || !conditions || !inputHeader || !outputHeader || !templateId) {
      return res.status(400).json({ error: "All fields (name, conditions, inputHeader, outputHeader, templateId) are required" });
    }
    const isBandRuleExist = await BandRule.findOne({
      where: { name, templateId }
    });

    if (isBandRuleExist) {
      return res.status(409).json({ error: "Band rule with the same name already exists for this template" });
    }
    const rule = await BandRule.create({
      id: uuidv4(),
      name,
      conditions,
      inputHeader,
      outputHeader,
      templateId,
      targetHeader,
      selectedValues,
      isGlobal
    });
    await createLog({ action: 'CREATE_BAND_RULE', username, performedBy: req.userId, details: `Band Rule '${name}' created with ID: ${rule.id}` });
    return res.status(201).json(rule);
  } catch (error) {
    await createLog({ action: 'CREATE_BAND_RULE_FAILED', username, performedBy: req.userId, details: `Failed to create band rule '${req.body.name}': ${error.message}` });
    console.error("Error creating band rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const updateBandRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.params;
    const { name, conditions, inputHeader, outputHeader, targetHeader, selectedValues, isGlobal=false } = req.body;
    if (!name || !conditions || !inputHeader || !outputHeader || !targetHeader || !selectedValues) {
      return res.status(400).json({ error: "All fields (name, conditions, inputHeader, outputHeader, targetHeader, studentTypes) are required" });
    }
    const rule = await BandRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Band rule not found" });
    }
    await rule.update({
      name,
      conditions,
      inputHeader,
      outputHeader,
      targetHeader,
      selectedValues,
      isGlobal
    });
    await createLog({ action: 'UPDATE_BAND_RULE', username, performedBy: req.userId, details: `Band Rule '${name}' with ID: ${id} updated` });
    return res.status(200).json({ name: rule.name, conditions: rule.conditions, inputHeader: rule.inputHeader, outputHeader: rule.outputHeader, targetHeader: rule.targetHeader, selectedValues: rule.selectedValues, isGlobal: rule.isGlobal });
  } catch (error) {
    await createLog({ action: 'UPDATE_BAND_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update band rule ID '${req.body.id}': ${error.message}` });
    console.error("Error updating band rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const getBandRulesByTemplateId = async (req, res) => {
  try {
    const { templateId } = req.query;
    const rules = await BandRule.findAll({
      where: { [Op.or]: [{templateId: templateId}, {isGlobal: true}] },
      attributes: ['id', 'name', 'conditions', 'inputHeader', 'outputHeader', 'targetHeader', 'selectedValues', 'isGlobal'],
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(rules);
  } catch (error) {
    console.error("Error fetching band rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deleteBandRule = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.query;
    const rule = await BandRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Band rule not found" });
    }
    await rule.destroy();
    await createLog({ action: 'DELETE_BAND_RULE', username, performedBy: req.userId, details: `Band Rule with ID: ${id} deleted` });
    return res.status(200).json({ message: "Band rule deleted successfully" });
  }
  catch (error) {
    await createLog({ action: 'DELETE_BAND_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete band rule ID '${id}': ${error.message}` });
    console.error("Error deleting band rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  } 
};

const createElementMatrix = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { name, academicBands, financialBands, values, templateId } = req.body;
    if (!name || !academicBands || !financialBands || !values || !templateId) {
      await transaction.rollback();
      return res.status(400).json({ error: "All fields (name, academicBands, financialBands, values, templateId) are required" });
    }
    const isMatrixExist = await ElementMatrix.findOne({
      where: { name, templateId }
    });

    if (isMatrixExist) {
      await transaction.rollback();
      return res.status(409).json({ error: "Element matrix with the same name already exists for this template" });
    }

    const matrix = await ElementMatrix.create({
      id: uuidv4(),
      name,
      academicBands,
      financialBands,
      values,
      templateId
    }, {transaction});
    await transaction.commit();
    await createLog({ action: 'CREATE_ELEMENT_MATRIX', username, performedBy: req.userId, details: `Element Matrix '${name}' created with ID: ${matrix.id}` });
    return res.status(201).json(matrix);
  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'CREATE_ELEMENT_MATRIX_FAILED', username, performedBy: req.userId, details: `Failed to create element matrix '${req.body.name}': ${error.message}` });
    console.error("Error creating element matrix:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const updateElementMatrix = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { name, academicBands, financialBands, values } = req.body;
    if (!name || !academicBands || !financialBands || !values) {
      await transaction.rollback();
      return res.status(400).json({ error: "All fields (name, academicBands, financialBands, values) are required" });
    }
    const matrix = await ElementMatrix.findByPk(id);
    if (!matrix) {
      await transaction.rollback();
      return res.status(404).json({ error: "Element matrix not found" });
    }
    await matrix.update({
      name,
      academicBands,
      financialBands,
      values
    }, {transaction});
    await transaction.commit();
    await createLog({ action: 'UPDATE_ELEMENT_MATRIX', username, performedBy: req.userId, details: `Element Matrix '${name}' with ID: ${id} updated` });
    return res.status(200).json(matrix);
  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'UPDATE_ELEMENT_MATRIX_FAILED', username, performedBy: req.userId, details: `Failed to update element matrix ID '${req.params.id}': ${error.message}` });
    console.error("Error updating element matrix:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deleteElementMatrix = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { id } = req.query;
    const matrix = await ElementMatrix.findByPk(id);
    if (!matrix) {
      return res.status(404).json({ error: "Element matrix not found" });
    }
    await matrix.destroy();
    await createLog({ action: 'DELETE_ELEMENT_MATRIX', username, performedBy: req.userId, details: `Element Matrix with ID: ${id} deleted` });
    return res.status(200).json({ message: "Element matrix deleted successfully" });
  } catch(error) {
    await createLog({ action: 'DELETE_ELEMENT_MATRIX_FAILED', username, performedBy: req.userId, details: `Failed to delete element matrix ID '${id}': ${error.message}` });
    console.error("Error deleting element matrix:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const getElementMatricesByTemplateId = async (req, res) => {
  try {
    const { templateId } = req.query;
    const matrices = await ElementMatrix.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'academicBands', 'financialBands', 'values'],
      order: [['createdAt', 'DESC']]
    });
    return res.status(200).json(matrices);
  }
  catch (error) {
    console.error("Error fetching element matrices:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  createRule,
  updateRule,
  deleteRule,
  getAllRules,
  getRuleById,
  getBulkRulesByTemplateId,
  createBulkRule,
  applyBulkRule,
  deleteBulkRule,
  createConditionalRule,
  getAllConditionalRules,
  getConditionalRuleById,
  deleteConditionalRule,
  createPopulationRule,
  getPopulationRuleByTemplateId,
  getPopulationRuleById,
  deletePopulationRule,
  updatePopulationRule,
  autoPopulationRule,
  updateConditionalRule,
  updateBulkRule,
  createBandRule,
  updateBandRule,
  getBandRulesByTemplateId,
  deleteBandRule,
  createElementMatrix,
  updateElementMatrix,
  deleteElementMatrix,
  getElementMatricesByTemplateId
};