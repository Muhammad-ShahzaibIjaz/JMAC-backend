const File = require('../models/File');
const Template = require('../models/Template');
const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const ExtractedHeader = require('../models/ExtractedHeader');
const MapHeader = require("../models/MapHeader");
const MappingTemplate = require('../models/MappingTemplate');
const sequelize = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const { headerProcessor, getFileSheet, selectedHeaderProcessor }  = require('../services/excelService');
const { Op } = require('sequelize');
const fs = require("fs");
const fsSync = require("fs").promises;
const path = require("path");
const { parseRule } = require("../services/parseService");
const crypto = require("crypto");
const { row } = require('mathjs');


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



async function fetchExistingHeaders(templateId) {
  if (!templateId) {
    throw new Error("templateId is required");
  }

  const existingHeaders = await Header.findAll({
    where: {
      templateId,
    },
    attributes: ["id", "name", "criticalityLevel", "columnType"],
  });

  return existingHeaders.map((header) => ({
    id: header.id,
    name: header.name,
    criticalityLevel: header.criticalityLevel,
    columnType: header.columnType,
  }));
}

async function saveFileAndData(processedFiles, templateId, mappingtemplateId, transaction) {
  const allSheets = [];

  // Fetch headers for the given templateId
  const templateHeaders = await Header.findAll({
    where: { templateId },
    transaction,
  });

  if (!templateHeaders.length) {
    throw new Error(`No headers found for templateId: ${templateId}`);
  }

  // Fetch mapHeaders only if mappingtemplateId is provided and not empty
  let headerToMapHeaders = new Map();
  if (mappingtemplateId && mappingtemplateId !== "") {
    const mapHeaders = await MapHeader.findAll({
      where: { mappingTemplateId: mappingtemplateId },
      transaction,
    });

    // Create a mapping of headerId to mapHeader names
    for (const mapHeader of mapHeaders) {
      if (mapHeader.headerId) {
        if (!headerToMapHeaders.has(mapHeader.headerId)) {
          headerToMapHeaders.set(mapHeader.headerId, []);
        }
        headerToMapHeaders.get(mapHeader.headerId).push(mapHeader.name.toLowerCase());
      }
    }
  }

  // Save files and collect sheet data
  for (const processedFile of processedFiles) {
    if (!processedFile.fileName || !processedFile.sheets) {
      throw new Error(`Invalid processed file: ${JSON.stringify(processedFile)}`);
    }

    for (const sheet of processedFile.sheets) {
      if (!sheet.headers || !sheet.data) {
        throw new Error(`Invalid sheet in ${processedFile.fileName}: ${JSON.stringify(sheet)}`);
      }
      allSheets.push({
        fileName: processedFile.fileName,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        data: sheet.data,
      });
    }
  }

  // Function to check if a header has unique values across all sheets
  const isHeaderUnique = (headerName) => {
    const ids = new Set();
    let totalRows = 0;
    for (const sheet of allSheets) {
      const idIndex = sheet.headers.findIndex((h) => h.toLowerCase() === headerName.toLowerCase());
      if (idIndex === -1) return false; // Header not found in this sheet
      for (const row of sheet.data) {
        const id = row[idIndex];
        if (id != null) {
          ids.add(id);
          totalRows++;
        }
      }
    }
    return ids.size === totalRows; // True if all non-null IDs are unique
  };

  let commonHeader;

  if (allSheets.length > 1 || processedFiles.length > 1) { 
    // Find common header (e.g., ID) across all sheets
    const headerCounts = new Map();
    for (const sheet of allSheets) {
      for (const header of sheet.headers) {
        const lowerHeader = header.toLowerCase();
        headerCounts.set(lowerHeader, (headerCounts.get(lowerHeader) || 0) + 1);
      }
    }

    const commonHeaders = [...headerCounts.entries()]
      .filter(([_, count]) => count === allSheets.length)
      .map(([header]) => header);

    // Find the first common header with unique values
    for (const header of commonHeaders) {
      if (isHeaderUnique(header)) {
        commonHeader = header;
        break;
      } else {
        console.warn(`Common header '${header}' has non-unique values`);
      }
    }

    if (!commonHeader) {
      throw new Error("No common header with unique values found across all sheets");
    }
  } else {
    // Single sheet: Check predefined primary key headers
    const potentialPrimaryKeys = ['studentid', 'studentidalt', 'id', 'student_id', 'student_id_alt' , 'unique_id'];
    const sheet = allSheets[0];

    for (const pk of potentialPrimaryKeys) {
      if (sheet.headers.some((h) => h.toLowerCase() === pk.toLowerCase()) && isHeaderUnique(pk)) {
        commonHeader = pk;
        break;
      }
    }

    // Fallback: Try each header in order, ensuring uniqueness
    if (!commonHeader) {
      for (const header of sheet.headers) {
        if (isHeaderUnique(header.toLowerCase())) {
          commonHeader = header.toLowerCase();
          break;
        } else {
          console.warn(`Header '${header}' is not unique`);
        }
      }
    }

    if (!commonHeader) {
      throw new Error("No unique header found in single sheet");
    }
  }


  // Quality check: Detect duplicate headers in sheets
  for (const sheet of allSheets) {
    const headerSet = new Set();
    for (const header of sheet.headers) {
      const lowerHeader = header.toLowerCase();
      if (headerSet.has(lowerHeader)) {
        console.warn(`Duplicate header '${header}' found in sheet '${sheet.sheetName}' of file '${sheet.fileName}'`);
        continue;
      }
      headerSet.add(lowerHeader);
    }
  }

  // Map processed file headers to template headers
  const headerMapping = new Map(); // Maps processed file header to template header
  for (const sheet of allSheets) {
    for (const fileHeader of sheet.headers) {
      const lowerFileHeader = fileHeader.toLowerCase();

      let matchedTemplateHeader = null;
      if (mappingtemplateId && mappingtemplateId !== "") {
        // Check if fileHeader matches any mapHeader
        for (const templateHeader of templateHeaders) {
          const mapHeaderNames = headerToMapHeaders.get(templateHeader.id) || [];
          if (mapHeaderNames.includes(lowerFileHeader)) {
            matchedTemplateHeader = templateHeader;
            break;
          }
        }
      }

      // If no mapHeader match or no mappingtemplateId, try matching by template header name
      if (!matchedTemplateHeader) {
        matchedTemplateHeader = templateHeaders.find(
          (h) => h.name.toLowerCase() === lowerFileHeader
        );
      }

      if (matchedTemplateHeader) {
        headerMapping.set(fileHeader, matchedTemplateHeader);
      }
    }
  }

  // Collect data by ID, allowing new data to be merged
  const dataById = new Map();
  for (const sheet of allSheets) {
    const idIndex = sheet.headers.findIndex((h) => h.toLowerCase() === commonHeader);
    if (idIndex === -1) {
      throw new Error(`Common header '${commonHeader}' not found in sheet '${sheet.sheetName}'`);
    }

    for (const row of sheet.data) {
      const id = row[idIndex];
      if (id == null) {
        console.warn(`Skipping row with null ID in sheet ${sheet.sheetName}`); // Debug log
        continue;
      }

      if (!dataById.has(id)) {
        dataById.set(id, { _nonNullCount: 0, _source: sheet.fileName });
      }
      const rowData = dataById.get(id);

      // Calculate non-null count for this row
      let nonNullCount = 0;
      const newRowData = {};
      for (const header of sheet.headers) {
        if (header.toLowerCase() === commonHeader) continue;
        const templateHeader = headerMapping.get(header);
        if (templateHeader) {
          const value = row[sheet.headers.indexOf(header)];
          newRowData[templateHeader.id] = value != null ? value.toString() : null;
          if (value != null) nonNullCount++;
        }
      }

      // Update data if new row has more non-null values or if existing data is empty
      if (!rowData._nonNullCount || nonNullCount >= rowData._nonNullCount) {
        rowData._nonNullCount = nonNullCount;
        rowData._source = sheet.fileName;
        Object.assign(rowData, newRowData);
      }
    }
  }

  // Quality check: Validate data consistency
  for (const [id, rowData] of dataById) {
    for (const templateHeader of templateHeaders) {
      const value = rowData[templateHeader.id];
      if (value != null && templateHeader.columnType === "text" && value.length > 1000) {
        console.warn(
          `Data quality warning: Value for header '${templateHeader.name}' in ID '${id}' exceeds length limit`
        );
      }
    }
  }

  // Prepare merged headers and data
  const mergedHeaders = templateHeaders.map((h) => h.name);
  const mergedData = [];
  for (const [id, rowData] of dataById) {
    const row = mergedHeaders.map((headerName) => {
      const templateHeader = templateHeaders.find((h) => h.name === headerName);
      if (templateHeader.name.toLowerCase() === commonHeader) return id;
      return rowData[templateHeader.id] || null;
    });
    mergedData.push(row);
  }

  // Save or update headers
  const savedHeaders = [];
  for (const templateHeader of templateHeaders) {
    let header = await Header.findOne({
      where: {
        id: templateHeader.id,
        templateId,
      },
      transaction,
    });

    if (!header) {
      header = await Header.create(
        {
          id: templateHeader.id,
          name: templateHeader.name,
          criticalityLevel: templateHeader.criticalityLevel || "3",
          columnType: templateHeader.columnType || "text",
          templateId,
        },
        { transaction }
      );
    }

    const existingData = await SheetData.findAll({
      where: { headerId: header.id },
      transaction,
    });
    const existingRowCount = existingData.length;
    const existingNonNullCount = existingData.filter((d) => d.value != null).length;

    // Calculate new data quality
    let newRowCount = 0;
    let newNonNullCount = 0;
    for (const row of mergedData) {
      const colIndex = mergedHeaders.indexOf(header.name);
      if (colIndex !== -1 && row[colIndex] != null) {
        newNonNullCount++;
      }
      newRowCount++;
    }

    // Update if new data has more non-null values or if existing data is empty
    const shouldUpdate =
      existingRowCount === 0 ||
      newNonNullCount > existingNonNullCount ||
      (newNonNullCount === existingNonNullCount && newRowCount > existingRowCount);

    if (shouldUpdate) {
      await SheetData.destroy({
        where: { headerId: header.id },
        transaction,
      });
    }

    savedHeaders.push({ header, shouldUpdate });
  }

  // Save merged data
  for (let rowIndex = 0; rowIndex < mergedData.length; rowIndex++) {
    const row = mergedData[rowIndex];
    for (let colIndex = 0; colIndex < row.length && colIndex < savedHeaders.length; colIndex++) {
      if (!savedHeaders[colIndex].shouldUpdate) continue;
      const value = row[colIndex] != null ? row[colIndex].toString() : null;
      await SheetData.create(
        {
          id: uuidv4(),
          rowIndex: rowIndex + 1,
          value,
          headerId: savedHeaders[colIndex].header.id,
        },
        { transaction }
      );
    }
  }

  return { savedHeaders: savedHeaders.map((h) => h.header) };
}



