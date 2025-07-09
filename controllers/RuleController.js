const Rule = require("../models/Rule");
const { v4: uuidv4 } = require("uuid");

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

const getRuleById = async (req, res) => {
  try {
    const { id } = req.query;

    const rule = await Rule.findByPk(id, {
      attributes: ['id', 'name', 'conditions', 'assignments', 'headers', 'templateId']
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

module.exports = {
  createRule,
  updateRule,
  deleteRule,
  getAllRules,
  getRuleById
};