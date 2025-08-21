const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, where, cast, col, fn} = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const math = require('mathjs');
const { OperationLog, SheetDataSnapshot } = require('../models');
const { countBaseHeaderValues, getAllBaseHeaderValues, sortByType, detectType, splitIntoBuckets, extractRange, looselyNormalize} = require('../utils/rangeHelper');


// const categorizer = async (req, res) => {
//   const transaction = await sequelize.transaction();

//   try {
//     const { templateId, targetHeader, categoryCount } = req.query;

//     if (!templateId || !targetHeader || !categoryCount) {
//       await transaction.rollback();
//       return res.status(400).json({
//         error: "Missing required fields: templateId, targetHeader and categoryCount are required",
//       });
//     }

//     const header = await Header.findOne({ where: { templateId, name: targetHeader }, transaction });
//     if (!header) {
//       await transaction.rollback();
//       return res.status(404).json({ error: "Target header not found" });
//     }

//     const rawValues = await SheetData.findAll({
//       where: { headerId: header.id },
//       attributes: ["value"],
//       transaction,
//     });

//     const cleaned = rawValues.map(v => v.value?.trim()).filter(val => val && val.toUpperCase() !== "NULL");
//     if (cleaned.length === 0) {
//       await transaction.rollback();
//       return res.status(404).json({ error: "No data found for the provided header" });
//     }

//     const uniqueValues = [];
//     const sampleSize = 20;

//     for (const val of cleaned) {
//       if (!uniqueValues.includes(val)) {
//         uniqueValues.push(val);
//         if (uniqueValues.length >= sampleSize) break;
//       }
//     }

//     const numericSample = uniqueValues.filter(val => /^-?\d+(\.\d+)?$/.test(val));
//     const numericConfidence = numericSample.length / uniqueValues.length;

//     const isLikelyNumeric = numericConfidence > 0.8;

//     let type = header.columnType;
//     if (type === "text") {

//       if (isLikelyNumeric) type = "numeric";
//       else if (uniqueValues.every(val => !isNaN(Date.parse(val)))) type = "Date";
//       else type = "string";
//     }

//     let result;

//     if (type === "numeric" || type === "integer" || type === "decimal") {
//       const values = cleaned.map(Number).filter(v => !isNaN(v));
//       if (values.length === 0) throw new Error("No valid numerical values found");

//       const min = Math.min(...values);
//       const max = Math.max(...values);
//       const step = (max - min) / categoryCount;
//       const epsilon = 0.000001;
//       const ranges = [];
//       for (let i = 0; i < categoryCount; i++) {
//         const start = parseFloat((min + i * step + (i > 0 ? epsilon : 0)).toFixed(6));
//         const end = parseFloat((i === categoryCount - 1 ? max : min + (i + 1) * step).toFixed(6));
//         ranges.push({ start, end });
//       }

//       result = { type: "numeric", ranges };

//     } else if (type === "Date") {
//       console.log("Categorizing date data");
//       const dates = cleaned.map(val => new Date(val)).filter(d => !isNaN(d));
//       if (dates.length === 0) throw new Error("No valid date entries found");

//       const sorted = dates.sort((a, b) => a - b);
//       const total = sorted.length;
//       const bucketSize = Math.floor(total / categoryCount);
//       if (bucketSize === 0) throw new Error("Too many categories for available date data");

//       const ranges = [];
//       for (let i = 0; i < categoryCount; i++) {
//         const start = sorted[i * bucketSize].toISOString();
//         const end = sorted[i === categoryCount - 1 ? total - 1 : (i + 1) * bucketSize - 1].toISOString();
//         ranges.push({ start, end });
//       }

//       result = { type: "date", ranges };

//     } else if (type === "Y/N" || type === "character" || type === "string") {
//       const allUniqueValues = [...new Set(cleaned)];
//       result = { type: "category", values: [{ labels: allUniqueValues }] };

//     } else {
//       throw new Error("Unsupported column type");
//     }

//     await transaction.commit();
//     return res.status(200).json(result);

//   } catch (error) {
//     await transaction.rollback();
//     return res.status(500).json({ error: error.message || "Failed to categorize data" });
//   }
// };

