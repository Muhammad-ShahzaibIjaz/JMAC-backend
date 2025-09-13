const Rule = require("../models/Rule");
const CalculationRule = require("../models/CalculationRule");
const { v4: uuidv4 } = require("uuid");
const { Header, ConditionalRule } = require("../models");
const { bulkUpdates } = require("./dataController");

const createRule = async (req, res) => {
  try {
    const { name, conditions, assignments, headers, templateId } = req.body;

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

    return res.status(201).json({ message: "Rule created successfully", rule });
  } catch (error) {
    console.error("Error creating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const createConditionalRule = async (req, res) => {
  try {
    const { ruleName, conditions, headers, targetHeaderName, targetValue, templateId } = req.body;

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
      templateId
    });

    return res.status(201).json({ id: rule.id, ruleName: rule.ruleName, conditions: Array.isArray(conditions.all)
  ? conditions.all.length
  : Array.isArray(conditions.any)
    ? conditions.any.length
    : 0, targetHeaderName: rule.targetHeaderName, targetValue: rule.targetValue });
  } catch (error) {
    console.error("Error creating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updateRule = async (req, res) => {
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

    return res.status(200).json({ message: "Rule updated successfully", rule });
  } catch (error) {
    console.error("Error updating rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const deleteRule = async (req, res) => {
  try {
    const { id } = req.params;

    const rule = await Rule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    return res.status(200).json({ message: "Rule deleted successfully" });
  } catch (error) {
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
      where: { templateId },
      attributes: ['id', 'ruleName', 'conditions', 'headers', 'targetHeaderName', 'targetValue'],
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
        targetValue: rule.targetValue
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
      where: { templateId: id, isGlobal: true },
      attributes: ['id', 'name', 'header', 'assignments'],
      order: [['createdAt', 'DESC']]
    });

    const transformedRules = rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
      headerName: rule.header,
      assignment: rule.assignments
    }));
    return res.status(200).json(transformedRules);
  } catch (error) {
    console.error("Error fetching rules:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};


const createBulkRule = async (req, res) => {
  const { headerName, value, name, templateId } = req.body;
  try{
    // Validate input
    if (!headerName || !value || !name || !templateId) {
      return res.status(400).json({ error: "All fields (headerName, value, name, templateId) are required" });
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
      isGlobal: true,
      templateId
    });
    return res.status(201).json({ id: rule.id, name: rule.name });
  } catch (error) {
    console.error("Error creating bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const applyBulkRule = async (req, res) => {
  const { id } = req.query;
  const { sheetId } = req.body;
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
    return res.status(200).json({ message: "Bulk rule applied successfully" });
  } catch (error) {
    console.error("Error applying bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const deleteBulkRule = async (req, res) => {
  const { id } = req.query;
  try{
    const isBulkRuleExist = await CalculationRule.findByPk(id);
    if (!isBulkRuleExist) {
      return res.status(404).json({ error: "Bulk rule not found" });
    }
    await isBulkRuleExist.destroy();
    return res.status(200).json({ message: "Bulk rule deleted successfully" });
  } catch(error) {
    console.error("Error deleting bulk rule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

const deleteConditionalRule = async (req, res) => {
  try {
    const { id } = req.query;

    const rule = await ConditionalRule.findByPk(id);
    if (!rule) {
      return res.status(404).json({ error: "Rule not found" });
    }

    await rule.destroy();
    return res.status(200).json({ message: "Rule deleted successfully" });
  } catch (error) {
    console.error("Error deleting rule:", error);
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
  deleteConditionalRule
};