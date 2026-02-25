const MappingTemplate = require('../models/MappingTemplate');
const MapHeader = require('../models/MapHeader');
const Header = require('../models/Header');
const sequelize  = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const { Template } = require('../models');
const { generateHeaderMappingExcel } = require('../services/SheetService');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');
const { pre_defined_mapping } = require('../utils/preDefinedMapping');
const desiredOrder = require('../utils/headerOrderList').desiredOrder;



async function validateMappedTemplate(id) {
  // Validate UUID format
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('mappingTemplateId must be a valid UUID');
  }

  const template = await MappingTemplate.findByPk(id);
  if (!template) {
    throw new Error('Mapping Template does not exist');
  }
  return template;
}


async function updateMapHeader(req, res) {
  const username = await getUserName(req.userId);
  try {
    const { maptemplateId } = req.params;
    const mapHeaders = req.body;

    // Validate mappingTemplateId
    await validateMappedTemplate(maptemplateId);

    // Validate input array
    if (!Array.isArray(mapHeaders) || mapHeaders.length === 0) {
      return res.status(400).json({ error: 'Request body must be a non-empty array of MapHeader objects' });
    }

    // Validate each MapHeader
    for (const mapHeader of mapHeaders) {
      // Validate name
      if (!mapHeader.name || typeof mapHeader.name !== 'string' || mapHeader.name.trim().length === 0) {
        return res.status(400).json({ error: 'Each MapHeader must have a valid non-empty name' });
      }

      if (mapHeader.headerId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mapHeader.headerId)) {
        return res.status(400).json({ error: 'headerId must be a valid UUID or null' });
      }
    }

    // Perform delete and create in a transaction
    const createdMapHeaders = await sequelize.transaction(async (t) => {
      // Delete all existing MapHeaders for the mappingTemplateId
      await MapHeader.destroy({
        where: { mappingTemplateId: maptemplateId },
        transaction: t,
      });

      // Prepare data for bulk create
      const mapHeaderData = mapHeaders.map((mapHeader) => ({
        id: uuidv4(),
        name: mapHeader.name.trim(),
        mappingTemplateId: maptemplateId,
        headerId: mapHeader.headerId || null,
      }));

      return await MapHeader.bulkCreate(mapHeaderData, {
        validate: true,
        returning: true,
        transaction: t,
      });
    });
    await createLog({ action: 'UPDATE_MAP_HEADERS', username, performedBy: req.userId, details: `Updated MapHeaders for Mapping Template ID: ${maptemplateId}. Total headers updated: ${createdMapHeaders.length}` });
    res.status(201).json({ message: "Ok" });
  } catch (error) {
    await createLog({ action: 'UPDATE_MAP_HEADERS_FAILED', username, performedBy: req.userId, details: `Failed to update MapHeaders for Mapping Template ID: ${req.params.maptemplateId}: ${error.message}` });
    console.error('Error updating MapHeaders:', error);
    res.status(500).json({ error: error.message });
  }
}


async function getMapHeader(req, res) {
  try {
    const { mappingTemplateId } = req.query;

    if (!mappingTemplateId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mappingTemplateId)) {
      return res.status(400).json({ error: 'mappingTemplateId must be a valid UUID' });
    }

    const mapHeaders = await MapHeader.findAll({
      where: {
        mappingTemplateId: mappingTemplateId,
      },
      attributes: ['id', 'name', 'headerId'],
    });

    if (mapHeaders.length === 0) {
      return res.status(404).json({ error: 'No MapHeaders found for the provided mappingTemplateId' });
    }

    res.status(200).json(
      mapHeaders.map((header) => ({
        id: header.id,
        name: header.name,
        headerId: header.headerId,
      })),
    );
  } catch (error) {
    console.error('Error fetching MapHeaders:', error);
    res.status(500).json({ error: error.message });
  }
}

function normalize(str) {
  return str.toLowerCase().replace(/[_\s]/g, '');
}

function sortHeadersFlexibleMatch(headers) {
  const normalizedToHeader = new Map();
  const normalizedOriginals = [];

  for (const h of headers) {
    const norm = normalize(h.name);
    normalizedToHeader.set(norm, h);
    normalizedOriginals.push(norm);
  }

  const ordered = [];
  const matchedKeys = new Set();

  for (const name of desiredOrder) {
    const norm = normalize(name);
    const match = normalizedToHeader.get(norm);
    if (match) {
      ordered.push(match);
      matchedKeys.add(norm);
    }
  }

  const extras = [];
  for (let i = 0; i < headers.length; i++) {
    const norm = normalizedOriginals[i];
    if (!matchedKeys.has(norm)) {
      extras.push(headers[i]);
    }
  }

  return ordered.concat(extras);
}


