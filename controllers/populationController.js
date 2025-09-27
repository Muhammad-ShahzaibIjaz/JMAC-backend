const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, where, cast, col, fn, literal} = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const math = require('mathjs');
const { OperationLog, SheetDataSnapshot } = require('../models');
const { countBaseHeaderValues, getAllBaseHeaderValues, sortByType, detectType, splitIntoBuckets, extractRange, looselyNormalize} = require('../utils/rangeHelper');


const categorizer = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { templateId, sheetId, targetHeader } = req.query;

    if (!templateId || !sheetId || !targetHeader) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Missing required fields: templateId, sheetId, targetHeader are required",
      });
    }

    const header = await Header.findOne({
      where: { templateId, name: targetHeader },
      transaction,
    });

    if (!header) {
      await transaction.rollback();
      return res.status(404).json({ error: "Target header not found" });
    }

    // Stream values for memory efficiency
    const stream = await SheetData.findAll({
      where: { headerId: header.id, sheetId },
      attributes: ["value"],
      raw: true,
      transaction,
    });

    const cleaned = [];
    const uniqueSet = new Set();
    const sampleSize = 20;

    for (const { value } of stream) {
      const trimmed = value?.trim();
      if (trimmed && trimmed.toUpperCase() !== "NULL") {
        cleaned.push(trimmed);
        if (uniqueSet.size < sampleSize) uniqueSet.add(trimmed);
      }
    }

    if (cleaned.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "No data found for the provided header" });
    }

    const uniqueValues = Array.from(uniqueSet);
    const numericSample = uniqueValues.filter(val => !isNaN(Number(val)));
    const numericConfidence = numericSample.length / uniqueValues.length;

    let type = header.columnType;
    if (type === "text") {
      if (numericConfidence > 0.8) type = "numeric";
      else if (uniqueValues.every(val => !isNaN(Date.parse(val)))) type = "Date";
      else type = "string";
    }

    let result;

    if (["numeric", "integer", "decimal"].includes(type)) {
      const numericValues = cleaned.map(Number).filter(v => !isNaN(v));
      if (numericValues.length === 0) throw new Error("No valid numerical values found");

      const [minMax] = await SheetData.findAll({
        where: { headerId: header.id, sheetId },
        attributes: [
          [literal('MIN(CAST("value" AS DOUBLE PRECISION))'), 'min'],
          [literal('MAX(CAST("value" AS DOUBLE PRECISION))'), 'max']
        ],
        raw: true,
        transaction
      });
      result = { type: "numeric", ranges : [{ start: Number(minMax.min), end: Number(minMax.max) }]  };

    } else if (type === "Date") {
      const dateValues = cleaned.map(val => new Date(val)).filter(d => !isNaN(d));
      if (dateValues.length === 0) throw new Error("No valid date entries found");

      dateValues.sort((a, b) => a - b);
      result = { type: "date", ranges: [{ start : dateValues[0].toISOString(), end: dateValues[dateValues.length - 1].toISOString() }] };

    } else if (["Y/N", "character", "string"].includes(type)) {
      cleaned.push(...["NULL", "Blanks"]);
      const allUniqueValues = Array.from(new Set(cleaned));
      result = { type: "category", values: [{ labels: allUniqueValues }] };

    } else {
      throw new Error("Unsupported column type");
    }

    await transaction.commit();
    return res.status(200).json(result);

  } catch (error) {
    console.error("Error in categorizer:", error.message, error.stack);
    await transaction.rollback();
    return res.status(500).json({ error: error.message || "Failed to categorize data" });
  }
};


