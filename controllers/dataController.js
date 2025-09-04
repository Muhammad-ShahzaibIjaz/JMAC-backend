const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes } = require('sequelize');
const {generateExcelFile} = require('../services/SheetService');
const { processFiles } = require('./fileController');
const { getMapHeaders, getHeaderID } = require('./headerController');
const { v4: uuidv4 } = require('uuid');
const { addressAPI } = require('../services/addressService');
const math = require('mathjs');
const { OperationLog, SheetDataSnapshot } = require('../models');
const { convertScore } = require('../services/conversion');
const { getCipTitle } = require('../services/cipService');
const { desiredOrder, requiredHeadersName, awardTypePatterns } = require('../utils/headerOrderList');
const { buildZipCountyMap } = require('../services/countyService');

async function deleteSheetData(req, res) {
  try {
    const { templateId } = req.query;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    let deletedCount = 0;
    await sequelize.transaction(async (transaction) => {
        deletedCount = await SheetData.destroy({
        where: {
          headerId: {
            [Op.in]: await sequelize.models.Header.findAll({
              where: { templateId },
              attributes: ['id'],
              raw: true,
            }).then(headers => headers.map(header => header.id))
          }
        },
        transaction,
      });

    });
    
    if (deletedCount === 0) {
      console.warn(`No SheetData records found for templateId ${templateId}`);
    }
    res.status(200).json({ 
      message: 'SheetData deleted successfully',
      deletedCount
    });
  } catch (error) {
    console.error(`Error deleting SheetData: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
}



// Validate value against columnType
function validateAndConvertValue(value, columnType, criticalityLevel) {
  if (criticalityLevel === '3') {
    return { value, valid: true };
  }

  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    return { value: null, valid: false };
  }

  const stringValue = value.toString().trim();

  switch (columnType) {
    case 'decimal': {
      const num = parseFloat(stringValue);
      const isValid = !isNaN(num) && Number.isFinite(num);
      return {
        value: isValid ? num.toFixed(4) : stringValue,
        valid: isValid,
      };
    }

    case 'integer': {
      const num = parseInt(stringValue, 10);
      const isValid = !isNaN(num) && Number.isInteger(num);
      return {
        value: isValid ? num.toString() : stringValue,
        valid: isValid,
      };
    }

    case 'Date': {
      const date = new Date(stringValue);
      const isValid = !isNaN(date.getTime());
      if (isValid) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return {
          value: `${month}-${day}-${year}`,
          valid: true,
        };
      }
      return { value: stringValue, valid: false };
    }

    case 'Y/N': {
      const normalized = stringValue.toUpperCase();
      if (['Y', 'N'].includes(normalized)) {
        return { value: normalized, valid: true };
      }
      if (normalized === 'YES') return { value: 'Y', valid: true };
      if (normalized === 'NO') return { value: 'N', valid: true };
      if (normalized === '1') return { value: 'Y', valid: true };
      if (normalized === '0') return { value: 'N', valid: true };
      return { value: stringValue, valid: false };
    }

    case 'text':
    case 'character': {
      const isValid = stringValue.length > 0;
      return { value: stringValue, valid: isValid };
    }

    default:
      return { value: stringValue, valid: false };
  }
}

// async function getHeadersWithValidatedData(req, res) {
//   try {
//     const { templateId, currentPage, pageSize } = req.query;

//     if (!templateId) {
//       return res.status(400).json({ error: 'templateId is required' });
//     }
//     if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
//       return res.status(400).json({ error: 'templateId must be a valid UUID' });
//     }
//     const page = parseInt(currentPage);
//     const size = parseInt(pageSize);
//     if (isNaN(page) || page < 1) {
//       return res.status(400).json({ error: 'currentPage must be a positive integer' });
//     }
//     if (isNaN(size) || size < 1) {
//       return res.status(400).json({ error: 'pageSize must be a positive integer' });
//     }

//     const headers = await Header.findAll({
//       where: { templateId },
//       attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
//       order: [['createdAt', 'ASC']],
//     });

//     if (!headers || headers.length === 0) {
//       return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
//     }

//     const allSheetData = await SheetData.findAll({
//       include: [{
//         model: Header,
//         where: { templateId },
//         attributes: [],
//       }],
//       attributes: ['id', 'rowIndex', 'value', 'headerId'],
//       order: [['rowIndex', 'ASC']],
//     });

//     const errorRows = new Set();
//     const errorPages = new Set();
//     const validatedDataByHeader = {};

//     headers.forEach(header => {
//       validatedDataByHeader[header.id] = [];
//     });

//     allSheetData.forEach(data => {
//       const header = headers.find(h => h.id === data.headerId);
//       if (!header) return;

//       const { value, valid } = validateAndConvertValue(
//         data.value,
//         header.columnType,
//         header.criticalityLevel
//       );

//       validatedDataByHeader[header.id].push({
//         id: data.id,
//         rowIndex: data.rowIndex,
//         value,
//         valid,
//       });

//       if (!valid) {
//         errorRows.add(data.rowIndex);
//         const pageWithError = Math.floor(data.rowIndex / size) + 1;
//         errorPages.add(pageWithError);
//       }
//     });

//     const offset = (page - 1) * size;
//     const paginatedDataByHeader = {};

//     headers.forEach(header => {
//       const headerData = validatedDataByHeader[header.id];
//       const paginatedData = headerData.filter(
//         data => data.rowIndex >= offset && data.rowIndex < offset + size
//       );
//       paginatedDataByHeader[header.id] = paginatedData;
//     });

//     const responseHeaders = headers.map(header => ({
//       id: header.id,
//       name: header.name,
//       criticalityLevel: header.criticalityLevel,
//       columnType: header.columnType,
//       data: paginatedDataByHeader[header.id],
//     }));

//     const totalRows = Math.max(...allSheetData.map(data => data.rowIndex), 0);
//     const totalPages = Math.ceil(totalRows / size);

//     res.status(200).json({
//       headers: responseHeaders,
//       totalErrorRows: errorRows.size,
//       errorPages: Array.from(errorPages).sort((a, b) => a - b),
//       pagination: {
//         currentPage: page,
//         pageSize: size,
//         totalRows,
//         totalPages,
//       },
//     });
//   } catch (error) {
//     console.error('Error retrieving headers with validated data:', error.message, error.stack);
//     res.status(500).json({ error: 'Failed to retrieve data' });
//   }
// }

function normalize(str) {
  return str.toLowerCase().replace(/[_\s]/g, '');
}

function sortHeadersFlexibleMatch(headers) {
  const headerMap = new Map(headers.map(h => [normalize(h.name), h]));
  const ordered = desiredOrder.map(name => headerMap.get(normalize(name))).filter(Boolean);
  const matchedKeys = new Set(ordered.map(h => normalize(h.name)));
  const extras = headers.filter(h => !matchedKeys.has(normalize(h.name)));
  return [...ordered, ...extras];
}

async function getHeadersWithValidatedData(req, res) {
  try {
    const { templateId, currentPage, pageSize } = req.query;

    // Validation checks
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }

    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1 || isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'Invalid pagination values' });
    }

    const offset = (page - 1) * size;

    // Fetch header definitions
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['createdAt', 'ASC']],
    });

    if (!headers?.length) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(headers);
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));

    const distinctRowIndices = await SheetData.findAll({
      include: [{ model: Header, where: { templateId }, attributes: [] }],
      attributes: ['rowIndex'],
      group: ['rowIndex'],
      order: [['rowIndex', 'ASC']],
      offset,
      limit: size,
      raw: true,
    });

    const rowIndexList = distinctRowIndices.map(r => r.rowIndex);

    const paginatedData = await SheetData.findAll({
      include: [{ model: Header, where: { templateId }, attributes: [] }],
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      where: { 
        rowIndex: rowIndexList,
       },
      order: [['rowIndex', 'ASC']],
    });

    // Count total rows efficiently
    const totalRows = await SheetData.count({
      include: [{ model: Header, where: { templateId }, attributes: [] }],
      distinct: true,
      col: 'rowIndex',
    });
    const totalPages = Math.ceil(totalRows / size);

    const paginatedDataByHeader = {};
    const errorRows = new Set();
    const errorPages = new Set();

    for (const header of sortedHeaders) {
      paginatedDataByHeader[header.id] = [];
    }

    for (const data of paginatedData) {
      const header = headerMap.get(data.headerId);
      if (!header) continue;

      const { value, valid } = validateAndConvertValue(
        data.value,
        header.columnType,
        header.criticalityLevel
      );

      paginatedDataByHeader[header.id].push({
        id: data.id,
        rowIndex: data.rowIndex,
        originalRowIndex: data.rowIndex,
        value,
        valid,
      });

      if (!valid) {
        errorRows.add(data.rowIndex);
        errorPages.add(Math.floor(data.rowIndex / size) + 1);
      }
    }
    
    const responseHeaders = sortedHeaders.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: paginatedDataByHeader[header.id],
    }));

    res.status(200).json({
      headers: responseHeaders,
      totalErrorRows: errorRows.size,
      errorPages: Array.from(errorPages).sort((a, b) => a - b),
      pagination: {
        currentPage: page,
        pageSize: size,
        totalRows,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error retrieving headers with validated data:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
}

async function getFilteredHeaderData(req, res) {
  try {
    const { templateId, selectedHeader, dataSearchQuery, currentPage, pageSize } = req.query;

    // 🔒 Basic Validation
    if (!templateId || !selectedHeader || !dataSearchQuery) {
      return res.status(400).json({ error: 'templateId, selectedHeader, and dataSearchQuery are required' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }

    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1 || isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'Invalid pagination values' });
    }

    const offset = (page - 1) * size;

    // ⚡ Indexed Header Lookup
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['createdAt', 'ASC']],
      raw: true,
    });

    if (!headers.length) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(headers);
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));

    // 🔍 Efficient RowIndex Fetch with fuzzy match
    const matchedRows = await SheetData.findAll({
      where: {
        headerId: selectedHeader,
        value: { [Op.iLike]: `%${dataSearchQuery}%` },
      },
      attributes: ['rowIndex'],
      group: ['rowIndex'],
      order: [['rowIndex', 'ASC']],
      offset,
      limit: size,
      raw: true,
    });

    const rowIndexList = matchedRows.map(r => r.rowIndex);
    if (!rowIndexList.length) {
      return res.status(404).json({ error: 'No matching data found' });
    }

    // 🎯 Fetch paginated data for matched rows
    const paginatedData = await SheetData.findAll({
      include: [{ model: Header, where: { templateId }, attributes: [] }],
      where: {
        rowIndex: { [Op.in]: rowIndexList },
      },
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC'], ['headerId', 'ASC']],
      raw: true,
    });

    // 📊 Total matching rows count
    const totalRows = await SheetData.count({
      where: {
        headerId: selectedHeader,
        value: { [Op.iLike]: `%${dataSearchQuery}%` },
      },
      distinct: true,
      col: 'rowIndex',
    });

    const totalPages = Math.ceil(totalRows / size);

    // ✅ Validate and format
    const paginatedDataByHeader = {};
    const errorRows = new Set();
    const errorPages = new Set();

    for (const header of sortedHeaders) {
      paginatedDataByHeader[header.id] = [];
    }

    for (const item of paginatedData) {
      const header = headerMap.get(item.headerId);

      if (!header) continue;

      const { value, valid } = validateAndConvertValue(
        item.value,
        header.columnType,
        header.criticalityLevel
      );

      paginatedDataByHeader[header.id].push({
        id: item.id,
        rowIndex: item.rowIndex,
        value,
        valid,
      });

      if (!valid) {
        errorRows.add(item.rowIndex);
        errorPages.add(Math.floor(item.rowIndex / size) + 1);
      }
    }

    const responseHeaders = sortedHeaders.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: paginatedDataByHeader[header.id],
    }));


    // 🧠 Final Response
    res.status(200).json({
      headers: responseHeaders,
      totalErrorRows: errorRows.size,
      errorPages: Array.from(errorPages).sort((a, b) => a - b),
      pagination: {
        currentPage: page,
        pageSize: size,
        totalRows,
        totalPages,
      },
    });
  } catch (error) {
    console.error('Error retrieving filtered header data:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
}

async function getHeadersWithDuplicateData(req, res) {
  try {
    const { templateId } = req.query;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }

    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['createdAt', 'ASC']],
    });
    if (!headers?.length) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(headers);
    const headerIds = sortedHeaders.map(h => h.id);
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));

    const normalize = str => str.toLowerCase().replace(/[_\s]/g, '');
    const normalizedHeaderMap = new Map(sortedHeaders.map(h => [normalize(h.name), h.name]));
    const preferredKey = normalizedHeaderMap.get('studentid');
    const identityHeaders = preferredKey ? [preferredKey] : sortedHeaders.slice(0, 3).map(h => h.name);

    const sheetData = [];
    const stream = await sequelize.query(`
      WITH filtered_headers AS (
        SELECT "id", "name", "columnType", "criticalityLevel"
        FROM "Header"
        WHERE "templateId" = :templateId
      )
      SELECT sd."id", sd."rowIndex", sd."value", sd."headerId",
             fh."name" AS "headerName", fh."columnType", fh."criticalityLevel"
      FROM "SheetData" sd
      JOIN filtered_headers fh ON sd."headerId" = fh."id"
      ORDER BY sd."rowIndex" ASC
    `, {
      replacements: { templateId },
      type: QueryTypes.SELECT,
      benchmark: true,
      logging: false,
      raw: true,
      plain: false,
      stream: true
    });

    for await (const row of stream) {
      sheetData.push(row);
    }

    const rowsByIndex = new Map();
    for (const entry of sheetData) {
      const { value, valid } = validateAndConvertValue(
        entry.value,
        entry.columnType,
        entry.criticalityLevel
      );

      if (!rowsByIndex.has(entry.rowIndex)) {
        rowsByIndex.set(entry.rowIndex, {
          originalRowIndex: entry.rowIndex,
          values: {},
          sheetDataRefs: []
        });
      }

      const row = rowsByIndex.get(entry.rowIndex);
      if (!row) {
        row = { originalRowIndex: entry.rowIndex, values: Object.create(null), sheetDataRefs: [] };
        rowsByIndex.set(entry.rowIndex, row);
      }
      row.values[entry.headerName] = value;
      row.sheetDataRefs.push({
        headerId: entry.headerId,
        headerName: entry.headerName,
        id: entry.id,
        value,
        valid
      });
    }

    const grouped = new Map();
    for (const row of rowsByIndex.values()) {
      const key = identityHeaders.map(h => row.values[h] ?? '').join('|');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    const duplicateRows = [];
    for (const group of grouped.values()) {
      if (group.length > 1) {
        group.forEach((row, index) => {
          duplicateRows.push({
            ...row,
            sequenceIndex: index + 1
          });
        });
      }
    }

    const headerDataMap = new Map();
    for (const row of duplicateRows) {
      for (const ref of row.sheetDataRefs) {
        if (!headerDataMap.has(ref.headerId)) {
          headerDataMap.set(ref.headerId, {
            id: ref.headerId,
            name: ref.headerName,
            criticalityLevel: headerMap.get(ref.headerId).criticalityLevel,
            columnType: headerMap.get(ref.headerId).columnType,
            data: []
          });
        }

        headerDataMap.get(ref.headerId).data.push({
          id: ref.id,
          rowIndex: row.sequenceIndex,
          originalRowIndex: row.originalRowIndex,
          value: ref.value,
          valid: ref.valid
        });
      }
    }

    const orderedHeaderResponse = sortedHeaders
    .map(h => headerDataMap.get(h.id))
    .filter(Boolean);

    res.status(200).json({
      headers: orderedHeaderResponse,
    });
  } catch (error) {
    console.error('Error in getHeadersWithDuplicateData:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to retrieve validated duplicate data' });
  }
}

async function getValidatedPageData(req, res) {
  try {
    const { templateId, currentPage = 1, pageSize = 30 } = req.query;

    // Validate inputs
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }
    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1) {
      return res.status(400).json({ error: 'currentPage must be a positive integer' });
    }
    if (isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'pageSize must be a positive integer' });
    }

    // Fetch all headers for the template
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['id', 'ASC']],
    });

    if (!headers || headers.length === 0) {
      console.log(`No headers found for templateId: ${templateId}`);
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    // Calculate rowIndex range for the page (assuming rowIndex is 1-based)
    const startRowIndex = (page - 1) * size + 1;
    const endRowIndex = page * size;

    // Fetch SheetData for the requested rowIndex range
    const sheetData = await SheetData.findAll({
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      where: {
        rowIndex: {
          [Op.between]: [startRowIndex, endRowIndex],
        },
      },
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC'], ['headerId', 'ASC']],
    });

    // Validate data and group by header
    const validatedDataByHeader = {};
    headers.forEach(header => {
      validatedDataByHeader[header.id] = [];
    });

    // Create a map of expected rowIndexes
    const expectedRowIndexes = Array.from({ length: size }, (_, i) => startRowIndex + i);

    // Process SheetData and fill in missing rows
    expectedRowIndexes.forEach(rowIndex => {
      headers.forEach(header => {
        const data = sheetData.find(d => d.rowIndex === rowIndex && d.headerId === header.id);
        if (data) {
          const { value, valid } = validateAndConvertValue(
            data.value,
            header.columnType,
            header.criticalityLevel
          );
          validatedDataByHeader[header.id].push({
            id: data.id,
            rowIndex: data.rowIndex,
            value,
            valid,
          });
        } else {
          // Add placeholder for missing data
          validatedDataByHeader[header.id].push({
            id: null,
            rowIndex,
            value: null,
            valid: false,
          });
        }
      });
    });

    // Prepare response headers with validated data
    const responseHeaders = headers.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: validatedDataByHeader[header.id],
    }));

    res.status(200).json(responseHeaders);
  } catch (error) {
    console.error('Error retrieving headers with validated page data:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to retrieve data' });
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


async function getTemplateDataWithExcel(req, res) {
  try {
    const { templateId, templateName } = req.query;

    console.time('header Fetch');
    // Fetch all headers for the template
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['id', 'ASC']],
    });
    console.timeEnd('header Fetch');

    if (!headers || headers.length === 0) {
      console.log(`No headers found for templateId: ${templateId}`);
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    console.time('SheetData Fetch');
    // Fetch all SheetData for the template
    const sheetData = await sequelize.query(`
        SELECT sd.id, sd."rowIndex", sd.value, sd."headerId"
        FROM "SheetData" sd
        INNER JOIN "Header" h ON h.id = sd."headerId"
        WHERE h."templateId" = :templateId
        ORDER BY sd."rowIndex" ASC, sd."headerId" ASC
      `, {
        replacements: { templateId },
        type: sequelize.QueryTypes.SELECT,
      });
    console.timeEnd('SheetData Fetch');

    console.time('header Ordering');
    const sortedHeaders = sortHeadersFlexibleMatch(headers);
    console.timeEnd('header Ordering');
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));
    const validatedDataByHeader = new Map();
    const errorRows = new Map();
    let maxRowIndex = 0;

    sortedHeaders.forEach(header => {
      validatedDataByHeader.set(header.id, []);
    });

    const rowBuckets = new Map();
    console.time('Data Validation and Grouping');
    for (const data of sheetData) {
      const header = headerMap.get(data.headerId);
      if (!header) continue;

      const { value, valid } = validateAndConvertValue(
        data.value,
        header.columnType,
        header.criticalityLevel
      );

      validatedDataByHeader.get(header.id).push({
        id: data.id,
        rowIndex: data.rowIndex,
        value,
        valid,
      });

      if (!rowBuckets.has(data.rowIndex)) {
        rowBuckets.set(data.rowIndex, new Map());
      }
      rowBuckets.get(data.rowIndex).set(data.headerId, { value, valid });

      if (!valid) {
        if (!errorRows.has(data.rowIndex)) {
          errorRows.set(data.rowIndex, []);
        }
        errorRows.get(data.rowIndex).push(header.name);
      }

      if (data.rowIndex > maxRowIndex) {
        maxRowIndex = data.rowIndex;
      }
    }
    console.timeEnd('Data Validation and Grouping');
    const responseHeaders = sortedHeaders.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: validatedDataByHeader.get(header.id),
    }));

    const totalErrorRows = errorRows.size;
    console.time('Excel Generation');
    const buffer = await generateExcelFile({
      headers: responseHeaders,
      maxRowIndex,
      totalErrorRows,
      errorRows,
      rowBuckets,
    });
    console.timeEnd('Excel Generation');
    const currentDate = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${templateName}_${currentDate}.xlsx`);
    res.status(200).send(buffer);
  } catch (error) {
    console.error('Error generating template data with Excel:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
}

async function saveProcessedData({ processedFiles, headerMap, currentPage, pageSize }) {
  const startRowIndex = (currentPage - 1) * pageSize + 1;
  const endRowIndex = currentPage * pageSize;

  const sheetDataRecords = [];
  let totalProcessedRows = 0;

  // Process each file
  for (const file of processedFiles) {
    for (const sheet of file.sheets) {
      const { headers, data } = sheet;

      // Paginate rows
      const paginatedRows = data.slice(startRowIndex - 1, endRowIndex);
      totalProcessedRows += paginatedRows.length;

      // Process each row
      paginatedRows.forEach((row, index) => {
        const rowIndex = startRowIndex + index;

        // Convert array row to object
        const rowObj = {};
        headers.forEach((header, i) => {
          rowObj[header] = row[i];
        });

        headers.forEach(fileHeader => {
          const headerInfo = headerMap.get(fileHeader.toLowerCase());
          if (!headerInfo) return;

          const value = rowObj[fileHeader];
          const { value: validatedValue, valid } = validateAndConvertValue(
            value,
            headerInfo.columnType,
            headerInfo.criticalityLevel
          );

          sheetDataRecords.push({
            id: uuidv4(),
            rowIndex,
            value: validatedValue,
            headerId: headerInfo.id,
          });
        });
      });
    }
  }

  // Bulk insert SheetData
  if (sheetDataRecords.length > 0) {
    await SheetData.bulkCreate(sheetDataRecords, {
      ignoreDuplicates: true,
    });
  }

  return {
    totalProcessedRows,
    totalRecords: sheetDataRecords.length,
  };
}



async function processAndSaveTemplateData(req, res) {
  try {
    const { templateId, mappingTemplateId, currentPage = 1, pageSize = 30 } = req.query;
    const files = req.files;

    // Validate inputs
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }


    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1) {
      return res.status(400).json({ error: 'currentPage must be a positive integer' });
    }
    if (isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'pageSize must be a positive integer' });
    }
    if (!files.files || files.files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required' });
    }

    // Log input parameters
    console.log('Input params:', { templateId, mappingTemplateId, currentPage: page, pageSize: size, fileCount: files.files.length });

    // Step 1: Process files
    const processedFiles = await processFiles(files.files);

    // Step 2: Map headers
    const uniqueFileHeaders = [...new Set(
      processedFiles.flatMap(file => file.sheets.flatMap(sheet => sheet.headers))
    )];
    const { headers, headerMap } = await getMapHeaders({ templateId, mappingTemplateId, fileHeaders: uniqueFileHeaders });

    // Log header mapping
    console.log('Header mapping:', Array.from(headerMap.entries()).map(([fileHeader, header]) => ({
      fileHeader,
      mappedHeader: header.name,
      headerId: header.id,
    })));

    // Check if any headers were mapped
    if (headerMap.size === 0) {
      return res.status(400).json({ error: 'No file headers could be mapped to existing template headers' });
    }

    // Step 3: Save processed data
    const { totalProcessedRows, totalRecords } = await saveProcessedData({
      processedFiles,
      headerMap,
      currentPage: page,
      pageSize: size,
    });

    // Return success response
    res.status(200).json({
      message: 'Files processed and data saved successfully',
      totalProcessedRows,
      totalRecords,
      headers: headers.map(h => ({
        id: h.id,
        name: h.name,
        criticalityLevel: h.criticalityLevel,
        columnType: h.columnType,
      })),
      unmappedHeaders: uniqueFileHeaders.filter(h => !headerMap.has(h.toLowerCase())),
      processedSheets: processedFiles.map(file => ({
        fileName: file.fileName,
        sheetNames: file.sheets.map(sheet => sheet.sheetName),
      })),
    });
  } catch (error) {
    console.error('Error processing and saving template data:', error.message, error.stack);
    res.status(error.message.includes('No headers found') ? 404 : 500).json({ error: error.message });
  }
}


