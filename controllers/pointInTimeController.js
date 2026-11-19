const { Op } = require('sequelize');
const { Header, SheetData, PopulationSubmission } = require('../models');
const {
  getRuleConditionsAndHeaders,
  applyPopulationRule,
  calculateStatusStudents,
  getStatusesByTemplateId,
} = require('./PopulationStatusController');

/*
 * ============================================================================
 *  POINT IN TIME  —  weekly funnel progression for 3 recruitment years
 * ============================================================================
 *
 *  HOW EACH STAGE IS FOUND:
 *    1. Apply the population rule  -> matchingRows  (the population subset).
 *    2. For EVERY configured PopulationStatus, run calculateStatusStudents()
 *       to get that status' rowIndexes — membership is defined purely by the
 *       consultant's config (statusName + selectedStatuses on
 *       Admissions_Funnel_Stage), exactly like every other insight graph.
 *       Pending (e.g. Accept + Application), Net Confirmed (Deposit), etc. all
 *       come straight from their own status, NOT from any subtraction.
 *    3. The date columns (application / admission / confirmation / cancellation)
 *       are used ONLY to place each already-identified student into a week.
 *
 *  Melt is the one derived extra the PPT asks for: a Confirmed-status student
 *  who also has a cancellation date (deposited then cancelled), by cancel week.
 *
 *  TIMELINE (data-driven — no fixed Oct 1 anchor):
 *    Each year's week grid starts at that year's EARLIEST admission date in the
 *    data (fallback: earliest of any event date; last resort: Oct 1). Weeks are
 *    Friday "end of week" buckets. Every year uses the same number of weeks
 *    (CYCLE_WEEKS) so the three lines align by week index. X labels use the
 *    current year's Friday dates; the current year fills to its last submission.
 * ============================================================================
 */

const CYCLE_WEEKS = 52; // one recruitment cycle; keeps the 3 years aligned by index

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DATE_HEADER_CANDIDATES = {
  application:  ['Date_Of_Application', 'Date of Application', 'Application_Date'],
  admission:    ['Date_Of_Admission', 'Date of Admission', 'Admission_Date', 'Admit_Date', 'Date_Of_Admit'],
  confirmation: ['Date_Of_Confirmation', 'Date of Confirmation', 'Confirmation_Date', 'Deposit_Date', 'Date_Of_Deposit'],
  cancellation: ['Date_Of_Cancellation', 'Date of Cancellation', 'Cancellation_Date', 'Cancel_Date'],
};

function resolveHeaderId(headers, candidates) {
  const wanted = candidates.map(norm);
  const found = headers.find((h) => wanted.includes(norm(h.name)));
  return found ? found.id : null;
}

// ---- date helpers ------------------------------------------------------------
function parseDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value) ? null : stripTime(value);
  const str = String(value).trim();
  if (!str || str.toUpperCase() === 'NULL') return null;

  let d = new Date(str.replace(' ', 'T'));
  if (!isNaN(d)) return stripTime(d);

  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, mm, dd, yy] = m;
    yy = yy.length === 2 ? `20${yy}` : yy;
    d = new Date(Number(yy), Number(mm) - 1, Number(dd));
    if (!isNaN(d)) return stripTime(d);
  }
  return null;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** `weeks` Friday "end of week" dates starting from the first Friday on/after startDate. */
