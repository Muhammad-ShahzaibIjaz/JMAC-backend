const fs = require('fs'); // For streams
const fsPromises = require('fs').promises; // For promises
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const csv = require('csv-parser');
const { Header, MapHeader, SheetData } = require('../models');
const sequelize = require('../config/database');
const crypto = require("crypto");
const copySheetData = require("../utils/copySheetData");
const { desiredOrder } = require("../utils/headerOrderList");
const { Op, QueryTypes } = require('sequelize');

// ============ HELPER FUNCTIONS ============

function normalize(str) {
    return str?.toString().trim().toLowerCase() || '';
}

async function parseLargeCSV(filePath) {
    return new Promise((resolve, reject) => {
        const headers = [];
        const data = [];
        let headersCaptured = false;
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headerList) => {
                headers.push(...headerList);
                headersCaptured = true;
            })
            .on('data', (row) => {
                const rowArray = headers.map(h => row[h] || null);
                data.push(rowArray);
            })
            .on('end', () => {
                resolve({ headers, data });
            })
            .on('error', reject);
    });
}

function readExcelFast(filePath) {
    return XLSX.readFile(filePath, { 
        raw: true, 
        cellDates: false,
        cellNF: false,
        cellText: false
    });
}

function isRowEmpty(row) {
    if (!row || !Array.isArray(row)) return true;
    for (let i = 0; i < Math.min(row.length, 100); i++) {
        const cell = row[i];
        if (cell !== null && cell !== undefined && cell !== "") {
            return false;
        }
    }
    return true;
}

function findFirstNonEmptyRow(jsonData, startFrom = 0) {
    for (let i = startFrom; i < jsonData.length; i++) {
        if (!isRowEmpty(jsonData[i])) {
            return i;
        }
    }
    return -1;
}

function processDataRowsFast(jsonData, headerPosition = null, isRowSkipped = false) {
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length < 1) {
        return { headers: [], data: [] };
    }

    // Find header row
    const baseHeaderRowIndex = headerPosition !== null ? Number(headerPosition) : findFirstNonEmptyRow(jsonData);
    const headerRowIndex = baseHeaderRowIndex + (isRowSkipped ? 1 : 0);
    
    if (headerRowIndex === -1 || headerRowIndex >= jsonData.length) {
        return { headers: [], data: [] };
    }

    const headers = jsonData[headerRowIndex] || [];
    
    // Process data rows
    const data = [];
    let consecutiveEmptyRows = 0;
    const maxConsecutiveEmptyRows = 10;
    
    for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
        const row = jsonData[i];
        if (!Array.isArray(row) || isRowEmpty(row)) {
            consecutiveEmptyRows++;
            if (consecutiveEmptyRows >= maxConsecutiveEmptyRows) break;
            continue;
        }
        consecutiveEmptyRows = 0;
        data.push(row);
    }

    return { headers, data };
}

// ============ CORE MAPPING & MERGING LOGIC ============

/**
 * Creates a mapping from sheet headers to template headers
 * @returns Map<columnIndex, templateHeaderObject>
 */
function createColumnMapping(sheetHeaders, templateHeaders, headerMap) {
    // Build reverse lookup: any variation → template header
    const variantToTemplate = new Map();
    
    for (const templateHeader of templateHeaders) {
        const templateName = normalize(templateHeader.name);
        const mappedNames = headerMap.get(templateName) || [];
        
        // Add the template name itself
        variantToTemplate.set(templateName, templateHeader);
        
        // Add all mapped variations
        mappedNames.forEach(mappedName => {
            variantToTemplate.set(normalize(mappedName), templateHeader);
        });
    }
    
    // Map each sheet column to template header
    const columnMapping = new Map(); // columnIndex -> templateHeader
    for (let i = 0; i < sheetHeaders.length; i++) {
        const sheetHeader = normalize(sheetHeaders[i]);
        const templateHeader = variantToTemplate.get(sheetHeader);
        if (templateHeader) {
            columnMapping.set(i, templateHeader);
        }
    }
    
    return columnMapping;
}

/**
 * Find the common identifier header across all sheets
 * This is the primary key (STUDENTID) that exists in every file
 */
