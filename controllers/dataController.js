const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes, fn, col } = require('sequelize');
const {generateExcelFile} = require('../services/SheetService');
const { processFiles } = require('./fileController');
const { getMapHeaders, getHeaderID } = require('./headerController');
const { v4: uuidv4 } = require('uuid');
const { processAddress } = require('../services/addressService');
const math = require('mathjs');
const { OperationLog, SheetDataSnapshot } = require('../models');
const { convertScore } = require('../services/conversion');
const { getCipTitle } = require('../services/cipService');
const { desiredOrder, requiredHeadersName, awardTypePatterns, ynFlags } = require('../utils/headerOrderList');
const { buildZipCountyMap } = require('../services/countyService');
const { calculateNACUBODiscountRate, calculateNetCharges, calculateGap, calculateNeedMet, calculateTotalDiscountRate, calculateNetTuition, calculateNeed, matchCriteria, calculateTotalNeedMet, calculateTotalDirectCost, calculateTotalInstitutionalMeritGift, calculateNetTuitionFee, calculateTuitionDiscountRate } = require('../utils/calculationHelper');
const { evaluateConditions, evaluateBound } = require('../services/evaluation');
const { createLog } = require("../utils/auditLogger");
const { getUserName } = require('./userController');
const fs = require('fs');