function getValidSheet(processedFiles) {
  const sheet = processedFiles?.[0]?.sheets?.[0];
  if (!sheet || !sheet.headers || !sheet.data) {
    throw new Error("Sheet is missing or malformed.");
  }
  return sheet;
}

async function fetchTemplateHeaders(templateId, transaction) {
  const headers = await Header.findAll({ where: { templateId }, transaction });
  if (!headers.length) throw new Error(`No headers found for templateId: ${templateId}`);
  return headers;
}

async function fetchMapHeaders(mappingTemplateId, transaction) {
  if (!mappingTemplateId) return [];
  return await MapHeader.findAll({ where: { mappingTemplateId }, transaction });
}

function resolveHeaderMapping(fileHeaders, templateHeaders, mapHeaders) {
  const headerToMap = new Map();
  for (const mapHeader of mapHeaders) {
    if (!headerToMap.has(mapHeader.headerId)) {
      headerToMap.set(mapHeader.headerId, []);
    }
    headerToMap.get(mapHeader.headerId).push(mapHeader.name.toLowerCase());
  }

  const mapping = new Map();
  for (const fileHeader of fileHeaders) {
    const lower = fileHeader.toLowerCase();
    let matched = null;

    for (const th of templateHeaders) {
      const aliases = headerToMap.get(th.id) || [];
      if (aliases.includes(lower) || th.name.toLowerCase() === lower) {
        matched = th;
        break;
      }
    }

    if (matched) mapping.set(fileHeader, matched);
  }
  return mapping;
}