function findCommonIdentifierAcrossSheets(allSheets, templateHeaders, headerMap) {
    // Build reverse lookup for all header variations
    const variantToTemplateName = new Map();
    for (const templateHeader of templateHeaders) {
        const templateName = normalize(templateHeader.name);
        const mappedNames = headerMap.get(templateName) || [];
        
        variantToTemplateName.set(templateName, templateName);
        mappedNames.forEach(mappedName => {
            variantToTemplateName.set(normalize(mappedName), templateName);
        });
    }
    
    // For each sheet, find which template headers are present
    const sheetsTemplateHeaders = [];
    
    for (const sheet of allSheets) {
        const presentTemplateHeaders = new Set();
        
        for (const sheetHeader of sheet.headers) {
            const normalizedHeader = normalize(sheetHeader);
            const templateHeaderName = variantToTemplateName.get(normalizedHeader);
            if (templateHeaderName) {
                presentTemplateHeaders.add(templateHeaderName);
            }
        }
        
        sheetsTemplateHeaders.push(presentTemplateHeaders);
    }
    
    if (sheetsTemplateHeaders.length === 0) return null;
    
    // Find headers that exist in ALL sheets
    const commonHeaders = [...sheetsTemplateHeaders[0]];
    for (let i = 1; i < sheetsTemplateHeaders.length; i++) {
        const currentSheetHeaders = sheetsTemplateHeaders[i];
        for (let j = 0; j < commonHeaders.length; j++) {
            if (!currentSheetHeaders.has(commonHeaders[j])) {
                commonHeaders.splice(j, 1);
                j--;
            }
        }
        if (commonHeaders.length === 0) break;
    }
    
    if (commonHeaders.length === 0) return null;
    
    // Prefer STUDENTID or criticality level 1
    const sortedHeaders = templateHeaders
        .filter(th => commonHeaders.includes(normalize(th.name)))
        .sort((a, b) => {
            // Prioritize STUDENTID or criticality level 1
            const aIsPrimary = normalize(a.name) === 'studentid' || a.criticalityLevel === '1';
            const bIsPrimary = normalize(b.name) === 'studentid' || b.criticalityLevel === '1';
            if (aIsPrimary && !bIsPrimary) return -1;
            if (!aIsPrimary && bIsPrimary) return 1;
            return 0;
        });
    
    return sortedHeaders.length > 0 ? sortedHeaders[0].name : commonHeaders[0];
}

/**
 * Merge data from multiple sheets based on the common identifier (STUDENTID)
 * This does a FULL OUTER JOIN-like operation across all files
 */
function mergeDataAcrossSheets(allSheets, commonIdentifierName, templateHeaders, headerMap) {
    const mergedData = new Map(); // identifier value -> Map<templateHeaderId, value>
    
    // Build reverse lookup for header mapping
    const variantToTemplate = new Map();
    for (const templateHeader of templateHeaders) {
        const templateName = normalize(templateHeader.name);
        const mappedNames = headerMap.get(templateName) || [];
        
        variantToTemplate.set(templateName, templateHeader);
        mappedNames.forEach(mappedName => {
            variantToTemplate.set(normalize(mappedName), templateHeader);
        });
    }
    
    // Process each sheet
    for (const sheet of allSheets) {
        // Find which column is the common identifier in this sheet
        let identifierColumnIndex = -1;
        const columnToTemplateMap = new Map(); // column index -> template header
        
        for (let i = 0; i < sheet.headers.length; i++) {
            const sheetHeader = normalize(sheet.headers[i]);
            const templateHeader = variantToTemplate.get(sheetHeader);
            
            if (templateHeader) {
                columnToTemplateMap.set(i, templateHeader);
                
                // Check if this is our common identifier column
                if (normalize(templateHeader.name) === normalize(commonIdentifierName)) {
                    identifierColumnIndex = i;
                }
            }
        }
        
        // Skip sheet if it doesn't have the common identifier
        if (identifierColumnIndex === -1) {
            console.warn(`⚠️ Sheet "${sheet.sheetName}" in "${sheet.fileName}" missing common identifier "${commonIdentifierName}", skipping`);
            continue;
        }
        
        console.log(`📊 Processing "${sheet.fileName}" - ${sheet.sheetName} (${sheet.data.length} rows)`);
        
        // Process each row in this sheet
        let rowsProcessed = 0;
        for (const row of sheet.data) {
            const identifierValue = row[identifierColumnIndex];
            
            // Skip rows without identifier
            if (identifierValue === null || identifierValue === undefined || identifierValue === '') {
                continue;
            }
            
            const identifierKey = identifierValue.toString();
            rowsProcessed++;
            
            // Initialize record if not exists
            if (!mergedData.has(identifierKey)) {
                mergedData.set(identifierKey, new Map());
            }
            
            const record = mergedData.get(identifierKey);
            
            // Add all data from this row to the record
            for (const [colIndex, templateHeader] of columnToTemplateMap.entries()) {
                const value = row[colIndex];
                
                // Only set if value exists and we haven't set it yet (first file wins)
                // Or we want to allow overwrites from more reliable sources
                if (value !== null && value !== undefined && value !== '') {
                    if (!record.has(templateHeader.id)) {
                        record.set(templateHeader.id, value.toString());
                    }
                }
            }
        }
        
        console.log(`   ✅ Processed ${rowsProcessed} rows with identifier`);
    }
    
    return mergedData;
}

