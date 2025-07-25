const SheetData = require('../models/SheetData');
const Header = require('../models/Header');
const Template = require('../models/Template');
const sequelize = require('../config/database');
const { DataTypes, Op, where, cast, col} = require('sequelize');
const { v4: uuidv4 } = require('uuid');
const math = require('mathjs');
const { OperationLog, SheetDataSnapshot } = require('../models');
const { buildRanges, countBaseHeaderValues, getAllBaseHeaderValues} = require('../utils/rangeHelper');


// const categorizer = async (req, res) => {
//   const transaction = await sequelize.transaction();

//   try {
//     const { templateId, targetHeader, categoryCount } = req.query;

//     if (!templateId || !targetHeader || !categoryCount) {
//       await transaction.rollback();
//       return res.status(400).json({ error: 'Missing required fields: templateId, targetHeader and categoryCount are required' });
//     }

//     const header = await Header.findOne({ where: { templateId, name: targetHeader }, transaction });
//     if (!header) {
//       await transaction.rollback();
//       return res.status(400).json({ error: 'target header not found' });
//     }

//     const rawValues = await SheetData.findAll({
//       where: { headerId: header.id },
//       attributes: ['value'],
//       transaction,
//     });

//     if (rawValues.length === 0) {
//       await transaction.rollback();
//       return res.status(404).json({ error: 'No data found for the provided headerId' });
//     }

//     const sortedValues = rawValues
//       .map((entry) => parseFloat(entry.value))
//       .filter((val) => !isNaN(val))
//       .sort((a, b) => b - a);

//     if (sortedValues.length === 0) {
//       await transaction.rollback();
//       return res.status(400).json({ error: 'No valid numerical values found in the data' });
//     }

//     const total = sortedValues.length;
//     const bucketSize = Math.floor(total / categoryCount);
//     const categories = [];

//     if (bucketSize === 0) {
//       await transaction.rollback();
//       return res.status(400).json({ error: 'Too many categories requested for the available data' });
//     }

//     for (let i = 0; i < categoryCount; i++) {
//       const startIdx = i * bucketSize;
//       const endIdx = i === categoryCount - 1 ? total - 1 : (i + 1) * bucketSize - 1;

//       const start = sortedValues[startIdx];
//       const end = sortedValues[endIdx];

//       categories.push({ start, end });
//     }

//     await transaction.commit();
//     return res.status(200).json(categories);

