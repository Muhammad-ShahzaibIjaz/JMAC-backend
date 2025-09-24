const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes } = require('sequelize');
const { PopulationStatus, PopulationSubmission, Header, PopulationRule, SheetData } = require('../models');
const { evaluateConditions } = require('../services/evaluation');

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
        console.log(`Max row index in sheet ${sheetId}: ${maxRowIndex}`);
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
        console.log(`Found ${matchingRowIndices.length} matching rows`);
        return matchingRowIndices;

    } catch (error) {
        console.error('Error applying population rule:', error);
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

  console.log(`Calculating averages for ${matchedRowIndexes.length} matched rows`);
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

  console.log(`Calculating averages for ${matchedRowIndexes.length} matched rows`);
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
            statuses: allStatuses.map(status => ({ statusName: status.statusName, count: 0, netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 })),
          }
        };
      }

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);

      const statusCounts = [];

      if (matchingRows.length > 0) {
        for (const status of allStatuses) {
          const { selectedStatuses, targetHeader, statusName } = status;
          const { count, rowIndexes } = await calculateStatusStudents(sheetId, selectedStatuses, targetHeader, templateId, matchingRows);
          const revenueStats = await getAveragesMetricsFromMatchedRows(sheetId, rowIndexes, templateId);
          statusCounts.push({ statusName, count, ...revenueStats });
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
            statuses: allStatuses.map(status => ({ statusName: status.statusName, count: 0, netRevenue: 0, netCharges: 0, nacuboDiscount: 0, totalDiscount: 0 })),
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
    getStudentHeadCountByYear
};