/**
 * Convert merged data to array format for display/debugging
 */
function mergedDataToArray(mergedData, templateHeaders) {
    const result = [];
    const templateHeaderMap = new Map(templateHeaders.map(h => [h.id, h.name]));
    
    for (const [identifier, dataMap] of mergedData.entries()) {
        const row = { identifier };
        for (const [headerId, value] of dataMap.entries()) {
            const headerName = templateHeaderMap.get(headerId);
            if (headerName) {
                row[headerName] = value;
            }
        }
        result.push(row);
    }
    
    return result;
}

// ============ MAIN PROCESSING FUNCTIONS ============

async function headerProcessorFast(files) {
    const processedFiles = [];
    
    for (const file of files) {
        console.log(`📁 Processing file: ${file.originalname}`);
        const startTime = Date.now();
        
        try {
            let headers = [];
            let data = [];
            
            // Handle CSV files
            if (file.originalname.endsWith(".csv")) {
                const fileStat = await fsPromises.stat(file.path);
                const isLargeFile = fileStat.size > 50 * 1024 * 1024; // > 50MB
                
                if (isLargeFile) {
                    const result = await parseLargeCSV(file.path);
                    headers = result.headers;
                    data = result.data;
                } else {
                    const csvData = await fsPromises.readFile(file.path, "utf8");
                    const workbook = XLSX.read(csvData, { type: "string", raw: true });
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: true });
                    const processed = processDataRowsFast(jsonData);
                    headers = processed.headers;
                    data = processed.data;
                }
            } 
            // Handle Excel files
            else {
                const workbook = readExcelFast(file.path);
                const sheets = [];
                
                for (const sheetName of workbook.SheetNames) {
                    const worksheet = workbook.Sheets[sheetName];
                    if (!worksheet) continue;
                    
                    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null, raw: true });
                    const processed = processDataRowsFast(jsonData);
                    
                    if (processed.headers.length > 0) {
                        sheets.push({
                            sheetName,
                            headers: processed.headers,
                            data: processed.data
                        });
                    }
                }
                
                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(`   ✅ Processed ${sheets.length} sheets in ${elapsed}s`);
                
                processedFiles.push({
                    id: uuidv4(),
                    fileName: file.originalname,
                    sheets
                });
                continue;
            }
            
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
            console.log(`   ✅ Extracted ${headers.length} headers and ${data.length} rows in ${elapsed}s`);
            
            processedFiles.push({
                id: uuidv4(),
                fileName: file.originalname,
                sheets: [{
                    sheetName: "Sheet1",
                    headers,
                    data
                }]
            });
            
        } catch (error) {
            throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
        }
    }
    
    return processedFiles;
}

async function getTemplateAndMappings(templateId, mappingTemplateId, isOriginal, transaction) {
    const templateHeaders = await Header.findAll({ where: { templateId }, transaction });
    
    const headerMap = new Map(); // templateHeader.name -> [mappedNames]
    
    if (mappingTemplateId && isOriginal) {
        const mapHeaders = await MapHeader.findAll({ where: { mappingTemplateId }, transaction });
        
        for (const th of templateHeaders) {
            const mapped = mapHeaders
                .filter(mh => mh.headerId === th.id)
                .map(mh => mh.name.trim().toLowerCase());
            headerMap.set(th.name.toLowerCase(), mapped);
        }
    } else {
        // If no mapping, each header maps only to itself
        for (const th of templateHeaders) {
            headerMap.set(th.name.toLowerCase(), [th.name.toLowerCase()]);
        }
    }
    
    return { templateHeaders, headerMap };
}

