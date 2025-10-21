const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes } = require('sequelize');
const { PopulationStatus, PopulationSubmission, Header, PopulationRule, SheetData } = require('../models');
const { evaluateConditions } = require('../services/evaluation');
const { generateMultiYearExcelFile } = require('../services/SheetService');
const { desiredOrder } = require('../utils/headerOrderList');
const { geocodeStudents } = require('../utils/coordinateFinder');

const savePopulationStatus = async (req, res) => {
    const { templateId, statusName, selectedStatuses, targetHeader } = req.body;
    try {

        if (!templateId || !selectedStatuses || !targetHeader) {
            return res.status(400).json({ error: 'templateId, selectedStatuses, and targetHeader are required' });
        }

        const isPopulationStatusExists = await PopulationStatus.findOne({
            where: {
                templateId,
                targetHeader,
                statusName
            }
        });

        if (isPopulationStatusExists) {
            return res.status(409).json({ error: 'A PopulationStatus with the same name already exists' });
        }

        const populationStatus = await PopulationStatus.create({
            templateId,
            statusName,
            selectedStatuses,
            targetHeader
        });
        res.status(201).json({id: populationStatus.id, statusName: populationStatus.statusName, selectedStatuses: populationStatus.selectedStatuses, targetHeader: populationStatus.targetHeader});
    } catch (error) {
        console.error('Error saving population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};


const getPopulationStatusByTemplateId = async (req, res) => {
    const { templateId } = req.params;
    try {
        if (!templateId) {
            return res.status(400).json({ error: 'templateId is required' });
        }
        const populationStatus = await PopulationStatus.findAll({
            where: { templateId },
            attributes: ['id', 'statusName', 'selectedStatuses', 'targetHeader']
        });
        res.status(200).json(populationStatus);
    } catch (error) {
        console.error('Error fetching population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const savePopulationSubmissionDate = async (req, res) => {
  const { templateId, submissionDate, selectedSheet } = req.body;

  try {
    if (!templateId || !submissionDate || !selectedSheet) {
      return res.status(400).json({ error: 'templateId, submissionDate, and selectedSheet are required' });
    }

    // Check for exact match
    const isSubmissionExists = await PopulationSubmission.findOne({
      where: { templateId, submissionDate }
    });

    if (isSubmissionExists) {
      return res.status(409).json({ error: 'A PopulationSubmission with the same date already exists' });
    }

    // Check for any submission within 6 days before this one
    const sixDaysAgo = new Date(submissionDate);
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);

    const recentSubmission = await PopulationSubmission.findOne({
      where: {
        templateId,
        submissionDate: {
          [Op.between]: [sixDaysAgo.toISOString().slice(0, 10), submissionDate]
        }
      }
    });

    if (recentSubmission) {
      return res.status(409).json({ error: 'A submission exists within 6 days before this date' });
    }

    // Save new submission
    const populationSubmission = await PopulationSubmission.create({
      templateId,
      submissionDate,
      selectedSheet
    });

    res.status(201).json({id: populationSubmission.id, submissionDate: populationSubmission.submissionDate, selectedSheet: populationSubmission.selectedSheet});
  } catch (error) {
    console.error('Error saving population submission date:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPopulationSubmissionsByTemplateId = async (req, res) => {
    const { templateId } = req.params;
    try {
        if (!templateId) {
            return res.status(400).json({ error: 'templateId is required' });
        }
        const submissions = await PopulationSubmission.findAll({
            where: { templateId },
            attributes: ['id', 'submissionDate', 'selectedSheet'],
            order: [['submissionDate', 'DESC']]
        });
        res.status(200).json(submissions);
    } catch (error) {
        console.error('Error fetching population submissions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const updatePopulationSubmissionDate = async (req, res) => {
    const { id, submissionDate, selectedSheet } = req.body;
    try {
        if (!id || !submissionDate || !selectedSheet) {
            return res.status(400).json({ error: 'id, submissionDate, and selectedSheet are required' });
        }
        const submission = await PopulationSubmission.findByPk(id);
        if (!submission) {
            return res.status(404).json({ error: 'PopulationSubmission not found' });
        }
        submission.submissionDate = submissionDate;
        submission.selectedSheet = selectedSheet;
        await submission.save();
        res.status(200).json(true);
    } catch (error) {
        console.error('Error updating population submission date:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


const updatePopulationStatus = async (req, res) => {
    const { id, statusName, selectedStatuses, targetHeader } = req.body;
    try {
        if (!id || !selectedStatuses || !targetHeader) {
            return res.status(400).json({ error: 'id, selectedStatuses, and targetHeader are required' });
        }
        const populationStatus = await PopulationStatus.findByPk(id);
        if (!populationStatus) {
            return res.status(404).json({ error: 'PopulationStatus not found' });
        }
        populationStatus.statusName = statusName;
        populationStatus.selectedStatuses = selectedStatuses;
        populationStatus.targetHeader = targetHeader;
        await populationStatus.save();
        res.status(200).json(true);
    } catch (error) {
        console.error('Error updating population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

const deletePopulationSubmission = async (req, res) => {
    const { id } = req.params;

    try {
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }

        const submission = await PopulationSubmission.findByPk(id);
        if (!submission) {
            return res.status(404).json({ error: 'PopulationSubmission not found' });
        }

        await submission.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting population submission:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


const deletePopulationStatus = async (req, res) => {
    const { id } = req.params;

    try {
        if (!id) {
            return res.status(400).json({ error: 'id is required' });
        }

        const populationStatus = await PopulationStatus.findByPk(id);
        if (!populationStatus) {
            return res.status(404).json({ error: 'PopulationStatus not found' });
        }

        await populationStatus.destroy();
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting population status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}


const parseDate = (str) => {
  const d = new Date(str);
  return isNaN(d) ? null : d;
};


const getClosestDate = (dates, targetDay, targetMonth) => {
  const sameMonthDates = dates.filter(
    (d) => d.getMonth() === targetMonth
  );

  if (sameMonthDates.length > 0) {
    return sameMonthDates.reduce((a, b) =>
      Math.abs(a.getDate() - targetDay) < Math.abs(b.getDate() - targetDay) ? a : b
    );
  }

  return dates.reduce((a, b) =>
    Math.abs(a.getDate() - targetDay) < Math.abs(b.getDate() - targetDay) ? a : b
  );
};

const findClosestPreviousDate = async (req, res) => {
  const { templateId, selectedDate, isWeekly=false } = req.body;
  try{
    if (!templateId || !selectedDate) {
      return res.status(400).json({ error: 'templateId and selectedDate are required' });
    }
    const selected = new Date(selectedDate);
    const submissions = await PopulationSubmission.findAll({
      where: {
        templateId,
        submissionDate: { [Op.ne]: null },
      },
      attributes: ['submissionDate'],
      raw: true,
    });

    const parsedDates = submissions.map((s) => parseDate(s.submissionDate)).filter((d) => d && d < selected);
    if (!isWeekly) {
      const selectedDay = selected.getDate();
      const selectedMonth = selected.getMonth();
      const yearsToCheck = [selected.getFullYear() - 1, selected.getFullYear() - 2];

      const result = {};

      for (const year of yearsToCheck) {
        const yearDates = parsedDates.filter((d) => d.getFullYear() === year);

        if (yearDates.length === 0) {
          result[year] = null;
        } else {
          const closest = getClosestDate(yearDates, selectedDay, selectedMonth);
          result[year] = closest ? closest.toISOString().split('T')[0] : null;
        }
      }

      return res.json({
        selectedDate: selectedDate,
        previousYear: result[yearsToCheck[0]],
        twoYearsAgo: result[yearsToCheck[1]],
      });
    }

    const result = {
      selectedDate: selected.toISOString().split('T')[0],
      previousYear: null,
      twoYearsAgo: null,
    };

    let count = 1;
    let lastDate = selected;

    for (const date of parsedDates) {
      const diff = Math.abs((lastDate - date) / (1000 * 60 * 60 * 24));
      if (diff >= 6 && diff <= 8) {
        // Acceptable weekly gap
        if (count === 1) {
          result.previousYear = date.toISOString().split('T')[0];
          lastDate = date;
          count++;
        } else if (count === 2) {
          result.twoYearsAgo = date.toISOString().split('T')[0];
          break;
        }
      } else if (diff > 8) {
        // If gap is bigger, still accept as fallback
        if (count === 1) {
          result.previousYear = date.toISOString().split('T')[0];
          lastDate = date;
          count++;
        } else if (count === 2) {
          result.twoYearsAgo = date.toISOString().split('T')[0];
          break;
        }
      }
    }

    return res.json(result);
  } catch (error) {
    console.error('Error finding closest previous date:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const normalizeKey = key => key.replace(/[^a-zA-Z0-9_]/g, '_');

const applyPopulationRule = async (templateId, sheetId, conditions, headers) => {
    try{
        if (!templateId || !sheetId || !conditions || !headers) {
            throw new Error('templateId, sheetId, conditions, and headers are required');
        }
        const allHeaders = await Header.findAll({
            where:{
                templateId,
                name: {[Op.in]: headers}
            },
            raw: true,
        });

        if (allHeaders.length === 0) {
            throw new Error('No matching headers found');
        }

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
        const evaluationHeaderIds = allHeaders.map(h => h.id);

        const sheetDataForEvaluation = await SheetData.findAll({
            where: {
                sheetId,
                headerId: { [Op.in]: evaluationHeaderIds }
            },
            raw: true,
        });

        const evalRows = new Map();
        sheetDataForEvaluation.forEach(entry => {
            const header = allHeaders.find(h => h.id === entry.headerId);
            const normalizedName = normalizeKey(header.name);
            const row = evalRows.get(entry.rowIndex) || {};
            row[normalizedName] = { value: entry.value, id: entry.id };
            evalRows.set(entry.rowIndex, row);
        });

        const matchingRowIndices = [];

        for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
            const rowData = evalRows.get(rowIndex) || {};

            const filteredRowData = {};
            for (const name of headers) {
                const normalized = normalizeKey(name);
                filteredRowData[normalized] = rowData[normalized] ?? { value: null };
            }

            const isValid = evaluateConditions(filteredRowData, conditions);
            if (isValid) matchingRowIndices.push(rowIndex);
        }
        return matchingRowIndices;

    } catch (error) {
        console.error('Error applying population rule:', error);
        throw error;
    }
}

const applyNeedBracket = async (templateId, sheetId, conditions, headers, matchingRows) => {
    try{
        if (!templateId || !sheetId || !conditions || !headers || !matchingRows) {
            throw new Error('templateId, sheetId, conditions, headers, and matchingRows are required');
        }
        const allHeaders = await Header.findAll({
            where:{
                templateId,
                name: {[Op.in]: headers}
            },
            raw: true,
        });

        if (allHeaders.length === 0) {
            throw new Error('No matching headers found');
        }

        const evaluationHeaderIds = allHeaders.map(h => h.id);

        const sheetDataForEvaluation = await SheetData.findAll({
            where: {
                sheetId,
                headerId: { [Op.in]: evaluationHeaderIds },
                rowIndex: { [Op.in]: matchingRows },
            },
            raw: true,
        });

        const evalRows = new Map();
        sheetDataForEvaluation.forEach(entry => {
            const header = allHeaders.find(h => h.id === entry.headerId);
            const normalizedName = normalizeKey(header.name);
            const row = evalRows.get(entry.rowIndex) || {};
            row[normalizedName] = { value: entry.value, id: entry.id };
            evalRows.set(entry.rowIndex, row);
        });

        const matchingRowIndices = [];

        for (const rowIndex of matchingRows) {
          const rowData = evalRows.get(rowIndex) || {};

          const filteredRowData = {};
          for (const name of headers) {
            const normalized = normalizeKey(name);
            filteredRowData[normalized] = rowData[normalized] ?? { value: null };
          }

          const isValid = evaluateConditions(filteredRowData, conditions);
          if (isValid) matchingRowIndices.push(rowIndex);
        }

        return matchingRowIndices;
    } catch (error) {
        console.error('Error applying need brackets:', error);
        throw error;
    }
}

const getSheetId = async (submissionId) => {
    const submission = await PopulationSubmission.findByPk(submissionId);
    if (!submission) {
        throw new Error('Submission Date not found');
    }
    return submission.selectedSheet;
}

const getSheetIdBySubmissionDate = async (submissionDate, templateId) => {
  if (submissionDate === null) return null;
    const submission = await PopulationSubmission.findOne({
        where: { submissionDate, templateId }
    });
    if (!submission) {
        throw new Error('Submission Date not found');
    }
    return submission.selectedSheet;
}

const getRuleConditionsAndHeaders = async (populationRuleId) => {
    const populationRule = await PopulationRule.findByPk(populationRuleId);
    if (!populationRule) {
        throw new Error('Population rule not found');
    }
    return {
        conditions: populationRule.conditions,
        headers: populationRule.headers
    };
}

async function getAveragesFromMatchedRows(sheetId, matchedRowIndexes, templateId) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return { netRevenue: 0, discountRate: 0 };
  }

  // Step 1: Get headerIds for Net_Tuition_Revenue and NACUBO_Discount_Rate
  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Net_Tuition_Revenue', 'NACUBO_Discount_Rate'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const netTuitionHeaderId = headerMap['Net_Tuition_Revenue'];
  const discountRateHeaderId = headerMap['NACUBO_Discount_Rate'];

  if (!netTuitionHeaderId && !discountRateHeaderId) {
    return { netRevenue: 0, discountRate: 0 };
  }

  // Step 2: Fetch relevant SheetData rows
  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [netTuitionHeaderId, discountRateHeaderId] },
    },
    attributes: ['headerId', 'value'],
    raw: true,
  });

  // Step 3: Group and calculate averages
  let netTuitionSum = 0;
  let netTuitionCount = 0;
  let discountRateSum = 0;
  let discountRateCount = 0;

  dataRows.forEach((row) => {
    let rawValue = row.value;

    // Handle percentage strings like "99%" or " 100 %"
    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      rawValue = rawValue.replace('%', '').trim();
    }

    const val = parseFloat(rawValue);
    if (isNaN(val)) return;

    if (row.headerId === netTuitionHeaderId) {
      netTuitionSum += val;
      netTuitionCount++;
    } else if (row.headerId === discountRateHeaderId) {
      discountRateSum += val;
      discountRateCount++;
    }
  });

  return {
    netRevenue: netTuitionCount ? Math.round(netTuitionSum / netTuitionCount) : 0,
    discountRate: discountRateCount ? (discountRateSum / discountRateCount).toFixed(2) : 0,
  };
}

async function getAveragesMetricsFromMatchedRows(sheetId, matchedRowIndexes, templateId) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 };
  }
  // Step 1: Get headerIds for Net_Tuition_Revenue and NACUBO_Discount_Rate
  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Net_Tuition_Revenue', 'Net_Charges_To_Student', 'NACUBO_Discount_Rate', 'Total_Discount_Rate'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const netTuitionHeaderId = headerMap['Net_Tuition_Revenue'];
  const discountRateHeaderId = headerMap['NACUBO_Discount_Rate'];
  const netChargesHeaderId = headerMap['Net_Charges_To_Student'];
  const totalDiscountHeaderId = headerMap['Total_Discount_Rate'];

  if (!netTuitionHeaderId && !discountRateHeaderId && !netChargesHeaderId && !totalDiscountHeaderId) {
    return { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 };
  }

  // Step 2: Fetch relevant SheetData rows
  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [netTuitionHeaderId, netChargesHeaderId, discountRateHeaderId, totalDiscountHeaderId] },
    },
    attributes: ['headerId', 'value'],
    raw: true,
  });

  // Step 3: Group and calculate averages
  let netTuitionSum = 0;
  let netTuitionCount = 0;
  let totalNACUBORateSum = 0;
  let totalNACUBORateCount = 0;
  let netChargesSum = 0;
  let netChargesCount = 0;
  let totalDiscountSum = 0;
  let totalDiscountCount = 0;

  dataRows.forEach((row) => {
    let rawValue = row.value;

    // Handle percentage strings like "99%" or " 100 %"
    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      rawValue = rawValue.replace('%', '').trim();
    }

    const val = parseFloat(rawValue);
    if (isNaN(val)) return;

    if (row.headerId === netTuitionHeaderId) {
      netTuitionSum += val;
      netTuitionCount++;
    } else if (row.headerId === discountRateHeaderId) {
      totalNACUBORateSum += val;
      totalNACUBORateCount++;
    } else if (row.headerId === netChargesHeaderId) {
      netChargesSum += val;
      netChargesCount++;
    } else if (row.headerId === totalDiscountHeaderId) {
      totalDiscountSum += val;
      totalDiscountCount++;
    }
  });
  return { 
    netRevenue: netTuitionCount ? Math.round(netTuitionSum / netTuitionCount) : 0, 
    netCharges: netChargesCount ? Math.round(netChargesSum / netChargesCount) : 0, 
    nacuboDiscount: totalNACUBORateCount ? (totalNACUBORateSum / totalNACUBORateCount).toFixed(2) : 0, 
    totalDiscount: totalDiscountCount ? (totalDiscountSum / totalDiscountCount).toFixed(2) : 0 
  };
}

async function getAveragesMetricsFromMatchedRowsOfPackage(sheetId, matchedRowIndexes, templateId, packageRowIndexes, non_packageRowIndexes) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return {
      all: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 },
      package: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 },
      nonPackage: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 }
    };
  }

  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Net_Tuition_Revenue', 'Net_Charges_To_Student', 'NACUBO_Discount_Rate', 'Total_Discount_Rate'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const netTuitionHeaderId = headerMap['Net_Tuition_Revenue'];
  const discountRateHeaderId = headerMap['NACUBO_Discount_Rate'];
  const netChargesHeaderId = headerMap['Net_Charges_To_Student'];
  const totalDiscountHeaderId = headerMap['Total_Discount_Rate'];

  if (!netTuitionHeaderId && !discountRateHeaderId && !netChargesHeaderId && !totalDiscountHeaderId) {
    return {
      all: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 },
      package: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 },
      nonPackage: { netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 }
    };
  }

  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [netTuitionHeaderId, netChargesHeaderId, discountRateHeaderId, totalDiscountHeaderId] },
    },
    attributes: ['headerId', 'rowIndex', 'value'],
    raw: true,
  });

  const initializeMetrics = () => ({
    netTuitionSum: 0,
    netTuitionCount: 0,
    nacuboSum: 0,
    nacuboCount: 0,
    netChargesSum: 0,
    netChargesCount: 0,
    totalDiscountSum: 0,
    totalDiscountCount: 0,
  });

  const allMetrics = initializeMetrics();
  const packageMetrics = initializeMetrics();
  const nonPackageMetrics = initializeMetrics();

  const processRow = (row, metrics) => {
    let rawValue = row.value;
    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      rawValue = rawValue.replace('%', '').trim();
    }
    const val = parseFloat(rawValue);
    if (isNaN(val)) return;

    if (row.headerId === netTuitionHeaderId) {
      metrics.netTuitionSum += val;
      metrics.netTuitionCount++;
    } else if (row.headerId === discountRateHeaderId) {
      metrics.nacuboSum += val;
      metrics.nacuboCount++;
    } else if (row.headerId === netChargesHeaderId) {
      metrics.netChargesSum += val;
      metrics.netChargesCount++;
    } else if (row.headerId === totalDiscountHeaderId) {
      metrics.totalDiscountSum += val;
      metrics.totalDiscountCount++;
    }
  };

  dataRows.forEach((row) => {
    processRow(row, allMetrics);
    if (packageRowIndexes.includes(row.rowIndex)) {
      processRow(row, packageMetrics);
    } else if (non_packageRowIndexes.includes(row.rowIndex)) {
      processRow(row, nonPackageMetrics);
    }
  });

  const formatMetrics = (metrics) => ({
    netRevenue: metrics.netTuitionCount ? Math.round(metrics.netTuitionSum / metrics.netTuitionCount) : 0,
    netCharges: metrics.netChargesCount ? Math.round(metrics.netChargesSum / metrics.netChargesCount) : 0,
    nacuboDiscount: metrics.nacuboCount ? (metrics.nacuboSum / metrics.nacuboCount).toFixed(2) : 0,
    totalDiscount: metrics.totalDiscountCount ? (metrics.totalDiscountSum / metrics.totalDiscountCount).toFixed(2) : 0,
  });

  return {
    all: formatMetrics(allMetrics),
    package: formatMetrics(packageMetrics),
    nonPackage: formatMetrics(nonPackageMetrics),
  };
}