async function deleteSheetData(req, res) {
  const username = await getUserName(req.userId);
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
    await createLog({ action: 'DELETE_SHEET_DATA', username, performedBy: req.userRole, details: `Deleted ${deletedCount} SheetData records for Template ID: ${templateId}` });
    res.status(200).json({ 
      message: 'SheetData deleted successfully',
      deletedCount
    });
  } catch (error) {
    await createLog({ action: 'DELETE_SHEET_DATA_FAILED', username, performedBy: req.userRole, details: `Failed to delete SheetData for Template ID: ${req.query.templateId}: ${error.message}` });
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
    const { templateId, sheetId, currentPage, pageSize, sortHeader = null, sortOrder = 'ASC' } = req.query;
    // Validation checks
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    if (!sheetId) {
      return res.status(400).json({ error: 'sheetId is required' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(templateId)) {
      return res.status(400).json({ error: 'templateId must be a valid UUID' });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sheetId)) {
      return res.status(400).json({ error: 'sheetId must be a valid UUID' });
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
    const headerIds = sortedHeaders.map(h => h.id);
    let distinctRowIndices;
    if (!sortHeader) {
      distinctRowIndices = await SheetData.findAll({
        where: { sheetId, headerId: headerIds },
        attributes: ['rowIndex'],
        group: ['rowIndex'],
        order: [['rowIndex', 'ASC']],
        offset,
        limit: size,
        raw: true,
      });
    } else {
      const query = `
        WITH AllDistinctRows AS (
          -- Get all distinct rowIndices for this sheet
          SELECT DISTINCT sd."rowIndex"
          FROM "SheetData" sd
          WHERE sd."sheetId" = :sheetId 
            AND sd."headerId" = ANY(:headerIds)
        ),
        SortedRows AS (
          -- Join with sort column values
          SELECT 
            adr."rowIndex",
            sd.value,
            CASE WHEN sd.value IS NULL THEN 1 ELSE 0 END as is_null
          FROM AllDistinctRows adr
          LEFT JOIN "SheetData" sd 
            ON adr."rowIndex" = sd."rowIndex" 
            AND sd."headerId" = :sortHeader
            AND sd."sheetId" = :sheetId
        )
        SELECT "rowIndex"
        FROM SortedRows
        ORDER BY 
          is_null ASC,  -- Non-null values first
          CASE 
            -- Try to cast as numeric for proper numeric sorting
            WHEN value ~ '^-?[0-9]+\.?[0-9]*$' THEN value::NUMERIC
            ELSE NULL 
          END ${sortOrder} NULLS LAST,
          value ${sortOrder} NULLS LAST  -- Alphanumeric sorting for non-numeric
        LIMIT :limit OFFSET :offset
      `;

      distinctRowIndices = await sequelize.query(query, {
        replacements: { 
          sheetId, 
          headerIds,
          sortHeader, 
          limit: size, 
          offset 
        },
        type: sequelize.QueryTypes.SELECT,
      });
    }

    const rowIndexList = distinctRowIndices.map(r => r.rowIndex);
    const paginatedData = await SheetData.findAll({
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      where: { 
        rowIndex: rowIndexList,
        sheetId,
        headerId: headerIds
      }
    });
    const rowIndexOrder = new Map(rowIndexList.map((rowIndex, index) => [rowIndex, index]));
    paginatedData.sort((a, b) => {
      return rowIndexOrder.get(a.rowIndex) - rowIndexOrder.get(b.rowIndex);
    });
    // Count total rows efficiently
    const totalRows = await SheetData.count({
      where: { sheetId, headerId: headerIds },
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
    const { templateId, sheetId, selectedHeader, dataSearchQuery, currentPage, pageSize } = req.query;

    // 🔒 Basic Validation
    if (!templateId || !sheetId || !selectedHeader || !dataSearchQuery) {
      return res.status(400).json({ error: 'templateId, sheetId, selectedHeader, and dataSearchQuery are required' });
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
        sheetId,
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
        sheetId
      },
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC'], ['headerId', 'ASC']],
      raw: true,
    });

    // 📊 Total matching rows count
    const totalRows = await SheetData.count({
      where: {
        headerId: selectedHeader,
        sheetId,
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
    const { templateId, sheetId } = req.query;

    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
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
      SELECT sd."id", sd."rowIndex", sd."value", sd."headerId", sd."sheetId",
             fh."name" AS "headerName", fh."columnType", fh."criticalityLevel"
      FROM "SheetData" sd
      JOIN filtered_headers fh ON sd."headerId" = fh."id"
      WHERE sd."sheetId" = :sheetId
      ORDER BY sd."rowIndex" ASC
    `, {
      replacements: { templateId, sheetId },
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
    const { templateId, sheetId, templateName, withEmptyColumns=true } = req.query;
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

    const sheetData = await sequelize.query(`
        SELECT sd.id, sd."rowIndex", sd.value, sd."headerId"
        FROM "SheetData" sd
        INNER JOIN "Header" h ON h.id = sd."headerId"
        WHERE h."templateId" = :templateId AND sd."sheetId" = :sheetId
        ORDER BY sd."rowIndex" ASC, sd."headerId" ASC
      `, {
        replacements: { templateId, sheetId },
        type: sequelize.QueryTypes.SELECT,
      });

    const sortedHeaders = sortHeadersFlexibleMatch(headers);
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));
    const validatedDataByHeader = new Map();
    const errorRows = new Map();
    let maxRowIndex = 0;

    sortedHeaders.forEach(header => {
      validatedDataByHeader.set(header.id, []);
    });

    const rowBuckets = new Map();
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
    const responseHeaders = sortedHeaders.map(header => {
      const data = validatedDataByHeader.get(header.id);
      return {
        id: header.id,
        name: header.name,
        criticalityLevel: header.criticalityLevel,
        columnType: header.columnType,
        data,
      };
    }).filter(headerObj => {
      if (withEmptyColumns === 'false' || withEmptyColumns === false) {
        return headerObj.data.some(d => d.value !== null && d.value !== '' && d.value !== undefined && d.value !== 'null' && d.value !== 'NULL');
      }
      return true;
    });
    const totalErrorRows = errorRows.size;
    const filePath = await generateExcelFile({
      headers: responseHeaders,
      maxRowIndex,
      totalErrorRows,
      errorRows,
      rowBuckets,
      templateName
    });

    res.download(filePath, err => {
      if (err) {
        console.error('Download failed:', err);
        res.status(500).json({ error: 'Failed to send file' });
      } else {
        console.log('File sent successfully.');
        fs.unlink(filePath, unlinkErr => {
          if (unlinkErr) {
            console.error('Failed to delete file:', unlinkErr);
          } else {
            console.log('File deleted from disk.');
          }
        });
      }
    });
    
  } catch (error) {
    console.error('Error generating template data with Excel:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to generate Excel file' });
  }
}


async function exportDataWithConditions(req, res) {
  const username = await getUserName(req.userId);
  const { templateId, sheetId, templateName, conditions = [], conditionHeaders = [], currentPage = 1, pageSize = 10000, withEmptyColumns=true } = req.body;
  
  try {
    if (!templateId || !sheetId || !templateName) {
      return res.status(400).json({ error: 'templateId, sheetId, and templateName are required' });
    }

    // 🔹 Step 1: Fetch headers from DB
    const allHeaders = await Header.findAll({
      where: { templateId },
      raw: true,
    });

    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(allHeaders);
    const allHeaderIds = sortedHeaders.map(h => h.id);

    // 🔹 Step 2: Get max row index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });

    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 3: If conditions provided, evaluate them to filter rows
    let matchingRowIndices = [];
    let errorRowIndices = [];

    if (conditionHeaders.length > 0) {
      // Fetch evaluation headers (only those used in conditions)
      const evaluationHeaders = allHeaders.filter(h => conditionHeaders.includes(h.name));
      const evaluationHeaderIds = evaluationHeaders.map(h => h.id);

      // Fetch SheetData for condition evaluation
      const sheetDataForEvaluation = await SheetData.findAll({
        where: {
          sheetId,
          headerId: { [Op.in]: evaluationHeaderIds }
        },
        raw: true,
      });

      // Organize data row-wise for condition evaluation
      const evalRows = new Map();
      sheetDataForEvaluation.forEach(entry => {
        const header = evaluationHeaders.find(h => h.id === entry.headerId);
        const normalizedName = normalizeKey(header.name);
        const row = evalRows.get(entry.rowIndex) || {};
        row[normalizedName] = { value: entry.value, id: entry.id };
        evalRows.set(entry.rowIndex, row);
      });

      // Evaluate conditions across all rows
      for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
        const rowData = evalRows.get(rowIndex) || {};
        const filteredRowData = {};

        for (const name of conditionHeaders) {
          const normalized = normalizeKey(name);
          filteredRowData[normalized] = rowData[normalized] ?? { value: null };
        }

        try {
          const isValid = evaluateConditions(filteredRowData, conditions);
          if (isValid) matchingRowIndices.push(rowIndex);
        } catch (error) {
          errorRowIndices.push(rowIndex);
        }
      }
    } else {
      // If no conditions, include all rows
      for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
        matchingRowIndices.push(rowIndex);
      }
    }

    // 🔹 Step 4: Fetch complete data ONLY for matching rows
    const sheetDataForExport = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: allHeaderIds },
        rowIndex: { [Op.in]: matchingRowIndices },
      },
      raw: true,
    });

    // 🔹 Step 5: Organize data for Excel generation - CRITICAL CHANGES HERE
    const headerMap = new Map(sortedHeaders.map(h => [h.id, h]));
    
    // NEW: Create a clean rowBuckets with ONLY matching rows and sequential indexing
    const sequentialRowBuckets = new Map();
    const errorRows = new Map();

    // Sort matching indices to maintain order
    matchingRowIndices.sort((a, b) => a - b);

    // Create sequential mapping: original rowIndex -> sequential row number
    const rowIndexMapping = new Map();
    matchingRowIndices.forEach((originalRowIndex, index) => {
      rowIndexMapping.set(originalRowIndex, index + 1);
    });

    // Process data and organize by SEQUENTIAL row numbers
    for (const data of sheetDataForExport) {
      const header = headerMap.get(data.headerId);
      if (!header) continue;

      const { value, valid } = validateAndConvertValue(
        data.value,
        header.columnType,
        header.criticalityLevel
      );

      // Get the sequential row number for this original rowIndex
      const sequentialRowNumber = rowIndexMapping.get(data.rowIndex);
      
      // Add to sequential row buckets
      if (!sequentialRowBuckets.has(sequentialRowNumber)) {
        sequentialRowBuckets.set(sequentialRowNumber, new Map());
      }
      sequentialRowBuckets.get(sequentialRowNumber).set(data.headerId, { value, valid });

      // Track error rows (using sequential row numbers)
      if (!valid) {
        if (!errorRows.has(sequentialRowNumber)) {
          errorRows.set(sequentialRowNumber, []);
        }
        errorRows.get(sequentialRowNumber).push(header.name);
      }
    }

    // 🔹 Step 6: Prepare data for existing generateExcelFile function
    // We need to create the structure that generateExcelFile expects
    const validatedDataByHeader = new Map();
    sortedHeaders.forEach(header => {
      validatedDataByHeader.set(header.id, []);
    });

    // Fill validatedDataByHeader with sequential row data
    for (const [sequentialRowNumber, rowData] of sequentialRowBuckets) {
      sortedHeaders.forEach(header => {
        const cellData = rowData.get(header.id);
        validatedDataByHeader.get(header.id).push({
          id: `${header.id}-${sequentialRowNumber}`, // Create synthetic ID
          rowIndex: sequentialRowNumber, // Use sequential row number
          value: cellData?.value ?? '',
          valid: cellData?.valid ?? true
        });
      });
    }

    // 🔹 Step 7: Prepare response headers structure
    const responseHeaders = sortedHeaders.map(header => {
      const data = validatedDataByHeader.get(header.id);
      return {
        id: header.id,
        name: header.name,
        criticalityLevel: header.criticalityLevel,
        columnType: header.columnType,
        data,
      };
    }).filter(headerObj => {
      if (withEmptyColumns === 'false' || withEmptyColumns === false) {
        return headerObj.data.some(d => d.value !== null && d.value !== '' && d.value !== undefined && d.value !== 'null' && d.value !== 'NULL');
      }
      return true;
    });

    // 🔹 Step 8: Generate Excel file using EXISTING function
    const totalErrorRows = errorRows.size;
    const filePath = await generateExcelFile({
      headers: responseHeaders,
      maxRowIndex: matchingRowIndices.length, // This is important - use filtered count
      totalErrorRows,
      errorRows,
      rowBuckets: sequentialRowBuckets, // Pass the sequential row buckets
      templateName
    });
    await createLog({
      action: 'EXPORT_DATA_WITH_CONDITIONS',
      username: username,
      performedBy: req.userRole,
      details: `Exported data for templateId: ${templateId} with conditions. Total rows exported: ${matchingRowIndices.length}, Errors: ${totalErrorRows}`
    });
    // 🔹 Step 9: Send file as download
    res.download(filePath, `${templateName}_filtered_data.xlsx`, err => {
      if (err) {
        console.error('Download failed:', err);
        res.status(500).json({ error: 'Failed to send file' });
      } else {
        console.log('File sent successfully.');
        // Clean up temporary file
        fs.unlink(filePath, unlinkErr => {
          if (unlinkErr) {
            console.error('Failed to delete file:', unlinkErr);
          } else {
            console.log('File deleted from disk.');
          }
        });
      }
    });

  } catch (error) {
    await createLog({
      action: 'EXPORT_DATA_WITH_CONDITIONS_FAILED',
      username: username,
      performedBy: req.userRole,
      details: `Failed to export data for templateId: ${templateId}. Error: ${error.message}`
    });
    console.error('Error in exportDataWithConditions:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
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
  const username = await getUserName(req.userId);
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
    await createLog({
      action: 'PROCESS_AND_SAVE_TEMPLATE_DATA',
      username: username,
      performedBy: req.userRole,
      details: `Processed and saved data for templateId: ${templateId}. Total processed rows: ${totalProcessedRows}, Total records: ${totalRecords}`
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
    await createLog({
      action: 'PROCESS_AND_SAVE_TEMPLATE_DATA_FAILED',
      username: username,
      performedBy: req.userRole,
      details: `Failed to process and save data for templateId: ${req.query.templateId}. Error: ${error.message}`
    });
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


async function updateData(updates, templateId, sheetId) {
  const transaction = await SheetData.sequelize.transaction();
  let updatedCount = 0;
  const snapshots = [];

  try {
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'UPDATE_ROW',
    }, { transaction });

    // Process each RowUpdate
    for (const update of updates) {
      for (const datum of update.data) {

        const currentRecord = await SheetData.findOne({
          where: {
            headerId: datum.headerId,
            sheetId: sheetId,
            rowIndex: update.rowIndex, 
          },
          transaction,
        });

        if (!currentRecord) {
          await SheetData.create({
            id: uuidv4(),
            headerId: datum.headerId,
            sheetId,
            rowIndex: update.rowIndex,
            value: datum.value,
          }, { transaction });

          // Snapshot for insert
          snapshots.push({
            id: uuidv4(),
            operationLogId: operationLog.id,
            headerId: datum.headerId,
            sheetId,
            rowIndex: update.rowIndex,
            originalValue: '',
            newValue: datum.value,
            changeType: 'INSERT',
          });

          updatedCount += 1;
        } else {
          //Create snapshot of original value
          snapshots.push({
            id: uuidv4(),
            operationLogId: operationLog.id,
            headerId: datum.headerId,
            sheetId: currentRecord.sheetId,
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
                sheetId: sheetId,
                rowIndex: update.rowIndex,
              },
              transaction,
            }
          );
  
          updatedCount += affectedRows;
        }

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
  const username = await getUserName(req.userId);
  try{
    const {updates, templateId, sheetId} = req.body;
    if(!templateId || !sheetId) {
      throw new Error('templateId and sheetId are not provided');
    }
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error('Updates must be a non-empty array');
    }

    const result = await updateData(updates, templateId, sheetId);
    await createLog({
      action: 'UPDATE_ROWS',
      username: username,
      performedBy: req.userRole,
      details: `Updated rows for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${result.updatedCount}`
    });
    res.status(200).json({ message: "OK" });
  } catch(error) {
    await createLog({ action: 'UPDATE_ROWS_FAILED', username: username, performedBy: req.userRole, details: `Failed to update rows for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    res.status(500).json({ error: error.message });
  }
}


async function bulkUpdates(headerId, value, templateId, sheetId) {
  const transaction = await sequelize.transaction();
  const snapshots = [];
  try {

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'BULK_UPDATE',
    }, { transaction });

    const currentRecords = await SheetData.findAll({
      where: { headerId, sheetId },
      attributes: ['id', 'rowIndex', 'value'],
      transaction
    });

    const maxRowIndexRecord = await SheetData.findOne({
      where: { sheetId },
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
        sheetId,
        rowIndex: record.rowIndex,
        originalValue: record.value,
        newValue: value
      });
    });

    const [affectedRows] = await SheetData.update(
      { value: value },
      { where: { headerId: headerId, sheetId: sheetId }, transaction }
    );

    const newRows = [];
    for (let i = 0; i <= maxRowIndex; i++) {
      if (i === 0) continue;
      if (!existingRowIndexes.has(i)) {
        newRows.push({
          id: uuidv4(),
          headerId: headerId,
          sheetId: sheetId,
          rowIndex: i,
          value: value
        });

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId,
          sheetId,
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
  const username = await getUserName(req.userId);
  try{
    const {headerId, value, templateId, sheetId} = req.body;

    const result = await bulkUpdates(headerId, value, templateId, sheetId);
    await createLog({ action: 'BULK_UPDATE', username: username, performedBy: req.userRole, details: `Bulk updated headerId: ${headerId} for templateId: ${templateId}, sheetId: ${sheetId}. Total affected rows: ${result.affectedRows}` });
    res.status(200).json({ message: "OK" });
  } catch(error) {
    await createLog({ action: 'BULK_UPDATE_FAILED', username: username, performedBy: req.userRole, details: `Failed to bulk update headerId: ${req.body.headerId} for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    res.status(500).json({ error: error.message });
  }
}


async function addPaddingInData(headerId, templateId, sheetId, padValue, padLength) {
  const transaction = await sequelize.transaction();
  let affectedRows = 0;
  const snapshots = [];

  try {
    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'PADDING_UPDATE',
    }, { transaction });

    // Fetch all records for the given headerId
    const records = await SheetData.findAll({ 
      where: { headerId, sheetId },
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
            where: { id: record.id, sheetId },
            transaction
          }
        );

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId,
          sheetId,
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
        sheetId,
        rowIndex: record.rowIndex,
        originalValue,
        newValue: paddedValue
      });

      const [count] = await SheetData.update(
        { value: paddedValue },
        {
          where: { id: record.id, sheetId },
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
  const username = await getUserName(req.userId);
  try{
    const {headerId, templateId, sheetId, padValue, padLength} = req.body;

    if (!headerId || !templateId || !sheetId) {
      return res.status(400).json({ message: "headerId, templateId, and sheetId are required" });
    }

    const result = await addPaddingInData(headerId, templateId, sheetId, padValue, padLength);
    await createLog({ action: 'PADDING_UPDATE', username: username, performedBy: req.userRole, details: `Applied padding to headerId: ${headerId} for templateId: ${templateId}, sheetId: ${sheetId}. Total affected rows: ${result.affectedRows}` });
    res.status(200).json({ message: "OK" });
  } catch(error) {
    await createLog({ action: 'PADDING_UPDATE_FAILED', username: username, performedBy: req.userRole, details: `Failed to apply padding to headerId: ${req.body.headerId} for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
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

      expr = expr.replace(/(lower\(data\[['"][^'"]+['"]\]\))\s*(==|!=)\s*('[^']*')/g, 
        (match, left, op, right) => {
          return op === '==' 
            ? `strEq(${left}, ${right})` 
            : `strNeq(${left}, ${right})`;
        });
      

      expr = expr
        .replace(/contains\((data\[['"][^'"]+['"]\])\s*,\s*('[^']*')\)/g, 'contains($1, $2)')
        .replace(/not\(contains\((data\[['"][^'"]+['"]\])\s*,\s*('[^']*')\)\)/g, 'notContains($1, $2)')
        .replace(/isEmpty\((data\[['"][^'"]+['"]\])\)/g, 'isEmpty($1)')
        .replace(/not\(isEmpty\((data\[['"][^'"]+['"]\])\)\)/g, 'isNotEmpty($1)')
        .replace(/startsWith\((data\[['"][^'"]+['"]\])\s*,\s*('[^']*')\)/g, 'startsWith($1, $2)')
        .replace(/endsWith\((data\[['"][^'"]+['"]\])\s*,\s*('[^']*')\)/g, 'endsWith($1, $2)');
    }
    return originalEvaluate.call(math, expr, scope);
  };
}

mathInstance.evaluate = createStringComparisonEvaluator(mathInstance);


async function applyCalculations(req, res) {
  const username = await getUserName(req.userId);
  const { templateId, sheetId, conditions, assignments, headers } = req.body;
  const transaction = await sequelize.transaction();
  let snapshots = [];
  try {

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'CALCULATION',
    }, { transaction });

    // Fetch headers
    const dbHeaders = await Header.findAll({
      where: { templateId, name: { [Op.in]: headers } },
      attributes: ['id', 'name', 'columnType'],
      transaction
    });
    const sortedHeaders = dbHeaders.map(h => h.name).sort((a, b) => b.length - a.length);
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

      // New: Replace header references with data[JSON.stringify(header)]
      for (const header of sortedHeaders) {
        const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Match headers bounded by start/end of string, spaces, parens, or operators (==, !=, etc.)
        const regex = new RegExp(`(^|[\\s(])` + escaped + `([\\s=<>!&|)+-/*%]|$)`, 'g');
        normalizedCond = normalizedCond.replace(regex, (match, before, after) => {
          const jsonHeader = JSON.stringify(header);  // e.g., '"Enrolled?"'
          return `${before}data[${jsonHeader}]${after}`;
        });
      }

      // Updated second pass: Handle case-insensitive for text (now matches data[...])
      normalizedCond = normalizedCond.replace(/data\[(['"])(.*?)\1\]\s*(==|!=)\s*('[^']*')/g, 
        (match, quote, header, op, value) => {
          if (!headerMap[header]) {
            throw new Error(`Header ${header} not found in condition: ${cond}`);
          }
          const columnType = headerMap[header].columnType;
          if (['text', 'character', 'Y/N'].includes(columnType)) {
            const cleanValue = value.slice(1, -1);
            return `lower(data[${JSON.stringify(header)}]) ${op} '${cleanValue.toLowerCase()}'`;
          }
          return match;
        });
      
      return normalizedCond;
    });

    // Fetch SheetData
    const sheetData = await SheetData.findAll({
      where: { 
        headerId: { [Op.in]: dbHeaders.map(h => h.id) },
        sheetId, 
      },
      attributes: ['headerId', 'rowIndex', 'value'],
      transaction
    });
    const maxRowIndex = await SheetData.findOne({
      where: { sheetId },
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      order: [['rowIndex', 'DESC']],
      attributes: ['rowIndex'],
      transaction,
    });
    const maxRow = maxRowIndex?.rowIndex ?? 0;

    const headerRowMap = new Map();

    for (const entry of sheetData) {
      if (!headerRowMap.has(entry.headerId)) {
        headerRowMap.set(entry.headerId, new Set());
      }
      headerRowMap.get(entry.headerId).add(entry.rowIndex);
    }

    for (const header of dbHeaders) {
      const existingRows = headerRowMap.get(header.id) || new Set();
      for (let i = 0; i <= maxRow - 1; i++) {
        if (i === 0) continue;
        if (!existingRows.has(i)) {
          sheetData.push({
            headerId: header.id,
            rowIndex: i,
            value: ''
          });
        }
      }
    }


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
      const scope = { data: {} };
      dbHeaders.forEach(h => {
        const value = rowData[h.name]?.trim();
        let parsedValue;
        if (value === '' || value === 'null' || value === undefined) {
          parsedValue = null;
        } else if (h.columnType === 'integer') {
          const parsed = parseInt(value, 10);
          parsedValue = isNaN(parsed) ? null : parsed;
        } else if (h.columnType === 'decimal') {
          const parsed = parseFloat(value);
          parsedValue = isNaN(parsed) ? null : parsed;
        } else if (h.columnType === 'Date') {
          const parsed = new Date(value);
          parsedValue = isNaN(parsed.getTime()) ? null : parsed;
        } else if (h.columnType === 'Y/N') {
          const upperValue = value.toUpperCase();
          parsedValue = ['Y', 'N'].includes(upperValue) ? upperValue : null;
        } else {
          parsedValue = String(value); // text, character
        }
        scope.data[h.name] = parsedValue;
      });

      for (let i = 0; i < processedConditions.length; i++) {
        let condition = processedConditions[i];
        const assignment = assignments[i];

        // Skip evaluation if critical scope values are null
        let skipCondition = false;
        const headersInCondition = [];

        const originalCond = conditions[i];
        for (const header of Object.keys(headerMap)) {
          if (originalCond.includes(header)) {  // Simple check; refine with regex if needed
            headersInCondition.push(header);
          }
        }

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
              // New: Replace headers in assignment.value with literal values
              let expr = assignment.value;
              for (const header of sortedHeaders) {
                const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`(?:@)?` + escaped, 'g');  // Handle optional @ if legacy
                expr = expr.replace(regex, () => {
                  const value = scope.data[header];
                  if (value === null) return 'null';
                  if (['integer', 'decimal'].includes(headerMap[header].columnType)) {
                    return value;
                  } else {
                    // Escape single quotes for string literals
                    return `'${String(value).replace(/'/g, "\\'")}'`;
                  }
                });
              }
              targetValue = mathInstance.evaluate(expr, scope);
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
                  sheetId,
                  rowIndex: parseInt(rowIndex),
                  originalValue: String(originalValue),
                  newValue: String(targetValue)
                });
              }

              upserts.push({
                headerId: headerMap[assignment.header].id,
                sheetId,
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
    await createLog({ action: 'CALCULATION', username: username, performedBy: req.userRole, details: `Applied calculations for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updatedRows}` });
    return res.status(200).json({
      message: 'Rules applied successfully',
      updatedRows,
    });
  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'CALCULATION_FAILED', username: username, performedBy: req.userRole, details: `Failed to apply calculations for templateId: ${templateId}, sheetId: ${sheetId}. Error: ${error.message}` });
    console.error('Error in applyCalculations:', error);
    return res.status(500).json({ error: `Server error: ${error.message}` });
  }
}




const addRow = async (req, res) => {
  const username = await getUserName(req.userId);
  const { templateId, sheetId } = req.params;

  try {
    // Check if template exists
    const template = await Template.findByPk(templateId);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!sheetId) {
      return res.status(400).json({ error: 'sheetId is required' });
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
          sheetId,
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
              sheetId,
            },
            { transaction: t },
          ),
        ),
      );

      await OperationLog.create({ id: uuidv4(), templateId, sheetId, operationType: 'ADD_ROW' }, { transaction: t });
    });
    await createLog({ action: 'ADD_ROW', username: username, performedBy: req.userRole, details: `Added new row to templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(201).json({ message: "Row Added"});
  } catch (error) {
    await createLog({ action: 'ADD_ROW_FAILED', username: username, performedBy: req.userRole, details: `Failed to add row to templateId: ${templateId}, sheetId: ${sheetId}. Error: ${error.message}` });
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
        result = await processAddress(row.streetAddress, row.city, row.state);
        // Validate response: expect { ZipCode: string }
        if (result && result !== "") {
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
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, streetAddress, city, state, zipcode } = req.body;
    
    // Validate request body
    if (!templateId || !sheetId || !streetAddress || !city || !state || !zipcode) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
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
        sheetId,
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
              sheetId,
              rowIndex: result.rowIndex,
              value: result.zipCode,
            });

            snapshots.push({
              id: uuidv4(),
              operationLogId: operationLog.id,
              headerId: zipcodeHeader.id,
              sheetId,
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
    await createLog({ action: 'ZIPCODE', username: username, performedBy: req.userRole, details: `Processed zip codes for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updates.length}, skipped rows: ${skippedRows.length}` });
    return res.status(200).json({
      message: 'Zip codes processed successfully',
      updatedRows: updates.length,
      skippedRows: skippedRows.length,
      skippedRowIndices: skippedRows,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'ZIPCODE_FAILED', username: username, performedBy: req.userRole, details: `Failed to process zip codes for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error finding zip codes:', error);
    return res.status(500).json({ error: 'Failed to find zip codes' });
  }
};

const scoreConversion = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, subject, testType, sourceHeader, sourceCompHeader, targetHeader } = req.body;
    if (!templateId || !subject || !testType || !sourceHeader || !targetHeader || !sheetId) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
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
    if (sourceCompHeader !== "optional" && sourceCompHeader !== null && sourceCompHeader !== "") {
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
        },
        sheetId,
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

    // Process rows for conversion - NEW LOGIC
    for (const rowIndex in rows) {
      const row = rows[rowIndex];
      const sourceValueStr = row.sourceValue;
      const compValueStr = row.compValue;
      
      // NEW: Handle cases where source value might be empty but comp value exists
      let finalSourceValue = null;
      
      // Case 1: Both source and comp values exist
      if (sourceValueStr && sourceValueStr.trim() !== '') {
        const sourceValue = parseFloat(sourceValueStr);
        if (isNaN(sourceValue)) {
          errors.push({
            rowIndex: parseInt(rowIndex),
            error: `Invalid number format in source: ${sourceValueStr}`
          });
          continue;
        }
        
        // Only convert if source value meets minimum requirement (e.g., 9 for ACT)
        try {
          const conversionResult = convertScore(subject, testType, sourceValue);
          
          if (conversionResult && conversionResult.error) {
            errors.push({
              rowIndex: parseInt(rowIndex),
              error: conversionResult.error
            });
            continue;
          }

          if (conversionResult && conversionResult.single !== undefined) {
            finalSourceValue = conversionResult.single;
          }
        } catch (error) {
          errors.push({
            rowIndex: parseInt(rowIndex),
            error: `Conversion failed: ${error.message}`
          });
          continue;
        }
      }
      
      // Case 2: No valid converted value from source, but comp value exists
      if (finalSourceValue === null && compValueStr && compValueStr.trim() !== '') {
        const compValue = parseFloat(compValueStr);
        if (isNaN(compValue)) {
          errors.push({
            rowIndex: parseInt(rowIndex),
            error: `Invalid number format in comparison: ${compValueStr}`
          });
          continue;
        }
        finalSourceValue = compValue;
      }
      
      // Case 3: No valid value at all
      if (finalSourceValue === null) {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      // NEW: Compare converted value with comp value and take the higher one
      let finalTargetValue = finalSourceValue;
      
      if (compValueStr && compValueStr.trim() !== '') {
        const compValue = parseFloat(compValueStr);
        if (!isNaN(compValue)) {
          finalTargetValue = Math.max(finalSourceValue, compValue);
        }
      }

      validRows.push({
        rowIndex: parseInt(rowIndex),
        finalTargetValue: finalTargetValue,
        originalValue: originalValues.get(parseInt(rowIndex)) || null,
        sourceConverted: finalSourceValue,
        compValueUsed: compValueStr && !isNaN(parseFloat(compValueStr)) ? parseFloat(compValueStr) : null
      });
    }

    const updates = [];
    const snapshots = [];

    // Perform updates
    for (const row of validRows) {
      try {
        const newTargetValue = String(row.finalTargetValue);
        const originalTargetValue = row.originalValue ? String(row.originalValue) : null;

        // Only update if value has changed
        if (newTargetValue !== originalTargetValue) {
          updates.push({
            id: uuidv4(),
            headerId: targetHeaderID.id,
            sheetId,
            rowIndex: row.rowIndex,
            value: newTargetValue,
          });

          snapshots.push({
            id: uuidv4(),
            operationLogId: operationLog.id,
            headerId: targetHeaderID.id,
            sheetId,
            rowIndex: row.rowIndex,
            originalValue: originalTargetValue,
            newValue: newTargetValue,
            changeType: originalTargetValue ? 'UPDATE' : 'INSERT',
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
    await createLog({ action: 'SCORE_CONVERSION', username: username, performedBy: req.userRole, details: `Processed score conversion for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updates.length}, skipped rows: ${skippedRows.length}` });
    return res.status(200).json({ 
      message: 'Score Conversion Done',
      stats: {
        updated: updates.length,
        skipped: skippedRows.length,
        errors: errors.length
      }
    });

  } catch(error) {
    await transaction.rollback();
    await createLog({ action: 'SCORE_CONVERSION_FAILED', username: username, performedBy: req.userRole, details: `Failed to process score conversion for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Score conversion error:', error);
    return res.status(500).json({ 
      error: 'Failed to Convert Score',
      details: error.message 
    }); 
  }
};



const cipConversion = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, sourceHeader, targetHeader } = req.body;
    if (!templateId || !sheetId || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create operation log
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
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
        },
        sheetId,
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
              sheetId,
              rowIndex: row.rowIndex,
              value: newTargetValue,
            });

            snapshots.push({
              id: uuidv4(),
              operationLogId: operationLog.id,
              headerId: targetHeaderID.id,
              sheetId,
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
    await createLog({ action: 'CIP_CONVERSION', username: username, performedBy: req.userRole, details: `Processed CIP conversion for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updates.length}, skipped rows: ${skippedRows.length}` });
    return res.status(200).json({ 
      message: 'CIP Conversion Done',
    });

  } catch(error) {
    await transaction.rollback();
    await createLog({ action: 'CIP_CONVERSION_FAILED', username: username, performedBy: req.userRole, details: `Failed to process CIP conversion for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('CIP conversion error:', error);
    return res.status(500).json({ 
      error: 'Failed to Convert CIP',
      details: error.message 
    }); 
  }
};

const FacilityZipFiller = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, sourceHeader, targetHeader } = req.body;
    if (!templateId || !sheetId || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'CONVERSION'
    }, { transaction });

    const [sourceHeaderObj, targetHeaderObj] = await Promise.all([
      Header.findOne({ where: { templateId, name: sourceHeader }, transaction }),
      Header.findOne({ where: { templateId, name: targetHeader }, transaction })
    ]);

    if (!sourceHeaderObj || !targetHeaderObj) {
      await transaction.rollback();
      return res.status(404).json({ error: 'One or more headers not found' });
    }

    const sheetData = await SheetData.findAll({
      where: {
        headerId: { [Op.in]: [sourceHeaderObj.id, targetHeaderObj.id] },
        sheetId,
      },
      transaction
    });

    const rows = {};
    sheetData.forEach(entry => {
      const rowIndex = entry.rowIndex;
      if (!rows[rowIndex]) rows[rowIndex] = {};
      if (entry.headerId === sourceHeaderObj.id) {
        rows[rowIndex].sourceZip = entry.value?.trim() || null;
      } else if (entry.headerId === targetHeaderObj.id) {
        rows[rowIndex].targetZip = entry.value?.trim() || null;
      }
    });

    const updates = [];
    const snapshots = [];
    const skippedRows = [];
    const errors = [];

    for (const rowIndex in rows) {
      const { sourceZip, targetZip } = rows[rowIndex];
      if (!sourceZip || sourceZip.length < 3) {
        skippedRows.push(parseInt(rowIndex));
        continue;
      }

      const zipPrefix = sourceZip.slice(0, 3);
      if (zipPrefix !== targetZip) {
        updates.push({
          id: uuidv4(),
          headerId: targetHeaderObj.id,
          sheetId,
          rowIndex: parseInt(rowIndex),
          value: zipPrefix
        });

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId: targetHeaderObj.id,
          sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: targetZip,
          newValue: zipPrefix,
          changeType: targetZip ? 'UPDATE' : 'INSERT'
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
    await createLog({ action: 'FACILITY_ZIP_FILL', username: username, performedBy: req.userRole, details: `Filled facility ZIP prefixes for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updates.length}, skipped rows: ${skippedRows.length}` });
    return res.status(200).json({
      message: 'ZIP prefix fill complete',
      updated: updates.length,
      skipped: skippedRows.length,
      errors
    });
  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'FACILITY_ZIP_FILL_FAILED', username: username, performedBy: req.userRole, details: `Failed to fill facility ZIP prefixes for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Facility ZIP fill error:', error);
    return res.status(500).json({
      error: 'Failed to fill ZIP prefixes',
      details: error.message
    });
  }
};


const zipCountyConversion = async (req, res) => {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, sourceHeader, targetHeader } = req.body;
    if (!templateId || !sheetId || !sourceHeader || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
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
        },
        sheetId,
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
          sheetId,
          rowIndex: parseInt(rowIndex),
          value: county
        });

        snapshots.push({
          id: uuidv4(),
          operationLogId: operationLog.id,
          headerId: targetHeaderID.id,
          sheetId,
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
    await createLog({ action: 'ZIP_COUNTY_CONVERSION', username: username, performedBy: req.userRole, details: `Processed ZIP to County conversion for templateId: ${templateId}, sheetId: ${sheetId}. Total updated rows: ${updates.length}, skipped rows: ${skippedRows.length}` });
    return res.status(200).json({
      message: 'ZIP to County Conversion Done',
      updated: updates.length,
      skipped: skippedRows.length,
      errors
    });

  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'ZIP_COUNTY_CONVERSION_FAILED', username: username, performedBy: req.userRole, details: `Failed to process ZIP to County conversion for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
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
    const { templateId, sheetId, conditions = [], currentPage = 1, pageSize = 10, headers = [] } = req.body;

    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId is required' });
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
      where: {
        headerId: { [Op.in]: dbHeaders.map(h => h.id) },
        sheetId,
      },
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

const normalizeKey = key => key.replace(/[^a-zA-Z0-9_]/g, '_');

async function evaluateSheetDataWithConditions(req, res) {
  const { templateId, sheetId, headers = [], conditions = [], currentPage = 1, pageSize = 30, sortHeader = null, sortOrder = 'asc' } = req.body;
  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }
    // 🔹 Step 1: Fetch headers from DB
    const allHeaders = await Header.findAll({
      where: {
        templateId
      },
      raw: true,
    });
    const evaluationHeaders = allHeaders.filter(h => headers.includes(h.name));

    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    const sortedHeaders = sortHeadersFlexibleMatch(allHeaders);

    // 🔹 Step 2: Build header lookup
    const evaluationHeaderIds = evaluationHeaders.map(h => h.id);
    const allHeaderIds = sortedHeaders.map(h => h.id);

    // 🔹 Step 2: Get max row index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });

    const maxRowIndex = result.maxRow ?? 0;



    // 🔹 Step 3: Fetch SheetData for all relevant headers
    const sheetDataForEvaluation = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: evaluationHeaderIds }
      },
      raw: true,
    });

    // 🔹 Step 4: Organize data row-wise
    const evalRows = new Map(); // rowIndex → { headerName → { value, id } }
    sheetDataForEvaluation.forEach(entry => {
      const header = evaluationHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = evalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value, id: entry.id };
      evalRows.set(entry.rowIndex, row);
    });

    // 🔹 Step 5: Evaluate conditions
    const matchingRowIndices = [];
    const errorRowIndices = [];

    // 🔹 Step 6: Evaluate conditions across all rows

    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = evalRows.get(rowIndex) || {};
      const filteredRowData = {};

      for (const name of headers) {
        const normalized = normalizeKey(name);
        filteredRowData[normalized] = rowData[normalized] ?? { value: null };
      }

      const isValid = evaluateConditions(filteredRowData, conditions);
      if (isValid) matchingRowIndices.push(rowIndex);
    }

    // 🔹 Step 6: Sorting before pagination
    if (sortHeader && sortOrder) {
      // Fetch values for sortHeader for all matching rows
      const sortData = await SheetData.findAll({
        where: {
          sheetId,
          headerId: sortHeader,
          rowIndex: { [Op.in]: matchingRowIndices }
        },
        raw: true,
      });

      const valueMap = new Map();
      sortData.forEach(entry => {
        valueMap.set(entry.rowIndex, entry.value);
      });

      // Helper: normalize values for type-aware comparison
      const normalizeForSort = (val) => {
        if (val == null || val == 'null' || val == 'NULL') return null;
        const str = String(val).trim();

        // Try numeric
        if (!isNaN(str) && str !== '' && str !== 'Blanks' && str !== 'blank') {
          return Number(str);
        }

        // Try date
        const date = Date.parse(str);
        if (!isNaN(date)) {
          return new Date(date).getTime();
        }

        // Fallback: string
        return str;
      };

      // Natural compare: splits into chunks of digits vs letters
      const naturalCompare = (a, b) => {
        const chunkify = (t) => t.toString().match(/(\d+|\D+)/g) || [];
        const aa = chunkify(a.toLowerCase());
        const bb = chunkify(b.toLowerCase());

        for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
          const x = aa[i], y = bb[i];
          if (x === y) continue;

          // If both chunks are numbers, compare numerically
          const nx = Number(x), ny = Number(y);
          if (!isNaN(nx) && !isNaN(ny)) {
            return nx - ny;
          }
          // Otherwise compare as strings
          return x.localeCompare(y);
        }
        return aa.length - bb.length;
      };

      matchingRowIndices.sort((a, b) => {
        const valA = normalizeForSort(valueMap.get(a));
        const valB = normalizeForSort(valueMap.get(b));

        if (valA == null && valB == null) return 0;
        if (valA == null) return sortOrder.toLowerCase() === 'asc' ? 1 : -1;
        if (valB == null) return sortOrder.toLowerCase() === 'asc' ? -1 : 1;

        let cmp;
        if (typeof valA === 'number' && typeof valB === 'number') {
          cmp = valA - valB;
        } else if (typeof valA === 'string' && typeof valB === 'string') {
          cmp = naturalCompare(valA, valB);
        } else {
          cmp = valA > valB ? 1 : valA < valB ? -1 : 0;
        }

        return sortOrder.toLowerCase() === 'asc' ? cmp : -cmp;
      });
    }


    // 🔹 Step 6: Apply pagination
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    const paginatedRowIndices = matchingRowIndices.slice(start, end);

    const sequentialRowIndices = paginatedRowIndices.map((originalRowIndex, i) => ({
      originalRowIndex,
      sequentialRowIndex: start + i + 1
    }));


    const sheetDataForDisplay = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: allHeaderIds },
        rowIndex: { [Op.in]: paginatedRowIndices },
      },
      raw: true,
    });

    const finalRows = new Map();

    sheetDataForDisplay.forEach(entry => {
      const header = sortedHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = finalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value, id: entry.id };
      finalRows.set(entry.rowIndex, row);
    });

    // 🔹 Step 7: Build response
    const responseHeaders = sortedHeaders.map(header => {
      const headerData = sequentialRowIndices.map(({ originalRowIndex, sequentialRowIndex }) => {
        const normalizedName = normalizeKey(header.name);
        const entry = finalRows.get(originalRowIndex)?.[normalizedName] ?? { value: null };
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
          valid
        };
      });

      return {
        id: header.id,
        name: header.name,
        criticalityLevel: header.criticalityLevel,
        columnType: header.columnType,
        data: headerData
      };
    });

    return res.status(200).json({
      headers: responseHeaders,
      totalErrorRows: errorRowIndices.length,
      errorPages: [], // optional
      pagination: {
        currentPage,
        pageSize,
        totalRows: matchingRowIndices.length,
        fullTotalRows: maxRowIndex,
        totalPages: Math.ceil(matchingRowIndices.length / pageSize)
      }
    });
  } catch (error) {
    console.error('Error in evaluateSheetDataWithConditions:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

async function deleteSheetDataByConditions(req, res) {
  const { templateId, sheetId, conditionHeaders = [], conditions = [] } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }
    const evaluationHeaders = await Header.findAll({
      where: {
        templateId,
        name: { [Op.in]: conditionHeaders } 
      },
      raw: true,
    });

    if (evaluationHeaders.length === 0) {
      return res.status(404).json({ error: 'No matching headers found for the template' });
    }

    const evaluationHeaderIds = evaluationHeaders.map(h => h.id);

    // 🔹 Step 3: Get max row index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });

    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 4: Fetch SheetData for all relevant headers
    const sheetDataForEvaluation = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: evaluationHeaderIds }
      },
      raw: true,
    });

    // 🔹 Step 5: Organize data row-wise
    const evalRows = new Map(); // rowIndex → { headerName → { value, id } }
    sheetDataForEvaluation.forEach(entry => {
      const header = evaluationHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = evalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value, id: entry.id };
      evalRows.set(entry.rowIndex, row);
    });

    // 🔹 Step 6: Evaluate conditions
    const matchingRowIndices = [];

    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = evalRows.get(rowIndex) || {};
      const filteredRowData = {};

      for (const name of conditionHeaders) {
        const normalized = normalizeKey(name);
        filteredRowData[normalized] = rowData[normalized] ?? { value: null };
      }

      const isValid = evaluateConditions(filteredRowData, conditions);
      if (isValid) matchingRowIndices.push(rowIndex);
    }

    if (matchingRowIndices.length === 0) {
      return res.status(200).json({ message: 'No rows matched the conditions.' });
    }


    const existingData = await SheetData.findAll({
      where: {
        sheetId,
        rowIndex: { [Op.in]: matchingRowIndices }
      },
      raw: true,
    });

    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'DELETE_ROW'
    });

    const snapshots = existingData.map(entry => ({
      operationLogId: operationLog.id,
      headerId: entry.headerId,
      sheetId,
      rowIndex: entry.rowIndex,
      originalValue: entry.value,
      newValue: null,
      changeType: 'DELETE'
    }));

    if (snapshots.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots);
    }

    // 🔹 Step 7: Delete matching rows
    await SheetData.destroy({
      where: {
        sheetId,
        rowIndex: { [Op.in]: matchingRowIndices }
      }
    });
    await createLog({ action: 'DELETE_SHEET_DATA', username: username, performedBy: req.userRole, details: `Deleted sheet data for templateId: ${templateId}, sheetId: ${sheetId}. Deleted rows count: ${matchingRowIndices.length}` });
    return res.status(200).json({
      message: `Deleted ${matchingRowIndices.length} rows successfully.`,
      deletedRowIndices: matchingRowIndices
    });
  } catch (error) {
    console.error('Error in deleteSheetDataByConditions:', error);
    await createLog({ action: 'DELETE_SHEET_DATA_FAILED', username: username, performedBy: req.userRole, details: `Failed to delete sheet data for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}


async function evaluateSheetDataAndAssign(req, res) {
  const username = await getUserName(req.userId);
  const { templateId, sheetId, headers = [], conditions = [], targetHeaderName, targetValue } = req.body;
  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }
    // 🔹 Step 1: Fetch headers from DB
    const allHeaders = await Header.findAll({
      where: {
        templateId,
        name: { [Op.in]: [...headers, targetHeaderName] }
      },
      raw: true,
    });

    const evaluationHeaders = allHeaders.filter(h => headers.includes(h.name));
    const targetHeader = allHeaders.find(h => h.name === targetHeaderName);
    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    // Get Max Row Index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });
    
    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 2: Build header lookup
    const evaluationHeaderIds = evaluationHeaders.map(h => h.id);
    const targetHeaderId = targetHeader?.id;

    // 🔹 Step 3: Fetch SheetData for all relevant headers
    const sheetDataForEvaluation = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: evaluationHeaderIds }
      },
      raw: true,
    });
    // 🔹 Step 4: Organize data row-wise
    const evalRows = new Map(); // rowIndex → { headerName → { value, id } }
    sheetDataForEvaluation.forEach(entry => {
      const header = evaluationHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = evalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value, id: entry.id };
      evalRows.set(entry.rowIndex, row);
    });
    // 🔹 Step 5: Evaluate conditions
    const matchingRowIndices = [];

    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = evalRows.get(rowIndex) || {};

      const filteredRowData = {};
      for (const name of headers) {
        const normalized = normalizeKey(name);
        filteredRowData[normalized] = rowData[normalized] ?? { value: '' };
      }

      const isValid = evaluateConditions(filteredRowData, conditions);
      if (isValid) matchingRowIndices.push(rowIndex);
    }
    // 🔹 Step 6: Do Assignments
    if (targetHeaderId) {
      const existingData = await SheetData.findAll({
        where: {
          sheetId,
          headerId: targetHeaderId,
          rowIndex: { [Op.in]: matchingRowIndices }
        },
        raw: true,
      });

      const existingMap = new Map();
      existingData.forEach(entry => {
        existingMap.set(entry.rowIndex, entry);
      });

      const operationLog = await OperationLog.create({
        templateId,
        sheetId,
        operationType: 'CALCULATION'
      });

      const upserts = [];
      const snapshots = [];

      for (const rowIndex of matchingRowIndices) {
        const existingEntry = existingMap.get(rowIndex);

        if (existingEntry) {
          upserts.push({
            id: existingEntry.id,
            sheetId,
            headerId: targetHeaderId,
            rowIndex,
            value: targetValue
          });
          snapshots.push({
            operationLogId: operationLog.id,
            headerId: targetHeaderId,
            sheetId,
            rowIndex,
            originalValue: existingEntry.value,
            newValue: targetValue,
            changeType: 'UPDATE'
          });
        } else {
          upserts.push({
            sheetId,
            headerId: targetHeader.id,
            rowIndex,
            value: targetValue
          });
          snapshots.push({
            operationLogId: operationLog.id,
            headerId: targetHeaderId,
            sheetId,
            rowIndex,
            originalValue: null,
            newValue: targetValue,
            changeType: 'INSERT'
          });
        }
      }
      await SheetData.bulkCreate(upserts, { updateOnDuplicate: ['value'] });

      if (snapshots.length > 0) {
        await SheetDataSnapshot.bulkCreate(snapshots);
      }
    }
    await createLog({ action: 'EVALUATE_AND_ASSIGN', username: username, performedBy: req.userRole, details: `Evaluated and assigned values for templateId: ${templateId}, sheetId: ${sheetId}. Total assigned rows: ${matchingRowIndices.length}` });
    return res.status(200).json({
      message: 'Assignment completed',
      assignedRows: matchingRowIndices.length
    });
  } catch (error) {
    await createLog({ action: 'EVALUATE_AND_ASSIGN_FAILED', username: username, performedBy: req.userRole, details: `Failed to evaluate and assign for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in evaluateSheetDataAndAssign:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

async function evaluateSheetDataPreview(req, res) {
  const username = await getUserName(req.userId);
  const { templateId, sheetId, headers = [], conditions = [], targetHeaderName, targetValue, limit = 50, offset = 0 } = req.body;

  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }

    // 🔹 Step 1: Fetch headers (evaluation + target)
    const allHeaders = await Header.findAll({
      where: { templateId, name: { [Op.in]: [...headers, targetHeaderName] } },
      raw: true,
    });
    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    const evaluationHeaders = allHeaders.filter(h => headers.includes(h.name));
    const targetHeader = allHeaders.find(h => h.name === targetHeaderName);

    // 🔹 Step 2: Get max row index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });
    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 3: Fetch sheet data for all relevant headers
    const sheetDataForEvaluation = await SheetData.findAll({
      where: { sheetId, headerId: { [Op.in]: allHeaders.map(h => h.id) } },
      raw: true,
    });

    // 🔹 Step 4: Organize row-wise
    const evalRows = new Map();
    sheetDataForEvaluation.forEach(entry => {
      const header = allHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = evalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value }; // ✅ only value, no id
      evalRows.set(entry.rowIndex, row);
    });

    // 🔹 Step 5: Evaluate conditions
    const allRowResults = [];
    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = evalRows.get(rowIndex) || {};
      const filteredRowData = {};

      for (const name of headers) {
        const normalized = normalizeKey(name);
        filteredRowData[normalized] = rowData[normalized] ?? { value: '' };
      }

      const isValid = evaluateConditions(filteredRowData, conditions);

      // Include ALL headers (evaluation + target)
      const fullRowData = {};
      for (const h of [...headers, targetHeaderName]) {
        const normalized = normalizeKey(h);
        if (h === targetHeaderName && isValid) {
          fullRowData[normalized] = { value: targetValue };
        } else {
          fullRowData[normalized] = rowData[normalized] ?? { value: '' };
        }
      }

      allRowResults.push({
        rowIndex,
        data: fullRowData
      });
    }

    // 🔹 Step 6: Sort and chunk
    allRowResults.sort((a, b) => a.rowIndex - b.rowIndex);
    const previewRows = allRowResults.slice(offset, offset + limit);
    await createLog({
      action: 'EVALUATE_PREVIEW',
      username,
      performedBy: req.userRole,
      details: `Previewed evaluation for templateId: ${templateId}, sheetId: ${sheetId}.`
    });

    return res.status(200).json(previewRows);

  } catch (error) {
    await createLog({
      action: 'EVALUATE_PREVIEW_FAILED',
      username,
      performedBy: req.userRole,
      details: `Failed to preview evaluation for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}`
    });
    console.error('Error in evaluateSheetDataPreview:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
}


async function evaluateSheetDataAndDelete(req, res) {
  const username = await getUserName(req.userId);
  const { templateId, sheetId, headers = [], conditions = [] } = req.body;
  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }
    // 🔹 Step 1: Fetch headers from DB
    const allHeaders = await Header.findAll({
      where: {
        templateId,
        name: { [Op.in]: [...headers] }
      },
      raw: true,
    });

    const evaluationHeaders = allHeaders.filter(h => headers.includes(h.name));
    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    // Get Max Row Index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });
    
    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 2: Build header lookup
    const evaluationHeaderIds = evaluationHeaders.map(h => h.id);

    // 🔹 Step 3: Fetch SheetData for all relevant headers
    const sheetDataForEvaluation = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: evaluationHeaderIds }
      },
      raw: true,
    });
    // 🔹 Step 4: Organize data row-wise
    const evalRows = new Map(); // rowIndex → { headerName → { value, id } }
    sheetDataForEvaluation.forEach(entry => {
      const header = evaluationHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = evalRows.get(entry.rowIndex) || {};
      row[normalizedName] = { value: entry.value, id: entry.id };
      evalRows.set(entry.rowIndex, row);
    });
    // 🔹 Step 5: Evaluate conditions
    const matchingRowIndices = [];

    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = evalRows.get(rowIndex) || {};

      const filteredRowData = {};
      for (const name of headers) {
        const normalized = normalizeKey(name);
        filteredRowData[normalized] = rowData[normalized] ?? { value: '' };
      }

      const isValid = evaluateConditions(filteredRowData, conditions);
      if (isValid) matchingRowIndices.push(rowIndex);
    }
    // 🔹 Step 6: Delete Matching Rows
    if (matchingRowIndices.length > 0) {
      // Fetch all rows that will be deleted
      const rowsToDelete = await SheetData.findAll({
        where: {
          sheetId,
          rowIndex: { [Op.in]: matchingRowIndices }
        },
        raw: true,
      });

      // Create operation log
      const operationLog = await OperationLog.create({
        templateId,
        sheetId,
        operationType: 'DELETE_ROW'
      });

      // Prepare snapshots before deletion
      const snapshots = rowsToDelete.map(entry => ({
        operationLogId: operationLog.id,
        headerId: entry.headerId,
        sheetId: entry.sheetId,
        rowIndex: entry.rowIndex,
        originalValue: entry.value,
        newValue: null,
        changeType: 'DELETE'
      }));

      // Delete rows
      await SheetData.destroy({
        where: {
          sheetId,
          rowIndex: { [Op.in]: matchingRowIndices }
        }
      });

      // Save snapshots
      if (snapshots.length > 0) {
        await SheetDataSnapshot.bulkCreate(snapshots);
      }
    }

    await createLog({
      action: 'EVALUATE_AND_DELETE',
      username: username,
      performedBy: req.userRole,
      details: `Evaluated and deleted rows for templateId: ${templateId}, sheetId: ${sheetId}. Total deleted rows: ${matchingRowIndices.length}`
    });

    return res.status(200).json({
      message: 'Deletion completed',
      deletedRows: matchingRowIndices.length
    });
    
  } catch (error) {
    await createLog({ action: 'EVALUATE_AND_DELETE_FAILED', username: username, performedBy: req.userRole, details: `Failed to evaluate and delete for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in evaluateSheetDataAndDelete:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}


async function applyReferenceOnData(inputHeaderId, outputHeaderId, mappings, sheetId, templateId) {
  const transaction = await sequelize.transaction();
  try {
    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    const allData = await SheetData.findAll({
      where: { headerId: { [Op.in]: [inputHeaderId, outputHeaderId] }, sheetId },
      raw: true,
      transaction
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
    const snapshots = [];
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
            snapshots.push({
              operationLogId: operationLog.id,
              headerId: outputHeaderId,
              sheetId: sheetId,
              rowIndex: Number(rowIndex),
              originalValue: outputRow.value,
              newValue: outputValue,
              changeType: 'UPDATE'
            });
          } else {
            inserts.push({
              rowIndex: Number(rowIndex),
              headerId: outputHeaderId,
              sheetId: sheetId,
              value: outputValue,
            });
            snapshots.push({
              operationLogId: operationLog.id,
              headerId: outputHeaderId,
              sheetId: sheetId,
              rowIndex: Number(rowIndex),
              originalValue: "",
              newValue: outputValue,
              changeType: 'INSERT'
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

    // BATCH UPDATES - Fix #1: Use bulkCreate for updates
    if (updates.length > 0) {
      // Instead of individual updates, use a single bulk update
      // For PostgreSQL, you can use raw query for better performance
      const updatePromises = [];
      const BATCH_SIZE = 500;
      
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        updatePromises.push(
          sequelize.query(
            `UPDATE "SheetData" SET value = data.value 
             FROM (VALUES ${batch.map((_, idx) => `($${idx * 2 + 1}::uuid, $${idx * 2 + 2}::text)`).join(', ')}) 
             AS data(id, value) WHERE "SheetData".id = data.id AND "SheetData"."sheetId" = $${batch.length * 2 + 1}`,
            {
              bind: [...batch.flatMap(u => [u.id, u.value]), sheetId],
              transaction
            }
          )
        );
      }
      await Promise.all(updatePromises);
    }

    // FIX #2: Correct bulkCreate usage
    if (inserts.length > 0) {
      await SheetData.bulkCreate(inserts, { transaction });
    }

    // FIX #3: Bulk create snapshots in batches
    if (snapshots.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < snapshots.length; i += BATCH_SIZE) {
        const batch = snapshots.slice(i, i + BATCH_SIZE);
        await SheetDataSnapshot.bulkCreate(batch, { transaction });
      }
    }
    
    await transaction.commit();
    return unmappedValues;

  } catch (err) {
    await transaction.rollback();
    console.error('Error in applyReferenceOnData:', err);
    throw err;
  }
}

async function deleteRow(req, res) {
  const { templateId, sheetId, rowIndex } = req.params;
  const transaction = await sequelize.transaction();
  const username = await getUserName(req.userId);
  try {
    const parsedRowIndex = parseInt(rowIndex);
    if (isNaN(parsedRowIndex)) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid rowIndex provided.' });
    }

    const operationLog = await OperationLog.create({
      id: uuidv4(),
      templateId,
      sheetId,
      operationType: 'DELETE_ROW'
    }, { transaction });

    // Step 2: Snapshot all matching rows using raw SQL
    await sequelize.query(
      `
      INSERT INTO "SheetDataSnapshot" (
        id, "operationLogId", "headerId", "sheetId", "rowIndex", "originalValue", "newValue", "changeType", "createdAt", "updatedAt"
      )
      SELECT
        gen_random_uuid(), :operationLogId, sd."headerId", sd."sheetId", sd."rowIndex", sd."value", NULL, 'DELETE', NOW(), NOW()
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h."id"
      WHERE h."templateId" = :templateId AND sd."rowIndex" = :rowIndex AND sd."sheetId" = :sheetId
      `,
      {
        replacements: {
          operationLogId: operationLog.id,
          templateId,
          rowIndex: parsedRowIndex,
          sheetId,
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
        AND "SheetData"."sheetId" = :sheetId
      `,
      {
        replacements: {
          templateId,
          rowIndex: parsedRowIndex,
          sheetId
        },
        transaction
      }
    );

    await transaction.commit();
    await createLog({ action: 'DELETE_ROW', username: username, performedBy: req.userRole, details: `Deleted row ${parsedRowIndex} for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({
      message: `Row ${parsedRowIndex} deleted successfully for template ${templateId}.`
    });
  } catch (error) {
    await transaction.rollback();
    console.error('❌ Error deleting row:', error);
    await createLog({ action: 'DELETE_ROW_FAILED', username: username, performedBy: req.userRole, details: `Failed to delete row ${rowIndex} for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function calculateAwards(templateId, sheetId, acceptedStatuses, transaction) {
  // Step 1: Fetch headers once
  const headers = await Header.findAll({
    where: { templateId, name: requiredHeadersName },
    transaction
  });

  const headerMap = Object.fromEntries(headers.map(h => [h.name, h.id]));
  const requiredHeaderIds = headers.map(h => h.id);
  const awardHeaderIds = Object.fromEntries(
    Object.keys(awardTypePatterns).map(name => [name, headerMap[name]])
  );

  // Step 2: Fetch all relevant SheetData in one query
  const sheetData = await SheetData.findAll({
    where: {
      headerId: { [Op.in]: requiredHeaderIds },
      sheetId
    },
    attributes: ['rowIndex', 'headerId', 'value'],
    raw: true,
    transaction
  });

  if (sheetData.length === 0) {
    await transaction.rollback();
    return;
  }

  // Step 3: Build in-memory map
  const sheetDataMap = {};
  for (const cell of sheetData) {
    sheetDataMap[`${cell.rowIndex}_${cell.headerId}`] = cell.value;
  }

  const rowIndexes = [...new Set(sheetData.map(d => d.rowIndex))];
  const acceptedStatusSet = new Set(acceptedStatuses.map(s => s.toLowerCase()));

  // Step 4: Create operation log once
  const operationLog = await OperationLog.create({
    templateId,
    sheetId,
    operationType: 'CALCULATION',
    transaction
  });

  const updates = [];
  const snapshots = [];
  const fnflSums = [];

  // Step 5: Process rows entirely in memory
  for (const rowIndex of rowIndexes) {
    const rowData = {};
    for (const headerId of requiredHeaderIds) {
      rowData[headerId] = sheetDataMap[`${rowIndex}_${headerId}`];
    }

    const awardSums = Object.fromEntries(
      Object.keys(awardTypePatterns).map(name => [name, 0])
    );
    let fnflTotal = 0;
    let hasFNFLFlag = false;
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

      if (/^FNFL$/.test(cd)) {
        console.log(`Current CD value: ${cd}, Status: ${status}`); 
        fnflTotal += amt;
        hasFNFLFlag = true;
      }
    }
    if (hasFNFLFlag) {
      fnflSums.push({rowIndex: parseInt(rowIndex), amount: fnflTotal });
      hasFNFLFlag = false;
    }

    // Collect updates + snapshots
    for (const [awardName, total] of Object.entries(awardSums)) {
      const headerId = awardHeaderIds[awardName];
      if (!headerId) continue;

      const newValue = total.toString();
      const originalValue = sheetDataMap[`${rowIndex}_${headerId}`] ?? null;

      updates.push({
        rowIndex: parseInt(rowIndex),
        headerId,
        sheetId,
        value: newValue
      });

      snapshots.push({
        operationLogId: operationLog.id,
        headerId,
        sheetId,
        rowIndex: parseInt(rowIndex),
        originalValue,
        newValue,
        changeType: originalValue ? 'UPDATE' : 'INSERT'
      });
    }
  }

  // Step 6: Bulk write once
  if (updates.length > 0) {
    await SheetData.bulkCreate(updates, {
      updateOnDuplicate: ['value'],
      transaction
    });
  }

  if (snapshots.length > 0) {
    await SheetDataSnapshot.bulkCreate(snapshots, {
      validate: false,
      transaction
    });
  }

  await transaction.commit();
  return fnflSums;
}

async function processNACUBODiscountRates(templateId, sheetId, maxRowIndex) {
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', '2_Semester_Fees', 'Total_Institutional_Gift', 'NACUBO_Discount_Rate']
      },
      transaction
    });


    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['NACUBO_Discount_Rate']) {
      await transaction.rollback();
      return { message: 'NACUBO_Discount_Rate header not found.' };
    }
    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['2_Semester_Tuition'], headerMap['2_Semester_Fees'], headerMap['Total_Institutional_Gift']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];
    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const fees = values[headerMap['2_Semester_Fees']] || 0;
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;
      const discountRate = calculateNACUBODiscountRate(tuition, fees, gift);
      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['NACUBO_Discount_Rate'],
          rowIndex: parseInt(rowIndex),
          sheetId: sheetId
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['NACUBO_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: discountRate.toString(),
          changeType: 'UPDATE'
        });

        existing.value = discountRate.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['NACUBO_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: discountRate.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['NACUBO_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: discountRate.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed NACUBO Discount Rates with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing NACUBO Discount Rates:', error);
    throw error;
  }
}

