const { v4: uuidv4 } = require("uuid");
const Sheet = require("../models/Sheet");

// Create a new sheet
async function createSheet(req, res) {
  try {
    const { templateId, mappingTemplateId, sheetName } = req.body;

    // Validation
    if (!templateId || !mappingTemplateId || !sheetName) {
      return res.status(400).json({
        message:
          "Template ID, Mapping Template ID, and Sheet name are required",
      });
    }

    const existingSheet = await Sheet.findOne({
      where: { templateId, sheetName },
    });
    if (existingSheet) {
      return res.status(409).json({
        message: `Sheet with name "${sheetName}" already exists for this template.`,
      });
    }

    const newSheet = await Sheet.create({
      id: uuidv4(),
      templateId,
      mappingTemplateId,
      sheetName,
    });

    return res.status(201).json({
      message: "✅ Sheet created successfully",
      sheet: newSheet,
    });
  } catch (error) {
    console.error("❌ Error creating sheet:", error);
    return res.status(500).json({
      message: "Internal server error",
      details: error.message,
    });
  }
}

//  Get all sheets for a template
async function getSheetsByTemplate(req, res) {
  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    const sheets = await Sheet.findAll({ where: { templateId } });

    if (sheets.length === 0) {
      return res.status(404).json({
        message: `No sheets found for template ID: ${templateId}`,
      });
    }

    return res.status(200).json(sheets);
  } catch (error) {
    console.error("❌ Error fetching sheets:", error);
    return res.status(500).json({
      message: "Internal server error",
      details: error.message,
    });
  }
}

module.exports = { createSheet, getSheetsByTemplate };