async function saveMergedData(mergedData, templateHeaders, sheetId, transaction) {
    // Step 1: Prepare the new merged data
    const newRecords = [];
    let globalRowIndex = 0;
    
    // Create a map to track which rowIndex each student ID maps to
    const studentToRowIndex = new Map();
    for (const [identifierValue, record] of mergedData.entries()) {
        studentToRowIndex.set(identifierValue, globalRowIndex);
        
        for (const [headerId, value] of record.entries()) {
            newRecords.push({
                headerId: headerId,
                rowIndex: globalRowIndex,
                value: value,
                sheetId: sheetId
            });
        }
        globalRowIndex++;
    }
    console.log(`💾 Processing ${mergedData.size} unique student records (${newRecords.length} total cell values)`);
    console.log(`   Row range: 0 to ${globalRowIndex - 1}`);
    // Step 2: Fetch ALL existing records for this sheet
    const existingRecords = await SheetData.findAll({
        where: { sheetId: sheetId },
        transaction,
        attributes: ['id', 'headerId', 'rowIndex', 'value']
    });
    console.log(`   Found ${existingRecords.length.toLocaleString()} existing records in database`);
    
    // Step 3: Build lookup maps for existing data
    const existingMap = new Map(); // key: "headerId|rowIndex" -> {id, value}
    for (const record of existingRecords) {
        const key = `${record.headerId}|${record.rowIndex}`;
        existingMap.set(key, {
            id: record.id,
            value: record.value
        });
    }
    // Step 4: Prepare operations
    const recordsToInsert = [];
    const recordsToUpdate = [];
    let totalSkipped = 0;
    let totalUpdated = 0;
    let totalInserted = 0;
    for (const newRecord of newRecords) {
        const key = `${newRecord.headerId}|${newRecord.rowIndex}`;
        const existing = existingMap.get(key);
        const newValue = newRecord.value;
        
        if (!existing) {
            // No existing record - insert new
            recordsToInsert.push({
                id: uuidv4(),
                rowIndex: newRecord.rowIndex,
                value: newValue,
                headerId: newRecord.headerId,
                sheetId: sheetId,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        } else {
            // Record exists - check if we need to update
            const existingValue = existing.value;
            
            // Only update if existing value is empty/null AND new value has data
            const shouldUpdate = (!existingValue || existingValue === '') && 
                                 newValue && newValue !== '';
            
            if (shouldUpdate) {
                recordsToUpdate.push({
                    id: existing.id,
                    value: newValue,
                    updatedAt: new Date()
                });
                totalUpdated++;
            } else {
                totalSkipped++;
            }
        }
    }
    // Step 5: Execute inserts
    if (recordsToInsert.length > 0) {
        const insertChunkSize = 100000;
        for (let i = 0; i < recordsToInsert.length; i += insertChunkSize) {
            const chunk = recordsToInsert.slice(i, i + insertChunkSize);
            await SheetData.bulkCreate(chunk, { transaction });
            totalInserted += chunk.length;
        }
        console.log(`   ✅ Inserted ${recordsToInsert.length.toLocaleString()} new records`);
    }
    
    // Step 6: Execute updates
    if (recordsToUpdate.length > 0) {
        const updateChunkSize = 100000;
        for (let i = 0; i < recordsToUpdate.length; i += updateChunkSize) {
            const chunk = recordsToUpdate.slice(i, i + updateChunkSize);
            
            // Batch updates using Promise.all for better performance
            const updatePromises = chunk.map(updateRecord => 
                SheetData.update(
                    { value: updateRecord.value, updatedAt: updateRecord.updatedAt },
                    { where: { id: updateRecord.id }, transaction }
                )
            );
            await Promise.all(updatePromises);
            
            if (i % 100000 === 0) {
                console.log(`      Updated ${Math.min(i + updateChunkSize, recordsToUpdate.length).toLocaleString()}/${recordsToUpdate.length.toLocaleString()} records...`);
            }
        }
        console.log(`   🔄 Updated ${recordsToUpdate.length.toLocaleString()} records (filled empty values)`);
    }
    
    // Step 7: Summary
    console.log(`\n📊 Final Results for Sheet ${sheetId}:`);
    console.log(`   ✨ Inserted: ${totalInserted.toLocaleString()} new cell records`);
    console.log(`   🔄 Updated: ${totalUpdated.toLocaleString()} records (empty → filled)`);
    console.log(`   ⏭️ Skipped: ${totalSkipped.toLocaleString()} records (already had values)`);
    console.log(`   📊 Total students: ${mergedData.size.toLocaleString()}`);
    console.log(`   📊 Total cells: ${newRecords.length.toLocaleString()}`);
    
    return { 
        totalRecords: mergedData.size, 
        totalValues: newRecords.length,
        inserted: totalInserted,
        updated: totalUpdated,
        skipped: totalSkipped
    };
}

// ============ MAIN CONTROLLER ============

async function processAndSaveSelectedSheets(req, res) {
    const startTime = Date.now();
    
    try {
        const { templateId, sheetSelectionData, mappingtemplateId, sheetId, isOriginal = false } = req.body;
        
        // Validation
        if (!templateId) throw new Error("templateId is required");
        if (!mappingtemplateId || !sheetId) throw new Error("mappingtemplateId and sheetId are required");
        if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
            throw new Error("sheetSelectionData must be an array");
        }
        
        console.log(`\n🚀 Starting merge process for template: ${templateId}`);
        console.log(`📋 Using mapping template: ${mappingtemplateId}`);
        
        // Prepare file list
        const files = [];
        for (const selection of sheetSelectionData) {
            const filePath = path.join("uploads", templateId, sheetId, selection.fileName);
            
            // Check if file exists
            try {
                await fsPromises.access(filePath);
            } catch {
                throw new Error(`File not found: ${filePath}`);
            }
            
            files.push({
                path: filePath,
                originalname: selection.fileName,
                sheetId
            });
        }
        
        // Step 1: Process all files and extract data
        console.log("\n📂 Step 1: Processing files...");
        const processedFiles = await headerProcessorFast(files);
        
        // Step 2: Filter only selected sheets
        const allSheets = [];
        for (const selection of sheetSelectionData) {
            const processedFile = processedFiles.find(pf => pf.fileName === selection.fileName);
            if (!processedFile) {
                throw new Error(`Processed file not found for ${selection.fileName}`);
            }
            
            const selectedSheets = processedFile.sheets.filter(sheet =>
                selection.sheets.some(s => s.sheetName === sheet.sheetName)
            );
            
            for (const sheet of selectedSheets) {
                const selectionSheet = selection.sheets.find(s => s.sheetName === sheet.sheetName);
                
                // Validate header count if provided
                if (selectionSheet?.totalHeaders && selectionSheet.totalHeaders !== sheet.headers.length) {
                    throw new Error(
                        `Header count mismatch for ${sheet.sheetName} in ${selection.fileName}: ` +
                        `expected ${selectionSheet.totalHeaders}, got ${sheet.headers.length}`
                    );
                }
                
                allSheets.push({
                    fileName: selection.fileName,
                    sheetName: sheet.sheetName,
                    headers: sheet.headers,
                    data: sheet.data
                });
            }
        }
        
        if (allSheets.length === 0) {
            throw new Error("No valid sheets selected for processing");
        }
        
        console.log(`\n📊 Step 2: Loaded ${allSheets.length} sheets for merging`);
        
        // Step 3: Get template and mapping configurations
        console.log("🔧 Step 3: Loading template and mappings...");
        const { templateHeaders, headerMap } = await getTemplateAndMappings(
            templateId, 
            mappingtemplateId, 
            isOriginal, 
            null // Transaction will be started in the next step
        );
        
        console.log(`   📋 Template has ${templateHeaders.length} headers`);
        console.log(`   🔗 Mapping has ${headerMap.size} mapped headers`);
        
        // Step 4: Find common identifier across all sheets
        console.log("\n🔍 Step 4: Finding common identifier across all files...");
        const commonIdentifier = findCommonIdentifierAcrossSheets(allSheets, templateHeaders, headerMap);
        
        if (!commonIdentifier) {
            throw new Error(
                "❌ No common header found across all sheets. " +
                "Make sure each file has at least one header that maps to the same template header (e.g., STUDENTID)."
            );
        }
        
        console.log(`   ✅ Common identifier found: "${commonIdentifier}"`);
        
        // Step 5: Merge data based on common identifier
        console.log("\n🔗 Step 5: Merging data across all files...");
        const mergeStartTime = Date.now();
        const mergedData = mergeDataAcrossSheets(allSheets, commonIdentifier, templateHeaders, headerMap);
        const mergeTime = ((Date.now() - mergeStartTime) / 1000).toFixed(2);
        
        console.log(`   ✅ Merged into ${mergedData.size} unique records in ${mergeTime}s`);
        
        // Optional: Show sample of merged data
        const sampleData = mergedDataToArray(mergedData, templateHeaders).slice(0, 5);
        if (sampleData.length > 0) {
            console.log("\n📋 Sample of merged data:");
            console.table(sampleData);
        }
        
        // Step 6: Save to database
        console.log("\n💾 Step 6: Saving to database...");
        await sequelize.transaction(async (t) => {
            const result = await saveMergedData(mergedData, templateHeaders, sheetId, t);
            console.log(`   ✅ Saved ${result.totalRecords} records with ${result.totalValues} values`);
        });
        
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✨ Complete! Total processing time: ${totalTime} seconds`);
        
        res.status(201).json({
            success: true,
            templateId,
            commonIdentifier,
            totalRecords: mergedData.size,
            processingTime: `${totalTime}s`
        });
        
    } catch (error) {
        console.error("❌ Processing error:", error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = { processAndSaveSelectedSheets };