async function processNetCharges(templateId, sheetId, maxRowIndex) {
  console.log('Processing Net_Charges...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', '2_Semester_Fees', '2_Semester_Room', '2_Semester_Meals', 'Net_Charges_To_Student', 'Total_Institutional_Gift']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Net_Charges_To_Student']) {
      await transaction.rollback();
      return { message: 'Net_Charges_To_Student header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [
          headerMap['2_Semester_Tuition'],
          headerMap['2_Semester_Fees'],
          headerMap['2_Semester_Room'],
          headerMap['2_Semester_Meals'],
          headerMap['Total_Institutional_Gift']
        ],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const fees = values[headerMap['2_Semester_Fees']] || 0;
      const housing = values[headerMap['2_Semester_Room']] || 0;
      const food = values[headerMap['2_Semester_Meals']] || 0;
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;

      const netCharges = calculateNetCharges(tuition, fees, housing, food, gift);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Net_Charges_To_Student'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Charges_To_Student'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: netCharges.toString(),
          changeType: 'UPDATE'
        });

        existing.value = netCharges.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Charges_To_Student'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: netCharges.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Net_Charges_To_Student'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: netCharges.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Net_Charges with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Net_Charges:', error);
    throw error;
  }
}

async function processTotalDirectCost(templateId, sheetId, maxRowIndex) {
  console.log('Processing Total_Direct_Cost...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', '2_Semester_Fees', '2_Semester_Room', '2_Semester_Meals', 'Total_Direct_Costs']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Total_Direct_Costs']) {
      await transaction.rollback();
      return { message: 'Total_Direct_Costs header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [
          headerMap['2_Semester_Tuition'],
          headerMap['2_Semester_Fees'],
          headerMap['2_Semester_Room'],
          headerMap['2_Semester_Meals']
        ],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const fees = values[headerMap['2_Semester_Fees']] || 0;
      const housing = values[headerMap['2_Semester_Room']] || 0;
      const food = values[headerMap['2_Semester_Meals']] || 0;

      const netCharges = calculateTotalDirectCost(tuition, fees, housing, food);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Total_Direct_Costs'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Direct_Costs'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: netCharges.toString(),
          changeType: 'UPDATE'
        });

        existing.value = netCharges.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Direct_Costs'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: netCharges.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Total_Direct_Costs'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: netCharges.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Total_Direct_Cost with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Total_Direct_Costs:', error);
    throw error;
  }
}

