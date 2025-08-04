const { Header, Template, SheetData, SheetDataSnapshot, OperationLog } = require('../models');
const MapHeader = require('../models/MapHeader');
const MappingTemplate = require('../models/MappingTemplate');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { exportHeader } = require('../services/excelService');

async function createHeader(req, res) {
  try {
    const { id, name, criticalityLevel, columnType } = req.body;

    if (!id || id.trim().length === 0) {
      return res.status(400).json({ error: 'Template ID is required and must be a non-empty' });
    }
    // Validate inputs
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required and must be a non-empty string' });
    }
    if (!criticalityLevel || !['1', '2', '3'].includes(criticalityLevel)) {
      return res.status(400).json({ error: "Criticality level must be one of '1', '2', '3'" });
    }
    if (!columnType || !['text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'].includes(columnType)) {
      return res.status(400).json({ error: "Column type must be one of 'text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'" });
    }


    const header = await sequelize.transaction(async (t) => {
      return await Header.create(
        {
          id: uuidv4(),
          name: name.trim(),
          criticalityLevel,
          columnType,
          templateId: id,
        },
        { transaction: t }
      );
    });

    res.status(201).json({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
    });
  } catch (error) {
    console.error('Error creating header:', error);
    res.status(500).json({ error: error.message });
  }
}

async function updateHeader(req, res) {
  try {
    const { id } = req.params;
    const { name, criticalityLevel, columnType } = req.body;

    // Validate inputs
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({ error: 'Header ID is required and must be a non-empty string' });
    }
    if (name && (typeof name !== 'string' || name.trim().length === 0)) {
      return res.status(400).json({ error: 'Name must be a non-empty string' });
    }
    if (criticalityLevel && !['1', '2', '3'].includes(criticalityLevel)) {
      return res.status(400).json({ error: "Criticality level must be one of '1', '2', '3'" });
    }
    if (columnType && !['text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'].includes(columnType)) {
      return res.status(400).json({ error: "Column type must be one of 'text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'" });
    }

    // Find header
    const header = await Header.findByPk(id);
    if (!header) {
      return res.status(404).json({ error: 'Header not found' });
    }

    // Update header within a transaction
    const updatedHeader = await sequelize.transaction(async (t) => {
      if (name) header.name = name.trim();
      if (criticalityLevel) header.criticalityLevel = criticalityLevel;
      if (columnType) header.columnType = columnType;

      await header.save({ transaction: t });
      return header;
    });

    res.status(200).json({
      id: updatedHeader.id,
      name: updatedHeader.name,
      criticalityLevel: updatedHeader.criticalityLevel,
      columnType: updatedHeader.columnType,
    });
  } catch (error) {
    console.error('Error updating header:', error);
    res.status(500).json({ error: error.message });
  }
}