async function updateSheetData(updates, options = {}) {
  const { headerId, validateExistence = true } = options;

  // Validate inputs
  if (!Array.isArray(updates) || updates.length === 0) {
    console.error('No updates provided or updates is not an array');
    return false;
  }

  const validUpdates = [];
  const errors = [];

  // Validate each update
  updates.forEach((update, index) => {
    const { id, rowIndex, value, valid } = update;

    if (!id || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      errors.push(`Invalid or missing id at index ${index}`);
      return;
    }
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      errors.push(`Invalid rowIndex at index ${index}: must be a positive integer`);
      return;
    }
    if (valid !== true) {
      errors.push(`Skipped update at index ${index}: valid is not true`);
      return;
    }

    validUpdates.push({ id, rowIndex, value });
  });

  if (validUpdates.length === 0) {
    console.warn('No valid updates to process:', errors);
    return false;
  }

  if (errors.length > 0) {
    console.warn('Validation errors:', errors);
  }

  try {
    // Start transaction
    return await SheetData.sequelize.transaction(async (transaction) => {
      // Validate existence and fetch headerIds if needed
      if (validateExistence || headerId) {
        const existingRecords = await SheetData.findAll({
          where: { id: validUpdates.map(u => u.id) },
          attributes: ['id', 'headerId'],
          transaction,
        });

        const existingIds = new Set(existingRecords.map(r => r.id));
        const missingIds = validUpdates.filter(u => !existingIds.has(u.id));
        if (missingIds.length > 0) {
          console.error(`Records not found for IDs: ${missingIds.map(u => u.id).join(', ')}`);
          return false;
        }

        if (headerId) {
          const invalidRecords = existingRecords.filter(r => r.headerId !== headerId);
          if (invalidRecords.length > 0) {
            console.error(`Header ID mismatch for records: ${invalidRecords.map(r => r.id).join(', ')}`);
            return false;
          }
        }
      }

      // Fetch headerIds for all valid updates if not provided
      const headerIds = headerId ? [headerId] : [...new Set(
        await SheetData.findAll({
          where: { id: validUpdates.map(u => u.id) },
          attributes: ['headerId'],
          transaction,
        }).map(r => r.headerId)
      )];

      // Check for unique constraint violations
      for (const hId of headerIds) {
        // Create a map of id to headerId for filtering
        const idToHeaderId = new Map();
        if (!headerId) {
          const records = await SheetData.findAll({
            where: { id: validUpdates.map(u => u.id) },
            attributes: ['id', 'headerId'],
            transaction,
          });
          records.forEach(r => idToHeaderId.set(r.id, r.headerId));
        }

        const rowIndices = validUpdates
          .filter(u => !validateExistence || headerId || idToHeaderId.get(u.id) === hId)
          .map(u => u.rowIndex);

        const existingRows = await SheetData.findAll({
          where: {
            headerId: hId,
            rowIndex: rowIndices,
            id: { [Op.notIn]: validUpdates.map(u => u.id) },
          },
          attributes: ['rowIndex'],
          transaction,
        });

        if (existingRows.length > 0) {
          console.error(`Unique constraint violation: rowIndex ${existingRows.map(r => r.rowIndex).join(', ')} already exists for headerId ${hId}`);
          return false;
        }
      }

      // Perform updates
      let updatedCount = 0;
      for (const update of validUpdates) {
        const { id, rowIndex, value } = update;
        const [count] = await SheetData.update(
          { rowIndex, value },
          { where: { id }, transaction }
        );
        updatedCount += count;
      }
      return updatedCount > 0;
    });
  } catch (error) {
    console.error('Error updating SheetData:', error.message, error.stack);
    return false;
  }
}


