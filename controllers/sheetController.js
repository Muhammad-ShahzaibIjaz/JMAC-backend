const sequelize = require('../config/database');
const { Sheet } = require('../models');

async function createSheet(req, res) {
  const { templateId, mappingTemplateId, sheetName } = req.body;

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
    res.status(201).json({ id: sheet.id, templateId, mappingTemplateId, sheetName });
  } catch (error) {
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


module.exports = {
  createSheet,
  getSheets,
};