async function deleteHeader(req, res) {
  try {
    const { id } = req.params;

    // Validate input
    if (!id || typeof id !== 'string' || id.trim().length === 0) {
      return res.status(400).json({ error: 'Header ID is required and must be a non-empty string' });
    }

    // Delete header within a transaction
    const result = await sequelize.transaction(async (t) => {
      const header = await Header.findByPk(id, { transaction: t });
      if (!header) {
        return { deleted: false, message: 'Header not found' };
      }

      await header.destroy({ transaction: t });
      return { deleted: true, message: 'Header deleted successfully' };
    });

    if (!result.deleted) {
      return res.status(404).json({ error: result.message });
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Error deleting header:', error);
    res.status(500).json({ error: error.message });
  }
}


async function getHeader(req, res) {
    try {
      const { id } = req.params;
  
      if (!id || typeof id !== 'string' || id.trim().length === 0) {
        return res.status(400).json({ error: 'Template ID is required and must be a non-empty string' });
      }
  
      const headers = await Header.findAll({
        where: { templateId: id },
        attributes: ['id', 'name', 'columnType', 'criticalityLevel'],
      });

      res.status(200).json(headers);
    } catch (error) {
      console.error('Error fetching headers:', {
        message: error.message,
        stack: error.stack,
        templateId: req.params?.id,
      });
      res.status(500).json({ error: error.message || 'Internal server error' });
    }
}

async function getQualifiedHeadersFromDB(templateId) {
  const query = `
    WITH valid_data AS (
      SELECT 
        h.id AS "headerId", 
        TRIM(sd.value) AS value
      FROM "Header" h
      JOIN "SheetData" sd ON sd."headerId" = h.id
      WHERE h."templateId" = :templateId
        AND sd.value IS NOT NULL
        AND TRIM(sd.value) <> ''
    ),
    filtered_headers AS (
      SELECT 
        "headerId"
      FROM valid_data
      GROUP BY "headerId"
      HAVING COUNT(DISTINCT value) >= 2
    )
    SELECT h.id, h.name, h."criticalityLevel", h."columnType"
    FROM "Header" h
    JOIN filtered_headers fh ON fh."headerId" = h.id
  `;

  const results = await sequelize.query(query, {
    replacements: { templateId },
    type: sequelize.QueryTypes.SELECT,
  });

  return results;
}

async function getQualifiedHeaders(req, res) {
  try {
    const { id: templateId } = req.params;

    if (!templateId || typeof templateId !== 'string' || templateId.trim().length === 0) {
      return res.status(400).json({ error: 'Template ID is required and must be a non-empty string' });
    }

    const qualifiedHeaders = await getQualifiedHeadersFromDB(templateId);
    if (!qualifiedHeaders || qualifiedHeaders.length === 0) {
      return res.status(404).json({ error: `No headers found` });
    }

    res.status(200).json(qualifiedHeaders);
  } catch (error) {
    console.error('Error fetching qualified headers:', error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}


async function exportHeaders(req, res) {
    try {
        const { templateName, templateId } = req.body;
    
        if (!templateName || templateName.trim().length === 0) {
          return res.status(400).json({ error: 'Template Name is required and must be a non-empty string' });
        }

        const headers = await Header.findAll({
          where: { templateId },
          attributes: ['id', 'name', 'columnType', 'criticalityLevel'],
        });

        const excelBuffer = await exportHeader(templateName, headers);
        // Set response headers
        res.setHeader('Content-Disposition', `attachment; filename="${templateName} Template.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(excelBuffer);

    } catch (error) {
        res.status(500).json({ error: error.message || 'Internal server error' });
    }
}

async function validateMappedTemplate(id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('mappingTemplateId must be a valid UUID');
  }

  const template = await MappingTemplate.findByPk(id);
  if (!template) {
    throw new Error('MappingTemplate does not exist');
  }
  return template;
}

async function validateTemplate(id) {
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('templateId must be a valid UUID'); // Fixed error message
  }

  const template = await Template.findByPk(id);
  if (!template) {
    throw new Error('Template does not exist');
  }
  return template;
}

async function getHeadersWithMapHeaders(req, res) {
  try {
    const { templateId, mappingtemplateId } = req.query;

    await validateTemplate(templateId);
    await validateMappedTemplate(mappingtemplateId);

    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name'],
      include: [
        {
          model: MapHeader,
          where: { mappingTemplateId: mappingtemplateId },
          attributes: ['id','name', 'headerId'],
          required: false,
        },
      ],
    });

    if (!headers || headers.length === 0) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    res.status(200).json(headers);
  } catch (error) {
    console.error(`Error retrieving headers with mapHeaders: ${error.message}`, error.stack);
    res.status(500).json({ error: error.message });
  }
}


async function getMapHeaders({ templateId, mappingTemplateId, fileHeaders }) {
  // Fetch Headers for templateId
  const headers = await Header.findAll({
    where: { templateId },
    attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
  });

  if (!headers || headers.length === 0) {
    throw new Error(`No headers found for templateId: ${templateId}`);
  }

  // Create a map of Header names for lookup
  const headerNameToInfo = new Map(
    headers.map(h => [
      h.name.toLowerCase(),
      { id: h.id, name: h.name, criticalityLevel: h.criticalityLevel, columnType: h.columnType },
    ])
  );

  // Initialize headerMap
  const headerMap = new Map(); // fileHeader (lowercase) -> { id, name, criticalityLevel, columnType }

  // If mappingTemplateId is provided, fetch MapHeaders
  let mapHeaders = [];
  if (mappingTemplateId) {
    mapHeaders = await MapHeader.findAll({
      where: { mappingTemplateId },
      attributes: ['name', 'headerId'],
    });
  }

  // Map file headers
  for (const fileHeader of fileHeaders) {
    const fileHeaderLower = fileHeader.toLowerCase();

    if (mappingTemplateId) {
      // Check MapHeader mapping
      const mapHeader = mapHeaders.find(mh => mh.name.toLowerCase() === fileHeaderLower);
      if (mapHeader) {
        const header = headers.find(h => h.id === mapHeader.headerId);
        if (header) {
          headerMap.set(fileHeaderLower, {
            id: header.id,
            name: header.name,
            criticalityLevel: header.criticalityLevel,
            columnType: header.columnType,
          });
          continue;
        }
      }
    }

    // Fallback to Header.name match (if no MapHeader or no mappingTemplateId)
    if (headerNameToInfo.has(fileHeaderLower)) {
      headerMap.set(fileHeaderLower, headerNameToInfo.get(fileHeaderLower));
    }
    // Skip unmapped headers
  }

  return { headers, headerMap };
}


async function getHeaderID(templateId) {
  try {
    const header = await Header.findOne({
      where: {
        name: "MatrixPop",
        templateId: templateId
      },
      attributes: ['id']
    });
    
    return header ? header.id : null;
  } catch (error) {
    console.error('Error fetching header ID:', error);
    throw error;
  }
}


async function createRunTimeHeader(req, res) {
  const transaction = await sequelize.transaction();
  try {
    const { templateId, name, criticalityLevel, columnType } = req.body;

    // Validate inputs
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new Error('Name is required and must be a non-empty string');
    }
    if (!criticalityLevel || !['1', '2', '3'].includes(criticalityLevel)) {
      throw new Error("Criticality level must be one of '1', '2', '3'");
    }
    if (!columnType || !['text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'].includes(columnType)) {
      throw new Error("Column type must be one of 'text', 'integer', 'decimal', 'Date', 'Y/N', 'number', 'character'");
    }

    // Create OperationLog entry
    const operationLog = await OperationLog.create(
      {
        id: uuidv4(),
        templateId,
        operationType: 'ADD_HEADER',
      },
      { transaction }
    );

    // Create new Header
    const header = await Header.create(
      {
        id: uuidv4(),
        name: name.trim(),
        criticalityLevel,
        columnType,
        templateId,
      },
      { transaction }
    );

    // Find maximum rowIndex for the template by joining with Header
    const [result] = await sequelize.query(
      `
      SELECT MAX(sd."rowIndex") as "maxRow"
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h.id
      WHERE h."templateId" = :templateId
      `,
      {
        replacements: { templateId },
        type: sequelize.QueryTypes.SELECT,
        transaction,
      }
    );

    const maxRow = result?.maxRow - 1 || 0;

    // Create empty SheetData entries for all rows for the new header
    const sheetDataEntries = [];
    const snapshotEntries = [];

    for (let i = 0; i <= maxRow; i++) {
      const sheetDataId = uuidv4();
      sheetDataEntries.push({
        id: sheetDataId,
        rowIndex: i+1,
        value: null,
        headerId: header.id,
      });

      // Create snapshot for potential revert
      snapshotEntries.push({
        id: uuidv4(),
        operationLogId: operationLog.id,
        headerId: header.id,
        rowIndex: i,
        originalValue: null,
        newValue: null,
        changeType: 'INSERT',
      });
    }

    // Bulk create SheetData entries
    await SheetData.bulkCreate(sheetDataEntries, { transaction });

    // Bulk create SheetDataSnapshot entries
    await SheetDataSnapshot.bulkCreate(snapshotEntries, { transaction });

    await transaction.commit();
    res.status(200).json({
      message: "Header created successfully",
      headerId: header.id,
      operationLogId: operationLog.id,
    });
  } catch (error) {
    await transaction.rollback();
    res.status(500).json({ error: error.message });
  }
}


module.exports = {
  createHeader,
  updateHeader,
  deleteHeader,
  getHeader,
  exportHeaders,
  getHeadersWithMapHeaders,
  getMapHeaders,
  getHeaderID,
  createRunTimeHeader,
  getQualifiedHeaders,
};