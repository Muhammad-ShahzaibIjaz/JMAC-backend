const { Op } = require('sequelize');
const { Header, SheetData, PopulationSubmission } = require('../models');
const {
  getRuleConditionsAndHeaders,
  applyPopulationRule,
  getStatusesByTemplateId,
} = require('./PopulationStatusController');

/*
 * ============================================================================
 *  POINT IN TIME  —  weekly funnel progression for 3 recruitment years
 * ============================================================================
 *
 *  MODEL (submission-driven):
 *    The campus submits a full snapshot every week (PopulationSubmission ->
 *    selectedSheet). We plot the funnel counts FROM EACH SUBMISSION at the week
 *    of its submissionDate, on a fixed Oct -> Sep axis.
 *
 *    Stage membership is the consultant's PopulationStatus config (statusName +
 *    selectedStatuses on the funnel header) — the same rule
 *    calculateStatusStudents uses. We do NOT use the date columns for
 *    Admits / Confirmed / Net Confirmed / Cancelled / Pending.
 *
 *    Date columns are used ONLY for MELT per submission:
 *      - sheet has confirmation-date data -> admission AND confirmation AND
 *        cancellation date all present;
 *      - otherwise -> funnel stage is a "Withdrawn Deposit-Cancel" status.
 *
 *  YEAR LABELLING: a cycle runs Oct -> Sep and is labelled by its END year (the
 *  enrolment year). A submission in Oct–Dec belongs to NEXT year's cycle; one in
 *  Jan–Sep belongs to the current year's cycle. So a submission dated Sep 2026
 *  is the 2026 cycle (Oct 2025 -> Sep 2026).
 *
 *  AXIS: fixed Oct -> Sep. Week 1 = the first Friday of October (computed), and
 *  each Friday is the "end of week". Points are snapped to their week for
 *  cross-year alignment, but every real submission's ACTUAL date is carried in
 *  `<year>_date` so the UI can show the true submission date on hover.
 *
 *  PERFORMANCE: one applyPopulationRule + ONE SheetData fetch per submission.
 *  Every status count and Melt are computed in memory; submissions are deduped
 *  to one per (year, week) and run with bounded concurrency.
 * ============================================================================
 */

const CONCURRENCY = 5;

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const DATE_HEADER_CANDIDATES = {
  admission:    ['Date_Of_Admission', 'Date of Admission', 'Admission_Date', 'Admit_Date', 'Date_Of_Admit'],
  confirmation: ['Date_Of_Confirmation', 'Date of Confirmation', 'Confirmation_Date', 'Deposit_Date', 'Date_Of_Deposit'],
  cancellation: ['Date_Of_Cancellation', 'Date of Cancellation', 'Cancellation_Date', 'Cancel_Date'],
};
const DEPOSIT_CANCEL_HINTS = ['withdrawndepositcancel', 'depositcancel'];

function resolveHeaderId(headers, candidates) {
  const wanted = candidates.map(norm);
  const found = headers.find((h) => wanted.includes(norm(h.name)));
  return found ? found.id : null;
}

function parseDate(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isNaN(value) ? null : value;
  const str = String(value).trim();
  if (!str || str.toUpperCase() === 'NULL') return null;
  let d = new Date(str.replace(' ', 'T'));
  if (!isNaN(d)) return d;
  const m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    let [, mm, dd, yy] = m;
    yy = yy.length === 2 ? `20${yy}` : yy;
    d = new Date(Number(yy), Number(mm) - 1, Number(dd));
    if (!isNaN(d)) return d;
  }
  return null;
}