function validateAndConvertValue(value, columnType, criticalityLevel) {
  if (criticalityLevel === '3') {
    return { value: value, valid: true };
  }

  if (value === null || value === undefined) {
    return { value: null, valid: false };
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

async function getDataWithRange(req, res) {
  try {
    const { templateId, currentPage, pageSize } = req.query;
    const { filters } = req.body;

    if (!templateId || !/^[0-9a-fA-F-]{36}$/.test(templateId)) {
      return res.status(400).json({ error: 'Valid templateId is required' });
    }

    const page = parseInt(currentPage);
    const size = parseInt(pageSize);
    if (isNaN(page) || page < 1 || isNaN(size) || size < 1) {
      return res.status(400).json({ error: 'Valid pagination parameters required' });
    }

    // Fetch headers
    const headers = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
      order: [['createdAt', 'ASC']],
    });

    if (!headers.length) {
      return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
    }

    let filteredRowIndexes = null;
    for (const filter of filters) {
      const { headerId, minRange, maxRange } = filter;
      const rangeConditions = [];

      if (minRange !== undefined) {
        rangeConditions.push(where(cast(col('value'), 'FLOAT'), { [Op.gte]: minRange }));
      }
      if (maxRange !== undefined) {
        rangeConditions.push(where(cast(col('value'), 'FLOAT'), { [Op.lte]: maxRange }));
      }

      const matchingRows = await SheetData.findAll({
        where: {
          headerId,
          [Op.and]: rangeConditions,
        },
        attributes: ['rowIndex', 'value']
      })

      const sortedRowIndexes = matchingRows
        .map(row => {
          const num = parseFloat(row.value);
          return !isNaN(num) ? { rowIndex: row.rowIndex, value: num } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b.value - a.value)
        .map(row => row.rowIndex);
      
      if (!sortedRowIndexes.length) {
        return res.status(200).json({
          headers: headers.map(h => ({ ...h.dataValues, data: [] })),
          totalErrorRows: 0,
          errorPages: [],
          pagination: {
            currentPage: page,
            pageSize: size,
            totalRows: 0,
            totalPages: 0,
          },
        });
      }

      // Apply intersection if previous filters exist
      filteredRowIndexes = filteredRowIndexes
        ? filteredRowIndexes.filter(idx => sortedRowIndexes.includes(idx))
        : sortedRowIndexes;
    }

    const paginatedIndexes = filteredRowIndexes.slice((page - 1) * size, page * size);

    // Step 2: Fetch all data for those rowIndexes
    const sheetData = await SheetData.findAll({
      include: [{
        model: Header,
        where: { templateId },
        attributes: [],
      }],
      where: {
        rowIndex: { [Op.in]: paginatedIndexes },
      },
      attributes: ['id', 'rowIndex', 'value', 'headerId'],
      order: [['rowIndex', 'ASC']],
    });

    // Step 3: Validate and group data
    const errorRows = new Set();
    const errorPages = new Set();
    const groupedByRow = {};

    sheetData.forEach(data => {
      const header = headers.find(h => h.id === data.headerId);
      if (!header) return;

      const { value, valid } = validateAndConvertValue(data.value, header.columnType, header.criticalityLevel);

      if (!groupedByRow[data.rowIndex]) groupedByRow[data.rowIndex] = {};
      groupedByRow[data.rowIndex][header.id] = { id: data.id, value, valid };

      if (!valid) {
        errorRows.add(data.rowIndex);
        errorPages.add(Math.floor(data.rowIndex / size) + 1);
      }
    });

    // Step 4: Paginate rows
    const totalRows = filteredRowIndexes.length;
    const totalPages = Math.ceil(totalRows / size);
    

    // Step 5: Build response
    const responseHeaders = headers.map(header => ({
      id: header.id,
      name: header.name,
      criticalityLevel: header.criticalityLevel,
      columnType: header.columnType,
      data: paginatedIndexes.map(rowIndex => ({
        rowIndex,
        ...groupedByRow[rowIndex][header.id] || { value: null, valid: false },
      })),
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
    console.error('Error retrieving filtered data:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to retrieve data' });
  }
}


async function getStructuredData(templateId, sheetId) {
  const headers = await Header.findAll({ where: { templateId }, raw: true });
  const headerIds = headers.map(h => h.id);
  const headerNames = Object.fromEntries(headers.map(h => [h.id, h.name]));

  const sheetRows = await SheetData.findAll({
    where: { headerId: { [Op.in]: headerIds }, sheetId },
    attributes: ['rowIndex', 'headerId', 'value'],
    raw: true,
  });

  // Step 1: Find max rowIndex
  const maxRowIndex = sheetRows.reduce((max, row) => Math.max(max, row.rowIndex), 0);

  // Step 2: Create a map of rowIndex → { headerName: value }
  const rows = new Map();
  for (const { rowIndex, headerId, value } of sheetRows) {
    if (!rows.has(rowIndex)) rows.set(rowIndex, {});
    rows.get(rowIndex)[headerNames[headerId]] = value;
  }

  // Step 3: Fill missing rows and missing header values with blanks
  const structured = [];
  for (let i = 1; i <= maxRowIndex; i++) {
    const row = rows.get(i) || {};
    const filledRow = {};

    for (const header of headers) {
      const headerName = header.name;
      filledRow[headerName] = row[headerName] ?? ''; // blank if missing
    }

    structured.push(filledRow);
  }

  return structured;
}


// async function getStructuredData(templateId, sheetId) {
//   const headers = await Header.findAll({ where: { templateId }, raw: true });
//   const headerIds = headers.map(h => h.id);
//   const headerNames = Object.fromEntries(headers.map(h => [h.id, h.name]));

//   const sheetRows = await SheetData.findAll({
//     where: { headerId: { [Op.in]: headerIds }, sheetId },
//     attributes: ['rowIndex', 'headerId', 'value'],
//     raw: true,
//   });

//   const rows = new Map();
//   for (const { rowIndex, headerId, value } of sheetRows) {
//     if (!rows.has(rowIndex)) rows.set(rowIndex, {});
//     rows.get(rowIndex)[headerNames[headerId]] = value;
//   }

//   return Array.from(rows.values());
// }




// function handleNestedHeaders(nestedHeaders, data) {
//   if (!nestedHeaders?.length) return data;

//   let filteredData = data;

//   for (const { header, ranges, bucketNumber } of nestedHeaders) {
//     if (!header || !ranges?.length) continue;

//     const detectedType = detectType(filteredData, header);
//     const sorted = sortByType(filteredData, header, detectedType);
//     if (detectedType === 'number') {
//       filteredData = filteredData.filter(row => +row[header] !== 0);
//     }

//     const buckets = splitIntoBuckets(sorted, bucketNumber || ranges.length);
//     console.log(`Buckets for ${header}:`, buckets.length);
//     const targetLabels = new Set(['International-Transfer', 'International-Freshman']);

//     for (let i = 0; i < buckets.length; i++) {
//       const bucket = buckets[i];
//       const matchingRows = bucket.filter(row =>
//         targetLabels.has(String(row['First_Year/Transfer/Continuing/Readmit/Online']).trim())
//       );
//       console.log(`Bucket ${i + 1} — Matching count: ${matchingRows.length}`);
//     }
//     const labelBuckets = new Map();
//     for (const bucket of buckets) {
//       const key = extractRange(bucket, header);
//       labelBuckets.set(`${looselyNormalize(key.start)}|${looselyNormalize(key.end)}`, bucket);
//     }

//     for (const range of ranges) {
//       const { start, end, labels } = range;
//       console.log(`Processing range for ${header}: ${start} to ${end} with labels:`, labels);
//       if (labels?.length) {
//         const labelSet = new Set(labels.map(l => String(l).trim()));
//         console.log('Label set:', labelSet);
//         const match = buckets.find(bucket =>
//           bucket.some(row => labelSet.has(String(row[header]).trim()))
//         );
//         console.log('Found matching bucket:', match.length);
//         if (match) {
//           filteredData = filteredData.filter(row => match.includes(row));
//           console.log('Filtered data count:', filteredData.length);
//         }
//       } else {
//         const key = `${looselyNormalize(start)}|${looselyNormalize(end)}`;
//         if (labelBuckets.has(key)) {
//           const match = labelBuckets.get(key);
//           filteredData = filteredData.filter(row => match.includes(row));
//           console.log('Filtered data count:', filteredData.length);
//         }
//       }
//     }
//   }

//   return filteredData;
// }

function handleNestedHeaders(nestedHeaders, data) {
  if (!nestedHeaders?.length) return data;

  let filteredData = data;

  for (const { header, ranges, bucketNumber } of nestedHeaders) {
    if (!header || !ranges?.length) continue;

    const detectedType = detectType(filteredData, header);
    const sorted = sortByType(filteredData, header, detectedType);

    if (detectedType === 'number') {
      filteredData = filteredData.filter(row => +row[header] !== 0);
    }

    const buckets = splitIntoBuckets(sorted, bucketNumber || ranges.length);
    console.log(`Buckets for ${header}:`, buckets.length);

    const labelBuckets = new Map();
    for (const bucket of buckets) {
      const key = extractRange(bucket, header);
      labelBuckets.set(`${looselyNormalize(key.start)}|${looselyNormalize(key.end)}`, bucket);
    }

    let combinedMatches = [];

    for (const range of ranges) {
      const { start, end, labels } = range;

      if (labels?.length) {
        const labelSet = new Set(labels.map(l => looselyNormalize(l)));
        console.log(`Label set for ${header}:`, labelSet);

        for (let i = 0; i < buckets.length; i++) {
          const bucket = buckets[i];
          const matchingRows = bucket.filter(row =>
            labelSet.has(looselyNormalize(row[header]))
          );
          console.log(`Bucket ${i + 1} — Matching count: ${matchingRows.length}`);
          combinedMatches.push(...matchingRows);
        }
      } else if (start != null && end != null) {
        for (let i = 0; i < buckets.length; i++) {
          const bucket = buckets[i];
          const matchingRows = bucket.filter(row => {
            const val = row[header];
            if (val == null || val === '') return false;

            if (detectedType === 'number') {
              return +val >= +start && +val <= +end;
            }
            if (detectedType === 'date') {
              return Date.parse(val) >= Date.parse(start) && Date.parse(val) <= Date.parse(end);
            }
            return false;
          });
          console.log(`Bucket ${i + 1} — Range match count: ${matchingRows.length}`);
          combinedMatches.push(...matchingRows);
        }
      }
    }

    const matchSet = new Set(combinedMatches);
    filteredData = filteredData.filter(row => matchSet.has(row));
    console.log(`Filtered data count after ${header}:`, filteredData.length);
  }

  return filteredData;
}

function autoDistributeSecond(data, baseHeader, targetHeader, categoryCount, nestedHeaders = []) {
  const workingData = handleNestedHeaders(nestedHeaders, data);
  const detectedType = detectType(workingData, targetHeader);
  const allBaseValues = getAllBaseHeaderValues(data, baseHeader);

  if (detectedType === 'number') {
    const nullBucket = [];
    const blankBucket = [];
    const zeroBucket = [];
    const remaining = [];

    for (const row of workingData) {
      const val = row[targetHeader];
      if (val === null) {
        nullBucket.push(row);
      } else if (val === '') {
        blankBucket.push(row);
      } else if (+val === 0) {
        zeroBucket.push(row);
      } else {
        remaining.push(row);
      }
    }

    const response = [];

    // NULL bucket
    if (nullBucket.length > 0) {
      response.push({
        targetHeader,
        targetRange: { start: null, end: null },
        total: nullBucket.length,
        baseHeaderCounts: countBaseHeaderValues(nullBucket, baseHeader, allBaseValues),
      });
    }

    // blanks bucket
    if (blankBucket.length > 0) {
      response.push({
        targetHeader,
        targetRange: { start: '', end: '' },
        total: blankBucket.length,
        baseHeaderCounts: countBaseHeaderValues(blankBucket, baseHeader, allBaseValues),
      });
    }

    // zero bucket
    if (zeroBucket.length > 0) {
      response.push({
        targetHeader,
        targetRange: { start: 0, end: 0 },
        total: zeroBucket.length,
        baseHeaderCounts: countBaseHeaderValues(zeroBucket, baseHeader, allBaseValues),
      });
    }

    // remaining buckets
    const sortedRemaining = sortByType(remaining, targetHeader, 'number');
    const buckets = splitIntoBuckets(sortedRemaining, categoryCount);

    for (const bucket of buckets) {
      const range = extractRange(bucket, targetHeader);
      response.push({
        targetHeader,
        targetRange: range,
        total: bucket.length,
        baseHeaderCounts: countBaseHeaderValues(bucket, baseHeader, allBaseValues),
      });
    }

    return response;
  }

  // fallback for non-numeric
  const sortedTarget = sortByType(workingData, targetHeader, detectedType);
  const buckets = splitIntoBuckets(sortedTarget, categoryCount);

  return buckets.map(bucket => {
    let targetRange;
    if (detectedType === 'date') {
      targetRange = extractRange(bucket, targetHeader);
    } else {
      const labelSet = new Set();
      for (const row of bucket) {
        const val = row[targetHeader];
        if (val != null) labelSet.add(String(val).trim());
      }
      targetRange = { labels: Array.from(labelSet) };
    }

    return {
      targetHeader,
      targetRange,
      total: bucket.length,
      baseHeaderCounts: countBaseHeaderValues(bucket, baseHeader, allBaseValues),
    };
  });
}


function autoDistribute(data, baseHeader, targetHeader, categoryCount, nestedHeaders = []) {
  const workingData = handleNestedHeaders(nestedHeaders, data);

  const detectedType = detectType(workingData, targetHeader);

  const sortedTarget = sortByType(workingData, targetHeader, detectedType);

  const buckets = splitIntoBuckets(sortedTarget, categoryCount);

  const allBaseValues = getAllBaseHeaderValues(data, baseHeader);

  return buckets.map(bucket => {
    let targetRange;

    if (detectedType === 'number' || detectedType === 'date') {
      targetRange = extractRange(bucket, targetHeader);
    } else {
      const labelSet = new Set();
      for (const row of bucket) {
        const val = row[targetHeader];
        if (val != null) labelSet.add(String(val).trim());
      }
      targetRange = { labels: Array.from(labelSet) };
    }

    return {
      targetHeader,
      targetRange,
      total: bucket.length,
      baseHeaderCounts: countBaseHeaderValues(bucket, baseHeader, allBaseValues),
    };
  });
}


function manualDistribute(data, baseHeader, nestedHeaders = [], manualRanges = []) {
  const categoryData = nestedHeaders.length ? handleNestedHeaders(nestedHeaders, data) : data;

  const allBaseValues = getAllBaseHeaderValues(categoryData, baseHeader);

  // Pre-normalize manualRanges labels once
  for (const { ranges } of manualRanges) {
    for (const range of ranges) {
      if (Array.isArray(range.labels)) {
        range.normalizedLabels = range.labels.map(label => String(label).trim().toLowerCase());
      }
    }
  }

  const breakdown = [];

  const labelMaps = {};
  for (let i = 0; i < categoryData.length; i++) {
    const row = categoryData[i];
    for (let j = 0; j < manualRanges.length; j++) {
      const header = manualRanges[j].header;
      const val = row[header];
      // if (val == null) continue;
      let norm;
      if (val == null || String(val).trim() === '') {
        norm = val == null ? 'NULL' : 'blanks';
      } else {
        norm = String(val).trim().toLowerCase();
      }
      if (!labelMaps[header]) labelMaps[header] = {};
      if (!labelMaps[header][norm]) labelMaps[header][norm] = [];
      labelMaps[header][norm].push(row);
    }
  }

  for (let i = 0; i < manualRanges.length; i++) {
    const { header, ranges } = manualRanges[i];
    for (let j = 0; j < ranges.length; j++) {
      const { start, end, labels, normalizedLabels } = ranges[j];
      let filtered = [];

      if (Array.isArray(labels) && labels.length > 0) {
        const map = labelMaps[header];
        if (map && normalizedLabels) {
          for (let k = 0; k < normalizedLabels.length; k++) {
            const norm = normalizedLabels[k];
            if (map[norm]) filtered.push(...map[norm]);
          }
        }
      } else {
        for (let k = 0; k < categoryData.length; k++) {
          const val = parseFloat(categoryData[k][header]);
          if (!isNaN(val) && val >= start && val <= end) {
            filtered.push(categoryData[k]);
          }
        }
      }

      if (!filtered.length) continue;

      breakdown.push({
        targetHeader: header,
        targetRange: labels ? { labels } : { start, end },
        total: filtered.length,
        baseHeaderCounts: countBaseHeaderValues(filtered, baseHeader, allBaseValues),
      });
    }
  }
  return breakdown;
}


async function getCategoryStats(req, res) {
  const { templateId, sheetId, baseHeader, targetHeader, categoryCount, autoDistribution, nestedHeaders = [], manualRanges = [] } = req.body;
  try{
    const structuredData = await getStructuredData(templateId, sheetId);
    let breakdown = [];
    if (autoDistribution) {
      if (!targetHeader || categoryCount > structuredData.length) {
        return res.status(200).json([]);
      }
      breakdown = autoDistributeSecond(structuredData, baseHeader, targetHeader, categoryCount, nestedHeaders);
    } else {
      breakdown = manualDistribute(structuredData, baseHeader, nestedHeaders, manualRanges);
    }
    res.status(200).json(breakdown);
  } catch(error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to process category breakdown.' });
  }
}


async function countStudentsByTemplateRaw(templateId, sheetId) {
  try {
    const query = `
      SELECT COUNT(DISTINCT sd."rowIndex") AS "studentCount"
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h."id"
      WHERE h."templateId" = :templateId AND sd."sheetId" = :sheetId
    `;

    const [result] = await sequelize.query(query, {
      replacements: { templateId, sheetId },
      type: sequelize.QueryTypes.SELECT,
    });

    return result.studentCount || 0;
  } catch (err) {
    console.error('Raw query error:', err);
    throw err;
  }
}

async function countStudentsByTemplate(req, res) {
  const { templateId, sheetId } = req.params;
  try {
    const count = await countStudentsByTemplateRaw(templateId, sheetId);
    res.status(200).json({ count });
  } catch (err) {
    console.error('Error counting students by template:', err);
    res.status(500).json({ error: 'Unable to count students by template.' });
  }
}

module.exports = {
    categorizer,
    getDataWithRange,
    getCategoryStats,
    countStudentsByTemplate
};