async function updateData(updates, templateId) {
  const transaction = await SheetData.sequelize.transaction();
  let updatedCount = 0;
  const snapshots = [];

  try {
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'UPDATE_ROW',
    }, { transaction });

    // Process each RowUpdate
    for (const update of updates) {
      for (const datum of update.data) {

        const currentRecord = await SheetData.findOne({
          where: {
            headerId: datum.headerId,
            rowIndex: update.rowIndex, 
          },
          transaction,
        });

        if (!currentRecord) {
          throw new Error(`Record not found for headerId ${datum.headerId} and rowIndex ${update.rowIndex}`);
        }

        //Create snapshot of original value
        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId: datum.headerId,
          rowIndex: update.rowIndex,
          originalValue: currentRecord.value,
          newValue: datum.value,
        });

        // Update the record matching headerId and rowIndex
        const [affectedRows] = await SheetData.update(
          { value: datum.value },
          {
            where: {
              headerId: datum.headerId,
              rowIndex: update.rowIndex,
            },
            transaction,
          }
        );

        updatedCount += affectedRows;
      }
    }

    if (snapshots.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    }

    // Commit transaction
    await transaction.commit();
    return { updatedCount, operationLogId: operationLog.id };
  } catch (error) {
    // Rollback transaction on error
    await transaction.rollback();
    throw new Error(`Failed to update SheetData: ${error.message}`);
  }
}

