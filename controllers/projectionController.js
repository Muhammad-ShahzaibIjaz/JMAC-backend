const sequelize = require('../config/database');
const { DataTypes, Op, QueryTypes, fn, col } = require('sequelize');
const { Header, SheetData } = require('../models');


const getElementEnrollmentStats = async (templateId, sheetId) => {
  // Step 1: Fetch both headers in one query
  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: ['Element_Number', 'Y/N Student_Enrolled'] },
    },
    attributes: ['id', 'name'],
    raw: true,
  });

  if (headers.length < 2) {
    throw new Error('Required headers not found');
  }

  // Map header IDs
  const headerMap = {};
  headers.forEach(h => { headerMap[h.name] = h.id; });

  const elementHeaderId = headerMap['Element_Number'];
  const enrolledHeaderId = headerMap['Y/N Student_Enrolled'];

  // Step 2: Fetch all relevant rows in one query
  const rows = await SheetData.findAll({
    attributes: ['rowIndex', 'value', 'headerId'],
    where: {
      sheetId,
      headerId: { [Op.in]: [elementHeaderId, enrolledHeaderId] },
    },
    raw: true,
  });

  if (rows.length === 0) {
    throw new Error('No data found for Element_Number or Y/N Student_Enrolled');
  }

  // Step 3: Organize data row-wise
  const rowMap = {};
  for (const row of rows) {
    if (!rowMap[row.rowIndex]) rowMap[row.rowIndex] = {};
    if (row.headerId === elementHeaderId) {
      rowMap[row.rowIndex].elementNumber = row.value;
    } else if (row.headerId === enrolledHeaderId) {
      rowMap[row.rowIndex].enrolledValue = row.value;
    }
  }

  // Step 4: Normalize values
  const admittedSet = new Set(['Y', 'Yes', 'true', '1']);
  const enrolledSet = new Set(['N', 'No', 'false', '0']);

  const stats = {};

  for (const [rowIndex, data] of Object.entries(rowMap)) {
    const element = data.elementNumber;
    const enrolledVal = (data.enrolledValue || '').toString().trim();

    if (!element) continue;

    if (!stats[element]) {
      stats[element] = {
        admittedCount: 0,
        admittedRowIndexes: [],
        enrolledCount: 0,
        enrolledRowIndexes: [],
      };
    }

    if (admittedSet.has(enrolledVal)) {
      stats[element].admittedCount++;
      stats[element].admittedRowIndexes.push(Number(rowIndex));
    } else if (enrolledSet.has(enrolledVal)) {
      stats[element].enrolledCount++;
      stats[element].enrolledRowIndexes.push(Number(rowIndex));
    }
  }

  return stats;
};

const getAverageRevenueAndDiscount = async (templateId, sheetId, enrolledRowIndexes) => {
  // Step 1: Fetch both headers in one query
  const headers = await Header.findAll({
    where: {
      templateId: templateId,
      name: { [Op.in]: ['Net_Tuition_Revenue', 'NACUBO_Discount_Rate', 'Student_Financial_Need', '%_Of_Need_Met', '%_Of_Need_Met_W/Gift_Aid'] },
    },
    attributes: ['id', 'name'],
    raw: true,
  });

  if (headers.length < 5) {
    throw new Error('Required headers not found');
  }

  // Map header IDs
  const headerMap = {};
  headers.forEach(h => { headerMap[h.name] = h.id; });

  const revenueHeaderId = headerMap['Net_Tuition_Revenue'];
  const discountHeaderId = headerMap['NACUBO_Discount_Rate'];
  const needHeaderId = headerMap['Student_Financial_Need'];
  const needMetHeaderId = headerMap['%_Of_Need_Met'];
  const needMetWithGiftAidHeaderId = headerMap['%_Of_Need_Met_W/Gift_Aid'];

  // Step 2: Fetch data for given rowIndexes
  const rows = await SheetData.findAll({
    attributes: ['rowIndex', 'value', 'headerId'],
    where: {
      sheetId,
      rowIndex: { [Op.in]: enrolledRowIndexes },
      headerId: { [Op.in]: [revenueHeaderId, discountHeaderId, needHeaderId, needMetHeaderId, needMetWithGiftAidHeaderId] },
    },
    raw: true,
  });

  if (rows.length === 0) {
    throw new Error('No data found for given rowIndexes');
  }

  // Step 3: Separate values
  let revenueSum = 0, revenueCount = 0;
  let discountSum = 0, discountCount = 0;
  let needSum = 0, needCount = 0;
  let needMetSum = 0, needMetCount = 0;
  let needMetWithGiftAidSum = 0, needMetWithGiftAidCount = 0;

  for (const row of rows) {
    const val = parseFloat(row.value);
    if (isNaN(val)) continue;

    if (row.headerId === revenueHeaderId) {
      revenueSum += val;
      revenueCount++;
    } else if (row.headerId === discountHeaderId) {
      discountSum += val;
      discountCount++;
    } else if (row.headerId === needHeaderId) {
      needSum += val;
      needCount++;
    } else if (row.headerId === needMetHeaderId) {
      needMetSum += val;
      needMetCount++;
    } else if (row.headerId === needMetWithGiftAidHeaderId) {
      needMetWithGiftAidSum += val;
      needMetWithGiftAidCount++;
    }
  }

  // Step 4: Calculate averages
  const avgRevenue = revenueCount > 0 ? Math.round(revenueSum / revenueCount) : null;
  const avgDiscount = discountCount > 0 ? (discountSum / discountCount).toFixed(2) : null;
  const avgNeed = needCount > 0 ? Math.round(needSum / needCount) : null;
  const avgNeedMet = needMetCount > 0 ? (needMetSum / needMetCount).toFixed(2) : null;
  const avgNeedMetWithGiftAid = needMetWithGiftAidCount > 0 ? (needMetWithGiftAidSum / needMetWithGiftAidCount).toFixed(2) : null;

  return {
    averageNetTuitionRevenue: avgRevenue,
    averageNACUBODiscountRate: avgDiscount,
    avgNeed: avgNeed,
    avgNeedMet: avgNeedMet,
    avgNeedMetWithGiftAid: avgNeedMetWithGiftAid,
  };
};