const getAdmittedStatuses = async (templateId) => {
  try{
    const admittedStatus = await PopulationStatus.findOne({
      where: {
        templateId,
        statusName: 'Admitted',
      },
    });
    if (!admittedStatus) return null;
    return {
      selectedStatuses: admittedStatus.selectedStatuses,
      targetHeader: admittedStatus.targetHeader
    }
  } catch (error) {
    console.error('Error fetching admitted status ID:', error);
    return null;
  }
}

const getStatuses = async (statusId) => {
  try{
    const status = await PopulationStatus.findOne({
      where: {
        id: statusId,
      },
    });
    if (!status) return null;
    return {
      selectedStatuses: status.selectedStatuses,
      targetHeader: status.targetHeader,
      statusName: status.statusName
    }
  } catch (error) {
    console.error('Error fetching status ID:', error);
    return null;
  }
}

const getStatusesByTemplateId = async (templateId) => {
  try{
    const statuses = await PopulationStatus.findAll({
      where: {
        templateId,
      },
    });
    return statuses.map(status => ({
      selectedStatuses: status.selectedStatuses,
      targetHeader: status.targetHeader,
      statusName: status.statusName
    }));
  } catch (error) {
    console.error('Error fetching statuses by template ID:', error);
    return [];
  }
}

const getAwardsByTemplateId = async (templateId, sheetIds = []) => {
  try {
    const headerKeys = Array.from({ length: 20 }, (_, i) => `Awd_Cd${i + 1}`);

    const headers = await Header.findAll({
      where: {
        templateId,
        name: headerKeys,
      },
      attributes: ['id'],
      raw: true,
    });

    if (!headers.length || !sheetIds.length) return [];

    const headerIds = headers.map(h => h.id);

    // 🔁 Batch fetch all relevant SheetData in one go
    const sheetDataRows = await SheetData.findAll({
      where: {
        headerId: { [Op.in]: headerIds },
        sheetId: { [Op.in]: sheetIds.filter(Boolean) },
      },
      attributes: ['value'],
      raw: true,
    });

    // 🧠 Deduplicate values
    const uniqueAwards = new Set();
    for (const { value } of sheetDataRows) {
      const name = value?.trim();
      if (name && name !== 'NULL') uniqueAwards.add(name);
    }

    return Array.from(uniqueAwards);
  } catch (error) {
    console.error('Error fetching awards by template ID:', error);
    return [];
  }
};