async function processNetTuition(templateId, sheetId, maxRowIndex) {
  console.log('Processing Net_Tuition...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', 'Total_Institutional_Gift', 'Net_Tuition_Revenue']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Net_Tuition_Revenue']) {
      await transaction.rollback();
      return { message: 'Net_Tuition_Revenue header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['2_Semester_Tuition'], headerMap['Total_Institutional_Gift']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;

      const netTuition = calculateNetTuition(tuition, gift);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Net_Tuition_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Tuition_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: netTuition.toString(),
          changeType: 'UPDATE'
        });

        existing.value = netTuition.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Tuition_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: netTuition.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Net_Tuition_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: netTuition.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Net_Tuition_Revenue with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Net_Tuition_Revenue:', error);
    throw error;
  }
}

async function processNetTuitionFee(templateId, sheetId, maxRowIndex) {
  console.log('Processing Net_Tuition/Fee_Revenue...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', 'Total_Institutional_Gift', 'Net_Tuition/Fee_Revenue', '2_Semester_Fees']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Net_Tuition/Fee_Revenue']) {
      await transaction.rollback();
      return { message: 'Net_Tuition/Fee_Revenue header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['2_Semester_Tuition'], headerMap['Total_Institutional_Gift'], headerMap['2_Semester_Fees']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;
      const fees = values[headerMap['2_Semester_Fees']] || 0;

      const netTuition = calculateNetTuitionFee(tuition, gift, fees);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Net_Tuition/Fee_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Tuition/Fee_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: netTuition.toString(),
          changeType: 'UPDATE'
        });

        existing.value = netTuition.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Net_Tuition/Fee_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: netTuition.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Net_Tuition/Fee_Revenue'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: netTuition.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Net_Tuition/Fee_Revenue with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Net_Tuition/Fee_Revenue:', error);
    throw error;
  }
}