async function createPreDefinedMapping(req, res) {
  try {
    const { templateId, mappingtemplateId } = req.query;

    // Fetch headers for the template
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ["id", "name", "criticalityLevel"],
    });

    if (!headers || headers.length === 0) {
      return res
        .status(404)
        .json({ error: `No headers found for templateId ${templateId}` });
    }

    // Build MapHeaders based on predefined mapping
    const mapHeadersToCreate = [];

    for (const header of headers) {
      const mapping = pre_defined_mapping.find(
        (m) => m.name.toLowerCase() === header.name.toLowerCase()
      );

      if (mapping) {
        mapping.aliases.forEach((alias) => {
          mapHeadersToCreate.push({
            id: uuidv4(),
            name: alias,
            headerId: header.id,
            mappingTemplateId: mappingtemplateId,
          });
        });
      }
    }

    // Save MapHeaders in DB
    if (mapHeadersToCreate.length > 0) {
      await MapHeader.bulkCreate(mapHeadersToCreate, { validate: true });
    }

    // Fetch headers again, now including their MapHeaders
    const enrichedHeaders = await Header.findAll({
      where: { templateId },
      attributes: ["id", "name", "criticalityLevel"],
      include: [
        {
          model: MapHeader,
          where: { mappingTemplateId: mappingtemplateId },
          attributes: ["id", "name", "headerId", "createdAt"],
          required: false,
          separate: true,
          order: [["createdAt", "ASC"]],
        },
      ],
    });

    if (!enrichedHeaders || enrichedHeaders.length === 0) {
      return res.status(404).json({
        error: `No headers with MapHeaders found for templateId ${templateId}`,
      });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(enrichedHeaders);

    res.status(200).json(sortedHeaders);
  } catch (error) {
    console.error(
      `Error creating predefined mapping: ${error.message}`,
      error.stack
    );
    res.status(500).json({ error: error.message });
  }
}

const getHeaderMappingTable = async (templateId, mappingTemplateId) => {
  try {
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name']
    });

    const headerIds = headers.map(h => h.id);

    const mappings = await MapHeader.findAll({
      where: {
        mappingTemplateId,
        headerId: headerIds
      },
      attributes: ['headerId', 'name']
    });

    const mapByHeaderId = new Map();
    mappings.forEach(m => {
      if (!mapByHeaderId.has(m.headerId)) {
        mapByHeaderId.set(m.headerId, []);
      }
      mapByHeaderId.get(m.headerId).push(m.name);
    });

    const table = [
      ['SMARTAID Headers', 'Mapped Headers'], // Header row
      ...headers.map(header => [
        header.name,
        mapByHeaderId.get(header.id)?.join(', ') || ''
      ])
    ];

    return table;
  } catch (error) {
    console.error("Error generating header mapping table:", error);
    throw error;
  }
};

const exportHeaderMapping = async (req, res) => {
  const username = await getUserName(req.userId);
  try {
    const { templateId, mappingTemplateId } = req.query;

    if (!templateId || !mappingTemplateId) {
      return res.status(400).json({ error: 'templateId and mappingTemplateId are required' });
    }

    const template = await Template.findByPk(templateId);
    const mappingTemplate = await MappingTemplate.findByPk(mappingTemplateId);
    

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!mappingTemplate) {
      return res.status(404).json({ error: 'Mapping Template not found' });
    }

    const mappingTable = await getHeaderMappingTable(templateId, mappingTemplateId);
    const buffer = await generateHeaderMappingExcel(mappingTable);
    await createLog({ action: 'EXPORT_HEADER_MAPPING', username, performedBy: req.userId, details: `Exported header mapping for Template ID: ${templateId} and Mapping Template ID: ${mappingTemplateId}` });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${template.name}_${mappingTemplate.name}.xlsx`);
    res.status(200).send(buffer);
  } catch (error) {
    await createLog({ action: 'EXPORT_HEADER_MAPPING_FAILED', username, performedBy: req.userId, details: `Failed to export header mapping for Template ID: ${req.query.templateId} and Mapping Template ID: ${req.query.mappingTemplateId}: ${error.message}` });
    console.error("Error exporting header mapping:", error);
    res.status(500).json({ error: 'Failed to export header mapping' });
  }
}


module.exports = {
  updateMapHeader,
  getMapHeader,
  exportHeaderMapping,
  createPreDefinedMapping,
};