const getGiftAndLoanTotals = async (templateId, sheetId, enrolledRowIndexes) => {
  // Step 1: Build header names dynamically
  const crHeaders = Array.from({ length: 20 }, (_, i) => `Awd_CR${i + 1}`);
  const statusHeaders = Array.from({ length: 20 }, (_, i) => `Awd_Status${i + 1}`);
  const amtHeaders = Array.from({ length: 20 }, (_, i) => `Awd_Amt${i + 1}`);

  const allHeaders = [...crHeaders, ...statusHeaders, ...amtHeaders];

  // Step 2: Fetch all headers in one query
  const headers = await Header.findAll({
    where: {
      templateId,
      name: { [Op.in]: allHeaders },
    },
    attributes: ['id', 'name'],
    raw: true,
  });

  if (headers.length === 0) {
    throw new Error('Award headers not found');
  }

  // Map header name → id
  const headerMap = {};
  headers.forEach(h => { headerMap[h.name] = h.id; });

  // Step 3: Fetch all award data for enrolled rowIndexes
  const rows = await SheetData.findAll({
    attributes: ['rowIndex', 'value', 'headerId'],
    where: {
      sheetId,
      rowIndex: { [Op.in]: enrolledRowIndexes },
      headerId: { [Op.in]: headers.map(h => h.id) },
    },
    raw: true,
  });

  if (rows.length === 0) {
    return { totalGift : 0, totalWorkAndLoan : 0 };
  }

  // Step 4: Organize row-wise data
  const rowMap = {};
  for (const row of rows) {
    if (!rowMap[row.rowIndex]) rowMap[row.rowIndex] = {};
    const headerName = Object.keys(headerMap).find(k => headerMap[k] === row.headerId);
    rowMap[row.rowIndex][headerName] = row.value;
  }

  // Step 5: Calculate totals
  const validStatuses = new Set(['Pending', 'Accepted', 'Accepting', 'A', 'P', 'Pended']);
  let totalGift = 0;
  let totalWorkAndLoan = 0;

  for (const [rowIndex, data] of Object.entries(rowMap)) {
    for (let i = 1; i <= 20; i++) {
      const status = (data[`Awd_Status${i}`] || '').trim();
      const cr = (data[`Awd_CR${i}`] || '').trim();
      const amt = parseFloat(data[`Awd_Amt${i}`]);

      if (!validStatuses.has(status) || isNaN(amt)) continue;

      const lastChar = cr.slice(-1).toUpperCase();
      if (lastChar === 'G') {
        totalGift += amt;
      } else if (lastChar === 'L' || lastChar === 'W') {
        totalWorkAndLoan += amt;
      }
    }
  }

  return { totalGift, totalWorkAndLoan };
};


const dataProject = async (req, res) => {
    const { templateId, sheetId } = req.body;
    try {
        const stats = await getElementEnrollmentStats(templateId, sheetId);
        for (const element in stats) {
            const enrolledRowIndexes = stats[element].enrolledRowIndexes;
            if (enrolledRowIndexes.length > 0) {
                const averages = await getAverageRevenueAndDiscount(templateId, sheetId, enrolledRowIndexes);
                stats[element].averageNetTuitionRevenue = averages.averageNetTuitionRevenue;
                stats[element].averageNACUBODiscountRate = averages.averageNACUBODiscountRate;
                stats[element].avgNeed = averages.avgNeed;
                stats[element].avgNeedMet = averages.avgNeedMet;
                stats[element].avgNeedMetWithGiftAid = averages.avgNeedMetWithGiftAid;
                const totals = await getGiftAndLoanTotals(templateId, sheetId, enrolledRowIndexes);
                stats[element].totalGift = totals.totalGift;
                stats[element].totalWorkAndLoan = totals.totalWorkAndLoan;
            } else {
                stats[element].averageNetTuitionRevenue = null;
                stats[element].averageNACUBODiscountRate = null;
                stats[element].avgNeed = null;
                stats[element].avgNeedMet = null;
                stats[element].avgNeedMetWithGiftAid = null;
                stats[element].totalGift = 0;
                stats[element].totalWorkAndLoan = 0;
            }
        }
        res.status(200).json({ success: true, data: stats });
    } catch (error) {
        console.error('Error in data projection:', error);
        res.status(500).json({ success: false, message: error.message });
    }
}

module.exports = {
    dataProject,
};