async function processTotalDiscountRate(templateId, sheetId, maxRowIndex) {
  console.log('Processing Total_Discount_Rate...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Total_Institutional_Gift', 'Total_Direct_Costs', 'Total_Discount_Rate']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Total_Discount_Rate']) {
      await transaction.rollback();
      return { message: 'Total_Discount_Rate header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['Total_Institutional_Gift'], headerMap['Total_Direct_Costs']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;
      const directCosts = values[headerMap['Total_Direct_Costs']] || 0;

      const discountRate = calculateTotalDiscountRate(gift, directCosts);
      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Total_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: discountRate.toString(),
          changeType: 'UPDATE'
        });

        existing.value = discountRate.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: discountRate.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Total_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: discountRate.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Total_Discount_Rate with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Total_Discount_Rate:', error);
    throw error;
  }
}

async function processNeed(templateId, sheetId, maxRowIndex) {
  console.log('Processing Need...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_COA', 'SAI', 'Student_Financial_Need', 'Institutional_Merit_As_%_Of_Need_Met']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Student_Financial_Need']) {
      await transaction.rollback();
      return { message: 'Student_Financial_Need header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['2_Semester_COA'], headerMap['SAI']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Fetch ALL existing records that will be affected to avoid race conditions
    const existingNeedRecords = await SheetData.findAll({
      where: {
        headerId: headerMap['Student_Financial_Need'],
        sheetId: sheetId
      },
      transaction
    });

    const existingNeedMap = new Map();
    existingNeedRecords.forEach(record => {
      existingNeedMap.set(record.rowIndex, record);
    });

    let existingMeritPercentMap = null;
    if (headerMap['Institutional_Merit_As_%_Of_Need_Met']) {
      const existingMeritPercentRecords = await SheetData.findAll({
        where: {
          headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
          sheetId: sheetId
        },
        transaction
      });
      existingMeritPercentMap = new Map();
      existingMeritPercentRecords.forEach(record => {
        existingMeritPercentMap.set(record.rowIndex, record);
      });
    }

    // Step 6: Prepare payloads
    const insertPayload = [];
    const updatePayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const COA = values[headerMap['2_Semester_COA']] || 'blank';
      const SAI = values[headerMap['SAI']] || 'blank';

      let need = 0;
      if (SAI !== 'blank' && COA !== 'blank' && !isNaN(SAI) && !isNaN(COA)) {
        need = calculateNeed(COA, SAI);
      } else {
        need = 0;
      }

      // Handle Student Financial Need
      const existingNeed = existingNeedMap.get(rowIndex);
      
      if (existingNeed) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Student_Financial_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existingNeed.value,
          newValue: need.toString(),
          changeType: 'UPDATE'
        });

        // Store for batch update instead of saving individually
        updatePayload.push({
          id: existingNeed.id,
          value: need.toString()
        });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Student_Financial_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: need.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Student_Financial_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: need.toString(),
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
      // Handle Institutional Merit Percent
      if (headerMap['Institutional_Merit_As_%_Of_Need_Met']) {
        const existingMeritPercent = existingMeritPercentMap?.get(rowIndex);
        let meritPercent = 0;
        
        // If need is 0, set merit percent to 0 regardless of existing value
        if (need === 0) {
          meritPercent = 0;
          
          if (existingMeritPercent) {
            // Update existing record to 0
            if (existingMeritPercent.value !== '0') {
              snapshotPayload.push({
                operationLogId: operationLog.id,
                headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
                sheetId: sheetId,
                rowIndex: parseInt(rowIndex),
                originalValue: existingMeritPercent.value,
                newValue: '0',
                changeType: 'UPDATE'
              });
              
              updatePayload.push({
                id: existingMeritPercent.id,
                value: '0'
              });
            }
          } else {
            // Insert new record with 0
            snapshotPayload.push({
              operationLogId: operationLog.id,
              headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
              sheetId: sheetId,
              rowIndex: parseInt(rowIndex),
              originalValue: null,
              newValue: '0',
              changeType: 'INSERT'
            });
            
            insertPayload.push({
              headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
              sheetId: sheetId,
              rowIndex: parseInt(rowIndex),
              value: '0',
              createdAt: new Date(),
              updatedAt: new Date()
            });
          }
        } 
        // If need is not 0, calculate percentage normally
        else if (existingMeritPercent && existingMeritPercent.value && existingMeritPercent.value !== '' && 
                !isNaN(existingMeritPercent.value) && existingMeritPercent.value !== '0') {
          
          // This is an existing record with a value - calculate percentage
          const meritValue = parseFloat(existingMeritPercent.value);
          meritPercent = (meritValue / need) * 100;
          meritPercent = parseFloat(meritPercent.toFixed(2));
          
          snapshotPayload.push({
            operationLogId: operationLog.id,
            headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
            sheetId: sheetId,
            rowIndex: parseInt(rowIndex),
            originalValue: existingMeritPercent.value,
            newValue: meritPercent.toString(),
            changeType: 'UPDATE'
          });
          
          updatePayload.push({
            id: existingMeritPercent.id,
            value: meritPercent.toString()
          });
        } 
        else if (existingMeritPercent && (!existingMeritPercent.value || existingMeritPercent.value === '')) {
          // Existing record but empty value - update it to 0
          snapshotPayload.push({
            operationLogId: operationLog.id,
            headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
            sheetId: sheetId,
            rowIndex: parseInt(rowIndex),
            originalValue: existingMeritPercent.value,
            newValue: '0',
            changeType: 'UPDATE'
          });
          
          updatePayload.push({
            id: existingMeritPercent.id,
            value: '0'
          });
        } 
        else if (!existingMeritPercent) {
          // No existing record - insert 0
          snapshotPayload.push({
            operationLogId: operationLog.id,
            headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
            sheetId: sheetId,
            rowIndex: parseInt(rowIndex),
            originalValue: null,
            newValue: '0',
            changeType: 'INSERT'
          });
          
          insertPayload.push({
            headerId: headerMap['Institutional_Merit_As_%_Of_Need_Met'],
            sheetId: sheetId,
            rowIndex: parseInt(rowIndex),
            value: '0',
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
    }

    // Step 7: Perform batch updates
    if (updatePayload.length > 0) {
      await Promise.all(updatePayload.map(record => 
        SheetData.update(
          { value: record.value, updatedAt: new Date() },
          { where: { id: record.id }, transaction }
        )
      ));
    }

    // Step 8: Bulk insert new SheetData (use ignoreDuplicates to prevent race condition issues)
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { 
        transaction,
        ignoreDuplicates: true  // This prevents errors from duplicate keys
      });
    }

    // Step 9: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Need with logging and snapshots.',
      rowsAffected: insertPayload.length + updatePayload.length + snapshotPayload.length
    };
  } catch (error) {
    // Check if transaction is still active before rolling back
    if (transaction && transaction.finished !== 'commit' && transaction.finished !== 'rollback') {
      await transaction.rollback();
    }
    console.error('Error processing Need:', error);
    throw error;
  }
}

async function processNeedMet(templateId, sheetId, maxRowIndex, fnflSums) {
  console.log('Processing Need_Met...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Student_Financial_Need', 'Total_Gift_Aid', 'Total_Work_Aid', 'Total_Need_Met']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Total_Need_Met']) {
      await transaction.rollback();
      return { message: 'Total_Need_Met header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['Student_Financial_Need'], headerMap['Total_Gift_Aid'], headerMap['Total_Work_Aid']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const fnflValue = fnflSums[rowIndex] || { rowIndex: parseInt(rowIndex), amount: 0 };
      const need = values[headerMap['Student_Financial_Need']] || 0;
      const gift = values[headerMap['Total_Gift_Aid']] || 0;
      const work = values[headerMap['Total_Work_Aid']] || 0;

      const needMet = calculateNeedMet(need, gift, work, fnflValue.amount);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Total_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: needMet.toString(),
          changeType: 'UPDATE'
        });

        existing.value = needMet.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Total_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: needMet.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Total_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: needMet.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Total_Need_Met with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Total_Need_Met:', error);
    throw error;
  }
}

async function processGap(templateId, sheetId, maxRowIndex, fnflSums) {
  console.log('Processing Gap...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Total_Direct_Costs', 'Total_Institutional_Gift', 'GAP/Unmet_Need']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['GAP/Unmet_Need']) {
      await transaction.rollback();
      return { message: 'GAP/Unmet_Need header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['Total_Direct_Costs'], headerMap['Total_Institutional_Gift']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;
      const directCosts = values[headerMap['Total_Direct_Costs']] || 0;
      const fnflValue = fnflSums[rowIndex] || { rowIndex: parseInt(rowIndex), amount: 0 };
      if (fnflSums[rowIndex]) {
        console.log(`Row ${rowIndex} - Direct Costs: ${directCosts}, Gift: ${gift}, FNFL: ${fnflValue.amount}`);
      }
      
      const gap = calculateGap(directCosts, gift, fnflValue.amount);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['GAP/Unmet_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['GAP/Unmet_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: gap === 0 ? "" : gap.toString(),
          changeType: 'UPDATE'
        });

        existing.value = gap === 0 ? "" : gap.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['GAP/Unmet_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: gap === 0 ? "" : gap.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['GAP/Unmet_Need'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: gap === 0 ? "" : gap.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Gap with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Gap:', error);
    throw error;
  }
}

async function processTotalNeedMet(templateId, sheetId, maxRowIndex, fnflSums) {
  console.log('Processing Total_Need_Met...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Student_Financial_Need', 'Total_Gift_Aid', 'Total_Work_Aid', '%_Of_Need_Met']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['%_Of_Need_Met']) {
      await transaction.rollback();
      return { message: '%_Of_Need_Met header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['Student_Financial_Need'], headerMap['Total_Gift_Aid'], headerMap['Total_Work_Aid']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const need = values[headerMap['Student_Financial_Need']] || 0;
      const gift = values[headerMap['Total_Gift_Aid']] || 0;
      const work = values[headerMap['Total_Work_Aid']] || 0;
      const fnflValue = fnflSums[rowIndex] || { rowIndex: parseInt(rowIndex), amount: 0 };

      const discountRate = calculateTotalNeedMet(need, gift, work, fnflValue.amount);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['%_Of_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['%_Of_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: discountRate.toString(),
          changeType: 'UPDATE'
        });

        existing.value = discountRate.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['%_Of_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: discountRate.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['%_Of_Need_Met'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: discountRate.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed %_Of_Need_Met with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing %_Of_Need_Met:', error);
    throw error;
  }
}

