const MappingTemplate = require('../models/MappingTemplate');
const MapHeader = require('../models/MapHeader');
const sequelize  = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');



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
    res.status(201).json({ message: "Ok" });
  } catch (error) {
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

module.exports = {
  updateMapHeader,
  getMapHeader,
};