function deduplicateRows(data) {
  const uniqueRowHashes = new Set();
  const rowMap = new Map();
  const generateRowHash = (row) => {
    const normalizedRow = row.map(val => (val ?? '').toString().trim().toLowerCase()).join('|');
    return crypto.createHash("sha256").update(normalizedRow).digest("hex");
  }

  for (const row of data) {
    const h = generateRowHash(row);
    if (!uniqueRowHashes.has(h)) {
      uniqueRowHashes.add(h);
      rowMap.set(h, row);
    }
  }

  return rowMap;
}

function validateTextLengths(rowMap, headers, headerMapping) {
  for (const row of rowMap.values()) {
    for (const header of headers) {
      const templateHeader = headerMapping.get(header);
      if (!templateHeader || templateHeader.columnType !== "text") continue;
      const val = row[headers.indexOf(header)];
      if (val && val.length > 1000) {
        console.warn(`⚠️ Value for '${templateHeader.name}' exceeds max length`);
      }
    }
  }
}

async function ensureHeadersExist(templateHeaders, templateId, transaction, rowMap, headers) {
  const saved = [];

  for (const th of templateHeaders) {
    let header = await Header.findOne({ where: { id: th.id, templateId }, transaction });
    if (!header) {
      header = await Header.create({ ...th, templateId }, { transaction });
    }

    const existing = await SheetData.findAll({ where: { headerId: header.id }, transaction });
    const existingCount = existing.length;
    const nonNullExisting = existing.filter(d => d.value != null).length;

    let newCount = 0, newNonNull = 0;
    for (const row of rowMap.values()) {
      const val = row[headers.indexOf(header.name)];
      if (val != null) newNonNull++;
      newCount++;
    }

    const shouldUpdate = existingCount === 0 || newNonNull > nonNullExisting ||
      (newNonNull === nonNullExisting && newCount > existingCount);

    if (shouldUpdate) {
      await SheetData.destroy({ where: { headerId: header.id }, transaction });
    }

    saved.push({ header, shouldUpdate });
  }

  return saved;
}