const calculateStatusStudents = async (sheetId, selectedStatuses, targetHeader, templateId, matchingRows) => {
  const statusHeader = await Header.findOne({
    where: {
      templateId,
      name: targetHeader
    }
  });

  if (!statusHeader) return 0;

  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchingRows },
      headerId: statusHeader.id,
    },
    attributes: ['rowIndex', 'value'],
    raw: true,
  });

  const admittedRows = dataRows.filter(row => selectedStatuses.includes(row.value));
  const admittedCount = admittedRows.length;
  const admittedRowIndexes = admittedRows.map(r => r.rowIndex);

  return {count: admittedCount, rowIndexes: admittedRowIndexes};
}


const calculatePackageStudents = async (sheetId, templateId, matchingRows) => {
  const header = await Header.findOne({
    where: {
      templateId,
      name: 'Y/N Is_Student_Packaged'
    }
  });

  if (!header) return 0;

  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchingRows },
      headerId: header.id,
    },
    attributes: ['rowIndex', 'value'],
    raw: true,
  });

  const rowMap = new Map();
  for (const { rowIndex, value } of dataRows) {
    const val = typeof value === 'string' ? value.trim().toUpperCase() : '';
    rowMap.set(rowIndex, val);
  }


  const packageRowIndexes = [];
  const non_packageRowIndexes = [];


  for (const rowIndex of matchingRows) {
    const val = rowMap.get(rowIndex);
    if (val === 'Y') {
      packageRowIndexes.push(rowIndex);
    } else {
      non_packageRowIndexes.push(rowIndex);
    }
  }

  return { packageRowIndexes, non_packageRowIndexes };
}



