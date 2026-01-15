const sequelize = require('../config/database');
const { Sheet } = require('../models');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');
const { DataTypes, Op, QueryTypes, fn, col } = require('sequelize');

async function createSheet(req, res) {
  const { templateId, mappingTemplateId, sheetName, sheetYear } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !mappingTemplateId || !sheetName || !sheetYear) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingSheet = await Sheet.findOne({ where: { templateId, mappingTemplateId, sheetName, sheetYear } });
    if (existingSheet) {
      return res.status(409).json({ error: 'Sheet with this name and year already exists' });
    }

    const sheet = await Sheet.create({
      templateId,
      mappingTemplateId,
      sheetName,
      sheetYear
    });
    await createLog({ action: 'CREATE_SHEET', username, performedBy: req.userRole, details: `Sheet '${sheetName}' for year '${sheetYear}' created with ID: ${sheet.id}` });
    res.status(201).json({ id: sheet.id, templateId, mappingTemplateId, sheetName, sheetYear });
  } catch (error) {
    await createLog({ action: 'CREATE_SHEET_FAILED', username, performedBy: req.userRole, details: `Failed to create sheet '${sheetName}' for year '${sheetYear}': ${error.message}` });
    console.error('Error creating sheet:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}


async function updateSheet(req, res) {
  const { id } = req.query;
  const { sheetName, sheetYear } = req.body;
  const username = await getUserName(req.userId);

  try {
    const sheet = await Sheet.findByPk(id);
    if (!sheet) {
      return res.status(404).json({ error: "Sheet not found" });
    }

    // If user is trying to change name/year, check uniqueness
    const newName = sheetName || sheet.sheetName;
    const newYear = sheetYear || sheet.sheetYear;

    const existing = await Sheet.findOne({
      where: {
        sheetName: newName,
        sheetYear: newYear,
        templateId: sheet.templateId, // same template
        id: { [Op.ne]: id }, // exclude current sheet
      },
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "Sheet with this name and year already exists" });
    }

    sheet.sheetName = newName;
    sheet.sheetYear = newYear;
    await sheet.save();

    await createLog({
      action: "UPDATE_SHEET",
      username,
      performedBy: req.userRole,
      details: `Sheet '${sheet.sheetName}' with ID: ${sheet.id} updated`,
    });

    res.status(200).json(sheet);
  } catch (error) {
    await createLog({
      action: "UPDATE_SHEET_FAILED",
      username,
      performedBy: req.userRole,
      details: `Failed to update sheet ID '${id}': ${error.message}`,
    });
    console.error("Error updating sheet:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

async function makeSheetCensused(req, res) {
    const { id } = req.query;
    const { flag } = req.body;
    const username = await getUserName(req.userId);
    try {
        const sheet = await Sheet.findByPk(id);
        if (!sheet) {
            return res.status(404).json({ error: 'Sheet not found' });
        }
        sheet.isFreezed = flag;
        await sheet.save();
        await createLog({ action: 'MAKE_SHEET_CENSUSED', username, performedBy: req.userRole, details: `Sheet '${sheet.sheetName}' with ID: ${sheet.id} marked as censused with flag ${flag}` });
        res.status(200).json(sheet);
    } catch (error) {
        await createLog({ action: 'MAKE_SHEET_CENSUSED_FAILED', username, performedBy: req.userRole, details: `Failed to mark sheet ID '${id}' as censused: ${error.message}` });
        console.error('Error marking sheet as censused:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function getSheets(req, res) {
    const { templateId, mappingTemplateId } = req.query;

    try {
        const sheets = await Sheet.findAll({
            where: {
                ...(templateId && { templateId }),
                ...(mappingTemplateId && { mappingTemplateId }),
            },
        });
        res.status(200).json(sheets);
    } catch (error) {
        console.error('Error fetching sheets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function getSheetsByTemplateId(req, res) {
    const { templateId } = req.params;

    try {
        const sheets = await Sheet.findAll({
            where: { templateId },
        });
        res.status(200).json(sheets);
    } catch (error) {
        console.error('Error fetching sheets:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

async function deleteSheet(req, res) {
    const { id } = req.params;
    const username = await getUserName(req.userId);
    try {
        const sheet = await Sheet.findByPk(id);
        if (!sheet) {
            return res.status(404).json({ error: 'Sheet not found' });
        }

        await sheet.destroy();
        await createLog({ action: 'DELETE_SHEET', username, performedBy: req.userRole, details: `Sheet '${sheet.sheetName}' with ID: ${sheet.id} deleted` });
        res.status(204).send();
    } catch (error) {
        await createLog({ action: 'DELETE_SHEET_FAILED', username, performedBy: req.userRole, details: `Failed to delete sheet ID '${id}': ${error.message}` });
        console.error('Error deleting sheet:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
  createSheet,
  updateSheet,
  makeSheetCensused,
  getSheets,
  deleteSheet,
  getSheetsByTemplateId
};