function prepareInsertPayload(sheet, templateHeadersFromDB, dbMappings) {
  const resolvedMap = new Map();

  for (const templateHeader of templateHeadersFromDB) {
    const originalName = templateHeader.name.toLowerCase();
    const dbMappedEntry = dbMappings.find(m => m.headerId === templateHeader.id);
    const mappedName = dbMappedEntry?.name?.toLowerCase();

    let matchIndex = -1;

    if (mappedName) {
      matchIndex = sheet.headers.findIndex(h => h.toLowerCase() === mappedName);
    }

    if (matchIndex === -1) {
      matchIndex = sheet.headers.findIndex(h => h.toLowerCase() === originalName);
    }

    const columnValues = matchIndex !== -1
      ? sheet.data.map(row => row[matchIndex] ?? null)
      : [];

    resolvedMap.set(templateHeader.id, columnValues);
  }

  // 🔄 Transform map into array of row objects (one per sheet row)
  const finalPayload = [];

  const rowCount = sheet.data.length;
  for (let i = 0; i < rowCount; i++) {
    const rowObj = {};

    for (const templateHeader of templateHeadersFromDB) {
      const values = resolvedMap.get(templateHeader.id);
      rowObj[templateHeader.id] = values?.[i] ?? null;
    }

    finalPayload.push(rowObj);
  }

  return finalPayload;
}


async function saveFileAndSingleSheetData(processedFiles, templateId, mappingTemplateId, transaction) {
  const sheet = getValidSheet(processedFiles);
  const templateHeaders = await fetchTemplateHeaders(templateId, transaction);
  const mapHeaders = await fetchMapHeaders(mappingTemplateId, transaction);

  const resolvedPayload = prepareInsertPayload(sheet, templateHeaders, mapHeaders);


  const headerMapping = resolveHeaderMapping(sheet.headers, templateHeaders, mapHeaders);
  const rowMap = deduplicateRows(sheet.data);
  validateTextLengths(rowMap, sheet.headers, headerMapping);



  const savedHeaders = await ensureHeadersExist(templateHeaders, templateId, transaction, rowMap, sheet.headers);
  let rowIndex = 1;
  const sheetDataPayload = [];

  for (const row of resolvedPayload) {
    for (const { header, shouldUpdate } of savedHeaders) {
      if (!shouldUpdate) continue;

      sheetDataPayload.push({
        id: uuidv4(),
        rowIndex,
        value: row[header.id] ?? null,
        headerId: header.id
      });
    }
    rowIndex++;
  }


  console.log(`⏳ Inserting ${sheetDataPayload.length} cells from ${rowMap.size} unique rows`);
  await SheetData.bulkCreate(sheetDataPayload, { transaction });
  return { savedHeaders: savedHeaders.map(h => h.header) };
}


