const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { Op } = require('sequelize');
const {generateExcelFile} = require('../services/excelService');
const { processFiles } = require('./fileController');
const { getMapHeaders } = require('./headerController');

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
  if (value === null || value === undefined) {
    return { value: null, valid: false };
  }

  if (criticalityLevel === '3') {
    return { value: value, valid: true };
  }

  const stringValue = value.toString().trim();
  if (stringValue === '') {
    return { value: null, valid: false };
  }

  switch (columnType) {
    case 'decimal': {
      const num = parseFloat(stringValue);
      if (!isNaN(num) && Number.isFinite(num) && stringValue.includes('.')) {
        return { value: num.toFixed(4), valid: true };
      }
      if (Number.isInteger(parseFloat(stringValue))) {
        return { value: parseFloat(stringValue).toFixed(4), valid: true };
      }
      return { value: stringValue, valid: false };
    }
    case 'integer': {
      const num = parseInt(stringValue, 10);
      if (!isNaN(num) && Number.isInteger(num)) {
        return { value: num.toString(), valid: true };
      }
      return { value: stringValue, valid: false };
    }
    case 'Date': {
      const date = new Date(stringValue);
      if (!isNaN(date.getTime())) {
        return { value: stringValue, valid: true };
      }
      return { value: stringValue, valid: false };
    }
    case 'Y/N': {
      const normalized = stringValue.toUpperCase();
      if (normalized === 'Y' || normalized === 'N') {
        return { value: normalized, valid: true };
      } else if (normalized === "YES" || normalized === "NO") {
        return { value: normalized === "YES" ? 'Y' : 'N', valid: true}
      } else if (normalized === "0" || normalized === "1") {
        return { value: normalized === "1" ? 'Y' : 'N', valid: true}
      } 
      return { value: stringValue, valid: false };
    }
    case 'text':
    case 'character':
      return { value: stringValue, valid: stringValue.length > 0 };
    default:
      return { value: stringValue, valid: false };
  }
}

async function getHeadersWithValidatedData(req, res) {
  try {
    const { templateId, currentPage = 1, pageSize = 30 } = req.query;

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

    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['id', 'ASC']],
    });

    if (!headers || headers.length === 0) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    const allSheetData = await SheetData.findAll({
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC']],
    });

    const errorRows = new Set();
    const errorPages = new Set();
    const validatedDataByHeader = {};

    headers.forEach(header => {
      validatedDataByHeader[header.id] = [];
    });

    allSheetData.forEach(data => {
      const header = headers.find(h => h.id === data.headerId);
      if (!header) return;

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

      if (!valid) {
        errorRows.add(data.rowIndex);
        const pageWithError = Math.floor(data.rowIndex / size) + 1;
        errorPages.add(pageWithError);
      }
    });

    const offset = (page - 1) * size;
    const paginatedDataByHeader = {};

    headers.forEach(header => {
      const headerData = validatedDataByHeader[header.id];
      const paginatedData = headerData.filter(
        data => data.rowIndex >= offset && data.rowIndex < offset + size
      );
      paginatedDataByHeader[header.id] = paginatedData;
    });

    const responseHeaders = headers.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: paginatedDataByHeader[header.id],
    }));

    const totalRows = Math.max(...allSheetData.map(data => data.rowIndex), 0);
    const totalPages = Math.ceil(totalRows / size);

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
    const { templateId } = req.query || req.params;

    // Validate inputs
    const template = await validateTemplate(templateId);

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

    // Fetch all SheetData for the template
    const sheetData = await SheetData.findAll({
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC'], ['headerId', 'ASC']],
    });

    // Validate data and track errors
    const validatedDataByHeader = {};
    const errorRows = new Map();
    headers.forEach(header => {
      validatedDataByHeader[header.id] = [];
    });

    // Process SheetData
    sheetData.forEach(data => {
      const header = headers.find(h => h.id === data.headerId);
      if (!header) {
        console.warn(`No header found for SheetData.headerId: ${data.headerId}`);
        return;
      }

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

      if (!valid) {
        const rowIndex = data.rowIndex;
        if (!errorRows.has(rowIndex)) {
          errorRows.set(rowIndex, []);
        }
        errorRows.get(rowIndex).push(header.name);
      }
    });

    // Prepare response headers with validated data
    const responseHeaders = headers.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: validatedDataByHeader[header.id],
    }));

    // Calculate total rows
    const totalRows = sheetData.length > 0 ? Math.max(...sheetData.map(d => d.rowIndex)) : 0;
    const totalErrorRows = errorRows.size;

    // Generate Excel file
    const buffer = await generateExcelFile({
      headers: responseHeaders,
      totalRows,
      totalErrorRows,
      errorRows,
    });


    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    // Set headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${template.name}_${currentDate}.xlsx`);

    // Send the Excel file
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

    // Log processing summary
    console.log('Processing summary:', {
      totalProcessedRows,
      totalRecords,
      headers: headers.map(h => h.name),
      unmappedHeaders: uniqueFileHeaders.filter(h => !headerMap.has(h.toLowerCase())),
      processedSheets: processedFiles.map(file => ({
        fileName: file.fileName,
        sheetNames: file.sheets.map(sheet => sheet.sheetName),
      })),
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


module.exports = {deleteSheetData, getHeadersWithValidatedData, getValidatedPageData, getTemplateDataWithExcel, processAndSaveTemplateData, updateSheetData};