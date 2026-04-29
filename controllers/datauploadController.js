const fs = require('fs');
const fsPromises = require('fs').promises;
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

function hasValue(v) {
    return v !== null && v !== undefined && v.toString().trim() !== '';
}

// Normalize identifier values for matching. Strip leading zeros so that
// "078103480" (mac SLATE_ID) and "78103480" (slate Student_ID) match.
function normalizeIdValue(v) {
    if (!hasValue(v)) return '';
    const s = v.toString().trim();
    const stripped = s.replace(/^0+/, '');
    return stripped === '' ? '0' : stripped;
}

async function parseLargeCSV(filePath) {
    return new Promise((resolve, reject) => {
        const headers = [];
        const data = [];
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('headers', (headerList) => { headers.push(...headerList); })
            .on('data', (row) => {
                const rowArray = headers.map(h => row[h] || null);
                data.push(rowArray);
            })
            .on('end', () => resolve({ headers, data }))
            .on('error', reject);
    });
}

function readExcelFast(filePath) {
    return XLSX.readFile(filePath, {
        raw: true, cellDates: false, cellNF: false, cellText: false
    });
}

function isRowEmpty(row) {
    if (!row || !Array.isArray(row)) return true;
    for (let i = 0; i < Math.min(row.length, 100); i++) {
        const cell = row[i];
        if (cell !== null && cell !== undefined && cell !== "") return false;
    }
    return true;
}

function findFirstNonEmptyRow(jsonData, startFrom = 0) {
    for (let i = startFrom; i < jsonData.length; i++) {
        if (!isRowEmpty(jsonData[i])) return i;
    }
    return -1;
}

