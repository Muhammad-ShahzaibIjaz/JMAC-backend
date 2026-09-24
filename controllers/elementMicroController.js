const { Op, QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

const { Header, SheetData, PopulationRule, PopulationStatus } = require('../models');
const { applyPopulationRule } = require('./PopulationStatusController');


// Same normalization the population-rule evaluator uses, so header names line up.
const normalizeKey = (key) =>
  typeof key === 'string' ? key.replace(/[^a-zA-Z0-9_]/g, '_') : '';


// The metric headers we average per element number (from the deck / spec).
// key = output field, header = SheetData Header.name to average.
const AVERAGE_METRICS = [
  { key: 'avgNeed', header: 'Student_Financial_Need' },
  { key: 'pctOfNeedMet', header: '%_Of_Need_Met' },
  { key: 'pctNeedMetWithGift', header: '%_Of_Need_Met_W/Gift_Aid' },
  { key: 'avgInstMeritGift', header: 'Total_Institutional_Merit_Gift' },
  { key: 'avgInstTotalGift', header: 'Total_Institutional_Gift' },
  // Avg. Total Gift (all gift aid), averaged over net confirmed — the 2026
  // value for the new "Avg. Total Gift" row.
  { key: 'avgTotalGift', header: 'Total_Gift_Aid' },
  { key: 'avgNetTuitionRevenue', header: 'Net_Tuition_Revenue' },
  { key: 'avgTuitionFeeRevenue', header: 'Net_Tuition/Fee_Revenue' },
  // Avg. Tuition & Fees Discount, straight from the NACUBO_Discount_Rate header
  // (already a percent, e.g. 70.33), averaged over net confirmed.
  { key: 'avgNacuboDiscountRate', header: 'NACUBO_Discount_Rate' },
];

const SUM_METRICS = [
  { key: 'totalInstGift', header: 'Total_Institutional_Gift' }, // NEW field
];

const NON_GIFT_AID_KEY = 'avgNonGiftAid';
const FEDERAL_WORK_AID_HEADER = 'Total_Federal_Work_Aid';
const AWARD_CODE_HEADERS = Array.from({ length: 20 }, (_, i) => `Awd_CR${i + 1}`);
const AWARD_AMOUNT_HEADERS = Array.from({ length: 20 }, (_, i) => `Awd_Amt${i + 1}`);


// A key may combine several patterns (Other Gift).
const AWARD_PATTERN_SUMS = [
  { key: 'sumNeedGift', patterns: [/^IN.G$/] },
  { key: 'sumMeritGift', patterns: [/^IM.G$/] },
  { key: 'sumHonorsGift', patterns: [/^IH.G$/] },
  { key: 'sumPerformanceGift', patterns: [/^IT.G$/] },
  { key: 'sumOtherGift', patterns: [/^II.G$/, /^IA.G$/, /^IP.G$/, /^IQ.G$/, /^IO.G$/] },
  { key: 'sumUnfundedInstGift', patterns: [/^I.UG$/] },
  { key: 'sumFundedInstGift', patterns: [/^I.FG$/] },
];

// Direct-charge revenue header sums (over net confirmed) for the summary.
const REVENUE_SUM_METRICS = [
  { key: 'sumTuitionRevenue', header: '2_Semester_Tuition' },
  { key: 'sumFeeRevenue', header: '2_Semester_Fees' },
  { key: 'sumRoomRevenue', header: '2_Semester_Room' },
  { key: 'sumMealsRevenue', header: '2_Semester_Meals' },
];

const ELEMENT_NUMBER_HEADER = 'Element_Number';

const toNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[$,%]/g, '').trim());
  return Number.isNaN(n) ? null : n;
};