async function updateRows(req, res) {
  try{
    const {updates, templateId} = req.body;
    if(!templateId) {
      throw new Error('templateId is not provided');
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('Updates must be a non-empty array');
    }

    const result = await updateData(updates, templateId);
    
    res.status(200).json({ message: "OK" });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}


async function bulkUpdates(headerId, value, templateId) {
  const transaction = await sequelize.transaction();
  const snapshots = [];
  try {

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'BULK_UPDATE',
    }, { transaction });

    const currentRecords = await SheetData.findAll({
      where: { headerId },
      attributes: ['id', 'rowIndex', 'value'],
      transaction
    });

    const maxRowIndexRecord = await SheetData.findOne({
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      order: [['rowIndex', 'DESC']],
      attributes: ['rowIndex'],
      transaction,
    });
    const maxRowIndex = maxRowIndexRecord?.rowIndex ?? 0;
    const existingRowIndexes = new Set(currentRecords.map(r => r.rowIndex));

    currentRecords.map(record => {
      snapshots.push({
        id: uuidv4(),
        operationLogId: operationLog.id,
        headerId,
        rowIndex: record.rowIndex,
        originalValue: record.value,
        newValue: value
      });
    });

    const [affectedRows] = await SheetData.update(
      { value: value },
      { where: { headerId: headerId }, transaction }
    );

    const newRows = [];
    for (let i = 1; i <= maxRowIndex; i++) {
      if (!existingRowIndexes.has(i)) {
        newRows.push({
          id: uuidv4(),
          headerId: headerId,
          rowIndex: i,
          value: value
        });

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId,
          rowIndex: i,
          originalValue: null,
          newValue: value
        });
      }
    }

    if (newRows.length > 0) {
      await SheetData.bulkCreate(newRows, { transaction });
    }

    if (snapshots.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    }

    await transaction.commit();

    return { affectedRows };
  } catch (error) {
    await transaction.rollback();
    throw new Error(`Failed to perform bulk update: ${error.message}`);
  }
}


async function bulkUpdateData(req, res) {
  try{
    const {headerId, value, templateId} = req.body;

    const result = await bulkUpdates(headerId, value, templateId);
    
    res.status(200).json({ message: "OK" });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}


async function addPaddingInData(headerId, templateId, padValue, padLength) {
  const transaction = await sequelize.transaction();
  let affectedRows = 0;
  const snapshots = [];

  try {
    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'PADDING_UPDATE',
    }, { transaction });

    // Fetch all records for the given headerId
    const records = await SheetData.findAll({ 
      where: { headerId },
      transaction 
    });

    // Process each record
    for (const record of records) {
      const rawValue = record.value;

      // Skip if value is null or string "NULL"
      if (rawValue === null || String(rawValue).trim().toUpperCase() === "NULL") {
        await SheetData.update(
          { value: "" }, // or null if you prefer
          {
            where: { id: record.id },
            transaction
          }
        );

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId,
          rowIndex: record.rowIndex,
          originalValue: rawValue,
          newValue: ""
        });

        affectedRows += 1;
        continue;
      }

      // Otherwise, pad the value
      const originalValue = String(rawValue);
      const paddedValue = padValue.repeat(padLength) + originalValue;

      snapshots.push({
        id: uuidv4(),
        operationLogId: operationLog.id,
        headerId,
        rowIndex: record.rowIndex,
        originalValue,
        newValue: paddedValue
      });

      const [count] = await SheetData.update(
        { value: paddedValue },
        {
          where: { id: record.id },
          transaction
        }
      );
      affectedRows += count;
    }

    // Save all snapshots in bulk
    if (snapshots.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    }

    await transaction.commit();
    return { 
      affectedRows,
      operationLogId: operationLog.id
    };
  } catch (error) {
    await transaction.rollback();
    throw new Error(`Failed to apply padding: ${error.message}`);
  }
}

async function addPadding(req,res) {
  try{
    const {headerId, templateId, padValue, padLength} = req.body;

    if (!headerId || !templateId) {
      return res.status(400).json({ message: "headerId and templateId is required" });
    }

    const result = await addPaddingInData(headerId, templateId, padValue, padLength);

    res.status(200).json({ message: "OK" });
  } catch(error) {
    res.status(500).json({ error: error.message });
  }
}