const getStudentHeadCountByYear = async (req, res) => {
  const { selectedDate, previousYearDate, twoYearsAgoDate, templateId, populationRuleId } = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;


    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };

    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
    const allStatuses = await getStatusesByTemplateId(templateId);

    const yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
      if (sheetId === null) {
        return {
          yearLabel,
          result: {
            statuses: allStatuses.map(status => ({ statusName: status.statusName, count: 0, packageCount: 0, nonPackageCount: 0, all: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0}, package: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0}, nonPackage: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0} })),
          }
        };
      }

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

      const statusCounts = [];

      if (matchingRows.length > 0) {
        for (const status of allStatuses) {
          const { selectedStatuses, targetHeader, statusName } = status;
          const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
          let { packageRowIndexes, non_packageRowIndexes } = await calculatePackageStudents(sheetId, templateId, rowIndexes);
          packageRowIndexes = Array.isArray(packageRowIndexes) ? packageRowIndexes : [];
          non_packageRowIndexes = Array.isArray(non_packageRowIndexes) ? non_packageRowIndexes : [];
          const revenueStats = await getAveragesMetricsFromMatchedRowsOfPackage(sheetId, rowIndexes, templateId, packageRowIndexes, non_packageRowIndexes);
          statusCounts.push({ statusName, count, packageCount: packageRowIndexes.length, nonPackageCount: non_packageRowIndexes.length, ...revenueStats });
        }

        return {
          yearLabel,
          result: {
            statuses: statusCounts,
          }
        };
      } else {
        return {
          yearLabel,
          result: {
            statuses: allStatuses.map(status => ({ statusName: status.statusName, count: 0, packageCount: 0, nonPackageCount: 0, all: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0}, package: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0}, nonPackage: {netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0} })),
          }
        };
      }
    });

    // Wait for all years to finish
    const yearResults = await Promise.all(yearPromises);

    // Build final results object
    const results = {};
    yearResults.forEach(({ yearLabel, result }) => {
      results[yearLabel] = result;
    });

    res.status(200).json(results);
  } catch (error) {
    console.error('Error getting student headcount by year:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const getRules = async (templateId) => {
    const populationRules = await PopulationRule.findAll({
        where: { templateId, ruleType: 'population' }
    });
    if (!populationRules) {
        throw new Error('Population rules not found');
    }
    return populationRules.map(rule => ({
        name: rule.ruleName,
        conditions: rule.conditions,
        headers: rule.headers
    }));
};

async function getAveragesNetRevenueFromMatchedRows(sheetId, matchedRowIndexes, templateId) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return { netRevenue: 0};
  }

  // Step 1: Get headerIds for Net_Tuition_Revenue and NACUBO_Discount_Rate
  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Net_Tuition_Revenue'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const netTuitionHeaderId = headerMap['Net_Tuition_Revenue'];

  if (!netTuitionHeaderId) {
    return { netRevenue: 0 };
  }

  // Step 2: Fetch relevant SheetData rows
  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [netTuitionHeaderId] },
    },
    attributes: ['headerId', 'value'],
    raw: true,
  });

  // Step 3: Group and calculate averages
  let netTuitionSum = 0;
  let netTuitionCount = 0;

  dataRows.forEach((row) => {
    let rawValue = row.value;

    // Handle percentage strings like "99%" or " 100 %"
    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      rawValue = rawValue.replace('%', '').trim();
    }

    const val = parseFloat(rawValue);
    if (isNaN(val)) return;

    if (row.headerId === netTuitionHeaderId) {
      netTuitionSum += val;
      netTuitionCount++;
    }
  });

  return {
    netRevenue: netTuitionCount ? Math.round(netTuitionSum / netTuitionCount) : 0,
  };
}


const getKPIOfStudents = async (req, res) => {
  const { selectedDate, previousYearDate, twoYearsAgoDate, templateId } = req.body;

  try {
    if (!templateId || !selectedDate) {
      return res.status(400).json({ error: 'templateId and selectedDate are required' });
    }

    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;

    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };

    const allStatuses = await getStatusesByTemplateId(templateId);
    const populationRules = await getRules(templateId);

    const yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
      const ruleResults = [];

      for (const rule of populationRules) {
        let statuses = [];

        if (!sheetId) {
          statuses = allStatuses.map(status => ({
            statusName: status.statusName,
            headCount: 0,
            netRevenue: 0,
          }));
        } else {
          const matchingRows = await applyPopulationRule(templateId, sheetId, rule.conditions, rule.headers);

          if (matchingRows.length > 0) {
            statuses = await Promise.all(allStatuses.map(async status => {
              const { selectedStatuses, targetHeader, statusName } = status;
              const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
              const revenueStats = await getAveragesNetRevenueFromMatchedRows(sheetId, rowIndexes, templateId);
              return {
                statusName,
                headCount: count,
                netRevenue: revenueStats.netRevenue || 0,
              };
            }));
          } else {
            statuses = allStatuses.map(status => ({
              statusName: status.statusName,
              headCount: 0,
              netRevenue: 0,
            }));
          }
        }
        // Push rule result with ruleName
        ruleResults.push({
          ruleName: rule.name, // Include ruleName here
          statuses,
        });
      }

      return {
        yearLabel,
        result: ruleResults,
      };
    });

    const finalResults = await Promise.all(yearPromises);
    res.status(200).json(finalResults);

  } catch (err) {
    console.log("Error while getting KPI: ", err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

async function getFinancialMetricsFromMatchedRows(sheetId, matchedRowIndexes, templateId) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return { TIUG: 0, TIFUG: 0, Avg_TIFUG: 0, Avg_TSG: 0, SNC: 0, Avg_SNC: 0, Avg_NACUBO: 0, Avg_Discount: 0, Avg_C_Discount: 0, Student_Pell: 0, Avg_Need_Met: 0, Avg_SFN: 0, Avg_TNM: 0, Avg_TUN: 0 };
  }

  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Total_Institutional_Gift', 'Total_Institutional_Unfunded_Gift', 'NACUBO_Discount_Rate', 'Total_Discount_Rate',
      'Institutional_Merit_As_%_Of_Need_Met', 'Total_Gift_Aid', 'Net_Charges_To_Student', 'Campus_Discount Rate',
      'Y/N Is_Student_Pell_Eligible', 'Student_Financial_Need', 'Total_Need_Met', 'GAP/Unmet_Need'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const totalInstGiftId = headerMap['Total_Institutional_Gift'];
  const totalInstUnfundedGiftId = headerMap['Total_Institutional_Unfunded_Gift'];
  const discountRateHeaderId = headerMap['NACUBO_Discount_Rate'];
  const totalDiscountHeaderId = headerMap['Total_Discount_Rate'];
  const instMeritNeedId = headerMap['Institutional_Merit_As_%_Of_Need_Met'];
  const totalGiftAidId = headerMap['Total_Gift_Aid'];
  const netChargesId = headerMap['Net_Charges_To_Student'];
  const campusDiscountId = headerMap['Campus_Discount Rate'];
  const studentPellId = headerMap['Y/N Is_Student_Pell_Eligible'];
  const studentFinancialNeedId = headerMap['Student_Financial_Need'];
  const totalNeedMetId = headerMap['Total_Need_Met'];
  const gapUnmetNeedId = headerMap['GAP/Unmet_Need'];

  if (!totalInstGiftId && !totalInstUnfundedGiftId && !discountRateHeaderId && !totalDiscountHeaderId 
    && !instMeritNeedId && !totalGiftAidId && !netChargesId && !campusDiscountId &&
    !studentPellId && !studentFinancialNeedId && !totalNeedMetId && !gapUnmetNeedId) {
    return { TIUG: 0, TIFUG: 0, Avg_TIFUG: 0, Avg_TSG: 0, SNC: 0, Avg_SNC: 0, Avg_NACUBO: 0, Avg_Discount: 0, Avg_C_Discount: 0, Student_Pell: 0, Avg_Need_Met: 0, Avg_SFN: 0, Avg_TNM: 0, Avg_TUN: 0 };
  }

  // Step 2: Fetch relevant SheetData rows
  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [totalInstGiftId, totalInstUnfundedGiftId, discountRateHeaderId, totalDiscountHeaderId,
        instMeritNeedId, totalGiftAidId, netChargesId, campusDiscountId, studentPellId,
        studentFinancialNeedId, totalNeedMetId, gapUnmetNeedId] },
    },
    attributes: ['headerId', 'value'],
    raw: true,
  });

  // Step 3: Group and calculate averages
  let totalInstGiftSum = 0;
  let totalInstGiftCount = 0;
  let totalInstUnfundedGiftSum = 0;
  let totalInstUnfundedGiftCount = 0;
  let totalNACUBORateSum = 0;
  let totalNACUBORateCount = 0;
  let totalDiscountSum = 0;
  let totalDiscountCount = 0;
  let instMeritNeedSum = 0;
  let instMeritNeedCount = 0;

  // Step 4: Additional aggregations
  let totalGiftAidSum = 0, totalGiftAidCount = 0;
  let netChargesSum = 0, netChargesCount = 0;
  let campusDiscountSum = 0, campusDiscountCount = 0;
  let pellEligibleCount = 0;
  let studentFinancialNeedSum = 0, studentFinancialNeedCount = 0;
  let totalNeedMetSum = 0, totalNeedMetCount = 0;
  let gapUnmetNeedSum = 0, gapUnmetNeedCount = 0;


  dataRows.forEach((row) => {
    let rawValue = row.value;

    // Handle percentage strings like "99%" or " 100 %"
    if (typeof rawValue === 'string' && rawValue.includes('%')) {
      rawValue = rawValue.replace('%', '').trim();
    }

    const val = parseFloat(rawValue);
    if (isNaN(val)) return;

    if (row.headerId === totalInstGiftId) {
      totalInstGiftSum += val;
      totalInstGiftCount++;
    } else if (row.headerId === totalInstUnfundedGiftId) {
      totalInstUnfundedGiftSum += val;
      totalInstUnfundedGiftCount++;
    } else if (row.headerId === discountRateHeaderId) {
      totalNACUBORateSum += val;
      totalNACUBORateCount++;
    } else if (row.headerId === instMeritNeedId) {
      instMeritNeedSum += val;
      instMeritNeedCount++;
    } else if (row.headerId === totalDiscountHeaderId) {
      totalDiscountSum += val;
      totalDiscountCount++;
    } else if (row.headerId === totalGiftAidId) {
      totalGiftAidSum += val;
      totalGiftAidCount++;
    } else if (row.headerId === netChargesId) {
      netChargesSum += val;
      netChargesCount++;
    } else if (row.headerId === campusDiscountId) {
      campusDiscountSum += val;
      campusDiscountCount++;
    } else if (row.headerId === studentFinancialNeedId) {
      studentFinancialNeedSum += val;
      studentFinancialNeedCount++;
    } else if (row.headerId === totalNeedMetId) {
      totalNeedMetSum += val;
      totalNeedMetCount++;
    } else if (row.headerId === gapUnmetNeedId) {
      gapUnmetNeedSum += val;
      gapUnmetNeedCount++;
    }
  });

  dataRows.forEach((row) => {
    const val = typeof row.value === 'string' ? row.value.trim().toUpperCase() : '';
    if (row.headerId === studentPellId && val === 'Y') {
      pellEligibleCount++;
    }
  });
  const totalStudents = matchedRowIndexes.length;
  let nacuboDiscount = totalNACUBORateCount ? (totalNACUBORateSum / totalNACUBORateCount).toFixed(2) : 0;
  let totalDiscount = totalDiscountCount ? (totalDiscountSum / totalDiscountCount).toFixed(2) : 0;

  return {
    TIUG: Math.round(totalInstUnfundedGiftSum),
    TIFUG: Math.round(totalInstGiftSum),
    Avg_TIFUG: totalStudents ? Math.round(totalInstGiftSum / totalStudents) : 0,
    Avg_TSG: totalGiftAidCount ? Math.round(totalGiftAidSum / totalGiftAidCount) : 0,
    SNC: Math.round(netChargesSum),
    Avg_SNC: netChargesCount ? Math.round(netChargesSum / netChargesCount) : 0,
    Avg_NACUBO: nacuboDiscount,
    Avg_Discount: totalDiscount,
    Avg_C_Discount: campusDiscountCount ? (campusDiscountSum / campusDiscountCount).toFixed(2) : 0,
    Student_Pell: totalStudents ? ((pellEligibleCount / totalStudents) * 100).toFixed(2) : 0,
    Avg_Need_Met: instMeritNeedCount ? Math.round(instMeritNeedSum / instMeritNeedCount) : 0,
    Avg_SFN: studentFinancialNeedCount ? Math.round(studentFinancialNeedSum / studentFinancialNeedCount) : 0,
    Avg_TNM: totalNeedMetCount ? Math.round(totalNeedMetSum / totalNeedMetCount) : 0,
    Avg_TUN: gapUnmetNeedCount ? Math.round(gapUnmetNeedSum / gapUnmetNeedCount) : 0,
  };
}