const getElementMatrixMicroData = async (req, res) => {
  const { templateId, sheetId, populationId } = req.query;
  try {
    if (!templateId || !sheetId || !populationId) {
      return res.status(400).json({
        message: 'templateId, sheetId and populationId are required.',
      });
    }
 
    // 1) Population rule → conditions + headers
    const population = await PopulationRule.findOne({
      where: { id: populationId, templateId },
      raw: true,
    });
    if (!population) {
      return res.status(404).json({ message: 'Population rule not found.' });
    }
 
    // 2) Row indices that belong to this population.
    const matchingRowIndices = await applyPopulationRule(
      templateId,
      sheetId,
      population.conditions,
      population.headers
    );
    if (!matchingRowIndices || matchingRowIndices.length === 0) {
      return res.status(200).json({ elements: {}, populationName: population.ruleName });
    }
    const rowIndexSet = new Set(matchingRowIndices);
 
    // 3) Admitted / Net Confirmed status definitions.
    const statuses = await PopulationStatus.findAll({
      where: { templateId, statusName: { [Op.in]: ['Admitted', 'Net Confirmed'] } },
      raw: true,
    });
    const admittedDef = statuses.find((s) => s.statusName === 'Admitted');
    const netConfirmedDef = statuses.find((s) => s.statusName === 'Net Confirmed');
 
    // 4) Collect the header ids we need to read: element number, the status
    //    target header(s), the average-metric headers, and the sum-metric
    //    headers (plus Student_Financial_Need for the derived ratio).
    const neededHeaderNames = new Set([ELEMENT_NUMBER_HEADER]);
    if (admittedDef?.targetHeader) neededHeaderNames.add(admittedDef.targetHeader);
    if (netConfirmedDef?.targetHeader) neededHeaderNames.add(netConfirmedDef.targetHeader);
    AVERAGE_METRICS.forEach((m) => neededHeaderNames.add(m.header));
    SUM_METRICS.forEach((m) => neededHeaderNames.add(m.header));
    // Non-gift aid inputs: federal work aid header + the 40 award code/amount cols.
    neededHeaderNames.add(FEDERAL_WORK_AID_HEADER);
    AWARD_CODE_HEADERS.forEach((h) => neededHeaderNames.add(h));
    AWARD_AMOUNT_HEADERS.forEach((h) => neededHeaderNames.add(h));
    // Revenue direct-charge headers for the Award Plan Summary.
    REVENUE_SUM_METRICS.forEach((m) => neededHeaderNames.add(m.header));
 
    const headers = await Header.findAll({
      where: { templateId, name: { [Op.in]: Array.from(neededHeaderNames) } },
      raw: true,
    });
    const headerIdByName = {};
    headers.forEach((h) => {
      headerIdByName[h.name] = h.id;
    });
 
    const elementHeaderId = headerIdByName[ELEMENT_NUMBER_HEADER];
    if (!elementHeaderId) {
      return res.status(400).json({
        message: `Header "${ELEMENT_NUMBER_HEADER}" not found for this template.`,
      });
    }
 
    // 5) Pull only the SheetData cells for the needed headers, this sheet.
    const neededHeaderIds = Object.values(headerIdByName);
    const cells = await SheetData.findAll({
      where: { sheetId, headerId: { [Op.in]: neededHeaderIds } },
      raw: true,
    });
 
    // Reshape into rows: rowIndex -> { headerName: value }
    const idToName = {};
    headers.forEach((h) => {
      idToName[h.id] = h.name;
    });
    const rows = new Map(); // rowIndex -> { name: value }
    for (const cell of cells) {
      if (!rowIndexSet.has(cell.rowIndex)) continue; // population filter
      const name = idToName[cell.headerId];
      const row = rows.get(cell.rowIndex) || {};
      row[name] = cell.value;
      rows.set(cell.rowIndex, row);
    }
 
    // 6) Aggregate per element number.
    // acc[element] = { admitted, netConfirmed, sums:{key:{sum,count}}, totals:{key:sum} }
    const acc = {};
    const ensure = (el) => {
      if (!acc[el]) {
        acc[el] = { admitted: 0, netConfirmed: 0, sums: {}, totals: {}, nonGiftAid: { sum: 0, count: 0 }, awardSums: {}, revSums: {} };
        AVERAGE_METRICS.forEach((m) => {
          acc[el].sums[m.key] = { sum: 0, count: 0 };
        });
        SUM_METRICS.forEach((m) => {
          acc[el].totals[m.key] = 0;
        });
        AWARD_PATTERN_SUMS.forEach((m) => {
          acc[el].awardSums[m.key] = 0;
        });
        REVENUE_SUM_METRICS.forEach((m) => {
          acc[el].revSums[m.key] = 0;
        });
      }
      return acc[el];
    };
 
    const admittedSet = new Set(admittedDef?.selectedStatuses || []);
    const netConfirmedSet = new Set(netConfirmedDef?.selectedStatuses || []);
    const admittedHeaderName = admittedDef?.targetHeader;
    const netConfirmedHeaderName = netConfirmedDef?.targetHeader;
 
    for (const [, row] of rows) {
      const element = row[ELEMENT_NUMBER_HEADER];
      if (element === undefined || element === null || element === '') continue;
      const bucket = ensure(String(element));
 
      // Admitted / Net Confirmed counts by status membership.
      const isAdmitted =
        admittedHeaderName && admittedSet.has(row[admittedHeaderName]);
      const isNetConfirmed =
        netConfirmedHeaderName && netConfirmedSet.has(row[netConfirmedHeaderName]);
 
      if (isAdmitted) bucket.admitted += 1;
      if (isNetConfirmed) bucket.netConfirmed += 1;
 
      // Average metrics are computed over NET CONFIRMED students only — e.g.
      // if an element has 40 admitted and 20 net confirmed, Avg Need / revenue
      // etc. average the 20 net-confirmed rows, not all 40. Counts above still
      // reflect the full admitted/net-confirmed totals.
      if (isNetConfirmed) {
        for (const m of AVERAGE_METRICS) {
          const n = toNumber(row[m.header]);
          if (n !== null) {
            bucket.sums[m.key].sum += n;
            bucket.sums[m.key].count += 1;
          }
        }
        for (const m of SUM_METRICS) {
          const n = toNumber(row[m.header]);
          if (n !== null) bucket.totals[m.key] += n;
        }
 
        // Non-gift aid = Total_Federal_Work_Aid + FNFL amount.
        // FNFL: scan Awd_CR1..20; wherever the code is exactly "FNFL", add the
        // paired Awd_Amt{i}. No acceptance-status filter (per instruction).
        const federalWorkAid = toNumber(row[FEDERAL_WORK_AID_HEADER]) ?? 0;
        let fnflTotal = 0;
        for (let i = 0; i < 20; i++) {
          const code = row[AWARD_CODE_HEADERS[i]];
          if (code != null && /^FNFL$/.test(String(code).trim())) {
            const amt = toNumber(row[AWARD_AMOUNT_HEADERS[i]]);
            if (amt !== null) fnflTotal += amt;
          }
        }
        bucket.nonGiftAid.sum += federalWorkAid + fnflTotal;
        bucket.nonGiftAid.count += 1;

        // Award-code pattern sums (institutional aid by type). Reuse the same
        // Awd_CR / Awd_Amt scan; a code contributes to a key if it matches any
        // of that key's patterns. A single code can only be one 4-char string,
        // so it lands in at most one key here.
        for (let i = 0; i < 20; i++) {
          const codeRaw = row[AWARD_CODE_HEADERS[i]];
          if (codeRaw == null) continue;
          const code = String(codeRaw).trim();
          if (!code) continue;
          const amt = toNumber(row[AWARD_AMOUNT_HEADERS[i]]);
          if (amt === null) continue;
          for (const m of AWARD_PATTERN_SUMS) {
            if (m.patterns.some((p) => p.test(code))) {
              bucket.awardSums[m.key] += amt;
              break;
            }
          }
        }

        // Direct-charge revenue sums over net confirmed.
        for (const m of REVENUE_SUM_METRICS) {
          const n = toNumber(row[m.header]);
          if (n !== null) bucket.revSums[m.key] += n;
        }
      }
    }
 
    // 7) Finalize: averages, sums, and the derived ratio. Yield is derived on
    //    the frontend (netConfirmed / admitted) since it recomputes live.
    const elements = {};
    for (const [element, b] of Object.entries(acc)) {
      const out = {
        admittedCount: b.admitted,
        netConfirmedCount: b.netConfirmed,
      };
      // Averages (sum / count over net confirmed).
      for (const m of AVERAGE_METRICS) {
        const { sum, count } = b.sums[m.key];
        out[m.key] = count > 0 ? sum / count : 0;
      }
      // Sums (total over net confirmed) — e.g. Total Inst. Gift.
      for (const m of SUM_METRICS) {
        out[m.key] = b.totals[m.key];
      }
      // Combined average: avgNonGiftAid = avg(Total_Federal_Work_Aid + FNFL)
      // over net confirmed rows.
      out[NON_GIFT_AID_KEY] =
        b.nonGiftAid.count > 0 ? b.nonGiftAid.sum / b.nonGiftAid.count : 0;
      // Derived: % Need Met w/Inst. Gift = Avg(Total_Institutional_Gift) / Avg(Need).
      // avgInstTotalGift and avgNeed are already computed above.
      out.pctNeedMetWithInstGift =
        out.avgNeed > 0 ? (out.avgInstTotalGift / out.avgNeed) * 100 : 0;

      // Award Plan Summary: institutional-aid-by-type sums and revenue sums.
      for (const m of AWARD_PATTERN_SUMS) {
        out[m.key] = b.awardSums[m.key];
      }
      for (const m of REVENUE_SUM_METRICS) {
        out[m.key] = b.revSums[m.key];
      }

      elements[element] = out;
    }
 
    return res.status(200).json({
      populationName: population.ruleName,
      elements,
    });
  } catch (error) {
    console.error('Error building element matrix micro data:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
 
module.exports = { getElementMatrixMicroData };