function stripTime(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ymd = (v) => { const d = parseDate(v); return d ? iso(d) : String(v).slice(0, 10); };

/** Cycle END year (enrolment year): Oct–Dec -> next year; Jan–Sep -> same year. */
function cycleEndYearOf(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear(); // 9 = October
}

/** Friday "end of week" dates for cycle ending in `endYear`: first Friday on/after
 *  Oct 1 of (endYear-1), through Sep 30 of endYear. */
function buildCycleFridays(endYear) {
  const start = new Date(endYear - 1, 9, 1); // Oct 1 of previous year
  while (start.getDay() !== 5) start.setDate(start.getDate() + 1); // 5 = Friday
  const end = new Date(endYear, 8, 30); // Sep 30 of end year
  const fridays = [];
  const cur = new Date(start);
  while (cur <= end) {
    fridays.push(new Date(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return fridays;
}

function weekOf(date, fridays) {
  const d = stripTime(date instanceof Date ? date : new Date(date));
  if (d <= fridays[0]) return 1;
  for (let i = 0; i < fridays.length; i++) {
    if (d <= fridays[i]) return i + 1;
  }
  return fridays.length;
}

const MELT_LABEL = 'Melt';

async function mapWithConcurrency(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

// -----------------------------------------------------------------------------
const getPointInTimeData = async (req, res) => {
  const { templateId, populationRuleId } = req.body;

  try {
    if (!templateId || !populationRuleId) {
      return res.status(400).json({ error: 'templateId and populationRuleId are required' });
    }

    const submissions = await PopulationSubmission.findAll({
      where: { templateId, submissionDate: { [Op.ne]: null } },
      attributes: ['submissionDate', 'selectedSheet'],
      order: [['submissionDate', 'ASC']],
      raw: true,
    });

    if (!submissions.length) {
      return res.status(200).json({
        currentYear: null, years: [], stages: [], weeks: [], data: {},
        meta: { hasDateData: false, meltDerivable: false },
      });
    }

    const currentCycle = cycleEndYearOf(submissions[submissions.length - 1].submissionDate);
    const years = [currentCycle - 2, currentCycle - 1, currentCycle];
    const yearSet = new Set(years);

    const fridaysByYear = {};
    years.forEach((y) => { fridaysByYear[y] = buildCycleFridays(y); });
    const labelFridays = fridaysByYear[currentCycle];
    const N = labelFridays.length;

    const [allStatuses, allHeaders, rule] = await Promise.all([
      getStatusesByTemplateId(templateId),
      Header.findAll({ where: { templateId }, attributes: ['id', 'name'], raw: true }),
      getRuleConditionsAndHeaders(populationRuleId),
    ]);
    const { conditions, headers } = rule;

    const nameToId = {};
    allHeaders.forEach((h) => { nameToId[h.name] = h.id; });
    const byName = {};
    allStatuses.forEach((s) => { byName[norm(s.statusName)] = s; });

    const dateHeaderIds = {
      admission: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.admission),
      confirmation: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.confirmation),
      cancellation: resolveHeaderId(allHeaders, DATE_HEADER_CANDIDATES.cancellation),
    };

    const stageHeaderName = (allStatuses.find((s) => s.targetHeader) || {}).targetHeader || 'Admissions_Funnel_Stage';
    const stageHeaderId = nameToId[stageHeaderName] || resolveHeaderId(allHeaders, [stageHeaderName]);

    const confirmedValsNorm = new Set((byName['confirmed']?.selectedStatuses || []).map(norm));
    const depositCancelNorm = new Set(
      (byName['cancelled']?.selectedStatuses || []).map(norm).filter((v) => confirmedValsNorm.has(v))
    );
    DEPOSIT_CANCEL_HINTS.forEach((h) => depositCancelNorm.add(h));

    const KNOWN = [
      { key: 'admitted',     label: 'Admits' },
      { key: 'confirmed',    label: 'Confirmed' },
      { key: 'netconfirmed', label: 'Net Confirmed' },
      { key: 'cancelled',    label: 'Cancelled' },
      { key: 'pending',      label: 'Pending' },
    ];
    const plan = [];
    const usedKeys = new Set();
    const addToPlan = (label, def) => {
      plan.push({
        label,
        targetHeaderId: nameToId[def.targetHeader] || resolveHeaderId(allHeaders, [def.targetHeader]),
        selectedSet: new Set(def.selectedStatuses || []),
      });
    };
    for (const k of KNOWN) {
      if (byName[k.key]) { addToPlan(k.label, byName[k.key]); usedKeys.add(k.key); }
    }
    for (const s of allStatuses) {
      const key = norm(s.statusName);
      if (usedKeys.has(key) || !s.statusName) continue;
      addToPlan(s.statusName, s);
      usedKeys.add(key);
    }

    const meltEnabled = Boolean(byName['confirmed'] && (dateHeaderIds.confirmation || stageHeaderId));

    const stages = [];
    const pushIf = (label) => { if (plan.some((p) => p.label === label)) stages.push(label); };
    pushIf('Admits');
    pushIf('Confirmed');
    pushIf('Net Confirmed');
    if (meltEnabled) stages.push(MELT_LABEL);
    pushIf('Cancelled');
    pushIf('Pending');
    for (const p of plan) if (!stages.includes(p.label)) stages.push(p.label);

    const fetchIds = new Set();
    plan.forEach((p) => { if (p.targetHeaderId) fetchIds.add(p.targetHeaderId); });
    if (meltEnabled) {
      [dateHeaderIds.admission, dateHeaderIds.confirmation, dateHeaderIds.cancellation, stageHeaderId]
        .forEach((id) => { if (id) fetchIds.add(id); });
    }
    const fetchIdArr = Array.from(fetchIds);

    const perYear = {};
    const dateByWeek = {};
    years.forEach((y) => {
      perYear[y] = {};
      stages.forEach((st) => { perYear[y][st] = new Array(N).fill(null); });
      dateByWeek[y] = new Array(N).fill(null);
    });

    // One submission per (year, week): latest wins (submissions are ASC).
    const cellByKey = new Map();
    for (const s of submissions) {
      const cy = cycleEndYearOf(s.submissionDate);
      if (!yearSet.has(cy)) continue;
      const week = weekOf(s.submissionDate, fridaysByYear[cy]);
      if (!week || week > N) continue;
      cellByKey.set(`${cy}-${week}`, { sub: s, cy, idx: week - 1 });
    }
    const cells = Array.from(cellByKey.values());

    await mapWithConcurrency(cells, CONCURRENCY, async ({ sub, cy, idx }) => {
      dateByWeek[cy][idx] = ymd(sub.submissionDate);
      const sheetId = sub.selectedSheet;

      const matchingRows = await applyPopulationRule(templateId, sheetId, conditions, headers);
      if (!matchingRows.length) {
        for (const st of stages) perYear[cy][st][idx] = 0;
        return;
      }

      const rows = fetchIdArr.length
        ? await SheetData.findAll({
            where: { sheetId, rowIndex: { [Op.in]: matchingRows }, headerId: { [Op.in]: fetchIdArr } },
            attributes: ['rowIndex', 'headerId', 'value'],
            raw: true,
          })
        : [];

      const rowVals = new Map();
      let hasConfData = false;
      for (const r of rows) {
        let o = rowVals.get(r.rowIndex);
        if (!o) { o = {}; rowVals.set(r.rowIndex, o); }
        o[r.headerId] = r.value;
        if (meltEnabled && r.headerId === dateHeaderIds.confirmation && parseDate(r.value)) hasConfData = true;
      }

      for (const p of plan) {
        if (!p.targetHeaderId) { perYear[cy][p.label][idx] = 0; continue; }
        let count = 0;
        for (const rowIndex of matchingRows) {
          const v = rowVals.get(rowIndex);
          if (v && p.selectedSet.has(v[p.targetHeaderId])) count++;
        }
        perYear[cy][p.label][idx] = count;
      }

      if (meltEnabled) {
        let melt = 0;
        for (const rowIndex of matchingRows) {
          const v = rowVals.get(rowIndex);
          if (!v) continue;
          if (hasConfData) {
            if (parseDate(v[dateHeaderIds.admission]) && parseDate(v[dateHeaderIds.confirmation]) && parseDate(v[dateHeaderIds.cancellation])) melt++;
          } else if (depositCancelNorm.has(norm(v[stageHeaderId]))) {
            melt++;
          }
        }
        perYear[cy][MELT_LABEL][idx] = melt;
      }
    });

    // A submission's count holds until the next submission: carry each year's
    // value forward (leading weeks stay null). `<year>_pt` keeps real values for
    // dotting; `<year>_date` keeps the real submission date for the tooltip.
    const data = {};
    for (const stage of stages) {
      const filled = {};
      const points = {};
      for (const year of years) {
        const src = perYear[year][stage];
        const f = new Array(N).fill(null);
        const p = new Array(N).fill(null);
        let last = null;
        for (let i = 0; i < N; i++) {
          const v = src[i];
          p[i] = v;
          if (v !== null && v !== undefined) last = v;
          f[i] = last;
        }
        filled[year] = f;
        points[year] = p;
      }

      data[stage] = [];
      for (let i = 0; i < N; i++) {
        const row = { week: i + 1, date: iso(labelFridays[i]) };
        for (const year of years) {
          row[String(year)] = filled[year][i];
          row[`${year}_pt`] = points[year][i];
          row[`${year}_date`] = dateByWeek[year][i]; // actual submission date (real points only)
        }
        data[stage].push(row);
      }
    }

    return res.status(200).json({
      currentYear: currentCycle,
      years,
      stages,
      weeks: labelFridays.map((f, i) => ({ week: i + 1, date: iso(f) })),
      data,
      meta: {
        hasDateData: Boolean(dateHeaderIds.admission && dateHeaderIds.confirmation && dateHeaderIds.cancellation),
        meltDerivable: meltEnabled,
      },
    });
  } catch (error) {
    console.error('Error building point-in-time data:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

module.exports = { getPointInTimeData };