async function processTotalNeedMet_W(templateId, sheetId, maxRowIndex) {
  console.log('Processing Total_Need_Met_W...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Student_Financial_Need', 'Total_Gift_Aid', '%_Of_Need_Met_W/Gift_Aid']
      },
      transaction
    });

    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['%_Of_Need_Met_W/Gift_Aid']) {
      await transaction.rollback();
      return { message: '%_Of_Need_Met_W/Gift_Aid header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['Student_Financial_Need'], headerMap['Total_Gift_Aid']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const need = values[headerMap['Student_Financial_Need']] || 0;
      const totalGiftAid = values[headerMap['Total_Gift_Aid']] || 0;

      const discountRate = calculateTotalInstitutionalMeritGift(need, totalGiftAid);

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['%_Of_Need_Met_W/Gift_Aid'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['%_Of_Need_Met_W/Gift_Aid'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: discountRate.toString(),
          changeType: 'UPDATE'
        });

        existing.value = discountRate.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['%_Of_Need_Met_W/Gift_Aid'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: discountRate.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['%_Of_Need_Met_W/Gift_Aid'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: discountRate.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed %_Of_Need_Met_W/Gift_Aid with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing %_Of_Need_Met_W/Gift_Aid:', error);
    throw error;
  }
}

async function processTuitionDiscountRates(templateId, sheetId, maxRowIndex) {
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_Tuition', 'Total_Institutional_Gift', 'Tuition_Discount_Rate']
      },
      transaction
    });


    const headerMap = {};
    headers.forEach(h => headerMap[h.name] = h.id);

    if (!headerMap['Tuition_Discount_Rate']) {
      await transaction.rollback();
      return { message: 'Tuition_Discount_Rate header not found.' };
    }
    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [headerMap['2_Semester_Tuition'], headerMap['Total_Institutional_Gift']],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];
    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const gift = values[headerMap['Total_Institutional_Gift']] || 0;
      const discountRate = calculateTuitionDiscountRate(tuition, gift);
      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['Tuition_Discount_Rate'],
          rowIndex: parseInt(rowIndex),
          sheetId: sheetId
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Tuition_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: discountRate.toString(),
          changeType: 'UPDATE'
        });

        existing.value = discountRate.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['Tuition_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: discountRate.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['Tuition_Discount_Rate'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: discountRate.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Tuition Discount Rates with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Tuition Discount Rates:', error);
    throw error;
  }
}

async function processCampusDiscount(templateId, sheetId, maxRowIndex) {
  console.log('Processing Campus Discount Rates...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Net_Tuition_Revenue', 'Total_Institutional_Gift', 'Campus_Discount Rate']
      },
      transaction
    });

    const headerMap = Object.fromEntries(headers.map(h => [h.name, h.id]));
    const netId = headerMap['Net_Tuition_Revenue'];
    const giftId = headerMap['Total_Institutional_Gift'];
    const discountId = headerMap['Campus_Discount Rate'];

    if (!discountId) {
      await transaction.rollback();
      return { message: 'Campus_Discount Rate header not found.' };
    }

    // Step 2: Fetch all relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [netId, giftId],
        sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex and compute totalNetTuitionRevenue
    const grouped = new Map();
    let totalNetTuitionRevenue = 0;

    for (const data of sheetData) {
      const rowIndex = data.rowIndex;
      const value = parseFloat(data.value) || 0;
      const row = grouped.get(rowIndex) || {};
      row[data.headerId] = value;
      grouped.set(rowIndex, row);

      if (data.headerId === netId) {
        totalNetTuitionRevenue += value;
      }
    }

    // Step 4: Fetch existing Campus_Discount Rate entries in bulk
    const existingDiscounts = await SheetData.findAll({
      where: {
        headerId: discountId,
        sheetId
      },
      transaction
    });

    const existingMap = new Map();
    for (const entry of existingDiscounts) {
      existingMap.set(entry.rowIndex, entry);
    }

    // Step 5: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 6: Prepare payloads
    const insertPayload = [];
    const updatePayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped.get(rowIndex) || {};
      const net = values[netId] || 0;
      const gift = values[giftId] || 0;

      const discountRate = totalNetTuitionRevenue > 0
        ? parseFloat(((gift / totalNetTuitionRevenue) * 100).toFixed(4))
        : 0;

      const newValue = discountRate.toString();
      const existing = existingMap.get(rowIndex);

      snapshotPayload.push({
        operationLogId: operationLog.id,
        headerId: discountId,
        sheetId,
        rowIndex,
        originalValue: existing?.value || null,
        newValue,
        changeType: existing ? 'UPDATE' : 'INSERT'
      });

      if (existing) {
        existing.value = newValue;
        updatePayload.push(existing);
      } else {
        insertPayload.push({
          headerId: discountId,
          sheetId,
          rowIndex,
          value: newValue
        });
      }
    }

    // Step 7: Bulk insert/update
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    if (updatePayload.length > 0) {
      await Promise.all(updatePayload.map(entry => entry.save({ transaction })));
    }

    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed Campus Discount Rates with logging and snapshots.',
      rowsAffected: insertPayload.length + updatePayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing Campus Discount Rates:', error);
    throw error;
  }
}

async function processCOA(templateId, sheetId, maxRowIndex) {
  console.log('Processing 2_Semester COA...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Fetch headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['2_Semester_COA', '2_Semester_Tuition', '2_Semester_Fees', '2_Semester_Room', '2_Semester_Meals' , '2_Semester_Books_Supplies', '2_Semester_Transportation', '2_Semester_Other_Indirect_Charges']
      },
      transaction
    });

    const headerMap = Object.fromEntries(headers.map(h => [h.name, h.id]));
    const tuitionId = headerMap['2_Semester_Tuition'];
    const feesId = headerMap['2_Semester_Fees'];
    const roomId = headerMap['2_Semester_Room'];
    const mealsId = headerMap['2_Semester_Meals'];
    const booksId = headerMap['2_Semester_Books_Supplies'];
    const transportationId = headerMap['2_Semester_Transportation'];
    const otherId = headerMap['2_Semester_Other_Indirect_Charges'];
    const coaId = headerMap['2_Semester_COA'];

    if (!coaId) {
      await transaction.rollback();
      return { message: '2_Semester_COA header not found.' };
    }

    // Step 2: Fetch relevant SheetData
    const sheetData = await SheetData.findAll({
      where: {
        headerId: [tuitionId, feesId, roomId, mealsId, booksId, transportationId, otherId],
        sheetId: sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const grouped = {};
    sheetData.forEach(data => {
      if (!grouped[data.rowIndex]) grouped[data.rowIndex] = {};
      grouped[data.rowIndex][data.headerId] = parseFloat(data.value) || 0;
    });

    // Step 4: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION'
    }, { transaction });

    // Step 5: Prepare payloads
    const insertPayload = [];
    const snapshotPayload = [];

    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      const values = grouped[rowIndex] || {};
      const tuition = values[headerMap['2_Semester_Tuition']] || 0;
      const fees = values[headerMap['2_Semester_Fees']] || 0;
      const room = values[headerMap['2_Semester_Room']] || 0;
      const meals = values[headerMap['2_Semester_Meals']] || 0;
      const books = values[headerMap['2_Semester_Books_Supplies']] || 0;
      const transportation = values[headerMap['2_Semester_Transportation']] || 0;
      const other = values[headerMap['2_Semester_Other_Indirect_Charges']] || 0;
      
      const coa = tuition + fees + room + meals + books + transportation + other;

      const existing = await SheetData.findOne({
        where: {
          headerId: headerMap['2_Semester_COA'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex)
        },
        transaction
      });

      if (existing) {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['2_Semester_COA'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: existing.value,
          newValue: coa.toString(),
          changeType: 'UPDATE'
        });

        existing.value = coa.toString();
        await existing.save({ transaction });
      } else {
        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId: headerMap['2_Semester_COA'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: null,
          newValue: coa.toString(),
          changeType: 'INSERT'
        });

        insertPayload.push({
          headerId: headerMap['2_Semester_COA'],
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          value: coa.toString()
        });
      }
    }

    // Step 6: Bulk insert new SheetData
    if (insertPayload.length > 0) {
      await SheetData.bulkCreate(insertPayload, { transaction });
    }

    // Step 7: Bulk insert SheetDataSnapshot
    if (snapshotPayload.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });
    }

    await transaction.commit();
    return {
      message: 'Processed 2_Semester_COA with logging and snapshots.',
      rowsAffected: insertPayload.length + snapshotPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error processing 2_Semester_COA:', error);
    throw error;
  }
}


async function calculateFurtherMetrics(templateId, sheetId, maxRowIndex, fnflSums) {
  await processNACUBODiscountRates(templateId, sheetId, maxRowIndex);
  await processCOA(templateId, sheetId, maxRowIndex);
  await processNetCharges(templateId, sheetId, maxRowIndex);
  await processTotalDirectCost(templateId, sheetId, maxRowIndex);
  await processNetTuition(templateId, sheetId, maxRowIndex);
  await processNetTuitionFee(templateId, sheetId, maxRowIndex);
  await processTotalDiscountRate(templateId, sheetId, maxRowIndex);
  await processNeed(templateId, sheetId, maxRowIndex);
  await processNeedMet(templateId, sheetId, maxRowIndex, fnflSums);
  await processGap(templateId, sheetId, maxRowIndex, fnflSums);
  await processTotalNeedMet(templateId, sheetId, maxRowIndex, fnflSums);
  await processTotalNeedMet_W(templateId, sheetId, maxRowIndex);
  await processTuitionDiscountRates(templateId, sheetId, maxRowIndex);
  await processCampusDiscount(templateId, sheetId, maxRowIndex);
}

