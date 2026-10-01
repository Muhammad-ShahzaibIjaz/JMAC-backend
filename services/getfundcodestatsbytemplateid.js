const { Op } = require('sequelize');
const { Header, SheetData } = require('../models'); // adjust to your import style
const {
  FUND_CODE_VIEW_NAMES,
  resolveFundCodeViewNames,
} = require('../utils/fundcodecategories');

/**
 * Same contract as getAwardAmountsByTemplateId, but keyed by Fund Code Type
 * "View Name" instead of the raw award code.
 *
 * Reads, for each of the 20 award slots:
 *   Awd_CR{n}     -> the cross-reference / fund code  (e.g. "IM1G")
 *   Awd_Amt{n}    -> the amount
 *   Awd_Status{n} -> accepted | pending
 *
 * Returns:
 *   { [viewName]: { acceptedAmount, acceptedCount, pendingAmount, pendingCount, totalAmount } }
 *
 * Every View Name from the config is present (zero-filled) so the chart keeps
 * a stable row set across the three years.
 */
const getFundCodeStatsByTemplateId = async (templateId, rowIndexes = []) => {
  const emptyStats = () => {
    const base = {};
    for (const viewName of FUND_CODE_VIEW_NAMES) {
      base[viewName] = {
        acceptedAmount: 0,
        acceptedCount: 0,
        pendingAmount: 0,
        pendingCount: 0,
        totalAmount: 0,
      };
    }
    return base;
  };

  try {
    if (!rowIndexes.length) return emptyStats();

    const crKeys = Array.from({ length: 20 }, (_, i) => `Awd_CR${i + 1}`);
    const amountKeys = Array.from({ length: 20 }, (_, i) => `Awd_Amt${i + 1}`);
    const statusKeys = Array.from({ length: 20 }, (_, i) => `Awd_Status${i + 1}`);

    const headers = await Header.findAll({
      where: {
        templateId,
        name: [...crKeys, ...amountKeys, ...statusKeys],
      },
      attributes: ['id', 'name'],
      raw: true,
    });

    if (!headers.length) return emptyStats();

    const headerMap = {};
    headers.forEach(h => {
      headerMap[h.name] = h.id;
    });

    const allHeaderIds = Object.values(headerMap);

    const sheetDataRows = await SheetData.findAll({
      where: {
        headerId: { [Op.in]: allHeaderIds },
        rowIndex: { [Op.in]: rowIndexes },
      },
      attributes: ['headerId', 'rowIndex', 'value'],
      raw: true,
    });

    // data[rowIndex][headerId] = value
    const data = {};
    for (const { headerId, rowIndex, value } of sheetDataRows) {
      if (!data[rowIndex]) data[rowIndex] = {};
      data[rowIndex][headerId] = value;
    }

    const fundCodeStats = emptyStats();

    for (const rowIndex of rowIndexes) {
      const row = data[rowIndex];
      if (!row) continue;

      for (let i = 0; i < 20; i++) {
        const crId = headerMap[`Awd_CR${i + 1}`];
        const amtId = headerMap[`Awd_Amt${i + 1}`];
        const statusId = headerMap[`Awd_Status${i + 1}`];

        const crVal = crId ? row[crId] : undefined;
        const amtVal = amtId ? row[amtId] : undefined;
        const statusVal = statusId ? row[statusId] : undefined;

        const fundCode = crVal?.trim();
        if (!fundCode || fundCode.toUpperCase() === 'NULL') continue;

        const status = statusVal?.trim()?.toLowerCase();
        if (!['accepted', 'pending'].includes(status)) continue;

        const amount = parseFloat(amtVal) || 0;

        // One raw code can feed a detail row AND its group TOTAL row.
        const targets = resolveFundCodeViewNames(fundCode);
        if (!targets.length) continue;

        for (const viewName of targets) {
          const bucket = fundCodeStats[viewName];
          if (!bucket) continue;

          if (status === 'accepted') {
            bucket.acceptedAmount += amount;
            bucket.acceptedCount += 1;
          } else {
            bucket.pendingAmount += amount;
            bucket.pendingCount += 1;
          }
          bucket.totalAmount += amount;
        }
      }
    }

    return fundCodeStats;
  } catch (error) {
    console.error('Error calculating fund code stats:', error);
    return emptyStats();
  }
};

module.exports = { getFundCodeStatsByTemplateId };