async function getFAFSAFromMatchedRows(sheetId, matchedRowIndexes, templateId) {
  if (!sheetId || !matchedRowIndexes || matchedRowIndexes.length === 0) {
    return { FAFSA: 0 };
  }

  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Y/N FAFSA_Received', 'Y/N Is_Student_Pell_Eligible'] },
    },
    raw: true,
  });

  const headerMap = headers.reduce((acc, h) => {
    acc[h.name] = h.id;
    return acc;
  }, {});

  const fafsaReceivedId = headerMap['Y/N FAFSA_Received'];
  const studentPellId = headerMap['Y/N Is_Student_Pell_Eligible'];

  if (!fafsaReceivedId || !studentPellId) {
    return { FAFSA: 0 };
  }

  const dataRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchedRowIndexes },
      headerId: { [Op.in]: [fafsaReceivedId, studentPellId] },
    },
    attributes: ['headerId', 'value', 'rowIndex'],
    raw: true,
  });

  // Group values by rowIndex
  const rowMap = {};
  for (const row of dataRows) {
    const val = typeof row.value === 'string' ? row.value.trim().toUpperCase() : '';
    if (!rowMap[row.rowIndex]) rowMap[row.rowIndex] = {};
    if (row.headerId === fafsaReceivedId) rowMap[row.rowIndex].fafsa = val;
    if (row.headerId === studentPellId) rowMap[row.rowIndex].pell = val;
  }

  let fafsaYesCount = 0;
  let pellEligibleWithFafsaCount = 0;

  for (const rowIndex of matchedRowIndexes) {
    const entry = rowMap[rowIndex];
    if (entry?.fafsa === 'Y') {
      fafsaYesCount++;
      if (entry.pell === 'Y') {
        pellEligibleWithFafsaCount++;
      }
    }
  }

  return {
    FAFSA: fafsaYesCount ? ((pellEligibleWithFafsaCount / fafsaYesCount) * 100).toFixed(2) : 0,
  };
}

const getFinancialAidsValues = async (req, res) => {
  const { selectedDate, templateId, populationRuleId } = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const selectedSheetId = await getSheetIdBySubmissionDate(selectedDate, templateId);

    const allStatuses = await getStatusesByTemplateId(templateId);

    if (!selectedSheetId) {
      const fallbackStatuses = allStatuses.map(status => ({
        statusName: status.statusName,
        TIUG: 0, TIFUG: 0, Avg_TIFUG: 0, Avg_TSG: 0, SNC: 0, Avg_SNC: 0,
        Avg_NACUBO: 0, Avg_Discount: 0, Avg_C_Discount: 0,
        FAFSA: 0, Student_Pell: 0, Avg_Need_Met: 0,
        Avg_SFN: 0, Avg_TNM: 0, Avg_TUN: 0
      }));
      return res.status(200).json(fallbackStatuses);
    }

    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
    const matchingRows = await applyPopulationRule(templateId, selectedSheetId, conditions, headers);

    const statusCounts = [];

    if (matchingRows.length > 0) {
      for (const status of allStatuses) {
        const { selectedStatuses, targetHeader, statusName } = status;
        const { rowIndexes } = await calculateStatusStudents(
          selectedSheetId,
          selectedStatuses,
          targetHeader,
          templateId,
          matchingRows
        );

        const revenueStats = await getFinancialMetricsFromMatchedRows(selectedSheetId, rowIndexes, templateId);
        const fafsaStats = await getFAFSAFromMatchedRows(selectedSheetId, rowIndexes, templateId);

        statusCounts.push({
          statusName,
          ...revenueStats,
          ...fafsaStats
        });
      }
    } else {
      statusCounts.push(...allStatuses.map(status => ({
        statusName: status.statusName,
        TIUG: 0, TIFUG: 0, Avg_TIFUG: 0, Avg_TSG: 0, SNC: 0, Avg_SNC: 0,
        Avg_NACUBO: 0, Avg_Discount: 0, Avg_C_Discount: 0,
        FAFSA: 0, Student_Pell: 0, Avg_Need_Met: 0,
        Avg_SFN: 0, Avg_TNM: 0, Avg_TUN: 0
      })));
    }

    return res.status(200).json(statusCounts);

  } catch (err) {
    console.error("Error while getting financial aids values:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const calculateFilerStats = async (sheetId, templateId, admittedRowIndexes) => {
  // Step 1: Get header IDs for SAI and Student_Financial_Need
  const [saiHeader, needHeader] = await Promise.all([
    Header.findOne({ where: { templateId, name: 'SAI' } }),
    Header.findOne({ where: { templateId, name: 'Student_Financial_Need' } })
  ]);

  if (!saiHeader || !needHeader) {
    return { totalFilers: 0, needBased: 0, totalFilerPercent: 0, needBasedPercent: 0, totalFilerSAI: 0, needBasedSAI: 0, totalFilerAvgNeed: 0, needBasedAvgNeed: 0 }
  };

  // Step 2: Fetch SAI and Need data for admittedRowIndexes
  const [saiRows, needRows] = await Promise.all([
    SheetData.findAll({
      where: {
        sheetId,
        rowIndex: { [Op.in]: admittedRowIndexes },
        headerId: saiHeader.id
      },
      attributes: ['rowIndex', 'value'],
      raw: true
    }),
    SheetData.findAll({
      where: {
        sheetId,
        rowIndex: { [Op.in]: admittedRowIndexes },
        headerId: needHeader.id
      },
      attributes: ['rowIndex', 'value'],
      raw: true
    })
  ]);

  // Step 3: Build lookup maps for fast access
  const saiMap = Object.fromEntries(saiRows.map(r => [r.rowIndex, r.value]));
  const needMap = Object.fromEntries(needRows.map(r => [r.rowIndex, r.value]));

  // Step 4: Filter totalFilers (SAI not blank)
  const totalFilers = admittedRowIndexes.filter(index => {
    const val = saiMap[index];
    return val !== null && val !== undefined && val.toString().trim() !== '';
  });

  // Step 5: Filter needBased (SAI exists AND Need > 0)
  const needBased = totalFilers.filter(index => {
    const needVal = parseFloat(needMap[index]);
    return !isNaN(needVal) && needVal > 0;
  });

  // Step 6: Calculate percentages
  const admittedCount = admittedRowIndexes.length;
  const totalFilerPercent = admittedCount ? ((totalFilers.length / admittedCount) * 100).toFixed(2) : 0;
  const needBasedPercent = admittedCount ? ((needBased.length / admittedCount) * 100).toFixed(2) : 0;

  // Step 7: Calculate averages
  const totalFilerSAIValues = totalFilers.map(i => parseFloat(saiMap[i])).filter(v => !isNaN(v));
  const needBasedSAIValues = needBased.map(i => parseFloat(saiMap[i])).filter(v => !isNaN(v));
  const totalFilerNeedValues = totalFilers.map(i => parseFloat(needMap[i])).filter(v => !isNaN(v));
  const needBasedNeedValues = needBased.map(i => parseFloat(needMap[i])).filter(v => !isNaN(v));

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    totalFilers: totalFilers.length,
    needBased: needBased.length,
    totalFilerPercent,
    needBasedPercent,
    totalFilerAvgSAI: avg(totalFilerSAIValues),
    needBasedAvgSAI: avg(needBasedSAIValues),
    totalFilerAvgNeed: avg(totalFilerNeedValues),
    needBasedAvgNeed: avg(needBasedNeedValues)
  };
};