async function calculateAwardInfo(req, res) {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try{
    const { templateId, sheetId, acceptedStatuses } = req.body;
    if (!templateId || !sheetId || !Array.isArray(acceptedStatuses) || acceptedStatuses.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid input. templateId, sheetId, and acceptedStatuses are required.' });
    }
    const maxRowIndex = await SheetData.findOne({
      where: { sheetId },
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      order: [['rowIndex', 'DESC']],
      attributes: ['rowIndex'],
    });
    const maxRow = maxRowIndex?.rowIndex ?? 0;
    const fnflSums = await calculateAwards(templateId, sheetId, acceptedStatuses, transaction);

    await calculateFurtherMetrics(templateId, sheetId, maxRow, fnflSums);
    await createLog({ action: 'CALCULATE_AWARD_INFO', username, performedBy: req.userRole, details: `Calculated award info for templateId: ${templateId}, sheetId: ${sheetId}` });
    res.status(200).json({ message: 'Award information calculated successfully.' });
  } catch(error){
    await transaction.rollback();
    await createLog({ action: 'CALCULATE_AWARD_INFO_FAILED', username, performedBy: req.userRole, details: `Failed to calculate award info for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error calculating award info:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function evaluatePellRowsSmart({ templateId, sheetId, pellSource, criteria, targetHeader, acceptanceStatus }) {
  const transaction = await sequelize.transaction();
  try {
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION',
    }, { transaction });

    const headers = await Header.findAll({ where: { templateId }, raw: true });

    // Step 2: Identify targetHeader
    const target = headers.find(h => h.name === targetHeader);
    if (!target) throw new Error(`Target header "${targetHeader}" not found`);

    // Step 3: Identify Awd_* headers based on pellSource
    const pellHeaders = [];
    const statusHeaders = [];

    for (let i = 1; i <= 20; i++) {
      const pellName = `Awd_${pellSource}${i}`;
      const statusName = `Awd_Status${i}`;

      const pell = headers.find(h => h.name === pellName);
      const status = headers.find(h => h.name === statusName);

      if (pell && status) {
        pellHeaders.push(pell);
        statusHeaders.push(status);
      }
    }

    if (!pellHeaders.length) throw new Error(`No headers found for source "${pellSource}"`);

    // Step 4: Fetch all relevant SheetData
    const allHeaderIds = [...pellHeaders.map(h => h.id), ...statusHeaders.map(h => h.id), target.id];
    const sheetData = await SheetData.findAll({
      where: { headerId: { [Op.in]: allHeaderIds }, sheetId: sheetId },
      raw: true,
    });

    // Step 5: Group data by rowIndex
    const rowMap = {};
    sheetData.forEach(({ rowIndex, headerId, value }) => {
      if (!rowMap[rowIndex]) rowMap[rowIndex] = {};
      rowMap[rowIndex][headerId] = value;
    });

    const updates = [];
    const snapshots = [];

    // Step 6: Evaluate each row
    for (const [rowIndex, row] of Object.entries(rowMap)) {
      let isEligible = false;

      for (let i = 0; i < pellHeaders.length; i++) {
        const pellValue = row[pellHeaders[i].id];
        const statusValue = row[statusHeaders[i].id];

        if (matchCriteria(pellValue, criteria) && acceptanceStatus.map(s => s.toLowerCase()).includes(statusValue.toLowerCase())) {
          isEligible = true;
          break;
        }
      }

      const newValue = isEligible ? 'Y' : 'N';
      const oldValue = row[target.id];

      if (oldValue !== newValue) {
        updates.push({
          rowIndex: parseInt(rowIndex),
          headerId: target.id,
          sheetId: sheetId,
          value: newValue,
        });

        snapshots.push({
          operationLogId: operationLog.id,
          headerId: target.id,
          sheetId: sheetId,
          rowIndex: parseInt(rowIndex),
          originalValue: oldValue || null,
          newValue,
          changeType: 'UPDATE',
        });
      }

    }

    // Step 7: Bulk upsert targetHeader values
    for (const update of updates) {
      await SheetData.upsert(update, { transaction });
    }

    if (snapshots.length) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    }

    await transaction.commit();
    return { updatedRows: updates.length, status: 'success' };

  } catch (err) {
    console.error('evaluatePellRowsSmart error:', err.message);
    throw err;
  }
}

async function calculatePellFlag(req, res) {
  const username = await getUserName(req.userId);
  try{
    const { templateId, sheetId, pellSource, criteria, targetHeader, acceptanceStatus } = req.body;
    if (!templateId || !sheetId || !pellSource || !criteria || !targetHeader || !acceptanceStatus) {
      return res.status(400).json({ message: 'Invalid input. templateId, sheetId, pellSource, criteria, targetHeader, and acceptanceStatus are required.' });
    }
    const result = await evaluatePellRowsSmart({ templateId, sheetId, pellSource, criteria, targetHeader, acceptanceStatus });
    await createLog({ action: 'CALCULATE_PELL_FLAG', username, performedBy: req.userRole, details: `Calculated Pell flag for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({ message: 'Pell flag calculation completed.', details: result });
  } catch(error){
    await createLog({ action: 'CALCULATE_PELL_FLAG_FAILED', username, performedBy: req.userRole, details: `Failed to calculate Pell flag for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in calculatePellFlag:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function replaceSheetValues(templateId, sheetId, originalValue, replaceValue) {
  const transaction = await sequelize.transaction();
  try {
    const matchValue = originalValue === null ? null : originalValue.trim();

    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'BULK_UPDATE',
    }, { transaction });

    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id'],
      raw: true,
    });

    const headerIds = headers.map(h => h.id);
    if (!headerIds.length) throw new Error('No headers found for given templateId');

    const batchSize = 10000;
    let offset = 0;
    let totalUpdated = 0;

    while (true) {
      const rows = await SheetData.findAll({
        where: {
          headerId: { [Op.in]: headerIds },
          sheetId: sheetId,
          value: matchValue,
        },
        attributes: ['id', 'headerId', 'rowIndex', 'value'],
        offset,
        limit: batchSize,
        raw: true,
      });

      if (!rows.length) break;

      const idsToUpdate = rows.map(r => r.id);

      await SheetData.update(
        { value: replaceValue },
        { where: { id: { [Op.in]: idsToUpdate }, sheetId: sheetId }, transaction }
      );

      const snapshots = rows.map(r => ({
        operationLogId: operationLog.id,
        headerId: r.headerId,
        sheetId: sheetId,
        rowIndex: r.rowIndex,
        originalValue: r.value,
        newValue: replaceValue,
        changeType: 'UPDATE',
      }));

      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });

      totalUpdated += rows.length;
      offset += batchSize;
    }

    await transaction.commit();
    return { updated: totalUpdated, status: 'success' };

  } catch (err) {
    await transaction.rollback();
    console.error('replaceSheetValuesWithAudit error:', err.message);
    throw err;
  }
}

async function bulkReplaceValues(req, res) {
  const username = await getUserName(req.userId);
  try {
    const { templateId, sheetId, originalValue, replaceValue } = req.body;
    if (templateId === undefined || originalValue === undefined || replaceValue === undefined || sheetId === undefined) {
      return res.status(400).json({ message: 'templateId, sheetId, originalValue, and replaceValue are required.' });
    }

    const result = await replaceSheetValues(templateId, sheetId, originalValue, replaceValue);
    await createLog({ action: 'BULK_REPLACE_VALUES', username, performedBy: req.userRole, details: `Bulk replaced values for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({ message: 'Bulk replace completed.', details: result });
  } catch (error) {
    await createLog({ action: 'BULK_REPLACE_VALUES_FAILED', username, performedBy: req.userRole, details: `Failed to bulk replace values for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in bulkReplaceValues:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function getStatusValues(req, res) {
  const { templateId, sheetId, targetHeader } = req.body;

  try {
    if (!templateId || !sheetId || !targetHeader) {
      return res.status(400).json({ message: 'templateId, sheetId, and targetHeader are required.' });
    }

    const header = await Header.findOne({ where: { templateId, name: targetHeader } });
    if (!header) {
      return res.status(404).json({ message: `Header "${targetHeader}" not found for the given templateId.` });
    }

    const statusData = await SheetData.findAll({
      where: { headerId: header.id, sheetId },
      attributes: ['value'],
      raw: true,
    });

    const statusValues = [
      ...new Set(
        statusData
          .map(item => item.value?.trim())
          .filter(v => v !== undefined && v !== null && v !== '' && v !== 'NULL')
      )
    ];

    return res.status(200).json({ statusValues });
  } catch (error) {
    console.error('Error in getStatusValues:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function extractHeaderValues(headerId, sheetId) {
  try {
    if (!headerId || !sheetId) {
      throw new Error('headerId and sheetId are required.');
    }

    const data = await SheetData.findAll({
      where: { headerId, sheetId },
      attributes: [[fn('DISTINCT', col('value')), 'value']],
      raw: true,
    });

    const values = data.map(d => d.value).filter(v => v !== null && v !== "");

    return values;
  } catch (error) {
    console.error('Error in getHeaderValues:', error);
    throw error;
  }
}


async function getHeaderValues(req, res) {
  const { templateId, sheetId, headerId } = req.body;

  try {
    if (!templateId || !sheetId || !headerId) {
      return res.status(400).json({ message: 'templateId, sheetId, and headerId are required.' });
    }

    const values = await extractHeaderValues(headerId, sheetId);

    return res.status(200).json({ values });
  } catch (error) {
    console.error('Error in getHeaderValues:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


async function getNullAwardRows(templateId, sheetId) {
  console.log('Finding rows with all NULL awards...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Get headerIds for Awd_Cd1 to Awd_Cd20
    const awardHeaders = await Header.findAll({
      where: {
        templateId,
        name: Array.from({ length: 20 }, (_, i) => `Awd_Cd${i + 1}`)
      },
      transaction
    });

    const awardHeaderIds = awardHeaders.map(h => h.id);
    if (awardHeaderIds.length === 0) {
      await transaction.rollback();
      return { message: 'No award headers found.' };
    }

    // Step 2: Fetch all SheetData for those headers
    const awardData = await SheetData.findAll({
      where: {
        headerId: awardHeaderIds,
        sheetId
      },
      transaction
    });

    // Step 3: Group by rowIndex
    const rowMap = new Map(); // rowIndex → count of non-null awards

    for (const entry of awardData) {
      const rowIndex = entry.rowIndex;
      const value = entry.value?.trim();
      if (value && value.toLowerCase() !== 'null') {
        rowMap.set(rowIndex, (rowMap.get(rowIndex) || 0) + 1);
      } else {
        rowMap.set(rowIndex, rowMap.get(rowIndex) || 0);
      }
    }

    // Step 4: Filter rows where all 20 awards are null
    const nullRows = [];
    for (const [rowIndex, nonNullCount] of rowMap.entries()) {
      if (nonNullCount === 0) {
        nullRows.push(rowIndex);
      }
    }

    await transaction.commit();
    return nullRows;
  } catch (error) {
    await transaction.rollback();
    console.error('Error finding NULL award rows:', error);
    throw error;
  }
}

async function populateAward20Fields(templateId, targetHeaderId, sheetId, targetRows, awardStatusName) {
  console.log('Populating Awd_Amt20, Awd_Cd20, Awd_Status20, Awd_CR20...');
  const transaction = await sequelize.transaction();
  try {
    // Step 1: Get header IDs
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['Awd_Amt20', 'Awd_Cd20', 'Awd_Status20', 'Awd_CR20']
      },
      transaction
    });

    const headerMap = Object.fromEntries(headers.map(h => [h.name, h.id]));
    const amt20Id = headerMap['Awd_Amt20'];
    const cd20Id = headerMap['Awd_Cd20'];
    const status20Id = headerMap['Awd_Status20'];
    const cr20Id = headerMap['Awd_CR20'];

    if (!amt20Id || !cd20Id || !status20Id || !cr20Id) {
      await transaction.rollback();
      return { message: 'One or more target headers not found.' };
    }

    // Step 2: Create OperationLog
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'BULK_UPSERT'
    }, { transaction });

    // Step 3: Fetch source values from targetHeaderId
    const sourceData = await SheetData.findAll({
      where: {
        headerId: targetHeaderId,
        sheetId,
        rowIndex: targetRows
      },
      transaction
    });

    const valueMap = new Map();
    for (const entry of sourceData) {
      const cleaned = entry.value?.replace(/[^\d.-]/g, '') || '0';
      valueMap.set(entry.rowIndex, cleaned);
    }

    // Step 4: Fetch existing SheetData for target rows and headers
    const existingData = await SheetData.findAll({
      where: {
        sheetId,
        rowIndex: targetRows,
        headerId: [amt20Id, cd20Id, status20Id, cr20Id]
      },
      transaction
    });

    const existingMap = new Map(); // key: `${headerId}_${rowIndex}`
    for (const entry of existingData) {
      const key = `${entry.headerId}_${entry.rowIndex}`;
      existingMap.set(key, entry.value);
    }

    // Step 5: Prepare upsert + snapshot payloads
    const upsertPayload = [];
    const snapshotPayload = [];

    for (const rowIndex of targetRows) {
      const amtValue = valueMap.get(rowIndex) || '0';

      const entries = [
        { headerId: amt20Id, value: amtValue },
        { headerId: cd20Id, value: 'B:International' },
        { headerId: status20Id, value: awardStatusName },
        { headerId: cr20Id, value: 'IMUG' }
      ];

      for (const { headerId, value } of entries) {
        const key = `${headerId}_${rowIndex}`;
        const originalValue = existingMap.get(key) ?? null;

        snapshotPayload.push({
          operationLogId: operationLog.id,
          headerId,
          sheetId,
          rowIndex,
          originalValue,
          newValue: value,
          changeType: originalValue === null ? 'INSERT' : 'UPDATE'
        });

        upsertPayload.push({ headerId, sheetId, rowIndex, value });
      }
    }

    // Step 6: Bulk upsert and snapshot
    await SheetData.bulkCreate(upsertPayload, {
      transaction,
      updateOnDuplicate: ['value']
    });

    await SheetDataSnapshot.bulkCreate(snapshotPayload, { transaction });

    await transaction.commit();
    return {
      message: `Upserted award fields with snapshot logging for ${targetRows.length} rows.`,
      rowsAffected: upsertPayload.length
    };
  } catch (error) {
    await transaction.rollback();
    console.error('Error populating award fields:', error);
    throw error;
  }
}


async function autoFillInternationalAwards(req, res) {
  const { templateId, sheetId, targetHeader, awardStatusName } = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !sheetId || !targetHeader || !awardStatusName) {
      return res.status(400).json({ message: 'templateId, sheetId, targetHeader, and awardStatusName are required.' });
    }
    const targetRows = await getNullAwardRows(templateId, sheetId);
    if (targetRows.length === 0) {
      return res.status(200).json({ message: 'No rows with all NULL awards found.' });
    }

    const header = await Header.findOne({ where: { templateId, name: targetHeader } });
    if (!header) {
      return res.status(404).json({ message: `Header "${targetHeader}" not found for the given templateId.` });
    }
    const result = await populateAward20Fields(templateId, header.id, sheetId, targetRows, awardStatusName);
    await createLog({ action: 'AUTO_FILL_INTERNATIONAL_AWARDS', username, performedBy: req.userRole, details: `Auto-filled international awards for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({ message: 'Auto-fill completed.', details: result });
  } catch (error) {
    await createLog({ action: 'AUTO_FILL_INTERNATIONAL_AWARDS_FAILED', username, performedBy: req.userRole, details: `Failed to auto-fill international awards for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in autoFillInternationalAwards:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


async function getAllStatusValues(req, res) {
  const { templateId, sheetId } = req.body;

  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ message: 'templateId and sheetId are required.' });
    }

    // Build header names dynamically: Awd_Status1 ... Awd_Status20
    const headerNames = Array.from({ length: 20 }, (_, i) => `Awd_Status${i + 1}`);

    const result = await SheetData.findAll({
      attributes: ['value'],
      include: [{
        model: Header,
        attributes: [],
        where: { templateId, name: headerNames },
        required: true
      }],
      where: { sheetId },
      raw: true
    });

    if (!result || result.length === 0) {
      return res.status(200).json({ statusValues: [] });
    }

    // Deduplicate all values (no filtering)
    const uniqueValues = Array.from(
      new Set(
        result
          .map(item => item.value?.toString().trim())
          .filter(val => val && val.toLowerCase() !== "null")
      )
    );

    return res.status(200).json({ statusValues: uniqueValues });

  } catch (error) {
    console.error('Error in getAllStatusValues:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

async function getAcceptanceStatusValues(req, res) {
  const { templateId, sheetId, targetHeader } = req.body;

  try {
    if (!templateId || !sheetId || !targetHeader) {
      return res.status(400).json({ message: 'templateId, sheetId, and targetHeader are required.' });
    }

    const result = await SheetData.findAll({
      attributes: ['value'],
      include: [{
        model: Header,
        attributes: [],
        where: { templateId, name: targetHeader },
        required: true
      }],
      where: { sheetId },
      raw: true
    });

    if (!result || result.length === 0) {
      return res.status(200).json({ statusValues: [] });
    }

    // Allowed values (case-insensitive)
    const allowedValues = new Set(['Accepted', 'Accept', 'Pending', 'A', 'P', 'accepted', 'accept', 'pending', 'a', 'p']);

    // Deduplicate and filter
    const filtered = Array.from(
      new Set(
        result
          .map(item => item.value?.toString().trim())
          .filter(val => val && allowedValues.has(val))
      )
    );

    return res.status(200).json({ statusValues: filtered });

  } catch (error) {
    console.error('Error in getAcceptanceStatusValues:', error);
    return res.status(500).json({ message: 'Internal server error.' });
  }
}

async function bulkUpdateYesNo(req, res) {
  const { templateId, sheetId } = req.body;
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    if (!templateId || !sheetId) {
      return res.status(400).json({ error: 'templateId and sheetId are required' });
    }

    // 🔹 Step 1: Fetch headers from DB
    const allHeaders = await Header.findAll({
      where: { templateId },
      raw: true,
    });

    if (allHeaders.length === 0) {
      return res.status(404).json({ error: 'No headers found for the template' });
    }

    // Filter only requested headers that exist in DB
    const evaluationHeaders = allHeaders.filter(h => ynFlags.includes(h.name));
    const evaluationHeaderIds = evaluationHeaders.map(h => h.id);

    if (evaluationHeaders.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: 'No matching headers found for Yes/No flags' });
    }

    // 🔹 Step 2: Get max row index
    const [result] = await sequelize.query(`
      SELECT MAX("rowIndex") AS "maxRow"
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND "headerId" IN (
          SELECT "id" FROM "Header" WHERE "templateId" = :templateId
        )
    `, {
      replacements: { sheetId, templateId },
      type: QueryTypes.SELECT
    });

    const maxRowIndex = result.maxRow ?? 0;

    // 🔹 Step 3: Fetch EXISTING data for relevant headers
    const sheetData = await SheetData.findAll({
      where: {
        sheetId,
        headerId: { [Op.in]: evaluationHeaderIds }
      },
      raw: true,
    });

    // 🔹 Step 4: Organize row-wise (ONLY EXISTING DATA)
    const existingDataMap = new Map(); // rowIndex -> { headerName -> { value, id, headerId } }
    sheetData.forEach(entry => {
      const header = evaluationHeaders.find(h => h.id === entry.headerId);
      const normalizedName = normalizeKey(header.name);
      const row = existingDataMap.get(entry.rowIndex) || {};
      row[normalizedName] = { 
        value: entry.value, 
        id: entry.id, 
        headerId: entry.headerId,
        exists: true 
      };
      existingDataMap.set(entry.rowIndex, row);
    });

    // 🔹 Step 5: Create operation log
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'BULK_UPDATE',
    }, { transaction });

    const updates = [];
    const inserts = [];
    const snapshots = [];

    // 🔹 Step 6: Iterate ALL rows (1 to maxRowIndex) and handle both existing and missing data
    for (let rowIndex = 1; rowIndex <= maxRowIndex; rowIndex++) {
      const rowData = existingDataMap.get(rowIndex) || {};

      for (const headerObj of evaluationHeaders) {
        const normalized = normalizeKey(headerObj.name);
        const existingEntry = rowData[normalized];
        
        let currentValue = existingEntry?.value ?? null;
        const newValue = (!currentValue || (currentValue !== "Yes" && currentValue !== "No")) ? "No" : currentValue;

        // Skip if value is already correct
        if (currentValue === newValue) continue;

        // Prepare snapshot
        snapshots.push({
          operationLogId: operationLog.id,
          headerId: headerObj.id,
          sheetId,
          rowIndex,
          originalValue: currentValue,
          newValue,
          changeType: existingEntry ? 'UPDATE' : 'INSERT',
        });

        // Prepare data for bulk operation
        if (existingEntry) {
          // UPDATE existing record
          updates.push({
            id: existingEntry.id,
            value: newValue
          });
        } else {
          // INSERT new record
          inserts.push({
            id: uuidv4(), // Make sure to import uuidv4
            headerId: headerObj.id,
            sheetId,
            rowIndex,
            value: newValue
          });
        }
      }
    }

    // 🔹 Step 7: Execute all database operations
    if (updates.length > 0) {
      // Bulk update existing records
      await Promise.all(
        updates.map(update =>
          SheetData.update(
            { value: update.value },
            {
              where: { id: update.id },
              transaction
            }
          )
        )
      );
    }

    if (inserts.length > 0) {
      // Bulk insert new records
      await SheetData.bulkCreate(inserts, { transaction, updateOnDuplicate: ["value", "updatedAt"] });
    }

    if (snapshots.length > 0) {
      // Bulk insert snapshots
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    }

    await transaction.commit();
    await createLog({ action: 'BULK_UPDATE_YES_NO', username, performedBy: req.userRole, details: `Bulk updated Yes/No flags for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({
      message: 'Bulk update completed successfully',
      stats: {
        updated: updates.length,
        inserted: inserts.length,
        totalProcessed: maxRowIndex
      }
    });

  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'BULK_UPDATE_YES_NO_FAILED', username, performedBy: req.userRole, details: `Failed to bulk update Yes/No flags for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in bulkUpdateYesNo:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message,
    });
  }
}

async function clearHeaderData(req, res) {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();

  try {
    const { templateId, sheetId, headerName } = req.body;
    if (!templateId || !sheetId || !headerName) {
      await transaction.rollback();
      return res.status(400).json({ message: 'templateId, sheetId, and headerName are required.' });
    }

    const header = await Header.findOne({ where: { templateId, name: headerName }, transaction });
    if (!header) {
      await transaction.rollback();
      return res.status(404).json({ message: `Header "${headerName}" not found for the given templateId.` });
    }

    const [countResult] = await sequelize.query(
      `SELECT COUNT(*)::int AS count FROM "SheetData" WHERE "sheetId" = :sheetId AND "headerId" = :headerId`,
      { replacements: { sheetId, headerId: header.id }, type: QueryTypes.SELECT, transaction }
    );


    if (countResult.count === 0) {
      await transaction.rollback();
      return res.status(404).json({ message: 'No data found for the specified headerId and sheetId.' });
    }

    // Step 2: Create operation log
    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION',
    }, { transaction });

    const rows = await SheetData.findAll({
      where: { sheetId, headerId: header.id },
      attributes: ['rowIndex', 'value'],
      raw: true,
      transaction
    });

    const snapshots = rows.map(row => ({
      operationLogId: operationLog.id,
      headerId: header.id,
      sheetId,
      rowIndex: row.rowIndex,
      originalValue: row.value,
      newValue: '',
      changeType: 'UPDATE'
    }));

    await SheetDataSnapshot.bulkCreate(snapshots, { transaction });
    await SheetData.update(
      { value: '' },
      { where: { sheetId, headerId: header.id }, transaction }
    );

    await transaction.commit();

    await createLog({
      action: 'CLEARING_HEADER_DATA',
      username,
      performedBy: req.userRole,
      details: `Cleared header data for templateId: ${templateId}, sheetId: ${sheetId}, headerName: ${headerName}`
    });

    return res.status(200).json({
      message: 'Header data cleared successfully',
      clearedRows: countResult.count,
      snapshotsInserted: snapshots.length
    });

  } catch (error) {
    await transaction.rollback();
    await createLog({
      action: 'CLEARING_HEADER_DATA_FAILED',
      username,
      performedBy: req.userRole,
      details: `Failed to clear header data for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}, headerName: ${req.body.headerName}. Error: ${error.message}`
    });
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}




async function clearEmptyHeaderColumns(req, res) {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();

  try {
    const { templateId, sheetId } = req.body;
    if (!templateId || !sheetId) {
      await transaction.rollback();
      return res.status(400).json({ message: 'templateId and sheetId are required.' });
    }
    // Step 1: Fetch all headers for this template
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name'],
      raw: true,
      transaction
    });
    if (headers.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ message: 'No headers found for this template.' });
    }

    let totalCleared = 0;
    const clearedHeaders = [];

    // Step 3: Iterate headers and clear only empty columns
    for (const header of headers) {
      const [checkResult] = await sequelize.query(
        `
        SELECT COUNT(*)::int AS count
        FROM "SheetData"
        WHERE "sheetId" = :sheetId
          AND "headerId" = :headerId
          AND "value" IS NOT NULL
          AND TRIM("value") <> ''
          AND LOWER("value") <> 'null'
        `,
        { replacements: { sheetId, headerId: header.id }, type: QueryTypes.SELECT, transaction }
      );
      // Skip if column has non-empty values
      if (checkResult.count > 0) continue;

      // Clear values (set to empty string)
      const [updateResult] = await sequelize.query(
        `
        UPDATE "SheetData"
        SET "value" = ''
        WHERE "sheetId" = :sheetId AND "headerId" = :headerId
        `,
        { replacements: { sheetId, headerId: header.id }, transaction }
      );

      clearedHeaders.push(header.name);
      totalCleared += updateResult.rowCount || 0;
    }

    await transaction.commit();

    await createLog({
      action: 'CLEAR_EMPTY_HEADER_COLUMNS',
      username,
      performedBy: req.userRole,
      details: `Cleared empty header columns for templateId: ${templateId}, sheetId: ${sheetId}`
    });

    return res.status(200).json({
      message: 'Empty header columns cleared successfully.',
      clearedRows: totalCleared,
      headersCleared: clearedHeaders
    });

  } catch (error) {
    await transaction.rollback();
    await createLog({
      action: 'CLEAR_EMPTY_HEADER_COLUMNS_FAILED',
      username,
      performedBy: req.userRole,
      details: `Failed to clear empty header columns for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}`
    });
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


async function normalizeNullValues(req, res) {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();

  try {
    const { templateId, sheetId } = req.body;
    if (!templateId || !sheetId) {
      await transaction.rollback();
      return res.status(400).json({ message: 'templateId and sheetId are required.' });
    }

    // Step 1: Count affected rows
    const [countResult] = await sequelize.query(
      `
      SELECT COUNT(*)::int AS count
      FROM "SheetData"
      WHERE "sheetId" = :sheetId
        AND (
          "value" IS NULL
          OR TRIM("value") = ''
          OR LOWER("value") = 'null'
        )
      `,
      { replacements: { sheetId }, type: QueryTypes.SELECT, transaction }
    );

    if (countResult.count === 0) {
      await transaction.rollback();
      return res.status(200).json({ message: 'No NULL or empty values found to normalize.', normalizedRows: 0 });
    }

    // Step 2: Create operation log
    await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION',
    }, { transaction });

    // Step 3: Update values to empty string
    const [updateResult] = await sequelize.query(
      `
      UPDATE "SheetData"
      SET "value" = ''
      WHERE "sheetId" = :sheetId
        AND (
          "value" IS NULL
          OR TRIM("value") = ''
          OR LOWER("value") = 'null'
        )
      `,
      { replacements: { sheetId }, transaction }
    );

    await transaction.commit();

    await createLog({
      action: 'NORMALIZE_NULL_VALUES',
      username,
      performedBy: req.userRole,
      details: `Normalized NULL/null/empty values for templateId: ${templateId}, sheetId: ${sheetId}`
    });

    return res.status(200).json({
      message: 'Null values normalized successfully.',
      normalizedRows: updateResult.rowCount || countResult.count
    });

  } catch (error) {
    await transaction.rollback();
    await createLog({
      action: 'NORMALIZE_NULL_VALUES_FAILED',
      username,
      performedBy: req.userRole,
      details: `Failed to normalize null values for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}`
    });
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}


async function evaluateBandsAndAssign(req, res) {
  const username = await getUserName(req.userId);
  const transaction = await sequelize.transaction();
  try {
    const { templateId, sheetId, outputHeader, targetHeader, selectedValues, conditions } = req.body;

    if (!templateId || !sheetId || !outputHeader || !targetHeader || !Array.isArray(selectedValues) || selectedValues.length === 0 || !Array.isArray(conditions) || conditions.length === 0) {
      await transaction.rollback();
      return res.status(400).json({ message: 'Invalid input. templateId, sheetId, outputHeader, targetHeader, selectedValues, and conditions are required.' });
    }

    const outputHeaderId = await Header.findOne({ where: { templateId, name: outputHeader } });
    const targetHeaderId = await Header.findOne({ where: { templateId, name: targetHeader } });

    if (!outputHeaderId || !targetHeaderId) {
      await transaction.rollback();
      return res.status(404).json({ message: "Output or target header not found for the given templateId." });
    }

    // Resolve all input headers used in conditions
    const inputHeaderNames = [...new Set(conditions.map(c => c.inputHeader))];
    const inputHeaders = await Header.findAll({ where: { templateId, name: inputHeaderNames } });
    const inputHeaderMap = new Map(inputHeaders.map(h => [h.name, h.id]));

    // Validate all input headers exist
    for (const name of inputHeaderNames) {
      if (!inputHeaderMap.has(name)) {
        await transaction.rollback();
        return res.status(404).json({ message: `Input header "${name}" not found for the given templateId.` });
      }
    }

    // Get max row index
    const [{ maxRowIndex }] = await sequelize.query(
      `SELECT MAX("rowIndex") as "maxRowIndex" FROM "SheetData" WHERE "sheetId" = :sheetId`,
      { replacements: { sheetId }, type: QueryTypes.SELECT }
    );

    // Fetch all input data for relevant headers + target filter
    const inputData = await sequelize.query(
      `
      SELECT i."rowIndex", i."value", i."headerId"
      FROM "SheetData" AS i
      INNER JOIN "SheetData" AS t
        ON i."rowIndex" = t."rowIndex"
      AND i."sheetId" = t."sheetId"
      WHERE i."headerId" IN (:inputHeaderIds)
        AND i."sheetId" = :sheetId
        AND t."headerId" = :targetHeaderId
        AND t."value" IN (:selectedValues)
      ORDER BY i."rowIndex" ASC
      `,
      {
        replacements: {
          inputHeaderIds: inputHeaderNames.map(n => inputHeaderMap.get(n)),
          targetHeaderId: targetHeaderId.id,
          sheetId,
          selectedValues,
        },
        type: QueryTypes.SELECT,
      }
    );

    if (inputData.length === 0) {
      await transaction.rollback();
      return res.status(200).json({ message: "No data found for the input headers." });
    }

    // Build maps: { headerId -> Map(rowIndex -> value) }
    const headerValueMaps = new Map();
    for (const row of inputData) {
      if (!headerValueMaps.has(row.headerId)) headerValueMaps.set(row.headerId, new Map());
      headerValueMaps.get(row.headerId).set(row.rowIndex, row.value);
    }

    const existingOutput = await SheetData.findAll({
      where: { headerId: outputHeaderId.id, sheetId },
      attributes: ["rowIndex", "id", "value"],
      raw: true,
    });
    const outputMap = new Map(existingOutput.map(r => [r.rowIndex, r]));

    const toInsert = [], toUpdate = [], snapshots = [];

    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: 'CALCULATION',
    }, { transaction });

    let correctOnes = 0;
    for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
      let assignedValue = null;
      for (const cond of conditions) {
        const headerId = inputHeaderMap.get(cond.inputHeader);
        const rawValue = headerValueMaps.get(headerId)?.get(rowIndex) ?? null;
        const inputValue = rawValue === null || rawValue === "" || rawValue.toUpperCase() === "NULL" ? null : parseFloat(rawValue);

        let lowerOk = false, upperOk = false;
        if (cond.lowerBound?.operator === 'isNull') {
          lowerOk = (inputValue === null);
        } else if (cond.lowerBound?.operator === 'isNotNull') {
          lowerOk = (inputValue !== null);
        } else {
          lowerOk = evaluateBound(inputValue, cond.lowerBound);
          if (lowerOk) correctOnes++;
        }

        if (cond.upperBound) {
          upperOk = evaluateBound(inputValue, cond.upperBound);
        } else {
          upperOk = true;
        }

        if (lowerOk && upperOk) {
          assignedValue = cond.assignValue;
          break; // stop at first matching condition
        }
      }
      
      if (assignedValue !== null) {
        const existing = outputMap.get(rowIndex);
        if (existing) {
          if (existing.value !== assignedValue) {
            toUpdate.push({ id: existing.id, value: assignedValue });
            snapshots.push({ operationLogId: operationLog.id, headerId: outputHeaderId.id, sheetId, rowIndex, originalValue: existing.value, newValue: assignedValue, changeType: 'UPDATE' });
          }
        } else {
          toInsert.push({ headerId: outputHeaderId.id, sheetId, rowIndex, value: assignedValue });
          snapshots.push({ operationLogId: operationLog.id, headerId: outputHeaderId.id, sheetId, rowIndex, originalValue: null, newValue: assignedValue, changeType: 'INSERT' });
        }
      }
    }

    // Bulk commit
    if (toInsert.length > 0) await SheetData.bulkCreate(toInsert, { transaction });
    if (toUpdate.length > 0) {
      const batchSize = 10000;
      for (let i = 0; i < toUpdate.length; i += batchSize) {
        const batch = toUpdate.slice(i, i + batchSize);
        await Promise.all(batch.map(upd => SheetData.update({ value: upd.value }, { where: { id: upd.id }, transaction })));
      }
    }
    if (snapshots.length > 0) await SheetDataSnapshot.bulkCreate(snapshots, { transaction });

    await transaction.commit();
    await createLog({ action: 'EVALUATE_BANDS_AND_ASSIGN', username, performedBy: req.userRole, details: `Evaluated conditions and assigned values for templateId: ${templateId}, sheetId: ${sheetId}` });

    return res.status(200).json({ message: "Condition evaluation completed successfully.", inserted: toInsert.length, updated: toUpdate.length });

  } catch (error) {
    await transaction.rollback();
    await createLog({ action: 'EVALUATE_BANDS_AND_ASSIGN_FAILED', username, performedBy: req.userRole, details: `Failed for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in evaluateBandsAndAssign:', error);
    return res.status(500).json({ message: 'Internal server error.', details: error.message });
  }
}

async function evaluateMatrixAndAssignElement(req, res) {
  const { templateId, sheetId, matrix } = req.body;
  const username = await getUserName(req.userId);
  const t = await sequelize.transaction();
  try {
    if (!templateId || !sheetId || !matrix) {
      await t.rollback();
      return res.status(400).json({ message: "Invalid input. templateId, sheetId, and matrix are required." });
    }

    const operationLog = await OperationLog.create({
      templateId,
      sheetId,
      operationType: "CALCULATION",
    }, { transaction: t });


    const requiredHeadersName = ["Financial_Band", "Element_Number", "Academic_Band"];
    const headers = await Header.findAll({
      where: { name: { [Op.in]: requiredHeadersName }, templateId },
      raw: true,
      transaction: t,
    });

    if (!headers || headers.length !== requiredHeadersName.length) {
      await t.rollback();
      return res.status(404).json({ message: "Required headers not found for the given templateId." });
    }

    const headerMap = headers.reduce((acc, h) => {
      acc[h.name] = h.id;
      return acc;
    }, {});


    const [academicRows, financialRows, elementRows] = await Promise.all([
      SheetData.findAll({ where: { headerId: headerMap["Academic_Band"], sheetId }, raw: true, transaction: t }),
      SheetData.findAll({ where: { headerId: headerMap["Financial_Band"], sheetId }, raw: true, transaction: t }),
      SheetData.findAll({ where: { headerId: headerMap["Element_Number"], sheetId }, raw: true, transaction: t }),
    ]);


    const bandMap = new Map();
    for (const r of academicRows) {
      bandMap.set(r.rowIndex, { academicBand: parseInt(r.value, 10) });
    }
    for (const r of financialRows) {
      const entry = bandMap.get(r.rowIndex);
      if (entry) entry.financialBand = parseInt(r.value, 10);
    }
    for (const r of elementRows) {
      const entry = bandMap.get(r.rowIndex);
      if (entry) entry.oldElement = r.value;
    }


    const updates = [];
    const snapshots = [];

    for (const [rowIndex, { academicBand, financialBand, oldElement }] of bandMap.entries()) {
      if (academicBand && financialBand) {
        const elementValue = matrix.values[financialBand - 1][academicBand - 1];

        if (elementValue !== undefined && elementValue !== oldElement) {
          updates.push({
            rowIndex,
            sheetId,
            headerId: headerMap["Element_Number"],
            value: elementValue,
          });

          snapshots.push({
            operationLogId: operationLog.id,
            headerId: headerMap["Element_Number"],
            sheetId,
            rowIndex,
            originalValue: oldElement || null,
            newValue: elementValue,
            changeType: oldElement ? "UPDATE" : "INSERT",
          });
        }
      }
    }

    if (updates.length > 0) {
      await SheetData.bulkCreate(updates, {
        updateOnDuplicate: ["value"],
        transaction: t,
      });
    }

    if (snapshots.length > 0) {
      await SheetDataSnapshot.bulkCreate(snapshots, { transaction: t });
    }

    await t.commit();
    await createLog({ action: 'EVALUATE_MATRIX_AND_ASSIGN_ELEMENT', username, performedBy: req.userRole, details: `Evaluated matrix and assigned elements for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({ 
      message: "Matrix applied successfully.", 
      updatedRows: updates.length, 
      loggedChanges: snapshots.length 
    });
  } catch (error) {
    await t.rollback();
    await createLog({ action: 'EVALUATE_MATRIX_AND_ASSIGN_ELEMENT_FAILED', username, performedBy: req.userRole, details: `Failed to evaluate matrix and assign elements for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error("Error in evaluateMatrixAndAssignElement:", error);
    return res.status(500).json({ message: "Internal server error.", details: error.message });
  }
}

async function updateInstitutionalCode(req, res) {
  const { templateId, sheetId, value} = req.body;
  const username = await getUserName(req.userId);
  try {
    if (!templateId || !sheetId || !value) {
      return res.status(400).json({ message: 'templateId, sheetId, and value are required.' });
    }
    const header = await Header.findOne({ where: { templateId, name: 'Institution_Code' } });
    if (!header) {
      return res.status(404).json({ message: 'Header "Institution_Code" not found for the given templateId.' });
    }
    const result = await SheetData.update(
      { value },
      { where: { headerId: header.id, sheetId } }
    );
    await createLog({ action: 'UPDATE_INSTITUTION_CODE', username, performedBy: req.userRole, details: `Updated Institution_Code for templateId: ${templateId}, sheetId: ${sheetId}` });
    return res.status(200).json({ message: 'Institution code updated successfully.', details: result });
  } catch (error) {
    await createLog({ action: 'UPDATE_INSTITUTION_CODE_FAILED', username, performedBy: req.userRole, details: `Failed to update Institution_Code for templateId: ${req.body.templateId}, sheetId: ${req.body.sheetId}. Error: ${error.message}` });
    console.error('Error in updateInstitutionalCode:', error);
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
  zipCountyConversion,
  calculatePellFlag,
  bulkReplaceValues,
  evaluateSheetDataWithConditions,
  evaluateSheetDataAndAssign,
  getStatusValues,
  getHeaderValues,
  FacilityZipFiller,
  extractHeaderValues,
  autoFillInternationalAwards,
  getAcceptanceStatusValues,
  exportDataWithConditions,
  bulkUpdateYesNo,
  evaluateBandsAndAssign,
  evaluateMatrixAndAssignElement,
  deleteSheetDataByConditions,
  updateInstitutionalCode,
  clearHeaderData,
  clearEmptyHeaderColumns,
  normalizeNullValues,
  evaluateSheetDataAndDelete,
  getAllStatusValues,
  evaluateSheetDataPreview
};