function buildFridaysFrom(startDate, weeks) {
  const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  while (d.getDay() !== 5) d.setDate(d.getDate() + 1); // 5 = Friday
  const out = [];
  for (let i = 0; i < weeks; i++) {
    out.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return out;
}

function weekOf(date, fridays) {
  if (!date) return null;
  if (date <= fridays[0]) return 1;
  for (let i = 0; i < fridays.length; i++) {
    if (date <= fridays[i]) return i + 1;
  }
  return fridays.length;
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const MELT_LABEL = 'Melt';

// ---- submission lookups ------------------------------------------------------
async function latestSubmissionForYear(templateId, year) {
  const submission = await PopulationSubmission.findOne({
    where: { templateId, submissionDate: { [Op.between]: [`${year}-01-01`, `${year}-12-31`] } },
    order: [['submissionDate', 'DESC']],
  });
  return submission ? { sheetId: submission.selectedSheet, date: submission.submissionDate } : null;
}

async function latestSubmission(templateId) {
  const submission = await PopulationSubmission.findOne({
    where: { templateId, submissionDate: { [Op.ne]: null } },
    order: [['submissionDate', 'DESC']],
  });
  return submission ? { sheetId: submission.selectedSheet, date: submission.submissionDate } : null;
}

async function statusRowIndexes(statusDef, sheetId, templateId, matchingRows) {
  if (!statusDef) return [];
  const res = await calculateStatusStudents(sheetId, statusDef.selectedStatuses, statusDef.targetHeader, templateId, matchingRows);
  return res && Array.isArray(res.rowIndexes) ? res.rowIndexes : [];
}

/**
 * Build the cumulative weekly series for one year's sheet.
 * Returns { series, fridays } — fridays is this year's data-driven week grid.
 */
async function buildYearSeries({ sheetId, templateId, year, conditions, headers, plan, meltEnabled, dateHeaderIds }) {
  const zero = () => new Array(CYCLE_WEEKS).fill(0);
  const emptySeries = () => {
    const s = {};
    for (const p of plan) s[p.label] = zero();
    if (meltEnabled) s[MELT_LABEL] = zero();
    return s;
  };
  // Fallback grid (only used when a year has no data) so labels still exist.
  const fallbackFridays = () => buildFridaysFrom(new Date(year - 1, 9, 1), CYCLE_WEEKS);

  if (!sheetId) return { series: emptySeries(), fridays: fallbackFridays() };

  const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);
  if (!matchingRows.length) return { series: emptySeries(), fridays: fallbackFridays() };

  // Dates for the matched rows (used only for timing + to find the start).
  const { application, admission, confirmation, cancellation } = dateHeaderIds;
  const neededDateIds = [application, admission, confirmation, cancellation].filter(Boolean);
  const dateByRow = new Map();
  let minAdmission = null;
  let minAny = null;
  if (neededDateIds.length) {
    const rows = await SheetData.findAll({
      where: { sheetId, rowIndex: { [Op.in]: matchingRows }, headerId: { [Op.in]: neededDateIds } },
      attributes: ['rowIndex', 'headerId', 'value'],
      raw: true,
    });
    for (const r of rows) {
      let o = dateByRow.get(r.rowIndex);
      if (!o) { o = {}; dateByRow.set(r.rowIndex, o); }
      const parsed = parseDate(r.value);
      if (r.headerId === application) o.app = parsed;
      else if (r.headerId === admission) o.adm = parsed;
      else if (r.headerId === confirmation) o.conf = parsed;
      else if (r.headerId === cancellation) o.canc = parsed;
      if (parsed) {
        if (r.headerId === admission && (!minAdmission || parsed < minAdmission)) minAdmission = parsed;
        if (!minAny || parsed < minAny) minAny = parsed;
      }
    }
  }

  // DATA-DRIVEN START: earliest admission date, else earliest event, else Oct 1.
  const startDate = minAdmission || minAny || new Date(year - 1, 9, 1);
  const fridays = buildFridaysFrom(startDate, CYCLE_WEEKS);

  const d = (r) => dateByRow.get(r) || {};
  const weekFns = {
    admit:   (r) => { const o = d(r); return weekOf(o.adm || o.app || o.conf || o.canc, fridays); },
    confirm: (r) => { const o = d(r); return weekOf(o.conf || o.adm || o.app || o.canc, fridays); },
    cancel:  (r) => { const o = d(r); return weekOf(o.canc || o.conf || o.adm || o.app, fridays); },
  };

  const cumulative = (rowIter, weekFn) => {
    const weekly = zero();
    for (const r of rowIter) {
      const w = weekFn(r);
      if (w) weekly[w - 1] += 1;
    }
    let s = 0;
    return weekly.map((v) => (s += v));
  };

  const out = {};
  let confirmedRows = null;

  for (const p of plan) {
    const rows = await statusRowIndexes(p.def, sheetId, templateId, matchingRows);
    if (p.cat === 'confirm' && norm(p.label) === 'confirmed') confirmedRows = rows;
    out[p.label] = cumulative(rows, weekFns[p.cat]);
  }

  if (meltEnabled) {
    const meltRows = (confirmedRows || []).filter((r) => d(r).canc);
    out[MELT_LABEL] = cumulative(meltRows, weekFns.cancel);
  }

  return { series: out, fridays };
}

// -----------------------------------------------------------------------------
const getPointInTimeData = async (req, res) => {
  const { templateId, populationRuleId } = req.body;

  try {
    if (!templateId || !populationRuleId) {
      return res.status(400).json({ error: 'templateId and populationRuleId are required' });
    }

    const current = await latestSubmission(templateId);
    if (!current) {
      return res.status(200).json({
        currentYear: null, years: [], currentWeek: 0, stages: [], weeks: [], data: {},
        meta: { hasDateData: false, meltDerivable: false },
      });
    }

    const endDate = current.date;
    const currentYear = new Date(endDate).getFullYear();
    const years = [currentYear - 2, currentYear - 1, currentYear];

    const [prev1, prev2] = await Promise.all([
      latestSubmissionForYear(templateId, currentYear - 1),
      latestSubmissionForYear(templateId, currentYear - 2),
    ]);
    const sheetByYear = {
      [currentYear]: current.sheetId,
      [currentYear - 1]: prev1 ? prev1.sheetId : null,
      [currentYear - 2]: prev2 ? prev2.sheetId : null,
    };

    const [allStatuses, allHeaders, rule] = await Promise.all([
      getStatusesByTemplateId(templateId),
      Header.findAll({ where: { templateId }, attributes: ['id', 'name'], raw: true }),
      getRuleConditionsAndHeaders(populationRuleId),
    ]);

    const byName = {};
    allStatuses.forEach((s) => { byName[norm(s.statusName)] = s; });

    const dateHeaderIds = {
      application: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.application),
      admission: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.admission),
      confirmation: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.confirmation),
      cancellation: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.cancellation),
    };

    const KNOWN = [
      { key: 'admitted',     label: 'Admits',        cat: 'admit' },
      { key: 'confirmed',    label: 'Confirmed',     cat: 'confirm' },
      { key: 'netconfirmed', label: 'Net Confirmed', cat: 'confirm' },
      { key: 'cancelled',    label: 'Cancelled',     cat: 'cancel' },
      { key: 'pending',      label: 'Pending',       cat: 'admit' },
    ];
    const catFor = (statusName) => {
      const n = norm(statusName);
      if (n.includes('cancel') || n.includes('withdrawn') || n.includes('melt') || n.includes('deny')) return 'cancel';
      if (n.includes('confirm') || n.includes('deposit') || n.includes('enroll')) return 'confirm';
      return 'admit';
    };

    const plan = [];
    const usedKeys = new Set();
    for (const k of KNOWN) {
      if (byName[k.key]) { plan.push({ label: k.label, def: byName[k.key], cat: k.cat }); usedKeys.add(k.key); }
    }
    for (const s of allStatuses) {
      const key = norm(s.statusName);
      if (usedKeys.has(key) || !s.statusName) continue;
      plan.push({ label: s.statusName, def: s, cat: catFor(s.statusName) });
      usedKeys.add(key);
    }

    const meltEnabled = Boolean(byName['confirmed'] && dateHeaderIds.cancellation);

    const stages = [];
    const pushIf = (label) => { if (plan.some((p) => p.label === label)) stages.push(label); };
    pushIf('Admits');
    pushIf('Confirmed');
    pushIf('Net Confirmed');
    if (meltEnabled) stages.push(MELT_LABEL);
    pushIf('Cancelled');
    pushIf('Pending');
    for (const p of plan) if (!stages.includes(p.label)) stages.push(p.label);

    const { conditions, headers } = rule;

    const perYear = {};
    await Promise.all(
      years.map(async (year) => {
        perYear[year] = await buildYearSeries({
          sheetId: sheetByYear[year],
          templateId,
          year,
          conditions,
          headers,
          plan,
          meltEnabled,
          dateHeaderIds,
        });
      })
    );

    // Labels = the current year's data-driven Friday grid.
    const labelFridays = perYear[currentYear]?.fridays || buildFridaysFrom(new Date(currentYear - 1, 9, 1), CYCLE_WEEKS);
    const N = labelFridays.length;
    const currentWeek = weekOf(stripTime(new Date(endDate)), labelFridays) || N;

    const data = {};
    for (const stage of stages) {
      data[stage] = [];
      for (let i = 0; i < N; i++) {
        const row = { week: i + 1, date: iso(labelFridays[i]) };
        for (const year of years) {
          const series = perYear[year]?.series?.[stage] || [];
          let val = i < series.length ? series[i] : null;
          if (year === currentYear && i + 1 > currentWeek) val = null;
          row[String(year)] = val;
        }
        data[stage].push(row);
      }
    }

    return res.status(200).json({
      currentYear,
      years,
      currentWeek,
      stages,
      weeks: labelFridays.map((f, i) => ({ week: i + 1, date: iso(f) })),
      data,
      meta: {
        hasDateData: Boolean((dateHeaderIds.admission || dateHeaderIds.confirmation) && dateHeaderIds.cancellation),
        hasConfirmationColumn: Boolean(dateHeaderIds.confirmation),
        meltDerivable: meltEnabled,
      },
    });
  } catch (error) {
    console.error('Error building point-in-time data:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

module.exports = { getPointInTimeData };