function processDataRowsFast(jsonData, headerPosition = null, isRowSkipped = false) {
    if (!jsonData || !Array.isArray(jsonData) || jsonData.length < 1) {
        return { headers: [], data: [] };
    }

    const baseHeaderRowIndex = headerPosition !== null
        ? Number(headerPosition)
        : findFirstNonEmptyRow(jsonData);
    const headerRowIndex = baseHeaderRowIndex + (isRowSkipped ? 1 : 0);

    if (headerRowIndex === -1 || headerRowIndex >= jsonData.length) {
        return { headers: [], data: [] };
    }

    const headers = jsonData[headerRowIndex] || [];
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
 * Build a lookup: any sheet header (or alias) -> the template header it maps to.
 */
function buildVariantToTemplateMap(templateHeaders, headerMap) {
    const variantToTemplate = new Map();
    for (const templateHeader of templateHeaders) {
        const templateName = normalize(templateHeader.name);
        const aliases = headerMap.get(templateName) || [];
        variantToTemplate.set(templateName, templateHeader);
        aliases.forEach(alias => {
            variantToTemplate.set(normalize(alias), templateHeader);
        });
    }
    return variantToTemplate;
}

/**
 * Pick join-key candidates in priority order.
 *
 * The OLD code looked for one common header in every sheet. That broke when
 * different files use different ID systems (slate has Slate IDs, mac has
 * Jenzabar IDs).
 *
 * The NEW approach: pick *every* identifier-like template field that exists
 * in at least one sheet, ranked by priority:
 *   1. Student_ID
 *   2. Alternate_Student_ID
 *   3. Any field with criticalityLevel === '1'
 *
 * For each row we collect every identifier and try to link by ANY of them.
 */
function findJoinKeyCandidates(allSheets, templateHeaders, headerMap) {
    const variantToTemplate = buildVariantToTemplateMap(templateHeaders, headerMap);

    const presentFields = new Set();
    for (const sheet of allSheets) {
        for (const sheetHeader of sheet.headers) {
            const th = variantToTemplate.get(normalize(sheetHeader));
            if (th) presentFields.add(normalize(th.name));
        }
    }

    const candidates = templateHeaders
        .filter(th => presentFields.has(normalize(th.name)))
        .map(th => {
            const n = normalize(th.name);
            let priority = 100;
            if (n === 'student_id' || n === 'studentid') priority = 1;
            else if (n === 'alternate_student_id') priority = 2;
            else if (th.criticalityLevel === '1') priority = 3;
            return { templateHeader: th, priority };
        })
        .filter(c => c.priority <= 3)
        .sort((a, b) => a.priority - b.priority);

    return candidates.map(c => c.templateHeader);
}

/**
 * Merge data from all sheets into one Map keyed by a synthetic unifiedKey.
 *
 * KEY MATCHING RULES:
 *   - For each row we collect every "identifier value" from any join-candidate
 *     column, normalize it (trim + strip leading zeros), and look it up in a
 *     SHARED namespace (no template-field prefix).
 *   - This is what makes cross-system linking work: slate's Student_ID column
 *     might hold "78103480" and mac's SLATE_ID column might hold "078103480".
 *     Both normalize to "78103480" and match.
 *
 *   - If ANY of a row's identifiers matches an existing student, we merge into
 *     that student. If multiple existing students get hit (e.g. row has IDs A
 *     and B, and there were already separate students for A and B), we
 *     combine them into one — that's the point of having multiple identifiers.
 *
 *   - If no match, the row creates a new student. If the row has NO usable
 *     identifier at all, it still becomes a new student via a synthetic key
 *     (so we don't lose people who happen to be missing IDs in this export).
 *
 * CELL-VALUE MERGE RULE:
 *   - Empty values never overwrite a real value.
 *   - Non-empty values overwrite earlier ones (later sheet wins).
 *   - Sheets are processed in deterministic filename order so "later" is stable.
 */
function mergeDataAcrossSheets(allSheets, joinCandidates, templateHeaders, headerMap) {
    const variantToTemplate = buildVariantToTemplateMap(templateHeaders, headerMap);
    const joinCandidateNames = new Set(joinCandidates.map(c => normalize(c.name)));

    // unifiedKey -> { ids: Set<normalizedId>, data: Map<headerId, value>, hasRealId: bool }
    const studentsByKey = new Map();
    // normalizedId -> unifiedKey (shared namespace across all join fields)
    const idToKey = new Map();

    let syntheticCounter = 0;

    function mergeStudent(targetKey, sourceKey) {
        if (targetKey === sourceKey) return;
        const target = studentsByKey.get(targetKey);
        const source = studentsByKey.get(sourceKey);
        if (!source) return;

        // Move all ids from source to target
        for (const id of source.ids) {
            target.ids.add(id);
            idToKey.set(id, targetKey);
        }

        // Merge cell values. Source was processed earlier in iteration so
        // target's values win for duplicates (preserves "later sheet wins").
        for (const [headerId, value] of source.data.entries()) {
            if (!target.data.has(headerId)) {
                target.data.set(headerId, value);
            }
        }

        target.hasRealId = target.hasRealId || source.hasRealId;
        studentsByKey.delete(sourceKey);
    }

    // Deterministic file order
    const sortedSheets = [...allSheets].sort((a, b) => {
        const fc = a.fileName.localeCompare(b.fileName);
        return fc !== 0 ? fc : a.sheetName.localeCompare(b.sheetName);
    });

    for (const sheet of sortedSheets) {
        // colIndex -> templateHeader (every mappable column)
        const columnToTemplateMap = new Map();
        // List of column indices that hold join-candidate values.
        // We register EVERY occurrence (not just first), because a single sheet
        // can have e.g. two columns that both map to Student_ID and they may
        // hold different real values.
        const joinColumnIndices = [];

        for (let i = 0; i < sheet.headers.length; i++) {
            const sheetHeader = normalize(sheet.headers[i]);
            const th = variantToTemplate.get(sheetHeader);
            if (!th) continue;

            // For cell-value mapping, first occurrence per template header wins.
            // (Otherwise the second column's value overwrites the first within
            // a single row, which we don't want for non-join fields.)
            if (!columnToTemplateMap.has(i) &&
                ![...columnToTemplateMap.values()].some(v => v.id === th.id)) {
                columnToTemplateMap.set(i, th);
            } else if (!joinCandidateNames.has(normalize(th.name))) {
                // Non-join duplicate column — skip for cell value writing,
                // first occurrence stays.
            } else {
                // It's a duplicate of a join candidate: still register the
                // column so we can use it as an identifier (see below), but
                // don't overwrite the cell-value mapping.
            }

            // Register every occurrence as a join column if it's a candidate
            if (joinCandidateNames.has(normalize(th.name))) {
                joinColumnIndices.push(i);
            }
        }

        console.log(`📊 Processing "${sheet.fileName}" - ${sheet.sheetName} (${sheet.data.length} rows) [${joinColumnIndices.length} id columns]`);

        let rowsMergedIntoExisting = 0;
        let rowsCreatedNew = 0;
        let rowsKeptWithoutId = 0;

        for (const row of sheet.data) {
            // Collect every normalized identifier value from this row
            const rowIds = new Set();
            for (const ci of joinColumnIndices) {
                const raw = row[ci];
                if (!hasValue(raw)) continue;
                const norm = normalizeIdValue(raw);
                if (norm) rowIds.add(norm);
            }

            // Find every existing student that any of these ids points to
            const matchingKeys = new Set();
            for (const id of rowIds) {
                const k = idToKey.get(id);
                if (k) matchingKeys.add(k);
            }

            let unifiedKey;
            if (matchingKeys.size === 0) {
                // No existing match — create a new student
                unifiedKey = uuidv4();
                const hasRealId = rowIds.size > 0;
                if (!hasRealId) {
                    syntheticCounter++;
                    rowsKeptWithoutId++;
                    // synthetic id ensures uniqueness — never collides with a real id
                    rowIds.add(`__synth__::${sheet.fileName}::${sheet.sheetName}::${syntheticCounter}`);
                } else {
                    rowsCreatedNew++;
                }
                studentsByKey.set(unifiedKey, {
                    ids: new Set(),
                    data: new Map(),
                    hasRealId
                });
            } else {
                // One or more matches — pick the first as the target,
                // merge any others into it. This handles the case where
                // a row's IDs link two previously-separate student records.
                const keysArray = [...matchingKeys];
                unifiedKey = keysArray[0];
                for (let k = 1; k < keysArray.length; k++) {
                    mergeStudent(unifiedKey, keysArray[k]);
                }
                rowsMergedIntoExisting++;
            }

            const record = studentsByKey.get(unifiedKey);

            // Register all of this row's ids -> unifiedKey
            for (const id of rowIds) {
                record.ids.add(id);
                idToKey.set(id, unifiedKey);
            }

            // Copy cell values. Non-empty values from the current sheet
            // overwrite earlier values (later sheet wins).
            for (const [colIndex, templateHeader] of columnToTemplateMap.entries()) {
                const value = row[colIndex];
                if (hasValue(value)) {
                    record.data.set(templateHeader.id, value.toString().trim());
                }
            }
        }

        console.log(`   ✅ merged-into-existing: ${rowsMergedIntoExisting}, new: ${rowsCreatedNew}, kept-without-id: ${rowsKeptWithoutId}`);
    }

    console.log(`\n🧮 Total unique students kept: ${studentsByKey.size}`);
    return studentsByKey;
}

function mergedDataToArray(studentsByKey, templateHeaders, limit = 5) {
    const idToName = new Map(templateHeaders.map(h => [h.id, h.name]));
    const result = [];
    let i = 0;
    for (const [unifiedKey, student] of studentsByKey.entries()) {
        if (i >= limit) break;
        const row = {
            _key: unifiedKey.slice(0, 8),
            _ids: [...student.ids].filter(s => !s.startsWith('__synth__')).slice(0, 3).join(' | ') || '(no id)'
        };
        for (const [headerId, value] of student.data.entries()) {
            const name = idToName.get(headerId);
            if (name) row[name] = value;
        }
        result.push(row);
        i++;
    }
    return result;
}

// ============ FILE READING ============

async function headerProcessorFast(files) {
    const processedFiles = [];

    for (const file of files) {
        console.log(`📁 Processing file: ${file.originalname}`);
        const startTime = Date.now();

        try {
            let headers = [];
            let data = [];

            if (file.originalname.endsWith(".csv")) {
                const fileStat = await fsPromises.stat(file.path);
                const isLargeFile = fileStat.size > 50 * 1024 * 1024;

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

                const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
                console.log(`   ✅ Extracted ${headers.length} headers and ${data.length} rows in ${elapsed}s`);

                processedFiles.push({
                    id: uuidv4(),
                    fileName: file.originalname,
                    sheets: [{ sheetName: "Sheet1", headers, data }]
                });
            } else {
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

                processedFiles.push({ id: uuidv4(), fileName: file.originalname, sheets });
            }
        } catch (error) {
            throw new Error(`Failed to process file ${file.originalname}: ${error.message}`);
        }
    }

    return processedFiles;
}

async function getTemplateAndMappings(templateId, mappingTemplateId, isOriginal, transaction) {
    const templateHeaders = await Header.findAll({ where: { templateId }, transaction });
    const headerMap = new Map();

    if (mappingTemplateId && isOriginal) {
        const mapHeaders = await MapHeader.findAll({ where: { mappingTemplateId }, transaction });
        for (const th of templateHeaders) {
            const aliases = mapHeaders
                .filter(mh => mh.headerId === th.id)
                .map(mh => mh.name.trim().toLowerCase());
            headerMap.set(th.name.toLowerCase(), aliases);
        }
    } else {
        for (const th of templateHeaders) {
            headerMap.set(th.name.toLowerCase(), [th.name.toLowerCase()]);
        }
    }

    return { templateHeaders, headerMap };
}

/**
 * Save merged data. rowIndex is assigned by sorting students deterministically:
 *   - students WITH a real id come first, sorted by their smallest id value
 *   - students WITHOUT a real id come last (synthetic keys, alphabetical)
 * This way the same student lands on the same rowIndex across re-uploads.
 */
async function saveMergedData(studentsByKey, templateHeaders, sheetId, transaction) {
    // Pick a stable sort key for each student
    const stable = [...studentsByKey.entries()].map(([key, student]) => {
        // Real ids only (filter out synthetic ones)
        const realIds = [...student.ids].filter(id => !id.startsWith('__synth__'));
        const sortKey = realIds.length > 0
            ? realIds.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0]
            : null;
        return { key, student, sortKey };
    });

    stable.sort((a, b) => {
        // Real-id students first
        if (a.sortKey && !b.sortKey) return -1;
        if (!a.sortKey && b.sortKey) return 1;
        if (a.sortKey && b.sortKey) {
            return a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true });
        }
        // Both synthetic — sort by unifiedKey for stability within a single run
        return a.key.localeCompare(b.key);
    });

    const newRecords = [];
    stable.forEach(({ student }, idx) => {
        for (const [headerId, value] of student.data.entries()) {
            newRecords.push({ headerId, rowIndex: idx, value, sheetId });
        }
    });

    console.log(`💾 Saving ${studentsByKey.size} students (${newRecords.length} cell values)`);
    console.log(`   Row range: 0 to ${stable.length - 1}`);

    const existingRecords = await SheetData.findAll({
        where: { sheetId },
        transaction,
        attributes: ['id', 'headerId', 'rowIndex', 'value']
    });
    console.log(`   Found ${existingRecords.length.toLocaleString()} existing records in DB`);

    const existingMap = new Map();
    for (const record of existingRecords) {
        existingMap.set(`${record.headerId}|${record.rowIndex}`, {
            id: record.id, value: record.value
        });
    }

    const recordsToInsert = [];
    const recordsToUpdate = [];
    let totalSkipped = 0;

    for (const newRecord of newRecords) {
        const key = `${newRecord.headerId}|${newRecord.rowIndex}`;
        const existing = existingMap.get(key);
        const newValue = newRecord.value;

        if (!existing) {
            recordsToInsert.push({
                id: uuidv4(),
                rowIndex: newRecord.rowIndex,
                value: newValue,
                headerId: newRecord.headerId,
                sheetId,
                createdAt: new Date(),
                updatedAt: new Date()
            });
        } else {
            const shouldUpdate = hasValue(newValue) && newValue !== existing.value;
            if (shouldUpdate) {
                recordsToUpdate.push({
                    id: existing.id,
                    value: newValue,
                    updatedAt: new Date()
                });
            } else {
                totalSkipped++;
            }
        }
    }

    let totalInserted = 0;
    if (recordsToInsert.length > 0) {
        const insertChunkSize = 100000;
        for (let i = 0; i < recordsToInsert.length; i += insertChunkSize) {
            const chunk = recordsToInsert.slice(i, i + insertChunkSize);
            await SheetData.bulkCreate(chunk, { transaction });
            totalInserted += chunk.length;
        }
        console.log(`   ✅ Inserted ${totalInserted.toLocaleString()} new records`);
    }

    let totalUpdated = 0;
    if (recordsToUpdate.length > 0) {
        const updateChunkSize = 1000;
        for (let i = 0; i < recordsToUpdate.length; i += updateChunkSize) {
            const chunk = recordsToUpdate.slice(i, i + updateChunkSize);
            const updatePromises = chunk.map(r =>
                SheetData.update(
                    { value: r.value, updatedAt: r.updatedAt },
                    { where: { id: r.id }, transaction }
                )
            );
            await Promise.all(updatePromises);
            totalUpdated += chunk.length;

            if (i % 10000 === 0 && i > 0) {
                console.log(`      Updated ${Math.min(i + updateChunkSize, recordsToUpdate.length).toLocaleString()}/${recordsToUpdate.length.toLocaleString()}`);
            }
        }
        console.log(`   🔄 Updated ${totalUpdated.toLocaleString()} records`);
    }

    console.log(`\n📊 Save summary for sheet ${sheetId}:`);
    console.log(`   ✨ Inserted: ${totalInserted.toLocaleString()}`);
    console.log(`   🔄 Updated:  ${totalUpdated.toLocaleString()}`);
    console.log(`   ⏭️  Skipped:  ${totalSkipped.toLocaleString()}`);
    console.log(`   👥 Students: ${studentsByKey.size.toLocaleString()}`);

    return {
        totalRecords: studentsByKey.size,
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

        if (!templateId) throw new Error("templateId is required");
        if (!mappingtemplateId || !sheetId) throw new Error("mappingtemplateId and sheetId are required");
        if (!sheetSelectionData || !Array.isArray(sheetSelectionData)) {
            throw new Error("sheetSelectionData must be an array");
        }

        console.log(`\n🚀 Starting merge for template: ${templateId}`);
        console.log(`📋 Mapping template: ${mappingtemplateId}`);

        const files = [];
        for (const selection of sheetSelectionData) {
            const filePath = path.join("uploads", templateId, sheetId, selection.fileName);
            try {
                await fsPromises.access(filePath);
            } catch {
                throw new Error(`File not found: ${filePath}`);
            }
            files.push({ path: filePath, originalname: selection.fileName, sheetId });
        }

        console.log("\n📂 Step 1: Parsing files...");
        const processedFiles = await headerProcessorFast(files);

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

        console.log("🔧 Step 3: Loading template and mappings...");
        const { templateHeaders, headerMap } = await getTemplateAndMappings(
            templateId, mappingtemplateId, isOriginal, null
        );
        console.log(`   📋 Template fields: ${templateHeaders.length}`);
        console.log(`   🔗 Mapped fields:   ${headerMap.size}`);

        console.log("\n🔍 Step 4: Finding join-key candidates...");
        const joinCandidates = findJoinKeyCandidates(allSheets, templateHeaders, headerMap);

        if (joinCandidates.length === 0) {
            console.warn("⚠️  No join-key candidates found. Every row will be a separate student.");
        } else {
            console.log(`   ✅ Join candidates: ${joinCandidates.map(c => c.name).join(' → ')}`);
        }

        console.log("\n🔗 Step 5: Merging data...");
        const mergeStartTime = Date.now();
        const studentsByKey = mergeDataAcrossSheets(allSheets, joinCandidates, templateHeaders, headerMap);
        const mergeTime = ((Date.now() - mergeStartTime) / 1000).toFixed(2);
        console.log(`   ✅ ${studentsByKey.size} unique students merged in ${mergeTime}s`);

        const sampleData = mergedDataToArray(studentsByKey, templateHeaders, 5);
        if (sampleData.length > 0) {
            console.log("\n📋 Sample of merged data:");
            console.table(sampleData);
        }

        console.log("\n💾 Step 6: Saving to database...");
        await sequelize.transaction(async (t) => {
            const result = await saveMergedData(studentsByKey, templateHeaders, sheetId, t);
            console.log(`   ✅ Saved ${result.totalRecords} students with ${result.totalValues} cell values`);
        });

        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✨ Done in ${totalTime}s`);

        res.status(201).json({
            success: true,
            templateId,
            joinCandidates: joinCandidates.map(c => c.name),
            totalRecords: studentsByKey.size,
            processingTime: `${totalTime}s`
        });

    } catch (error) {
        console.error("❌ Processing error:", error);
        res.status(500).json({ error: error.message });
    }
}

module.exports = { processAndSaveSelectedSheets };