//   } catch (error) {
//     await transaction.rollback();
//     return res.status(500).json({ 
//       error: 'Failed to categorize data',
//     });
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

    const header = await Header.findOne({ where: { templateId, name: targetHeader }, transaction });
    if (!header) {
      await transaction.rollback();
      return res.status(404).json({ error: "Target header not found" });
    }

    const rawValues = await SheetData.findAll({
      where: { headerId: header.id },
      attributes: ["value"],
      transaction,
    });

    const cleaned = rawValues.map(v => v.value?.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      await transaction.rollback();
      return res.status(404).json({ error: "No data found for the provided header" });
    }

    let type = header.columnType;
    if (type === "text") {
      const isNumeric = cleaned.every(val => !isNaN(parseFloat(val)));
      const isDate = cleaned.every(val => !isNaN(Date.parse(val)));

      if (isNumeric) type = "numeric";
      else if (isDate) type = "date";
      else type = "string";
    }

    let result;

    if (type === "numeric" || type === "integer" || type === "decimal") {
      const values = cleaned.map(Number).filter(v => !isNaN(v));
      if (values.length === 0) throw new Error("No valid numerical values found");

      const min = Math.min(...values);
      const max = Math.max(...values);
      const step = Math.ceil((max - min + 1) / categoryCount);

      const ranges = [];
      for (let i = 0; i < categoryCount; i++) {
        const start = min + i * step;
        const end = i === categoryCount - 1 ? max : start + step - 1;
        ranges.push({ start, end });
      }

      result = { type: "numeric", ranges };

    } else if (type === "date") {
      const dates = cleaned.map(val => new Date(val)).filter(d => !isNaN(d));
      if (dates.length === 0) throw new Error("No valid date entries found");

      const sorted = dates.sort((a, b) => a - b);
      const total = sorted.length;
      const bucketSize = Math.floor(total / categoryCount);
      if (bucketSize === 0) throw new Error("Too many categories for available date data");

      const ranges = [];
      for (let i = 0; i < categoryCount; i++) {
        const start = sorted[i * bucketSize].toISOString();
        const end = sorted[i === categoryCount - 1 ? total - 1 : (i + 1) * bucketSize - 1].toISOString();
        ranges.push({ start, end });
      }

      result = { type: "date", ranges };

    } else if (type === "Y/N" || type === "character" || type === "string") {
      const uniqueValues = [...new Set(cleaned)];
      if (categoryCount < uniqueValues.length) {
        throw new Error(`Category count (${categoryCount}) is less than unique values (${uniqueValues.length})`);
      }

      result = { type: "category", values: uniqueValues.map(label => ({ label })) };

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


// async function getDataWithRange(req, res) {
//   try {
//     const { templateId, headerId, currentPage, pageSize, minRange, maxRange } = req.query;

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


//     // Range validation
//     let minRangeValue = minRange ? parseFloat(minRange) : undefined;
//     let maxRangeValue = maxRange ? parseFloat(maxRange) : undefined;
//     if ((minRange && isNaN(minRangeValue)) || (maxRange && isNaN(maxRangeValue))) {
//       return res.status(400).json({ error: 'Range values must be valid numbers' });
//     }
//     if (minRangeValue !== undefined && maxRangeValue !== undefined && minRangeValue > maxRangeValue) {
//       return res.status(400).json({ error: 'minRange cannot be greater than maxRange' });
//     }


//     const headers = await Header.findAll({
//       where: { templateId },
//       attributes: ['id', 'name', 'criticalityLevel', 'columnType'],
//       order: [['createdAt', 'ASC']],
//     });

//     if (!headers || headers.length === 0) {
//       return res.status(404).json({ error: `No headers found for templateId ${templateId}` });
//     }

//     let rowIndexes = [];
//     if (headerId && (minRangeValue !== undefined || maxRangeValue !== undefined)) {
//         const rangeFilter = {
//             headerId,
//             value: {},
//         };
//         if (minRangeValue !== undefined) rangeFilter.value[Op.gte] = minRangeValue;
//         if (maxRangeValue !== undefined) rangeFilter.value[Op.lte] = maxRangeValue;

//         const matchingRows = await SheetData.findAll({
//             where: rangeFilter,
//             attributes: ['rowIndex'],
//         });

//         rowIndexes = matchingRows.map(row => row.rowIndex);
//         if (!rowIndexes.length) {
//             return res.status(200).json({
//                 headers: headers.map(h => ({ ...h.dataValues, data: [] })),
//                 totalErrorRows: 0,
//                 errorPages: [],
//                 pagination: {
//                     currentPage: page,
//                     pageSize: size,
//                     totalRows: 0,
//                     totalPages: 0,
//                 },
//             });
//         }
//     }

//     const allSheetData = await SheetData.findAll({
//       include: [{
//         model: Header,
//         where: { templateId },
//         attributes: [],
//       }],
//       where: rowIndexes.length ? { rowIndex: { [Op.in]: rowIndexes } } : { '$Header.templateId$': templateId },
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

//     // Sort values in descending order for the specified headerId
//     if (headerId) {
//       validatedDataByHeader[headerId] = validatedDataByHeader[headerId]
//         .map(entry => ({
//           ...entry,
//           value: entry.value ? parseFloat(entry.value) : null,
//         }))
//         .filter(entry =>
//           entry.value !== null &&
//           !isNaN(entry.value) &&
//           (minRangeValue === undefined || entry.value >= minRangeValue) &&
//           (maxRangeValue === undefined || entry.value <= maxRangeValue)
//         )
//         .sort((a, b) => b.value - a.value);
//     }


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
  const headers = await Header.findAll({ where: { templateId } });
  const headerMap = {};

  headers.forEach(h => (headerMap[h.id] = h.name));

  const sheetRows = await SheetData.findAll({
    where: { headerId: { [Op.in]: headers.map(h => h.id) } },
    order: [['rowIndex', 'ASC']],
  });

  const rowMap = {};
  sheetRows.forEach(row => {
    const headerName = headerMap[row.headerId];
    if (!rowMap[row.rowIndex]) rowMap[row.rowIndex] = {};
    rowMap[row.rowIndex][headerName] = row.value;
  });

  return Object.values(rowMap);
}



function breakdownNestedFirst(data, baseHeader, targetHeader, categoryCount, nestedHeaders, manualRanges = []) {
  const result = [];
  const allBaseHeaderValues = getAllBaseHeaderValues(data, baseHeader);

  nestedHeaders.forEach(({ header, ranges }) => {
    ranges.forEach(nestedRange => {
      const nestedFiltered = data.filter(row => {
        const val = parseFloat(row[header]);
        return val >= nestedRange.start && val <= nestedRange.end;
      });

      if (nestedFiltered.length === 0) return;

      const targetRanges = manualRanges.length > 0 ? manualRanges : buildRanges(nestedFiltered, targetHeader, categoryCount);

      targetRanges.forEach(targetRange => {
        const finalFiltered = nestedFiltered.filter(row => {
          const val = parseFloat(row[targetHeader]);
          return val >= targetRange.start && val <= targetRange.end;
        });

        result.push({
          targetRange,
          total: finalFiltered.length,
          baseHeaderCounts: countBaseHeaderValues(finalFiltered, baseHeader, allBaseHeaderValues),
        });
      });
    });
  });

  return result;
}




async function getCategoryStats(req, res) {
  const { templateId, baseHeader, targetHeader, categoryCount, nestedHeaders = [], manualRanges = [] } = req.body;
  try{
    const structuredData = await getStructuredData(templateId);
    let breakdown = [];
    if (nestedHeaders.length === 0) {
      const targetRanges = manualRanges.length > 0 ? manualRanges : buildRanges(structuredData, targetHeader, categoryCount);
      const allBaseValues = getAllBaseHeaderValues(structuredData, baseHeader);

      breakdown = targetRanges.map(targetRange => {
        const filtered = structuredData.filter(row => {
          const val = parseFloat(row[targetHeader]);
          return val >= targetRange.start && val <= targetRange.end;
        });

        return {
          targetRange,
          total: filtered.length,
          baseHeaderCounts: countBaseHeaderValues(filtered, baseHeader, allBaseValues),
        };
      });
    } else {
      breakdown = breakdownNestedFirst(structuredData, baseHeader, targetHeader, categoryCount, nestedHeaders, manualRanges);
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