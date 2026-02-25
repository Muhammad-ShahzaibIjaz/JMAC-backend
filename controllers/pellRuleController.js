const { Op } = require('sequelize');
const sequelize = require('../config/database');
const { PellRule } = require('../models');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

const createPellRule = async (req, res) => {
    const { name, pellSource, criteria, targetHeader, templateId, acceptanceStatus, isGlobal=false } = req.body;
    const username = await getUserName(req.userId);

    try {

        if (!name || !pellSource || !criteria || !targetHeader || !templateId || !acceptanceStatus) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Check for existing PellRule with the same name and templateId
        const existingPellRule = await PellRule.findOne({ where: { name, templateId } });
        if (existingPellRule) {
            return res.status(409).json({ error: 'PellRule with the same name and templateId already exists' });
        }
        const newPellRule = await PellRule.create({
            name,
            pellSource,
            criteria,
            targetHeader,
            templateId,
            acceptanceStatus,
            isGlobal
        });
        await createLog({ action: 'CREATE_PELL_RULE', username, performedBy: req.userId, details: `Created PellRule '${name}' with ID: ${newPellRule.id}` });
        res.status(201).json({id: newPellRule.id, name, pellSource: newPellRule.pellSource, criteria: newPellRule.criteria, targetHeader: newPellRule.targetHeader, acceptanceStatus: newPellRule.acceptanceStatus, isGlobal: newPellRule.isGlobal});
    } catch (error) {
        await createLog({ action: 'CREATE_PELL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to create PellRule '${name}': ${error.message}` });
        console.error('Error creating PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const duplicatePellRule = async (req, res) => {
  const { pellId, name, templateId } = req.body;

  if (!pellId || !name || !templateId) {
    return res.status(400).json({ error: "pellId, name, and templateId are required" });
  }

  try {
    const usernamePromise = getUserName(req.userId);

    // Run queries in parallel
    const [existingPellRule, isRuleExist, username] = await Promise.all([
      PellRule.findByPk(pellId),
      PellRule.findOne({ where: { templateId, name } }),
      usernamePromise
    ]);

    if (!existingPellRule) {
      return res.status(404).json({ error: "PellRule to duplicate not found" });
    }

    if (isRuleExist) {
      return res.status(409).json({ error: "Duplicate PellRule already exists" });
    }

    const {
      pellSource,
      criteria,
      targetHeader,
      acceptanceStatus,
      isGlobal
    } = existingPellRule;

    const duplicatePellRule = await PellRule.create({
      name,
      pellSource,
      criteria,
      targetHeader,
      templateId,
      acceptanceStatus,
      isGlobal
    });

    await createLog({
      action: "DUPLICATE_PELL_RULE",
      username,
      performedBy: req.userId,
      details: `Duplicated PellRule with new ID: ${duplicatePellRule.id} from original ID: ${pellId}`
    });

    return res.status(201).json({
      id: duplicatePellRule.id,
      name: duplicatePellRule.name,
      pellSource: duplicatePellRule.pellSource,
      criteria: duplicatePellRule.criteria,
      targetHeader: duplicatePellRule.targetHeader,
      templateId: duplicatePellRule.templateId,
      acceptanceStatus: duplicatePellRule.acceptanceStatus,
      isGlobal: duplicatePellRule.isGlobal
    });
  } catch (error) {
    const username = await getUserName(req.userId);
    await createLog({
      action: "DUPLICATE_PELL_RULE_FAILED",
      username,
      performedBy: req.userId,
      details: `Failed to duplicate PellRule with original ID: ${pellId}: ${error.message}`
    });
    console.error("Error duplicating PellRule:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const updatePellRule = async (req, res) => {
    const { pellId } = req.params;
    const { name, pellSource, criteria, targetHeader, acceptanceStatus, templateId, isGlobal=false } = req.body;
    const username = await getUserName(req.userId);
    try {
        const pellRule = await PellRule.findByPk(pellId);
        if (!pellRule) {
            return res.status(404).json({ error: 'PellRule not found' });
        }
        pellRule.templateId = templateId || pellRule.templateId;
        pellRule.name = name || pellRule.name;
        pellRule.pellSource = pellSource || pellRule.pellSource;
        pellRule.criteria = criteria || pellRule.criteria;
        pellRule.targetHeader = targetHeader || pellRule.targetHeader;
        pellRule.acceptanceStatus = acceptanceStatus || pellRule.acceptanceStatus;
        pellRule.isGlobal = isGlobal;
        await pellRule.save();
        await createLog({ action: 'UPDATE_PELL_RULE', username, performedBy: req.userId, details: `Updated PellRule with ID: ${pellId}` });
        res.status(200).json(pellRule);
    }
    catch (error) {
        await createLog({ action: 'UPDATE_PELL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to update PellRule with ID: ${pellId}: ${error.message}` });
        console.error('Error updating PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const getPellRules = async (req, res) => {
    const { templateId } = req.query;

    try {
        const pellRules = await PellRule.findAll(
            { where: { 
                [Op.or]: [{templateId: templateId}, {isGlobal: true}] } }
        );
        res.status(200).json(pellRules);
    } catch (error) {
        console.error('Error fetching PellRules:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const getPellRuleById = async (req, res) => {
    const { id } = req.params;

    try {
        const pellRule = await PellRule.findByPk(id);
        if (!pellRule) {
            return res.status(404).json({ error: 'PellRule not found' });
        }
        res.status(200).json(pellRule);
    } catch (error) {
        console.error('Error fetching PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const deletePellRule = async (req, res) => {
    const { id } = req.query;
    const username = await getUserName(req.userId);
    try {
        const pellRule = await PellRule.findByPk(id);
        if (!pellRule) {
            return res.status(404).json({ error: 'PellRule not found' });
        }
        await pellRule.destroy();
        await createLog({ action: 'DELETE_PELL_RULE', username, performedBy: req.userId, details: `Deleted PellRule with ID: ${id}` });
        res.status(200).json({ message: 'PellRule deleted successfully' });
    } catch (error) {
        await createLog({ action: 'DELETE_PELL_RULE_FAILED', username, performedBy: req.userId, details: `Failed to delete PellRule with ID: ${id}: ${error.message}` });
        console.error('Error deleting PellRule:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    createPellRule,
    getPellRules,
    getPellRuleById,
    deletePellRule,
    updatePellRule,
    duplicatePellRule
}