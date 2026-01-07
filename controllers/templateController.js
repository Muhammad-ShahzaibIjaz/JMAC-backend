const sequelize  = require('../config/database');
const Template = require('../models/Template');
const Header = require('../models/Header');
const MapHeader = require('../models/MapHeader');
const TemplatePermission = require('../models/TemplatePermission');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const path = require('path');
const fs = require('fs');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');

async function createTemplate(req, res) {
  const { name } = req.body;
  const username = await getUserName(req.userId);
  try {

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Template name is required and must be a non-empty string' });
    }

    const trimmedName = name.trim();

    const existingTemplate = await Template.findOne({
      where: sequelize.where(
        sequelize.fn('LOWER', sequelize.col('name')),
        trimmedName.toLowerCase()
      ),
    });

    if (existingTemplate) {
      return res.status(409).json({ error: 'A template with this name already exists' });
    }

    const template = await sequelize.transaction(async (t) => {
      return await Template.create(
        {
          id: uuidv4(),
          name: name.trim(),
        },
        { transaction: t }
      );
    });
    await createLog({
      action: 'CREATE_TEMPLATE',
      username,
      performedBy: req.userRole,
      details: `Template '${template.name}' created with ID: ${template.id}`,
    });
    res.status(201).json({
      id: template.id,
      name: template.name
    });
  } catch (error) {
    await createLog({ action: 'CREATE_TEMPLATE_FAILED', username, performedBy: req.userRole, details: `Failed to create template '${name}': ${error.message}` });
    console.error('Error creating template:', error);
    res.status(500).json({ error: error.message });
  }
}

async function deleteTemplate(req, res) {
  const { id } = req.params;
  const username = await getUserName(req.userId);
  try {

    // Validate input
    if (!id || typeof id !== "string" || id.trim().length === 0) {
      return res.status(400).json({ error: "Template ID is required and must be a non-empty string" });
    }
    const result = await sequelize.transaction(async (t) => {
      // Find the template
      const template = await Template.findByPk(id, { transaction: t });
      if (!template) {
        return { deleted: false, message: "Template not found" };
      }

      // Find all headers associated with the template
      const headers = await Header.findAll({
        where: { templateId: id },
        transaction: t,
      });

      // Delete all MapHeader records referencing these headers
      const headerIds = headers.map((header) => header.id);
      await MapHeader.destroy({
        where: { headerId: headerIds },
        transaction: t,
      });

      // Delete the Template (cascading deletes handle associated data)
      await template.destroy({ transaction: t });
      return {
        deleted: true,
        message: "Successfully deleted template and all associated data",
      };
    });
    if (!result.deleted) {
      return res.status(404).json({ error: result.message });
    }
    
    const dirPath = path.join(__dirname, '..', 'uploads', id);
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        if (fs.lstatSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
          console.log(`Deleted file: ${filePath}`);
        }
      }
    } else {
      console.warn(`Directory not found: ${dirPath}`);
    }
    
    await createLog({ action: 'DELETE_TEMPLATE', username, performedBy: req.userRole, details: `Template with ID: ${id} deleted` });
    return res.status(200).json(result);
  } catch (error) {
    await createLog({ action: 'DELETE_TEMPLATE_FAILED', username, performedBy: req.userRole, details: `Failed to delete template ID '${id}': ${error.message}` });
    console.error("Error deleting template:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}


async function getTemplates(req, res) {
  const { userId, userRole } = req;
  try {
    let templates;

    if (userRole === "Admin" || userRole === "Creator") {
      // full access
      templates = await Template.findAll();
    } else if (userRole === "Consultant" || userRole === "Campus") {
      templates = await Template.findAll({
        include: [
          {
            model: TemplatePermission,
            as: "permissions",
            where: { userId },
            attributes: [],
          },
        ],
      });
    } else {
      templates = [];
    }

    const formattedTemplates = templates.map((template) => ({
      id: template.id,
      name: template.name,
    }));

    res.json(formattedTemplates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: error.message });
  }
}

async function getTemplateByID(req, res) {
  try {
    const { id } = req.params;
    const template = await Template.findByPk(id);

    res.json({
      id: template.id,
      name: template.name,
    });
  } catch (error) {
    console.error('Error fetching templates:', error);
    res.status(500).json({ error: error.message });
  }
}

async function getTemplatePermissionStatus(req, res) {
  const { templateId } = req.query;
  const { userId } = req;
  try {
    if (!templateId) {
      return res.status(400).json({ error: 'Template ID is required' });
    }
    const permission = await TemplatePermission.findOne({
      where: {
        templateId,
        userId,
      },
    });
    if (!permission) {
      return res.status(200).json({ access: false });
    }
    res.status(200).json({ access: permission.accessLevel ===  'write' ? true : false });
  } catch (error) {
    console.error('Error fetching template permission status:', error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = {
  createTemplate,
  deleteTemplate,
  getTemplates,
  getTemplateByID,
  getTemplatePermissionStatus,
};