async function saveUniqueHeaders(processedFiles, templateId, transaction) {
  try {
    // Extract headers from processedFiles
    const headersToSave = processedFiles.flatMap(file => 
      file.sheets.flatMap(sheet => 
        sheet.headers.map(headerName => ({
          name: headerName,
          criticalityLevel: '3', // Default as per model
          columnType: 'text', // Default as per model
          templateId
        }))
      )
    );

    // Get existing headers for the template from DB
    const existingHeaders = await Header.findAll({
      where: { templateId },
      attributes: ['name'],
      transaction
    });

    // Create a Set of existing header names for quick lookup
    const existingHeaderNames = new Set(existingHeaders.map(h => h.name));

    // Filter out headers that already exist
    const uniqueHeaders = headersToSave.filter(
      header => !existingHeaderNames.has(header.name)
    );

    // Bulk create unique headers
    if (uniqueHeaders.length > 0) {
      await Header.bulkCreate(uniqueHeaders, { transaction });
    }

    return uniqueHeaders.length;
  } catch (error) {
    throw new Error(`Failed to save unique headers: ${error.message}`);
  }
}




async function uploadAndGetHeaders(req, res) {
  try {
    const { templateId, fileNames, headerOrientation, headerPosition, isRowSkipped } = req.body;
    if (!templateId || !Array.isArray(fileNames) || fileNames.length === 0) {
      return res.status(400).json({ error: 'templateId and fileNames array are required' });
    }

    // Construct file objects for headerProcessor
    const files = fileNames.map(fileName => ({
      path: path.join('uploads', templateId, fileName),
      originalname: fileName
    }));

    const processedFiles = await headerProcessor(files, headerOrientation, headerPosition, isRowSkipped);
    
    await sequelize.transaction(async (t) => {
      await saveUniqueHeaders(processedFiles, templateId, t);
    });

    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

async function uploadAndProcessData(req, res) {
  try {
    const { templateId, mappingtemplateId, fileNames } = req.body;
    if (!templateId || !mappingtemplateId) {
      return res.status(400).json({ error: 'templateId and Mapping TemplateId are required' });
    }

    // Construct file objects for headerProcessor
    const files = fileNames.map(fileName => ({
      path: path.join('uploads', templateId, fileName),
      originalname: fileName
    }));

    const processedFiles = await headerProcessor(files);
    
    await sequelize.transaction(async (t) => {
      await saveFileAndSingleSheetData(processedFiles, templateId, mappingtemplateId ,t);
    });


    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


async function processAndGetHeaderSelectedSheets(req, res) {
  try{

    const { templateId, sheetSelectionData, headerOrientation, headerPosition, isRowSkipped } = req.body;

    if (!templateId) {
      throw new Error("templateId is required");
    }
    if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
      throw new Error("sheetSelectionData must be an array");
    }

    for (const selection of sheetSelectionData) {
      if (!selection.fileName || !selection.sheets || !Array.isArray(selection.sheets)) {
        throw new Error(`Invalid sheetSelectionData: ${JSON.stringify(selection)}`);
      }
      for (const sheet of selection.sheets) {
        if (!sheet.sheetName || typeof sheet.totalHeaders !== "number") {
          throw new Error(`Invalid sheet in ${selection.fileName}: ${JSON.stringify(sheet)}`);
        }
      }
    }

    const files = [];
    for (const selection of sheetSelectionData) {
      const filePath = path.join("uploads", templateId, selection.fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      files.push({
        id: uuidv4(),
        path: filePath,
        originalname: selection.fileName,
      });
    }

    let processedFiles;
    try {
      processedFiles = await headerProcessor(files, headerOrientation, headerPosition, isRowSkipped);
    } catch (error) {
      throw new Error(`Failed to process files: ${error.message}`);
    }

    const filteredProcessedFiles = [];
    for (const selection of sheetSelectionData) {
      const processedFile = processedFiles.find((pf) => pf.fileName === selection.fileName);
      if (!processedFile) {
        throw new Error(`Processed file not found for ${selection.fileName}`);
      }

      const selectedSheets = processedFile.sheets.filter((sheet) =>
        selection.sheets.some((s) => s.sheetName === sheet.sheetName)
      );

      for (const sheet of selectedSheets) {
        const selectionSheet = selection.sheets.find((s) => s.sheetName === sheet.sheetName);
        if (selectionSheet.totalHeaders !== sheet.headers.length) {
          throw new Error(
            `Header count mismatch for ${sheet.sheetName} in ${selection.fileName}: expected ${selectionSheet.totalHeaders}, got ${sheet.headers.length}`
          );
        }
      }

      if (selectedSheets.length > 0) {
        filteredProcessedFiles.push({
          ...processedFile,
          sheets: selectedSheets,
        });
      }
    }

    if (filteredProcessedFiles.length === 0) {
      throw new Error("No valid sheets selected for processing");
    }

    await sequelize.transaction(async (t) => {
      await saveUniqueHeaders(filteredProcessedFiles, templateId, t);
    });
    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    }); 

  } catch(error) {
    res.status(500).json({error: error.message});
  }
}


async function processAndGetSheetMapHeaders(req, res) {
  const { templateId, sheetSelectionData } = req.body;
  const { mappingTemplateId } = req.params;

  if (!templateId || !mappingTemplateId) {
    return res.status(400).json({ error: 'templateId and mappingTemplateId are required' });
  }

  if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
    return res.status(400).json({ error: 'sheetSelectionData must be an array' });
  }

  // Validate sheetSelectionData
  for (const selection of sheetSelectionData) {
    if (!selection.fileName || !selection.sheets || !Array.isArray(selection.sheets)) {
      return res.status(400).json({ error: `Invalid sheetSelectionData: ${JSON.stringify(selection)}` });
    }
    for (const sheet of selection.sheets) {
      if (!sheet.sheetName || typeof sheet.totalHeaders !== 'number') {
        return res.status(400).json({ error: `Invalid sheet in ${selection.fileName}: ${JSON.stringify(sheet)}` });
      }
    }
  }

  try {
    const files = [];
    for (const selection of sheetSelectionData) {
      const filePath = path.join("uploads", templateId, selection.fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      files.push({
        id: uuidv4(),
        path: filePath,
        originalname: selection.fileName,
      });
    }

    // Step 2: Process files
    const processedFiles = await headerProcessor(files);

    // Step 3: Filter processed files to include only selected sheets
    const filteredProcessedFiles = [];
    for (const selection of sheetSelectionData) {
      const processedFile = processedFiles.find((pf) => pf.fileName === selection.fileName);
      if (!processedFile) {
        return res.status(400).json({ error: `Processed file not found for ${selection.fileName}` });
      }

      const selectedSheets = processedFile.sheets.filter((sheet) =>
        selection.sheets.some((s) => s.sheetName === sheet.sheetName)
      );

      // Validate header count
      for (const sheet of selectedSheets) {
        const selectionSheet = selection.sheets.find((s) => s.sheetName === sheet.sheetName);
        if (selectionSheet.totalHeaders !== sheet.headers.length) {
          return res.status(400).json({
            error: `Header count mismatch for ${sheet.sheetName} in ${selection.fileName}: expected ${selectionSheet.totalHeaders}, got ${sheet.headers.length}`,
          });
        }
      }

      if (selectedSheets.length > 0) {
        filteredProcessedFiles.push({
          ...processedFile,
          sheets: selectedSheets,
        });
      }
    }

    if (filteredProcessedFiles.length === 0) {
      return res.status(400).json({ error: 'No valid sheets selected for processing' });
    }

    // Step 4: Extract all unique headers from filtered processed files
    const extractedHeaders = [];
    for (const file of filteredProcessedFiles) {
      for (const sheet of file.sheets) {
        sheet.headers.forEach(header => {
          if (header) {
            extractedHeaders.push({name: header, fileBelongsTo: file.fileName,});
          }
        });
      }
    }

    // Step 5: Get existing headers from ExtractedHeader for this mappingTemplateId
    const existingExtractedHeaders = await ExtractedHeader.findAll({
      where: { mappingTemplateId },
      attributes: ['name'],
      raw: true,
    });
    const existingExtractedHeaderNames = new Set(existingExtractedHeaders.map(header => header.name));

    // Step 6: Filter out headers that already exist in ExtractedHeader
    const uniqueHeaders = extractedHeaders.filter(
      header => !existingExtractedHeaderNames.has(header.name)
    );

    // Step 7: Save unique headers to ExtractedHeader and prepare response
    await ExtractedHeader.sequelize.transaction(async (t) => {
      for (const header of uniqueHeaders) {
        const headerData = {
          id: uuidv4(),
          name: header,
          columnType: 'text',
          criticalityLevel: '3',
          mappingTemplateId,
          fileBelongsTo: header.fileBelongsTo,
        };
        await ExtractedHeader.create(headerData, { transaction: t });
      }
    });

    // Step 9: Return all headers (existing + new) for the mappingTemplateId
    const allHeaders = await ExtractedHeader.findAll({
      where: { mappingTemplateId },
      attributes: ['id', 'name', 'columnType', 'criticalityLevel', 'fileBelongsTo'],
      raw: true,
    });

    res.status(200).json(allHeaders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}



async function processAndSaveSelectedSheets(req, res) {
  try{

    const { templateId, sheetSelectionData, mappingtemplateId} = req.body;

    if (!templateId) {
      throw new Error("templateId is required");
    }
    if (!templateId) {
      throw new Error("mappingtemplateId is required");
    }
    if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
      throw new Error("sheetSelectionData must be an array");
    }

    for (const selection of sheetSelectionData) {
      if (!selection.fileName || !selection.sheets || !Array.isArray(selection.sheets)) {
        throw new Error(`Invalid sheetSelectionData: ${JSON.stringify(selection)}`);
      }
      for (const sheet of selection.sheets) {
        if (!sheet.sheetName || typeof sheet.totalHeaders !== "number") {
          throw new Error(`Invalid sheet in ${selection.fileName}: ${JSON.stringify(sheet)}`);
        }
      }
    }

    // Check for existing files in DB
    const existingFiles = await File.findAll({
      where: {
        templateId,
        filename: sheetSelectionData.map(s => s.fileName)
      },
      attributes: ['filename']
    });
    const existingFileNames = new Set(existingFiles.map(f => f.filename));

    // Filter out already existing files
    const newSelections = sheetSelectionData.filter(
      selection => !existingFileNames.has(selection.fileName)
    );

    const files = [];
    for (const selection of sheetSelectionData) {
      const filePath = path.join("uploads", templateId, selection.fileName);
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      files.push({
        id: uuidv4(),
        path: filePath,
        originalname: selection.fileName,
      });
    }

    let processedFiles;
    try {
      processedFiles = await headerProcessor(files);
    } catch (error) {
      throw new Error(`Failed to process files: ${error.message}`);
    }

    const filteredProcessedFiles = [];
    for (const selection of sheetSelectionData) {
      const processedFile = processedFiles.find((pf) => pf.fileName === selection.fileName);
      if (!processedFile) {
        throw new Error(`Processed file not found for ${selection.fileName}`);
      }

      const selectedSheets = processedFile.sheets.filter((sheet) =>
        selection.sheets.some((s) => s.sheetName === sheet.sheetName)
      );

      for (const sheet of selectedSheets) {
        const selectionSheet = selection.sheets.find((s) => s.sheetName === sheet.sheetName);
        if (selectionSheet.totalHeaders !== sheet.headers.length) {
          throw new Error(
            `Header count mismatch for ${sheet.sheetName} in ${selection.fileName}: expected ${selectionSheet.totalHeaders}, got ${sheet.headers.length}`
          );
        }
        console.log(sheet.data.length);
      }

      if (selectedSheets.length > 0) {
        filteredProcessedFiles.push({
          ...processedFile,
          sheets: selectedSheets,
        });
      }
    }

    if (filteredProcessedFiles.length === 0) {
      throw new Error("No valid sheets selected for processing");
    }

    await sequelize.transaction(async (t) => {
      await saveFileAndData(filteredProcessedFiles, templateId, mappingtemplateId ,t);
    });

    const headers = await fetchExistingHeaders(templateId);
    res.status(201).json({
      templateId,
      headers,
    }); 

  } catch(error) {
    res.status(500).json({error: error.message});
  }
}




async function getFileSheets(req, res) {
  try{
    const { templateId, headerOrientation, headerPosition } = req.body; // Assuming templateId is sent in the request body
    if (!req.files.files || req.files.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required' });
    }

    const fileNames = req.files.files.map(file => file.filename);
    const filesNames = fileNames.map(fileName => ({
      path: path.join('uploads', templateId, fileName),
      originalname: fileName
    }));

    for (const file of filesNames) {
      try {
        await File.create(
          {
            filename: file.originalname,
            templateId,
          }
        );
      } catch (createError) {
        console.error(`Failed to create File record for ${file.originalname}: ${createError.message}`);
      }
    }
    const data = await getFileSheet(req.files.files, headerOrientation, headerPosition);
    res.status(200).json(data)
  } catch(error) {
    res.status(500).json({ error: error.message })
  }
}


async function processAndCompareHeaders(req, res) {
  const { templateId, fileNames } = req.body;
  const { mappingTemplateId } = req.params;

  if (!templateId) {
    return res.status(400).json({ error: 'mappingTemplateId is required' });
  }

  try {
    // Step 1: Prepare files for processing
    const files = fileNames.map(fileName => ({
      path: path.join('uploads', templateId, fileName),
      originalname: fileName
    }));
    const processedFiles = await headerProcessor(files);

    // Step 2: Extract all unique headers from processed files
    const extractedHeaders = new Set();
    for (const file of processedFiles) {
      for (const sheet of file.sheets) {
        sheet.headers.forEach(header => {
          if (header) extractedHeaders.add(header); // Only add non-empty headers
        });
      }
    }

    // Step 3: Get existing headers from ExtractedHeader for this mappingTemplateId
    const existingExtractedHeaders = await ExtractedHeader.findAll({
      where: { mappingTemplateId},
      attributes: ['name'],
      raw: true,
    });
    const existingExtractedHeaderNames = new Set(existingExtractedHeaders.map(header => header.name));

    // Step 4: Filter out headers that already exist in ExtractedHeader
    const uniqueHeaders = Array.from(extractedHeaders).filter(
      header => !existingExtractedHeaderNames.has(header)
    );

    // Step 5: Save unique headers to ExtractedHeader and prepare response
    await ExtractedHeader.sequelize.transaction(async (t) => {
      for (const header of uniqueHeaders) {
        const headerData = {
          id: uuidv4(),
          name: header,
          columnType: 'text',
          criticalityLevel: '3',
          mappingTemplateId,
          fileBelongsTo: files[0].originalname,
        };
        await ExtractedHeader.create(headerData, { transaction: t });
      }
    });

    // Step 7: Return all headers (existing + new) for the mappingTemplateId
    const allHeaders = await ExtractedHeader.findAll({
      where: { mappingTemplateId },
      attributes: ['id', 'name', 'columnType', 'criticalityLevel', 'fileBelongsTo'],
      raw: true,
    });

    res.status(200).json(allHeaders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}


async function getExtractedHeadersByTemplateId(req, res) {
  const { mappingTemplateId } = req.query;
  if (!mappingTemplateId) {
    return res.status(400).json({ message: "Mapping Template Id is required" });
  }
  try {
    const headers = await ExtractedHeader.findAll({
      where: { mappingTemplateId },
      attributes: ['id', 'name', 'columnType', 'criticalityLevel', 'fileBelongsTo'],
      raw: true,
    });
    res.status(200).json(headers);
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
}


async function processNLP(req, res) {
  const { ruleString } = req.body;

  try{
    const result = parseRule(ruleString);
    res.status(200).json(result);
  } catch(error) {
    res.status(500).json({ error: error.message });
  }

}

async function getMissingHeaders(req, res) {
  const { templateId, mappingTemplateId, fileNames } = req.body;

  if (!templateId || !Array.isArray(fileNames) || fileNames.length === 0) {
    return res.status(400).json({ error: 'templateId and fileNames array are required' });
  }

  if (!mappingTemplateId) {
    return res.status(400).json({ error: 'mappingTemplateId is required' });
  }

  const files = fileNames.map(fileName => ({
    path: path.join('uploads', templateId, fileName),
    originalname: fileName
  }));

  try {
    const processedFiles = await headerProcessor(files);

    const headers = await Header.findAll({ where: { templateId } });

    const mapHeaders = await MapHeader.findAll({ where: { mappingTemplateId } });

    const headerMap = new Map();
    mapHeaders.forEach(mh => headerMap.set(mh.headerId, mh.name));

    const expectedNames = headers.map(h =>
      headerMap.has(h.id) ? headerMap.get(h.id) : h.name
    ).map(name => name.toLowerCase());

    const actualHeaders = processedFiles.flatMap(file =>
      file.sheets.flatMap(sheet => sheet.headers.map(h => h.toLowerCase()))
    );

    const missing = expectedNames.filter(name => !actualHeaders.includes(name));

    return res.status(200).json({ missingHeaders: [...new Set(missing)] });

  } catch (error) {
    console.error('Error in getMissingHeaders:', error);
    return res.status(500).json({ error: error.message });
  }
}


module.exports = {
  uploadAndGetHeaders,
  getFileSheets,
  processAndSaveSelectedSheets,
  processAndCompareHeaders,
  getExtractedHeadersByTemplateId,
  uploadAndProcessData,
  processAndGetHeaderSelectedSheets,
  processAndGetSheetMapHeaders,
  getMissingHeaders
};