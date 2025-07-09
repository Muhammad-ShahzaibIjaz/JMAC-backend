const sequelize  = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const Mapping_Template = require('../models/MappingTemplate');
const Template = require('../models/Template');


async function createMappingTemplate(req, res) {
  try {
    const { templateId } = req.params;
    const { name } = req.body;

    if (!templateId || templateId.trim().length === 0) {
        return res.status(400).json({ error: "Template ID is required and must be a non-empty string" });
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Mapped Template name is required and must be a non-empty string' });
    }

    const trimmedName = name.trim();
    const existingTemplate = await Mapping_Template.findOne({
      where: {
        [Op.and]: [
          sequelize.where(
            sequelize.fn('LOWER', sequelize.col('name')),
            trimmedName.toLowerCase()
          ),
          { templateId }
        ]
      }
    });

    if (existingTemplate) {
      return res.status(409).json({ error: 'A Mapped template with this name already exists' });
    }

    const template = await sequelize.transaction(async (t) => {
      return await Mapping_Template.create(
        {
          id: uuidv4(),
          name: name.trim(),
          templateId
        },
        { transaction: t }
      );
    });

    res.status(201).json({
      id: template.id,
      name: template.name,
      templateId: template.templateId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function validateTemplate(templateId) {
  if (!templateId || templateId.trim().length === 0) {
    throw new Error('Template ID is required and must be non-empty');
  }
  const template = await Template.findByPk(templateId);
  if (!template) {
    throw new Error('Template does not exist');
  }
  return template;
}


async function deleteMappingTemplate(req, res) {
  try {
    const { id } = req.params;

    if (!id || id.trim().length === 0) {
      return res.status(400).json({ error: "Mapping Template ID is required and must be a non-empty string" });
    }

    const result = await sequelize.transaction(async (t) => {
      const template = await Mapping_Template.findByPk(id, { transaction: t });
      if (!template) {
        return { deleted: false, message: "Template not found" };
      }

      await template.destroy({ transaction: t });

      return {
        deleted: true,
        message: "Successfully deleted template and all associated data",
      };
    });

    if (!result.deleted) {
      return res.status(404).json({ error: result.message });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error("Error deleting template:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}



async function getMappingTemplates(req, res) {
  try {
    const { id } = req.params;

    await validateTemplate(id);

    const templates = await Mapping_Template.findAll({
      where: {
        templateId: id
      }
    });

    const formattedTemplates = templates.map((template) => ({
      id: template.id,
      name: template.name,
      templateId: template.templateId
    }));

    res.json(formattedTemplates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


async function updateMappingTemplate(req, res) {
  try {
    const { id, name } = req.query;

    if (!id || !name) {
      return res.status(400).json({ error: "mappingId and name are required" });
    }

    const [updatedCount, updatedTemplates] = await Mapping_Template.update(
      { name },
      {
        where: { id },
        returning: true, // Return the updated record(s)
      }
    );

    if (updatedCount === 0) {
      return res.status(404).json({ error: "No template found with the provided templateId" });
    }
    res.status(200).json({
      message: "ok"
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


module.exports = {
  createMappingTemplate,
  deleteMappingTemplate,
  getMappingTemplates,
  updateMappingTemplate
};