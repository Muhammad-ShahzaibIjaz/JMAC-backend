/**
 * Fund Code Type configuration.
 *
 * Source of truth: "Fund Code List for Awards Tab.xlsx"
 * The ORDER IN THIS FILE IS THE ORDER RENDERED IN THE CHART.
 * Institutional Aid is always first, Employee Benefit second, etc.
 * Do not re-sort this at runtime.
 *
 * Pattern syntax
 * --------------
 *   *        -> exactly ONE character, anything (alpha / numeric / special)
 *   (A+B)    -> exactly ONE character, either A or B  e.g. (T+E) -> [TE]
 *   anything else is a literal character (case-insensitive)
 *
 * So:
 *   IM*G      -> 4 chars: I, M, <any one>, G
 *   (T+E)***  -> 4 chars: T or E, then any 3
 *   I***      -> 4 chars: I, then any 3   (the group TOTAL row)
 *
 * `isTotal: true` rows are the "TOTAL <X> AID" rollups. They are matched
 * INDEPENDENTLY of the detail rows — a code that lands in "Merit Gift" also
 * lands in "TOTAL INSTITUTIONAL AID". That is intentional.
 */

const FUND_CODE_GROUPS = [
  {
    group: 'Institutional Aid',
    rows: [
      { code: 'IM*G', viewName: 'Merit Gift' },
      { code: 'IN*G', viewName: 'Need Gift' },
      { code: 'II*G', viewName: 'International Merit Gift' },
      { code: 'IH*G', viewName: 'Honors Gift' },
      { code: 'IT*G', viewName: 'Talent Gift' },
      { code: 'IP*G', viewName: 'Premier Gift' },
      { code: 'IA*G', viewName: 'Athletic Gift' },
      { code: 'IQ*G', viewName: 'Qualified Gift' },
      { code: 'IO*G', viewName: 'Other Gift' },
      { code: 'I*RG', viewName: 'Room Gift' },
      { code: 'I**W', viewName: 'Institutional Work' },
      { code: 'I**L', viewName: 'Institutional Loan' },
      { code: 'I***', viewName: 'TOTAL INSTITUTIONAL AID', isTotal: true },
    ],
  },
  {
    group: 'Employee Benefit',
    rows: [
      { code: 'E**G', viewName: 'Employee Benefit Gift' },
      { code: 'T**G', viewName: 'Tuition Exchange Gift' },
      { code: '(T+E)***', viewName: 'TOTAL EMPLOYEE BENEFIT AID', isTotal: true },
    ],
  },
  {
    group: 'State Aid',
    rows: [
      { code: 'SN*G', viewName: 'State Need Gift' },
      { code: 'SM*G', viewName: 'State Merit Gift' },
      { code: 'SO*G', viewName: 'State Other Gift' },
      { code: 'S**W', viewName: 'State Work' },
      { code: 'S**L', viewName: 'State Loan' },
      { code: 'S***', viewName: 'TOTAL STATE AID', isTotal: true },
    ],
  },
  {
    group: 'Federal Aid',
    rows: [
      { code: 'FN*G', viewName: 'Federal Need Gift' },
      { code: 'FO*G', viewName: 'Federal Other Gift' },
      { code: 'FQ*G', viewName: 'Federal Qualified Gift' },
      { code: 'F**W', viewName: 'Federal Work' },
      { code: 'FN*L', viewName: 'Federal Need Loan' },
      { code: 'FQ*L', viewName: 'Federal Qualified Loan' },
      { code: 'F***', viewName: 'TOTAL FEDERAL AID', isTotal: true },
    ],
  },
  {
    group: 'Outside Aid',
    rows: [
      { code: 'O**G', viewName: 'Outside Gift' },
      { code: 'O**W', viewName: 'Outside Work' },
      { code: 'O**L', viewName: 'Outside Loan' },
      { code: 'O***', viewName: 'TOTAL OUTSIDE AID', isTotal: true },
    ],
  },
  {
    group: 'Private Aid',
    rows: [
      { code: 'P**G', viewName: 'Private Gift' },
      { code: 'P**W', viewName: 'Private Work' },
      { code: 'P**L', viewName: 'Private Loan' },
      { code: 'P***', viewName: 'TOTAL PRIVATE AID', isTotal: true },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Pattern -> RegExp                                                   */
/* ------------------------------------------------------------------ */

const escapeLiteral = ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile a fund-code pattern into an anchored, case-insensitive RegExp.
 *
 *   'IM*G'     -> /^IM.G$/i
 *   '(T+E)***' -> /^[TE]...$/i
 *   'I***'     -> /^I...$/i
 */
const patternToRegex = pattern => {
  let source = '^';
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === '(') {
      const close = pattern.indexOf(')', i);
      if (close === -1) {
        throw new Error(`Unclosed "(" in fund code pattern: ${pattern}`);
      }
      const alternatives = pattern
        .slice(i + 1, close)
        .split('+')
        .map(s => s.trim())
        .filter(Boolean);

      if (!alternatives.length) {
        throw new Error(`Empty alternation in fund code pattern: ${pattern}`);
      }

      // All single characters -> character class. Otherwise -> non-capturing group.
      if (alternatives.every(a => a.length === 1)) {
        source += `[${alternatives.map(escapeLiteral).join('')}]`;
      } else {
        source += `(?:${alternatives.map(escapeLiteral).join('|')})`;
      }
      i = close + 1;
      continue;
    }

    if (ch === '*') {
      source += '.'; // exactly one character, anything
      i += 1;
      continue;
    }

    source += escapeLiteral(ch);
    i += 1;
  }

  source += '$';
  return new RegExp(source, 'i');
};

/* ------------------------------------------------------------------ */
/* Derived structures (built once at require time)                     */
/* ------------------------------------------------------------------ */

/**
 * Flat, ordered layout the frontend uses to render rows + dividers.
 * [{ group, viewName, code, isTotal, groupIndex, rowIndex }]
 */
const FUND_CODE_LAYOUT = FUND_CODE_GROUPS.flatMap((g, groupIndex) =>
  g.rows.map((r, rowIndex) => ({
    group: g.group,
    viewName: r.viewName,
    code: r.code,
    isTotal: !!r.isTotal,
    groupIndex,
    rowIndex,
  }))
);

const FUND_CODE_VIEW_NAMES = FUND_CODE_LAYOUT.map(r => r.viewName);

const COMPILED_GROUPS = FUND_CODE_GROUPS.map(g => ({
  group: g.group,
  details: g.rows.filter(r => !r.isTotal).map(r => ({ ...r, regex: patternToRegex(r.code) })),
  totals: g.rows.filter(r => r.isTotal).map(r => ({ ...r, regex: patternToRegex(r.code) })),
}));

/**
 * Resolve a raw fund code (e.g. "IM1G") to the View Names it feeds.
 *
 * Rules:
 *  - Within a group, the FIRST matching detail row wins (spreadsheet order).
 *    This stops a code like "IMRG" from being counted in both "Merit Gift"
 *    (IM*G) and "Room Gift" (I*RG).
 *  - The group TOTAL row is matched independently and always added.
 *  - A code is checked against every group, so nothing is silently dropped
 *    if the prefixes ever overlap.
 *
 * Returns [] for codes that match nothing (unmapped codes are ignored).
 */
const _resolveCache = new Map();

const resolveFundCodeViewNames = rawCode => {
  const code = (rawCode || '').trim();
  if (!code) return [];

  if (_resolveCache.has(code)) return _resolveCache.get(code);

  const targets = [];
  for (const g of COMPILED_GROUPS) {
    const detail = g.details.find(d => d.regex.test(code));
    if (detail) targets.push(detail.viewName);
    for (const t of g.totals) {
      if (t.regex.test(code)) targets.push(t.viewName);
    }
  }

  _resolveCache.set(code, targets);
  return targets;
};

module.exports = {
  FUND_CODE_GROUPS,
  FUND_CODE_LAYOUT,
  FUND_CODE_VIEW_NAMES,
  patternToRegex,
  resolveFundCodeViewNames,
};