async function getMatrixPop(req, res) {
  try {
    const { templateId } = req.params;

    if (!templateId) {
      return res.status(400).json({ message: "Template ID is required" });
    }

    const headerID = await getHeaderID(templateId);
    if (!headerID) {
      return res.status(400).json({ message: "There is No MatrixPop Available Now" });
    }

    const values = await SheetData.findAll({
      where: {
        headerId: headerID
      },
      attributes: [[sequelize.fn('DISTINCT', sequelize.col('value')), 'value']],
      raw: true
    });

    if (!values || values.length === 0) {
      return res.status(404).json({ message: "No values found for the given header ID" });
    }

    const uniqueValues = values.map(item => item.value).filter(value => value !== null);

    return res.status(200).json( uniqueValues );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


// Enhanced mathjs configuration with string comparison support
const mathConfig = {
  createLower: math.factory('lower', [], () => {
    return function lower(value) {
      if (value === null || value === undefined) return value;
      if (typeof value !== 'string') {
        throw new Error(`Function lower expects a string or null, got ${typeof value}`);
      }
      return value.toLowerCase();
    };
  }),
  // Add string equality operators
  createStringEquals: math.factory('strEq', [], () => {
    return function strEq(a, b) {
      return String(a) === String(b);
    };
  }),
  createStringNotEquals: math.factory('strNeq', [], () => {
    return function strNeq(a, b) {
      return String(a) !== String(b);
    };
  }),
  createIsEmpty: math.factory('isEmpty', [], () => {
    return function isEmpty(value) {
      return value === null || value === undefined || String(value).trim() === '';
    };
  }),
  createIsNotEmpty: math.factory('isNotEmpty', [], () => {
    return function isNotEmpty(value) {
      return !(value === null || value === undefined || String(value).trim() === '');
    };
  }),
  createContains: math.factory('contains', [], () => {
    return function contains(str, search) {
      if (str === null || str === undefined) return false;
      return String(str).includes(String(search));
    };
  }),
  createNotContains: math.factory('notContains', [], () => {
    return function notContains(str, search) {
      if (str === null || str === undefined) return true;
      return !String(str).includes(String(search));
    };
  }),
  createStartsWith: math.factory('startsWith', [], () => {
    return function startsWith(str, prefix) {
      if (str === null || str === undefined) return false;
      return String(str).startsWith(String(prefix));
    };
  }),
  createEndsWith: math.factory('endsWith', [], () => {
    return function endsWith(str, suffix) {
      if (str === null || str === undefined) return false;
      return String(str).endsWith(String(suffix));
    };
  }),
  createYEq: math.factory('yEq', [], () => {
    return function yEq(a, b) {
      return String(a).toUpperCase() === String(b).toUpperCase();
    };
  }),
  createYNotEquals: math.factory('yNeq', [], () => {
    return function yNeq(a, b) {
      return String(a).toUpperCase() !== String(b).toUpperCase();
    };
  })
};

const mathInstance = math.create(math.all);
mathInstance.import(mathConfig, { override: true });

// Replace comparison operators with our string-aware versions for text columns
function createStringComparisonEvaluator(math) {
  const originalEvaluate = math.evaluate;
  return function evaluate(expr, scope) {
    if (typeof expr === 'string') {
      // Handle Y/N comparisons
      expr = expr.replace(/(yEq|yNeq)\(([^,]+),\s*('[^']*')\)/g, 
        (match, fn, left, right) => {
          return `${fn}(${left}, ${right})`;
        });
      // Replace == with strEq and != with strNeq for text comparisons
      expr = expr.replace(/(lower\(@?\w+\))\s*(==|!=)\s*('[^']*')/g, 
        (match, left, op, right) => {
          return op === '==' 
            ? `strEq(${left}, ${right})` 
            : `strNeq(${left}, ${right})`;
        });
      
      expr = expr
        .replace(/contains\((\w+)\s*,\s*('[^']*')\)/g, 'contains($1, $2)')
        .replace(/not\(contains\((\w+)\s*,\s*('[^']*')\)\)/g, 'notContains($1, $2)')
        .replace(/isEmpty\((\w+)\)/g, 'isEmpty($1)')
        .replace(/not\(isEmpty\((\w+)\)\)/g, 'isNotEmpty($1)')
        .replace(/startsWith\((\w+)\s*,\s*('[^']*')\)/g, 'startsWith($1, $2)')
        .replace(/endsWith\((\w+)\s*,\s*('[^']*')\)/g, 'endsWith($1, $2)');
    }
    return originalEvaluate.call(math, expr, scope);
  };
}

mathInstance.evaluate = createStringComparisonEvaluator(mathInstance);

async function applyCalculations(req, res) {
  const { templateId, conditions, assignments, headers } = req.body;
  const transaction = await sequelize.transaction();
  let snapshots = [];
  try {

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'CALCULATION',
    }, { transaction });

    // Fetch headers
    const dbHeaders = await Header.findAll({
      where: { templateId, name: { [Op.in]: headers } },
      attributes: ['id', 'name', 'columnType'],
      transaction
    });
    const headerMap = {};
    dbHeaders.forEach(h => {
      headerMap[h.name] = { id: h.id, columnType: h.columnType || 'text' };
    });
    const processedConditions = conditions.map(cond => {

      // Step 1: Clean up outer quotes and escaped quotes
      let normalizedCond = cond
        .replace(/^"|"$/g, '')
        .replace(/\\"/g, '"')
        .replace(/"/g, "'");

      // First pass: Add @ prefix to all header references
      normalizedCond = cond.replace(/\b([a-zA-Z_]\w*)\b/g, (match, header) => {
        if (headerMap[header] && !match.startsWith('@')) {
          return `@${header}`;
        }
        return match;
      });

      // Second pass: Handle case-insensitive comparison for text columns
      normalizedCond = normalizedCond.replace(/@(\w+)\s*(==|!=)\s*('[^']*')/g, 
        (match, header, op, value) => {
          if (!headerMap[header]) {
            throw new Error(`Header ${header} not found in condition: ${cond}`);
          }
          const columnType = headerMap[header].columnType;
          if (['text', 'character', 'Y/N'].includes(columnType)) {
            const cleanValue = value.slice(1, -1);
            return `lower(@${header}) ${op} '${cleanValue.toLowerCase()}'`;
          }
          return match;
        });
      
      return normalizedCond;
    });

    // Fetch SheetData
    const sheetData = await SheetData.findAll({
      where: { headerId: dbHeaders.map(h => h.id) },
      attributes: ['headerId', 'rowIndex', 'value'],
      transaction
    });
    const rows = {};
    sheetData.forEach(entry => {
      if (!rows[entry.rowIndex]) rows[entry.rowIndex] = {};
      const headerName = dbHeaders.find(h => h.id === entry.headerId)?.name;
      rows[entry.rowIndex][headerName] = entry.value;
    });

    // Store original values for comparison
    const originalValues = {};
    sheetData.forEach(entry => {
      const headerName = dbHeaders.find(h => h.id === entry.headerId)?.name;
      originalValues[`${headerName}-${entry.rowIndex}`] = entry.value;
    })

    // Apply rules
    let updatedRows = 0;
    const upserts = [];
    for (const [rowIndex, rowData] of Object.entries(rows)) {
      const scope = {};
      dbHeaders.forEach(h => {
        const value = rowData[h.name]?.trim();
        if (value === '' || value === 'null' || value === undefined) {
          scope[h.name] = null;
        } else if (h.columnType === 'integer') {
          const parsed = parseInt(value, 10);
          scope[h.name] = isNaN(parsed) ? null : parsed;
        } else if (h.columnType === 'decimal') {
          const parsed = parseFloat(value);
          scope[h.name] = isNaN(parsed) ? null : parsed;
        } else if (h.columnType === 'Date') {
          const parsed = new Date(value);
          scope[h.name] = isNaN(parsed.getTime()) ? null : parsed;
        } else if (h.columnType === 'Y/N') {
          const upperValue = value.toUpperCase();
          scope[h.name] = ['Y', 'N'].includes(upperValue) ? upperValue : null;
        } else {
          scope[h.name] = String(value); // text, character
        }
      });

      for (let i = 0; i < processedConditions.length; i++) {
        let condition = processedConditions[i].replace(/@(\w+)/g, '$1');
        const assignment = assignments[i];

        // Skip evaluation if critical scope values are null
        let skipCondition = false;
        const headersInCondition = condition.match(/\b(\w+)\b/g) || [];
        for (const header of headersInCondition) {
          if (scope[header] === null && headerMap[header]?.columnType === 'integer') {
            console.log(`Skipping condition ${i} for row ${rowIndex} due to null value in ${header}`);
            skipCondition = true;
            break;
          }
        }
        if (skipCondition) continue;

        try {
          const conditionResult = mathInstance.evaluate(condition, scope);
          if (conditionResult) {
            let targetValue;
            if (assignment.value.match(/^'[^']*'$/)) {
              targetValue = assignment.value.slice(1, -1);
            } else if (assignment.value === 'true' || assignment.value === 'false') {
              targetValue = assignment.value === 'true';
            } else if (!isNaN(assignment.value)) {
              targetValue = parseFloat(assignment.value);
            } else {
              targetValue = mathInstance.evaluate(
                assignment.value.replace(/(?:@)?(\w+)/g, (match, header) => {
                  if (headerMap[header]) {
                    const value = scope[header];
                    if (value === null) return 'null';
                    return ['integer', 'decimal'].includes(headerMap[header].columnType)
                      ? value
                      : `'${String(value)}'`;
                  }
                  return match;
                }),
                scope
              );
            }
            const targetType = headerMap[assignment.header].columnType;
            if (targetValue !== null && targetValue !== undefined) {
              if (targetType === 'integer') {
                targetValue = Math.round(Number(targetValue));
              } else if (targetType === 'decimal') {
                targetValue = Number(targetValue);
              } else if (targetType === 'Y/N') {
                targetValue = String(targetValue).toUpperCase() === 'Y' || targetValue === true ? 'Y' : 'N';
              } else if (targetType === 'Date') {
                targetValue = new Date(targetValue).toISOString();
              } else {
                targetValue = String(targetValue);
              }


              // Only create snapshot if value is changing
              const originalValue = originalValues[`${assignment.header}-${rowIndex}`];
              if(String(originalValue) !== String(targetValue)) {
                snapshots.push({
                  id: uuidv4(),
                  operationLogId: operationLog.id,
                  headerId: headerMap[assignment.header].id,
                  rowIndex: parseInt(rowIndex),
                  originalValue: String(originalValue),
                  newValue: String(targetValue)
                });
              }

              upserts.push({
                headerId: headerMap[assignment.header].id,
                rowIndex: parseInt(rowIndex),
                value: String(targetValue),
              });
              updatedRows++;
              break;
            }
          }
        } catch (condError) {
          console.error(`Error evaluating condition ${i} for row ${rowIndex}:`, condError);
        }
      }
    }

    // Perform batch upsert
    if (upserts.length > 0) {
      
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });

      for (const upsert of upserts) {
        await SheetData.upsert(upsert, { transaction });
      }
    }

    await transaction.commit();

    return res.status(200).json({
      message: 'Rules applied successfully',
      updatedRows,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error in applyCalculations:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
}


const addRow = async (req, res) => {
  const { templateId } = req.params;

  try {
    // Check if template exists
    const template = await Template.findByPk(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'columnType', 'criticalityLevel'],
    });

    if (headers.length === 0) {
      return res.status(400).json({ error: 'No headers found for this template' });
    }

    await sequelize.transaction(async (t) => {
      const maxRowIndex = await SheetData.max('rowIndex', {
        where: {
          headerId: headers.map((h) => h.id),
        },
        transaction: t,
      });

      const newRowIndex = (maxRowIndex || 0) + 1;

      const sheetDataEntries = await Promise.all(
        headers.map((header) =>
          SheetData.create(
            {
              id: uuidv4(),
              rowIndex: newRowIndex,
              value: "",
              headerId: header.id,
            },
            { transaction: t },
          ),
        ),
      );

      await OperationLog.create({ id: uuidv4(), templateId, operationType: 'ADD_ROW' }, { transaction: t });
    });
    return res.status(201).json({ message: "Row Added"});
  } catch (error) {
    console.error('Error adding row:', error);
    return res.status(500).json({ error: 'Failed to add row' });
  }
};

// Helper function to process API calls in batches with retries
const processBatch = async (batch, maxRetries = 3) => {
  const results = [];
  for (const row of batch) {
    let retries = 0;
    let success = false;
    let result = null;
    let error = null;

    while (retries < maxRetries && !success) {
      try {
        // Call addressAPI with individual parameters
        result = await addressAPI(row.streetAddress, row.city, row.state);
        // Validate response: expect { ZipCode: string }
        if (result && result.ZipCode && typeof result.ZipCode === 'string') {
          success = true;
        } else {
          throw new Error('Invalid API response: Missing or invalid zip code');
        }
      } catch (err) {
        retries++;
        error = err;
        // Exponential backoff: wait 100ms * 2^retries
        if (retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, retries)));
        }
      }
    }

    if (success) {
      results.push({
        rowIndex: row.rowIndex,
        zipCode: result.ZipCode,
      });
    } else {
      console.error(`Failed to fetch zip code for row ${row.rowIndex} after ${maxRetries} retries:`, error);
      results.push({
        rowIndex: row.rowIndex,
        error: error.message || 'Failed to fetch zip code',
      });
    }
  }
  return results;
};

const findZipCodes = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { templateId, streetAddress, city, state, zipcode } = req.body;
    
    // Validate request body
    if (!templateId || !streetAddress || !city || !state || !zipcode) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'ZIPCODE'
    }, { transaction });

    // Find header IDs
    const streetAddressHeader = await Header.findOne({
      where: { templateId, name: streetAddress }, transaction
    });
    const cityHeader = await Header.findOne({
      where: { templateId, name: city }, transaction
    });
    const stateHeader = await Header.findOne({
      where: { templateId, name: state }, transaction
    });
    const zipcodeHeader = await Header.findOne({
      where: { templateId, name: zipcode }, transaction
    });

    if (!streetAddressHeader || !cityHeader || !stateHeader || !zipcodeHeader) {
      await transaction.rollback();
      return res.status(404).json({ error: 'One or more headers not found' });
    }

    // Fetch data for all relevant headers
    const data = await SheetData.findAll({
      where: {
        headerId: {
          [Op.in]: [streetAddressHeader.id, cityHeader.id, stateHeader.id, zipcodeHeader.id],
        },
      },
    });

    // Group data by rowIndex
    const rows = {};
    const originalZipcodes = new Map();
    data.forEach((entry) => {
      const rowIndex = entry.rowIndex;
      if (!rows[rowIndex]) {
        rows[rowIndex] = {};
      }
      if (entry.headerId === streetAddressHeader.id) {
        rows[rowIndex].streetAddress = entry.value;
      } else if (entry.headerId === cityHeader.id) {
        rows[rowIndex].city = entry.value;
      } else if (entry.headerId === stateHeader.id) {
        rows[rowIndex].state = entry.value;
      } else if (entry.headerId === zipcodeHeader.id) {
        rows[rowIndex].zipcode = entry.value;
        originalZipcodes.set(rowIndex, entry.value);
      }
    });

    // Prepare valid rows for processing
    const validRows = [];
    const skippedRows = [];
    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      // Skip rows with missing streetAddress, city, or state, or if zipcode already exists
      if (
        !row.streetAddress ||
        !row.city ||
        !row.state 
      ) {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }
      validRows.push({
        rowIndex: parseInt(rowIndex),
        streetAddress: row.streetAddress,
        city: row.city,
        state: row.state,
        originalZipcode: originalZipcodes.get(parseInt(rowIndex)) || null
      });
    }

    // Process rows in batches of 5
    const BATCH_SIZE = 5;
    const updates = [];
    const snapshots = [];
    const errors = [];
    for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
      const batch = validRows.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${i / BATCH_SIZE + 1} of ${Math.ceil(validRows.length / BATCH_SIZE)}`);
      const batchResults = await processBatch(batch);
      batchResults.forEach((result) => {
        if (result.zipCode) {
          const row = validRows.find(r => r.rowIndex === result.rowIndex);
          const newZipCode = result.zipCode;
          const originalZipCode = row.originalZipcode;

          if (originalZipCode !== newZipCode) {
            updates.push({
              id: uuidv4(),
              headerId: zipcodeHeader.id,
              rowIndex: result.rowIndex,
              value: result.zipCode,
            });

            snapshots.push({
              id: uuidv4(),
              operationLogId: operationLog.id,
              headerId: zipcodeHeader.id,
              rowIndex: result.rowIndex,
              originalValue: originalZipCode,
              newValue: newZipCode,
              changeType: originalZipCode ? 'UPDATE' : 'INSERT'
            });

          }
        } else {
          errors.push({
            rowIndex: result.rowIndex,
            error: result.error,
          });
        }
      });
    }

    // Apply updates to SheetData table
    if (updates.length > 0) {

      if (snapshots.length > 0) {
        await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
      }

      await SheetData.bulkCreate(updates, {
        updateOnDuplicate: ['value'], // Update value if rowIndex and headerId already exist
        transaction
      });
    }

    await transaction.commit();

    return res.status(200).json({
      message: 'Zip codes processed successfully',
      updatedRows: updates.length,
      skippedRows: skippedRows.length,
      skippedRowIndices: skippedRows,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    await transaction.rollback();
    console.error('Error finding zip codes:', error);
    return res.status(500).json({ error: 'Failed to find zip codes' });
  }
};

const scoreConversion = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { templateId, subject, testType, sourceHeader, sourceCompHeader, targetHeader } = req.body;
    if (!templateId || !subject || !testType || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'CONVERSION'
    }, { transaction });

    // Find source and target headers
    const sourceHeaderID = await Header.findOne({
      where: { templateId, name: sourceHeader },
      transaction,
    });

    const targetHeaderID = await Header.findOne({
      where: { templateId, name: targetHeader },
      transaction
    });

    // Find comparison header if provided
    let sourceCompHeaderID = null;
    if (sourceCompHeader !== "optional" || sourceCompHeader !== null) {
      sourceCompHeaderID = await Header.findOne({
        where: { templateId, name: sourceCompHeader },
        transaction,
      });
      if (!sourceCompHeaderID) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Comparison header not found' });
      }
    }

    if (!sourceHeaderID || !targetHeaderID) {
      await transaction.rollback();
      return res.status(404).json({ error: 'One or more headers not found' });
    }


    // Get all relevant sheet data
    const headerIds = [sourceHeaderID.id, targetHeaderID.id];
    if (sourceCompHeaderID) {
      headerIds.push(sourceCompHeaderID.id);
    }

    // Get all relevant sheet data
    const data = await SheetData.findAll({
      where: {
        headerId: {
          [Op.in]: headerIds,
        }
      },
      transaction
    });

    // Organize data by row
    const rows = {};
    const originalValues = new Map();
    data.forEach((entry) => {
      const rowIndex = entry.rowIndex;
      if (!rows[rowIndex]) {
        rows[rowIndex] = {};
      }
      if (entry.headerId === sourceHeaderID.id) {
        rows[rowIndex].sourceValue = entry.value; // This is a string
      } else if (entry.headerId === targetHeaderID.id) {
        rows[rowIndex].targetValue = entry.value; // This is a string
        originalValues.set(rowIndex, entry.value);
      } else if (entry.headerId === sourceCompHeaderID?.id) {
        rows[rowIndex].compValue = entry.value;
      }
    });

    const validRows = [];
    const skippedRows = [];
    const errors = [];

    // Process rows for conversion
    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      const sourceValueStr = row.sourceValue;
      
      // Skip if source value is empty or not a number
      if (!sourceValueStr || sourceValueStr.trim() === '') {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      // Parse the string value to number
      let sourceValue = parseFloat(sourceValueStr);
      if (isNaN(sourceValue)) {
        errors.push({
          rowIndex: parseInt(rowIndex),
          error: `Invalid number format: ${sourceValueStr}`
        });
        continue;
      }

      if (sourceCompHeader && row.compValue) {
        const compValue = parseFloat(row.compValue);
        if (isNaN(compValue)) {
          errors.push({
            rowIndex: parseInt(rowIndex),
            error: `Invalid number format in comparison: ${row.compValue}`
          });
          continue;
        }
        sourceValue = Math.max(sourceValue, compValue);
      }

      // Check if the parsed number meets minimum requirements
      if (sourceValue < 9) {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      validRows.push({
        rowIndex: parseInt(rowIndex),
        sourceValue: sourceValue,
        originalValue: originalValues.get(parseInt(rowIndex)) || null
      });
    }

    const updates = [];
    const snapshots = [];

    // Perform conversions
    for (const row of validRows) {
      try {
        const conversionResult = convertScore(subject, testType, row.sourceValue);
        
        if (conversionResult && conversionResult.error) {
          errors.push({
            rowIndex: row.rowIndex,
            error: conversionResult.error
          });
          continue;
        }

        if (conversionResult && conversionResult.single !== undefined) {
          const newTargetValue = String(conversionResult.single);
          const originalTargetValue = row.originalValue ? String(row.originalValue) : null;

          // Only update if value has changed
          if (newTargetValue !== originalTargetValue) {
            updates.push({
              id: uuidv4(),
              headerId: targetHeaderID.id,
              rowIndex: row.rowIndex,
              value: newTargetValue,
            });

            snapshots.push({
              id: uuidv4(),
              operationLogId: operationLog.id,
              headerId: targetHeaderID.id,
              rowIndex: row.rowIndex,
              originalValue: originalTargetValue,
              newValue: newTargetValue,
              changeType: originalTargetValue ? 'UPDATE' : 'INSERT'
            });
          }
        } else {
          errors.push({
            rowIndex: row.rowIndex,
            error: 'No conversion result returned'
          });
        }
      } catch (error) {
        errors.push({
          rowIndex: row.rowIndex,
          error: error.message
        });
      }
    }

    // Execute updates if any
    if (updates.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
      
      await SheetData.bulkCreate(updates, {
        updateOnDuplicate: ['value'],
        transaction
      });
    }

    await transaction.commit();
    
    return res.status(200).json({ 
      message: 'Score Conversion Done',
    });

  } catch(error) {
    await transaction.rollback();
    console.error('Score conversion error:', error);
    return res.status(500).json({ 
      error: 'Failed to Convert Score',
      details: error.message 
    }); 
  }
};



const cipConversion = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sourceHeader, targetHeader } = req.body;
    if (!templateId || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'CONVERSION'
    }, { transaction });

    // Find source and target headers
    const sourceHeaderID = await Header.findOne({
      where: { templateId, name: sourceHeader },
      transaction,
    });

    const targetHeaderID = await Header.findOne({
      where: { templateId, name: targetHeader },
      transaction
    });

    if (!sourceHeaderID || !targetHeaderID) {
      await transaction.rollback();
      return res.status(404).json({ error: 'One or more headers not found' });
    }

    // Get all relevant sheet data
    const data = await SheetData.findAll({
      where: {
        headerId: {
          [Op.in]: [sourceHeaderID.id, targetHeaderID.id],
        }
      },
      transaction
    });

    // Organize data by row
    const rows = {};
    const originalValues = new Map();
    data.forEach((entry) => {
      const rowIndex = entry.rowIndex;
      if (!rows[rowIndex]) {
        rows[rowIndex] = {};
      }
      if (entry.headerId === sourceHeaderID.id) {
        rows[rowIndex].sourceValue = entry.value;
      } else if (entry.headerId === targetHeaderID.id) {
        rows[rowIndex].targetValue = entry.value;
        originalValues.set(rowIndex, entry.value);
      }
    });

    const validRows = [];
    const skippedRows = [];
    const errors = [];

    // Process rows for conversion
    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      const sourceValueStr = row.sourceValue;
      
      if (!sourceValueStr || sourceValueStr.trim() === '') {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      validRows.push({
        rowIndex: parseInt(rowIndex),
        sourceValue: sourceValueStr,
        originalValue: originalValues.get(parseInt(rowIndex)) || null
      });
    }

    const updates = [];
    const snapshots = [];

    // Perform conversions
    for (const row of validRows) {
      try {
        const conversionResult = await getCipTitle(row.sourceValue);
        
        if (conversionResult && conversionResult.error) {
          errors.push({
            rowIndex: row.rowIndex,
            error: conversionResult.error
          });
          continue;
        }

        if (conversionResult && conversionResult !== undefined) {
          const newTargetValue = conversionResult;
          const originalTargetValue = row.originalValue ? row.originalValue : null;

          // Only update if value has changed
          if (newTargetValue !== originalTargetValue) {
            updates.push({
              id: uuidv4(),
              headerId: targetHeaderID.id,
              rowIndex: row.rowIndex,
              value: newTargetValue,
            });

            snapshots.push({
              id: uuidv4(),
              operationLogId: operationLog.id,
              headerId: targetHeaderID.id,
              rowIndex: row.rowIndex,
              originalValue: originalTargetValue,
              newValue: newTargetValue,
              changeType: originalTargetValue ? 'UPDATE' : 'INSERT'
            });
          }
        } else {
          errors.push({
            rowIndex: row.rowIndex,
            error: 'No conversion result returned'
          });
        }
      } catch (error) {
        errors.push({
          rowIndex: row.rowIndex,
          error: error.message
        });
      }
    }

    // Execute updates if any
    if (updates.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
      
      await SheetData.bulkCreate(updates, {
        updateOnDuplicate: ['value'],
        transaction
      });
    }

    await transaction.commit();
    
    return res.status(200).json({ 
      message: 'CIP Conversion Done',
    });

  } catch(error) {
    await transaction.rollback();
    console.error('CIP conversion error:', error);
    return res.status(500).json({ 
      error: 'Failed to Convert CIP',
      details: error.message 
    }); 
  }
};


const zipCountyConversion = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sourceHeader, targetHeader } = req.body;
    if (!templateId || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'CONVERSION'
    }, { transaction });

    const sourceHeaderID = await Header.findOne({
      where: { templateId, name: sourceHeader },
      transaction
    });

    const targetHeaderID = await Header.findOne({
      where: { templateId, name: targetHeader },
      transaction
    });

    if (!sourceHeaderID || !targetHeaderID) {
      await transaction.rollback();
      return res.status(404).json({ error: 'One or more headers not found' });
    }

    const data = await SheetData.findAll({
      where: {
        headerId: {
          [Op.in]: [sourceHeaderID.id, targetHeaderID.id],
        }
      },
      transaction
    });

    const rows = {};
    const originalValues = new Map();
    const zipSet = new Set();

    data.forEach((entry) => {
      const rowIndex = entry.rowIndex;
      if (!rows[rowIndex]) rows[rowIndex] = {};

      if (entry.headerId === sourceHeaderID.id) {
        const rawZip = entry.value?.trim();
        if (rawZip && rawZip.length >= 5) {
          const normalizedZip = rawZip.slice(0, 5);
          rows[rowIndex].sourceValue = normalizedZip;
          zipSet.add(normalizedZip);
        }
      } else if (entry.headerId === targetHeaderID.id) {
        rows[rowIndex].targetValue = entry.value;
        originalValues.set(rowIndex, entry.value);
      }
    });

    const zipCountyMap = await buildZipCountyMap(zipSet);

    const updates = [];
    const snapshots = [];
    const skippedRows = [];
    const errors = [];

    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      const zip = row.sourceValue;

      if (!zip) {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      const county = zipCountyMap.get(zip);
      if (!county) {
        errors.push({ rowIndex: parseInt(rowIndex), error: 'County not found for ZIP' });
        continue;
      }

      const originalTargetValue = row.targetValue || null;

      if (county !== originalTargetValue) {
        updates.push({
          id: uuidv4(),
          headerId: targetHeaderID.id,
          rowIndex: parseInt(rowIndex),
          value: county
        });

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId: targetHeaderID.id,
          rowIndex: parseInt(rowIndex),
          originalValue: originalTargetValue,
          newValue: county,
          changeType: originalTargetValue ? 'UPDATE' : 'INSERT'
        });
      }
    }

    if (updates.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
      await SheetData.bulkCreate(updates, {
        updateOnDuplicate: ['value'],
        transaction
      });
    }

    await transaction.commit();
    return res.status(200).json({
      message: 'ZIP to County Conversion Done',
      updated: updates.length,
      skipped: skippedRows.length,
      errors
    });

  } catch (error) {
    await transaction.rollback();
    console.error('ZIP to County conversion error:', error);
    return res.status(500).json({
      error: 'Failed to Convert ZIP to County',
      details: error.message
    });
  }
};


async function evaluateRulesAndReturnFilteredData(req, res) {
  try {
    // Validate request
    const { templateId, conditions = [], currentPage = 1, pageSize = 10, headers = [] } = req.body;

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    // Validate pagination
    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1 || isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'Invalid pagination parameters' });
    }

    // Fetch all headers for the templateId from database
    const dbHeaders = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'columnType', 'criticalityLevel'],
      order: [['createdAt', 'ASC']],
    });

    if (dbHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    // Create header map for quick lookup
    const headerMap = new Map(dbHeaders.map(h => [h.name, h]));
    const headerIdToName = new Map(dbHeaders.map(h => [h.id, h.name]));

    // Process conditions to replace header names and handle special cases
    const processedConditions = conditions.map(condition => {
      let processed = condition
        .replace(/^"|"$/g, '')
        .replace(/\\"/g, '"')
        .replace(/'/g, '"');

      processed = processed.replace(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g, (match) =>
        headerMap.has(match) ? match : match
      );

      processed = processed.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*"([^"]*)"/g, 
        (match, header, operator, value) => {
          const headerInfo = headerMap.get(header);
          if (!headerInfo) return match;

          if (['text', 'character'].includes(headerInfo.columnType.toLowerCase())) {
            return operator === '=='
              ? `strEq(${header}, "${value}")`
              : `strNeq(${header}, "${value}")`;
          }
          return match;
        });

      return processed;
    });

    // ⚡ Fetch and organize SheetData
    const allSheetData = await SheetData.findAll({
      where: { headerId: dbHeaders.map(h => h.id) },
      attributes: ['id', 'headerId', 'rowIndex', 'value'],
      order: [['rowIndex', 'ASC'], ['headerId', 'ASC']],
      raw: true,
    });

    // 🧠 Organize data by rowIndex and headerName
    const rows = new Map();
    for (const entry of allSheetData) {
      const row = rows.get(entry.rowIndex) || {};
      const headerName = headerIdToName.get(entry.headerId);
      if (headerName) {
        row[headerName] = { id: entry.id, value: entry.value };
        rows.set(entry.rowIndex, row);
      }
    }

    // 🧪 Evaluate conditions
    const matchingRowIndices = [];
    const errorRowIndices = [];

    for (const [rowIndex, rowData] of rows.entries()) {
      const scope = {};

      for (const header of dbHeaders) {
        const rawValue = rowData[header.name]?.value ?? null;
        switch (header.columnType.toLowerCase()) {
          case 'integer':
            scope[header.name] = rawValue && !isNaN(rawValue) ? parseInt(rawValue, 10) : null;
            break;
          case 'decimal':
            scope[header.name] = rawValue && !isNaN(rawValue) ? parseFloat(rawValue) : null;
            break;
          case 'date':
            const date = rawValue ? new Date(rawValue) : null;
            scope[header.name] = date && !isNaN(date.getTime()) ? date : null;
            break;
          case 'y/n':
            scope[header.name] = rawValue ? (String(rawValue).toUpperCase() === 'Y' ? 'Y' : 'N') : null;
            break;
          default:
            scope[header.name] = rawValue != null ? String(rawValue) : null;
        }
      }

      let allConditionsMet = true;
      for (const condition of processedConditions) {
        try {
          if (!mathInstance.evaluate(condition, scope)) {
            allConditionsMet = false;
            break;
          }
        } catch {
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
        matchingRowIndices.push(rowIndex);
      } else {
        errorRowIndices.push(rowIndex);
      }
    }

    // Apply pagination
    const startIndex = (page - 1) * size;
    const paginatedRowIndices = matchingRowIndices.slice(startIndex, startIndex + size);
    

    // Create sequential row indices for the response
    const sequentialRowIndices = paginatedRowIndices.map((originalRowIndex, index) => ({
      originalRowIndex,
      sequentialRowIndex: startIndex + index + 1,
    }));

    // 🧱 Build response
    const responseHeaders = dbHeaders.map(header => {
      const headerData = sequentialRowIndices.map(({ originalRowIndex, sequentialRowIndex }) => {
        const entry = rows.get(originalRowIndex)?.[header.name] ?? { value: null };
        const { value, valid } = validateAndConvertValue(
          entry.value ?? null,
          header.columnType,
          header.criticalityLevel
        );

        return {
          id: entry.id || `${header.id}-${sequentialRowIndex}`,
          rowIndex: sequentialRowIndex,
          originalRowIndex,
          value,
          valid,
        };
      });

      return {
        id: header.id,
        name: header.name,
        criticalityLevel: header.criticalityLevel,
        columnType: header.columnType,
        data: headerData,
      };
    });

    return res.status(200).json({
      headers: responseHeaders,
      totalErrorRows: errorRowIndices.length,
      errorPages: [], // can be computed if needed
      pagination: {
        currentPage: page,
        pageSize: size,
        totalRows: matchingRowIndices.length,
        totalPages: Math.ceil(matchingRowIndices.length / size),
      },
    });
  } catch (error) {
    console.error('Error in evaluateRulesAndReturnFilteredData:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}


async function applyReferenceOnData(inputHeaderId, outputHeaderId, mappings) {
  try {
    const allData = await SheetData.findAll({
      where: { headerId: { [Op.in]: [inputHeaderId, outputHeaderId] } },
      raw: true,
    });

    const grouped = new Map();
    for (const row of allData) {
      if (!grouped.has(row.rowIndex)) grouped.set(row.rowIndex, {});
      grouped.get(row.rowIndex)[row.headerId] = row;
    }

    const compiledMappings = mappings.map(({ inputValue, outputValue }) => ({
      regex: new RegExp(`^${inputValue.replace(/[-[\]/{}()+?.\\^$|]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'),
      outputValue,
    }));

    const updates = [];
    const inserts = [];
    const unmappedValues = [];

    for (const [rowIndex, rowGroup] of grouped.entries()) {
      const inputRow = rowGroup[inputHeaderId];
      const outputRow = rowGroup[outputHeaderId];

      if (!inputRow?.value) continue;

      let matched = false;
      for (const { regex, outputValue } of compiledMappings) {
        if (regex.test(inputRow.value.trim())) {
          matched = true;
          if (outputRow) {
            updates.push({ id: outputRow.id, value: outputValue });
          } else {
            inserts.push({
              rowIndex: Number(rowIndex),
              headerId: outputHeaderId,
              value: outputValue,
            });
          }
          break;
        }
        if (inputRow.value === outputValue) {
          matched = true;
        }
      }

      if (!matched) {
        unmappedValues.push(inputRow.value);
      }
    }

    if (updates.length > 0) {
      await Promise.all(updates.map(({ id, value }) =>
        SheetData.update({ value }, { where: { id } })
      ));
    }

    if (inserts.length > 0) {
      await SheetData.bulkCreate(inserts);
    }

    return unmappedValues;

  } catch (err) {
    console.error('Error in applyReferenceOnData:', err);
    throw err;
  }
}

async function deleteRow(req, res) {
  const { templateId, rowIndex } = req.params;
  const transaction = await sequelize.transaction();

  try {
    const parsedRowIndex = parseInt(rowIndex);
    if (isNaN(parsedRowIndex)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid rowIndex provided.' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      operationType: 'DELETE_ROW'
    }, { transaction });

    // Step 2: Snapshot all matching rows using raw SQL
    await sequelize.query(
      `
      INSERT INTO "SheetDataSnapshot" (
        id, "operationLogId", "headerId", "rowIndex", "originalValue", "newValue", "changeType", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), :operationLogId, sd."headerId", sd."rowIndex", sd."value", NULL, 'DELETE', NOW(), NOW()
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h."id"
      WHERE h."templateId" = :templateId AND sd."rowIndex" = :rowIndex
      `,
      {
        replacements: {
          operationLogId: operationLog.id,
          templateId,
          rowIndex: parsedRowIndex
        },
        transaction
      }
    );

    // Step 3: Delete rows using raw SQL
    await sequelize.query(
      `
      DELETE FROM "SheetData"
      USING "Header"
      WHERE "SheetData"."headerId" = "Header"."id"
        AND "Header"."templateId" = :templateId
        AND "SheetData"."rowIndex" = :rowIndex
      `,
      {
        replacements: {
          templateId,
          rowIndex: parsedRowIndex
        },
        transaction
      }
    );

    await transaction.commit();

    return res.status(200).json({
      message: `Row ${parsedRowIndex} deleted successfully for template ${templateId}.`
    });
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error deleting row:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


async function calculateAwards(templateId, acceptedStatuses, transaction) {
  const headers = await Header.findAll({
    where: { templateId, name: requiredHeadersName },
    transaction
  });

  const headerMap = Object.fromEntries(headers.map(h => [h.name, h.id]));
  const requiredHeaderIds = headers.map(h => h.id);
  const awardHeaderIds = Object.fromEntries(
    Object.keys(awardTypePatterns).map(name => [name, headerMap[name]])
  );

  const sheetData = await SheetData.findAll({
    where: { headerId: requiredHeaderIds },
    attributes: ['rowIndex', 'headerId', 'value'],
    raw: true,
    transaction
  });

  if (sheetData.length === 0) {
    await transaction.rollback();
    return;
  }

  const sheetDataMap = {};
  for (const cell of sheetData) {
    sheetDataMap[`${cell.rowIndex}_${cell.headerId}`] = cell.value;
  }

  const rowIndexes = [...new Set(sheetData.map(d => d.rowIndex))];
  const acceptedStatusSet = new Set(acceptedStatuses.map(s => s.toLowerCase()));

  const operationLog = await OperationLog.create({
    templateId,
    operationType: 'CALCULATION',
    transaction
  });

  const updates = [];
  const snapshots = [];

  for (const rowIndex of rowIndexes) {
    const rowData = {};
    for (const headerId of requiredHeaderIds) {
      rowData[headerId] = sheetDataMap[`${rowIndex}_${headerId}`];
    }

    const awardSums = Object.fromEntries(
      Object.keys(awardTypePatterns).map(name => [name, 0])
    );

    for (let i = 1; i <= 20; i++) {
      const cd = rowData[headerMap[`Awd_CR${i}`]];
      const amtRaw = rowData[headerMap[`Awd_Amt${i}`]];
      const status = rowData[headerMap[`Awd_Status${i}`]];

      if (!cd || !acceptedStatusSet.has(status?.toLowerCase())) continue;

      const amt = parseFloat(amtRaw);
      if (isNaN(amt)) continue;

      for (const [awardName, pattern] of Object.entries(awardTypePatterns)) {
        if (pattern.test(cd)) {
          awardSums[awardName] += amt;
        }
      }
    }

    for (const [awardName, total] of Object.entries(awardSums)) {
      const headerId = awardHeaderIds[awardName];
      if (!headerId) continue;

      updates.push({
        rowIndex: parseInt(rowIndex),
        headerId,
        value: total.toString()
      });

      const originalValue = sheetDataMap[`${rowIndex}_${headerId}`] ?? null;
      snapshots.push({
        operationLogId: operationLog.id,
        headerId,
        rowIndex: parseInt(rowIndex),
        originalValue,
        newValue: total.toString(),
        changeType: originalValue ? 'UPDATE' : 'INSERT'
      });
    }
  }

  await SheetData.bulkCreate(updates, {
    updateOnDuplicate: ['value'],
    transaction
  });

  await SheetDataSnapshot.bulkCreate(snapshots, {
    validate: false,
    transaction
  });

  await transaction.commit();
}


async function calculateAwardInfo(req, res) {
  const transaction = await sequelize.transaction();
  try{
    const { templateId, acceptedStatuses } = req.body;
    if (!templateId || !Array.isArray(acceptedStatuses) || acceptedStatuses.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid input. templateId and acceptedStatuses are required.' });
    }
    await calculateAwards(templateId, acceptedStatuses, transaction);
    res.status(200).json({ message: 'Award information calculated successfully.' });
  } catch(error){
    await transaction.rollback();
    console.error('Error calculating award info:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


module.exports = {
  deleteSheetData, 
  getMatrixPop, 
  getHeadersWithValidatedData, 
  getValidatedPageData, 
  getTemplateDataWithExcel, 
  processAndSaveTemplateData, 
  updateSheetData, 
  updateRows, 
  bulkUpdateData, 
  addPadding, 
  applyCalculations, 
  addRow, 
  findZipCodes, 
  scoreConversion,
  cipConversion,
  evaluateRulesAndReturnFilteredData,
  applyReferenceOnData,
  bulkUpdates,
  getHeadersWithDuplicateData,
  deleteRow,
  getFilteredHeaderData,
  calculateAwardInfo,
  zipCountyConversion
};