const getFAFSAFilerSummary = async (req, res) => {
  const {selectedDate, previousYearDate, twoYearsAgoDate, templateId, populationRuleId} = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;

    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };

    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
    const allStatuses = await getStatusesByTemplateId(templateId);

    const yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
      if (sheetId === null) {
        return {
          yearLabel,
          result: {
            statuses: allStatuses.map(status => ({ statusName: status.statusName, totalFilers: 0, needBased: 0, totalFilerPercent: 0, needBasedPercent: 0, totalFilerSAI: 0, needBasedSAI: 0, totalFilerAvgNeed: 0, needBasedAvgNeed: 0 })),
          }
        };
      }

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

      const statusCounts = [];

      if (matchingRows.length > 0) {
        for (const status of allStatuses) {
          const { selectedStatuses, targetHeader, statusName } = status;
          const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
          const revenueStats = await calculateFilerStats(sheetId, templateId, rowIndexes);
          statusCounts.push({ statusName, ...revenueStats });
        }

        return {
          yearLabel,
          result: {
            statuses: statusCounts,
          }
        };
      } else {
        return {
          yearLabel,
          result: {
            statuses: allStatuses.map(status => ({ statusName: status.statusName, totalFilers: 0, needBased: 0, totalFilerPercent: 0, needBasedPercent: 0, totalFilerSAI: 0, needBasedSAI: 0, totalFilerAvgNeed: 0, needBasedAvgNeed: 0 })),
          }
        };
      }
    });

    // Wait for all years to finish
    const yearResults = await Promise.all(yearPromises);

    // Build final results object
    const results = {};
    yearResults.forEach(({ yearLabel, result }) => {
      results[yearLabel] = result;
    });

    res.status(200).json(results);
  } catch (err) {
    console.error("Error while getting FAFSA filer summary:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const getAwardAmountsByTemplateId = async (templateId, rowIndexes = []) => {
  try {
    const awardKeys = Array.from({ length: 20 }, (_, i) => `Awd_Cd${i + 1}`);
    const amountKeys = Array.from({ length: 20 }, (_, i) => `Awd_Amt${i + 1}`);
    const statusKeys = Array.from({ length: 20 }, (_, i) => `Awd_Status${i + 1}`);

    const headers = await Header.findAll({
      where: {
        templateId,
        name: [...awardKeys, ...amountKeys, ...statusKeys],
      },
    });

    if (!headers.length) return [];

    const headerMap = {};
    headers.forEach(h => {
      headerMap[h.name] = h.id;
    });

    const allHeaderIds = Object.values(headerMap);

    // 🔁 Batch fetch all SheetData in one go
    const sheetDataRows = await SheetData.findAll({
      where: {
        headerId: { [Op.in]: allHeaderIds },
        rowIndex: { [Op.in]: rowIndexes },
      },
      attributes: ['headerId', 'rowIndex', 'value'],
      raw: true,
    });

    // 🧠 Build fast lookup: data[rowIndex][headerId] = value
    const data = {};
    for (const { headerId, rowIndex, value } of sheetDataRows) {
      if (!data[rowIndex]) data[rowIndex] = {};
      data[rowIndex][headerId] = value;
    }

    const awardStats = {};

    for (const rowIndex of rowIndexes) {
      for (let i = 0; i < 20; i++) {
        const cdKey = `Awd_Cd${i + 1}`;
        const amtKey = `Awd_Amt${i + 1}`;
        const statusKey = `Awd_Status${i + 1}`;

        const cdVal = data[rowIndex]?.[headerMap[cdKey]];
        const amtVal = data[rowIndex]?.[headerMap[amtKey]];
        const statusVal = data[rowIndex]?.[headerMap[statusKey]];

        const awardName = cdVal?.trim();
        const amount = parseFloat(amtVal) || 0;
        const status = statusVal?.trim()?.toLowerCase();

        if (!awardName || !['accepted', 'pending'].includes(status)) continue;

        if (!awardStats[awardName]) {
          awardStats[awardName] = {
            acceptedAmount: 0,
            pendingAmount: 0,
            acceptedCount: 0,
            pendingCount: 0,
            totalAmount: 0,
          };
        }

        if (status === 'accepted') {
          awardStats[awardName].acceptedAmount += amount;
          awardStats[awardName].acceptedCount += 1;
        } else if (status === 'pending') {
          awardStats[awardName].pendingAmount += amount;
          awardStats[awardName].pendingCount += 1;
        }

        awardStats[awardName].totalAmount += amount;
      }
    }

    return awardStats;
  } catch (error) {
    console.error('Error calculating award amounts:', error);
    return {};
  }
};

const calculateAvgSAIAndNeed = async (sheetId, templateId, admittedRowIndexes) => {
  try {
    const headers = await Header.findAll({
      where: {
        templateId,
        name: ['SAI', 'Student_Financial_Need'],
      },
      attributes: ['id', 'name'],
      raw: true,
    });

    const headerMap = {};
    headers.forEach(h => { headerMap[h.name] = h.id; });

    const saiId = headerMap['SAI'];
    const needId = headerMap['Student_Financial_Need'];

    if (!saiId || !needId) return { AvgSAI: 0, AvgNeed: 0 };

    // 🔁 Batch fetch both SAI and Need rows in one query
    const sheetDataRows = await SheetData.findAll({
      where: {
        sheetId,
        rowIndex: { [Op.in]: admittedRowIndexes },
        headerId: { [Op.in]: [saiId, needId] },
      },
      attributes: ['headerId', 'value'],
      raw: true,
    });

    // 🧠 Split values
    const saiValues = [];
    const needValues = [];

    for (const { headerId, value } of sheetDataRows) {
      const num = parseFloat(value);
      if (isNaN(num)) continue;

      if (headerId === saiId) saiValues.push(num);
      else if (headerId === needId) needValues.push(num);
    }

    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

    return {
      AvgSAI: avg(saiValues),
      AvgNeed: avg(needValues),
    };
  } catch (error) {
    console.error('Error calculating averages:', error);
    return { AvgSAI: 0, AvgNeed: 0 };
  }
};

const getAwardStats = async (req, res) => {
  const { selectedDate, previousYearDate, twoYearsAgoDate, templateId, populationRuleId, financialBandId='', academicBandId='', isAllStudent=false } = req.body;
  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;
    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };
    const allStatuses = await getStatusesByTemplateId(templateId);
    const rawSheetIds = Object.values(sheetIds);
    const validSheetIds = rawSheetIds.filter(id => id);
    const allAwards = await getAwardsByTemplateId(templateId, validSheetIds);
    const zeroedAwardStats = {};
    allAwards.forEach(award => {
      zeroedAwardStats[award] = {
        acceptedAmount: 0,
        acceptedCount: 0,
        pendingAmount: 0,
        pendingCount: 0,
        totalAmount: 0,
      };
    });
    let yearPromises;
    if (!isAllStudent) {
      const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
      yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
        if (sheetId === null) {
          return {
            yearLabel,
            result: {
              statuses: allStatuses.map(status => ({ statusName: status.statusName, awards: zeroedAwardStats, avgNeed: 0, avgSAI: 0})),
            }
          };
        }
        let matchingRows;
        matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

        if (matchingRows.length === 0) {
          return {
            yearLabel,
            result: {
              statuses: allStatuses.map(status => ({ statusName: status.statusName, awards: zeroedAwardStats, avgNeed: 0, avgSAI: 0})),
            }
          };
        }
        if (financialBandId !== '') {
          const { conditions, headers } = await getRuleConditionsAndHeaders(financialBandId);
          matchingRows = await applyNeedBracket(templateId, sheetId, conditions, headers, matchingRows);
        }
        if (academicBandId !== '') {
          const { conditions, headers } = await getRuleConditionsAndHeaders(academicBandId);
          matchingRows = await applyNeedBracket(templateId, sheetId, conditions, headers, matchingRows);
        }
        const statusCounts = [];
        if (matchingRows.length > 0) {
          for (const status of allStatuses) {
            const { selectedStatuses, targetHeader, statusName } = status;
            const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
            const awardStats = await getAwardAmountsByTemplateId(templateId, rowIndexes);
            const { AvgSAI, AvgNeed } = await calculateAvgSAIAndNeed(sheetId, templateId, rowIndexes);
            statusCounts.push({ statusName, awards: awardStats, avgSAI: AvgSAI, avgNeed: AvgNeed });
          }

          return {
            yearLabel,
            result: {
              statuses: statusCounts,
            }
          };
        } else {
          return {
            yearLabel,
            result: {
              statuses: allStatuses.map(status => ({ statusName: status.statusName, awards: zeroedAwardStats, avgNeed: 0, avgSAI: 0})),
            }
          };
        };
      });

    } else {
      yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
        if (sheetId === null) {
          return {
            yearLabel,
            result: {
              statuses: allStatuses.map(status => ({ statusName: status.statusName, awards: zeroedAwardStats, avgNeed: 0, avgSAI: 0})),
            }
          };
        }
        let matchingRows;
        matchingRows = (
          await SheetData.findAll({
            where: { sheetId },
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('rowIndex')), 'rowIndex']],
            raw: true,
          })
        ).map(r => r.rowIndex);
        const statusCounts = [];
        if (matchingRows.length > 0) {
          if (financialBandId !== '') {
            const { conditions, headers } = await getRuleConditionsAndHeaders(financialBandId);
            matchingRows = await applyNeedBracket(templateId, sheetId, conditions, headers, matchingRows);
          }
          if (academicBandId !== '') {
            const { conditions, headers } = await getRuleConditionsAndHeaders(academicBandId);
            matchingRows = await applyNeedBracket(templateId, sheetId, conditions, headers, matchingRows);
          }

          for (const status of allStatuses) {
            const { selectedStatuses, targetHeader, statusName } = status;
            const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
            const awardStats = await getAwardAmountsByTemplateId(templateId, rowIndexes);
            const { AvgSAI, AvgNeed } = await calculateAvgSAIAndNeed(sheetId, templateId, rowIndexes);
            statusCounts.push({ statusName, awards: awardStats, avgSAI: AvgSAI, avgNeed: AvgNeed });
          }

          return {
            yearLabel,
            result: {
              statuses: statusCounts,
            }
          };
        } else {
          return {
            yearLabel,
            result: {
              statuses: allStatuses.map(status => ({ statusName: status.statusName, awards: zeroedAwardStats, avgNeed: 0, avgSAI: 0})),
            }
          };
        };
      });
    }
    const yearResults = await Promise.all(yearPromises);
    const results = {};
      yearResults.forEach(({ yearLabel, result }) => {
        results[yearLabel] = result;
    });

    res.status(200).json(results);
  } catch (err) {
    console.error("Error while getting award stats:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

const getStealthMatchedRows = async (templateId, sheetId, matchingRows) => {
  const stealthHeader = await Header.findOne({
    where: { templateId, name: 'Y/N Stealth APP' },
    attributes: ['id'],
    raw: true,
  });

  if (!stealthHeader) return { stealthRowIndexes: [], non_stealthRowIndexes: [] };

  const stealthRows = await SheetData.findAll({
    where: {
      sheetId,
      rowIndex: { [Op.in]: matchingRows },
      headerId: stealthHeader.id,
    },
    attributes: ['rowIndex', 'value'],
    raw: true,
  });

  const stealthRowMap = new Map();
  for (const { rowIndex, value } of stealthRows) {
    const val = typeof value === 'string' ? value.trim().toUpperCase() : '';
    stealthRowMap.set(rowIndex, val);
  }


  const stealthRowIndexes = [];
  const non_stealthRowIndexes = [];


  for (const rowIndex of matchingRows) {
    const val = stealthRowMap.get(rowIndex);
    if (val === 'Y') {
      stealthRowIndexes.push(rowIndex);
    } else {
      non_stealthRowIndexes.push(rowIndex);
    }
  }

  return { stealthRowIndexes, non_stealthRowIndexes };
};


const getStudentStealthCountByYear = async (req, res) => {
  const { selectedDate, previousYearDate, twoYearsAgoDate, templateId, populationRuleId } = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;


    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };

    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
    const allStatuses = await getStatusesByTemplateId(templateId);

    const yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
      if (sheetId === null) {
        const statusCounts = allStatuses.map(status => ({
          statusName: status.statusName,
          totalCount: 0,
          stealthCount: 0,
          nonStealthCount: 0,
          stealthStats: {
            netRevenue: 0,
            netCharges: 0,
            nacuboDiscount: 0,
            totalDiscount: 0
          },
          nonStealthStats: {
            netRevenue: 0,
            netCharges: 0,
            nacuboDiscount: 0,
            totalDiscount: 0
          }
        }));

        return {
          yearLabel,
          result: {
            statuses: statusCounts
          }
        };
      }

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

      if (matchingRows.length > 0) {
        const statusCounts = [];
        for (const status of allStatuses) {
          const { selectedStatuses, targetHeader, statusName } = status;
          const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
          const { stealthRowIndexes, non_stealthRowIndexes } = await getStealthMatchedRows(templateId, sheetId, rowIndexes);
          const stealthRevenueStats = await getAveragesMetricsFromMatchedRows(sheetId, stealthRowIndexes, templateId);
          const nonStealthRevenueStats = await getAveragesMetricsFromMatchedRows(sheetId, non_stealthRowIndexes, templateId);
          statusCounts.push({ statusName, totalCount: count, stealthCount: stealthRowIndexes.length, nonStealthCount: non_stealthRowIndexes.length,  stealthStats: stealthRevenueStats, nonStealthStats: nonStealthRevenueStats });
        }

        return {
          yearLabel,
          result: {
            statuses: statusCounts,
          }
        };
      } else {
        const statusCounts = allStatuses.map(status => ({
          statusName: status.statusName,
          totalCount: 0,
          stealthCount: 0,
          nonStealthCount: 0,
          stealthStats: {
            netRevenue: 0,
            netCharges: 0,
            nacuboDiscount: 0,
            totalDiscount: 0
          },
          nonStealthStats: {
            netRevenue: 0,
            netCharges: 0,
            nacuboDiscount: 0,
            totalDiscount: 0
          }
        }));

        return {
          yearLabel,
          result: {
            statuses: statusCounts
          }
        };
      }
    });

    // Wait for all years to finish
    const yearResults = await Promise.all(yearPromises);

    // Build final results object
    const results = {};
    yearResults.forEach(({ yearLabel, result }) => {
      results[yearLabel] = result;
    });

    res.status(200).json(results);
  } catch (error) {
    console.error('Error getting stealth student headCount by year:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

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

const getExportableStudentData = async (req, res) => {
  const {
    selectedDate,
    previousYearDate,
    twoYearsAgoDate,
    templateId,
    populationRuleId,
    statusId,
  } = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId || !statusId) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    const selectedYear = new Date(selectedDate).getFullYear();
    const previousYear = selectedYear - 1;
    const twoYearsAgo = selectedYear - 2;

    const sheetIds = {
      [selectedYear]: await getSheetIdBySubmissionDate(selectedDate, templateId),
      [previousYear]: await getSheetIdBySubmissionDate(previousYearDate, templateId),
      [twoYearsAgo]: await getSheetIdBySubmissionDate(twoYearsAgoDate, templateId),
    };

    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);

    const statusObj = await PopulationStatus.findOne({
      where: { id: statusId },
      attributes: ['statusName', 'selectedStatuses', 'targetHeader'],
      raw: true,
    });

    if (!statusObj) {
      return res.status(400).json({ error: 'Invalid statusId' });
    }

    const { selectedStatuses, targetHeader } = statusObj;

    const allHeaders = await Header.findAll({
      where: { templateId },
      attributes: ['id', 'name'],
      raw: true,
    });
    const sortedHeaders = sortHeadersFlexibleMatch(allHeaders);
    const headerMap = Object.fromEntries(sortedHeaders.map(h => [h.id, h.name]));
    const headerNames = sortedHeaders.map(h => h.name);

    const yearPromises = Object.entries(sheetIds).map(async ([yearLabel, sheetId]) => {
      if (!sheetId) {
        return { yearLabel, headers: headerNames, rows: [] };
      }

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

      if (matchingRows.length === 0) {
        return { yearLabel, headers: headerNames, rows: [] };
      }

      const { rowIndexes } = await calculateStatusStudents(
        sheetId,
        selectedStatuses,
        targetHeader,
        templateId,
        matchingRows
      );

      if (rowIndexes.length === 0) {
        return { yearLabel, headers: headerNames, rows: [] };
      }

      const sheetData = await SheetData.findAll({
        where: {
          sheetId,
          rowIndex: { [Op.in]: rowIndexes },
          headerId: { [Op.in]: sortedHeaders.map(h => h.id) },
        },
        attributes: ['rowIndex', 'headerId', 'value'],
        raw: true,
      });

      const grouped = {};
      for (const { rowIndex, headerId, value } of sheetData) {
        if (!grouped[rowIndex]) grouped[rowIndex] = {};
        grouped[rowIndex][headerMap[headerId]] = value;
      }

      const rows = rowIndexes.map(index => {
        const row = grouped[index] || {};
        return headerNames.reduce((acc, name) => {
          acc[name] = row[name] ?? '';
          return acc;
        }, {});
      });

      return { yearLabel, headers: headerNames, rows };
    });

    const yearResults = await Promise.all(yearPromises);

    const final = {};
    yearResults.forEach(({ yearLabel, headers, rows }) => {
      final[yearLabel] = { headers, rows };
    });

    const buffer = await generateMultiYearExcelFile(final);
    const currentDate = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${statusObj.statusName}_${currentDate}.xlsx`);
    res.status(200).send(buffer);
  } catch (error) {
    console.error('Error exporting student data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};


async function analyzeStudentsByStateAndCounty(sheetId, templateId, rowIndexes) {
  try {
    // 🎯 Step 1: Fetch required headers
    const headers = await Header.findAll({
      where: {
        templateId,
        name: [
          'SAI',
          'Student_Financial_Need',
          'Student_State',
          'County',
          'Student_Address_1',
          'Student_City',
        ],
      },
      attributes: ['id', 'name'],
      raw: true,
    });
    console.time('analyzeStudentsByStateAndCounty Headers Fetch');
    const headerMap = {};
    headers.forEach(h => { headerMap[h.name] = h.id; });
    console.timeEnd('analyzeStudentsByStateAndCounty Headers Fetch');
    const required = ['SAI', 'Student_Financial_Need', 'Student_State', 'County', 'Student_Address_1', 'Student_City'];
    for (const key of required) {
      if (!headerMap[key]) throw new Error(`Missing header: ${key}`);
    }

    // 📥 Step 2: Fetch SheetData for given rows
    const sheetData = await SheetData.findAll({
      where: {
        sheetId,
        rowIndex: { [Op.in]: rowIndexes },
        headerId: { [Op.in]: Object.values(headerMap) },
      },
      attributes: ['rowIndex', 'headerId', 'value'],
      raw: true,
    });

    // 🧠 Step 3: Reconstruct student objects
    const studentMap = {};
    for (const row of sheetData) {
      const { rowIndex, headerId, value } = row;
      if (!studentMap[rowIndex]) studentMap[rowIndex] = { rowIndex };
      const headerName = Object.keys(headerMap).find(k => headerMap[k] === headerId);
      studentMap[rowIndex][headerName] = value;
    }

    const students = Object.values(studentMap);

    // 🗺️ Step 4: Geocode students
    const enriched = await geocodeStudents(
      students.map(s => ({
        address: s.Student_Address_1,
        city: s.Student_City,
        state: s.Student_State,
        ...s,
      }))
    );

    // 🧮 Step 5: Group by State
    const stateGroups = {};
    for (const s of enriched) {
      const state = s.Student_State?.trim();
      if (!state) continue;
      if (!stateGroups[state]) stateGroups[state] = [];
      stateGroups[state].push(s);
    }

    const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;

    const stateResults = {};
    for (const [state, group] of Object.entries(stateGroups)) {
      const saiValues = [];
      const needValues = [];

      for (const s of group) {
        const sai = parseFloat(s.SAI);
        const need = parseFloat(s.Student_Financial_Need);
        if (!isNaN(sai)) saiValues.push(sai);
        if (!isNaN(need)) needValues.push(need);
      }

      stateResults[state] = {
        studentCount: group.length,
        AvgSAI: avg(saiValues),
        AvgNeed: avg(needValues),
        students: group.map(s => ({
          rowIndex: s.rowIndex,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      };
    }

    // 🧮 Step 6: Group by County
    const countyGroups = {};
    for (const s of enriched) {
      const county = s.County?.trim();
      if (!county) continue;
      if (!countyGroups[county]) countyGroups[county] = [];
      countyGroups[county].push(s);
    }

    const countyResults = {};
    for (const [county, group] of Object.entries(countyGroups)) {
      const saiValues = [];
      const needValues = [];

      for (const s of group) {
        const sai = parseFloat(s.SAI);
        const need = parseFloat(s.Student_Financial_Need);
        if (!isNaN(sai)) saiValues.push(sai);
        if (!isNaN(need)) needValues.push(need);
      }

      countyResults[county] = {
        studentCount: group.length,
        AvgSAI: avg(saiValues),
        AvgNeed: avg(needValues),
        students: group.map(s => ({
          rowIndex: s.rowIndex,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      };
    }

    return { byState: stateResults, byCounty: countyResults };
  } catch (err) {
    console.error('Error in analyzeStudentsByStateAndCounty:', err);
    return { byState: {}, byCounty: {} };
  }
}

const getDatabyStateCounty = async (req, res) => {
  const { selectedDate, templateId, populationRuleId } = req.body;

  try {
    if (!selectedDate || !templateId || !populationRuleId) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const selectedSheetId = await getSheetIdBySubmissionDate(selectedDate, templateId);
    const { conditions, headers } = await getRuleConditionsAndHeaders(populationRuleId);
    const allStatuses = await getStatusesByTemplateId(templateId);

    if (!selectedSheetId) {
      const emptyStatuses = allStatuses.map(status => ({
        statusName: status.statusName,
        countryData: [],
        countyData: []
      }));
      return res.status(200).json({ statuses: emptyStatuses });
    }

    const matchingRows = await applyPopulationRule(templateId, selectedSheetId, conditions, headers);
    if (matchingRows.length === 0) {
      const emptyStatuses = allStatuses.map(status => ({
        statusName: status.statusName,
        countryData: [],
        countyData: []
      }));
      return res.status(200).json({ statuses: emptyStatuses });
    }

    console.time('statusProcessing');

    const statusData = await Promise.all(
      allStatuses.map(async status => {
        const { selectedStatuses, targetHeader, statusName } = status;

        const { count, rowIndexes } = await calculateStatusStudents(
          selectedSheetId,
          selectedStatuses,
          targetHeader,
          templateId,
          matchingRows
        );

        const result = await analyzeStudentsByStateAndCounty(
          selectedSheetId,
          templateId,
          rowIndexes
        );

        return {
          statusName,
          countryData: result.byState,
          countyData: result.byCounty
        };
      })
    );

    console.timeEnd('statusProcessing');

    return res.status(200).json({ statuses: statusData });

  } catch (err) {
    console.error("Error while getting data by country/county:", err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
    savePopulationStatus,
    savePopulationSubmissionDate,
    updatePopulationSubmissionDate,
    getPopulationSubmissionsByTemplateId,
    deletePopulationSubmission,
    getPopulationStatusByTemplateId,
    updatePopulationStatus,
    deletePopulationStatus,
    findClosestPreviousDate,
    getStudentHeadCountByYear,
    getKPIOfStudents,
    getFinancialAidsValues,
    getFAFSAFilerSummary,
    getAwardStats,
    getStudentStealthCountByYear,
    getExportableStudentData,
    getDatabyStateCounty
};