const categorizer = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { templateId, targetHeader, categoryCount } = req.query;

    if (!templateId || !targetHeader || !categoryCount) {
      await transaction.rollback();
      return res.status(400).json({
        error: "Missing required fields: templateId, targetHeader and categoryCount are required",
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
      where: { headerId: header.id },
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
        where: { headerId: header.id },
        attributes: [
          [fn("MIN", col("value")), "min"],
          [fn("MAX", col("value")), "max"]
        ],
        raw: true,
        transaction
      });

      const min = Number(minMax.min);
      const max = Number(minMax.max);
      const step = (max - min) / categoryCount;
      const epsilon = 0.000001;

      const ranges = [];
      for (let i = 0; i < categoryCount; i++) {
        const start = parseFloat((min + i * step + (i > 0 ? epsilon : 0)).toFixed(6));
        const end = parseFloat((i === categoryCount - 1 ? max : min + (i + 1) * step).toFixed(6));
        ranges.push({ start, end });
      }

      result = { type: "numeric", ranges };

    } else if (type === "Date") {
      const dateValues = cleaned.map(val => new Date(val)).filter(d => !isNaN(d));
      if (dateValues.length === 0) throw new Error("No valid date entries found");

      dateValues.sort((a, b) => a - b);
      const total = dateValues.length;
      const bucketSize = Math.floor(total / categoryCount);
      if (bucketSize === 0) throw new Error("Too many categories for available date data");

      const ranges = [];
      for (let i = 0; i < categoryCount; i++) {
        const start = dateValues[i * bucketSize].toISOString();
        const end = dateValues[i === categoryCount - 1 ? total - 1 : (i + 1) * bucketSize - 1].toISOString();
        ranges.push({ start, end });
      }

      result = { type: "date", ranges };

    } else if (["Y/N", "character", "string"].includes(type)) {
      const allUniqueValues = Array.from(new Set(cleaned));
      result = { type: "category", values: [{ labels: allUniqueValues }] };

    } else {
      throw new Error("Unsupported column type");
    }

    await transaction.commit();
    return res.status(200).json(result);

  } catch (error) {
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

async function getStructuredData(templateId) {
  const headers = await Header.findAll({ where: { templateId }, raw: true });
  const headerIds = headers.map(h => h.id);
  const headerNames = Object.fromEntries(headers.map(h => [h.id, h.name]));

  const sheetRows = await SheetData.findAll({
    where: { headerId: { [Op.in]: headerIds } },
    attributes: ['rowIndex', 'headerId', 'value'],
    raw: true,
  });

  const rows = new Map();
  for (const { rowIndex, headerId, value } of sheetRows) {
    if (!rows.has(rowIndex)) rows.set(rowIndex, {});
    rows.get(rowIndex)[headerNames[headerId]] = value;
  }

  return Array.from(rows.values());
}




function handleNestedHeaders(nestedHeaders, data) {
  if (!nestedHeaders?.length) return data;

  let filteredData = data;

  for (const { header, ranges, bucketNumber } of nestedHeaders) {
    if (!header || !ranges?.length) continue;

    const detectedType = detectType(filteredData, header);
    const sorted = sortByType(filteredData, header, detectedType);
    const buckets = splitIntoBuckets(sorted, bucketNumber || ranges.length);

    const labelBuckets = new Map();
    for (const bucket of buckets) {
      const key = extractRange(bucket, header);
      labelBuckets.set(`${looselyNormalize(key.start)}|${looselyNormalize(key.end)}`, bucket);
    }

    for (const range of ranges) {
      const { start, end, labels } = range;

      if (labels?.length) {
        const labelSet = new Set(labels.map(l => String(l).trim().toLowerCase()));
        const match = buckets.find(bucket =>
          bucket.every(row => labelSet.has(String(row[header]).trim().toLowerCase()))
        );
        if (match) {
          filteredData = match;
          break;
        }
      } else {
        const key = `${looselyNormalize(start)}|${looselyNormalize(end)}`;
        if (labelBuckets.has(key)) {
          filteredData = labelBuckets.get(key);
          break;
        }
      }
    }
  }

  return filteredData;
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
      if (val == null) continue;
      const norm = String(val).trim().toLowerCase();
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
  const { templateId, baseHeader, targetHeader, categoryCount, autoDistribution, nestedHeaders = [], manualRanges = [] } = req.body;
  try{
    const structuredData = await getStructuredData(templateId);
    let breakdown = [];
    if (autoDistribution) {
      if (!targetHeader || categoryCount > structuredData.length) {
        return res.status(200).json([]);
      }
      breakdown = autoDistribute(structuredData, baseHeader, targetHeader, categoryCount, nestedHeaders);
    } else {
      breakdown = manualDistribute(structuredData, baseHeader, nestedHeaders, manualRanges);
    }
    res.status(200).json(breakdown);
  } catch(error) {
    console.error(error);
    res.status(500).json({ error: 'Unable to process category breakdown.' });
  }
}


async function countStudentsByTemplateRaw(templateId) {
  try {
    const query = `
      SELECT COUNT(DISTINCT sd."rowIndex") AS "studentCount"
      FROM "SheetData" sd
      JOIN "Header" h ON sd."headerId" = h."id"
      WHERE h."templateId" = :templateId
    `;

    const [result] = await sequelize.query(query, {
      replacements: { templateId },
      type: sequelize.QueryTypes.SELECT,
    });

    return result.studentCount || 0;
  } catch (err) {
    console.error('Raw query error:', err);
    throw err;
  }
}

async function countStudentsByTemplate(req, res) {
  const { templateId } = req.params;
  try {
    const count = await countStudentsByTemplateRaw(templateId);
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