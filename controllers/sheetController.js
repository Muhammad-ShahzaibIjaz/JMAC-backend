const sequelize = require('../config/database');
const { Sheet } = require('../models');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

async function createSheet(req, res) {
  const { templateId, mappingTemplateId, sheetName } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !mappingTemplateId || !sheetName) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingSheet = await Sheet.findOne({ where: { templateId, mappingTemplateId, sheetName } });
    if (existingSheet) {
      return res.status(409).json({ error: 'Sheet with this name already exists' });
    }

    const sheet = await Sheet.create({
      templateId,
      mappingTemplateId,
      sheetName,
    });
    await createLog({ action: 'CREATE_SHEET', username, performedBy: req.userId, details: `Sheet '${sheetName}' created with ID: ${sheet.id}` });
    res.status(201).json({ id: sheet.id, templateId, mappingTemplateId, sheetName });
  } catch (error) {
    await createLog({ action: 'CREATE_SHEET_FAILED', username, performedBy: req.userId, details: `Failed to create sheet '${sheetName}': ${error.message}` });
    console.error('Error creating sheet:', error);
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
        await createLog({ action: 'DELETE_SHEET', username, performedBy: req.userId, details: `Sheet '${sheet.sheetName}' with ID: ${sheet.id} deleted` });
        res.status(204).send();
    } catch (error) {
        await createLog({ action: 'DELETE_SHEET_FAILED', username, performedBy: req.userId, details: `Failed to delete sheet ID '${id}': ${error.message}` });
        console.error('Error deleting sheet:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

module.exports = {
  createSheet,
  getSheets,
  deleteSheet,
  getSheetsByTemplateId
};