/**
 * dateNormalizer.js
 * ------------------
 * Centralised date handling for Excel/CSV uploads.
 *
 * WHY THIS EXISTS
 * ---------------
 * Different source exports store the same logical "date" in different ways:
 *
 *   1. Text dates      -> "09/19/2005", "7/16/24 14:20"   (Fall2024 export)
 *   2. Excel serials   -> 45313, 45489.597...             (FAFSA/package cols)
 *   3. Foreign-encoded -> 12009175, 15817559  (8-digit)   (PowerCampus/CRM cols)
 *
 * Previously the readers used { raw: true } and dumped whatever was stored, so:
 *   - real Excel serials showed up as "45313" instead of a date, and
 *   - datetimes kept their time component.
 *
 * This module turns every recoverable date into the canonical string:
 *
 *        MM-DD-YYYY          (no time component, zero-padded)
 *
 * Values that cannot be recovered (the 8-digit foreign-encoded integers that
 * Excel itself cannot render — their formatted text is empty) are returned
 * unchanged. There is NO arithmetic transform that recovers them consistently;
 * they are corrupt at the source and must be fixed in the export, not here.
 */

// Excel 1900 date-system epoch. Excel's day 1 == 1900-01-01, but it also has the
// fake 1900-02-29, so the usable epoch anchor is 1899-12-30 (UTC to avoid TZ drift).
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86400000;

// Plausible Excel serial range: day 2 (1900-01-01) .. ~60000 (year 2064).
// Anything >= 60000 that is formatted as a date is treated as unrecoverable junk
// (the real foreign-encoded values are all 8 digits, i.e. >= 10,000,000).
const SERIAL_MIN = 1;
const SERIAL_MAX = 60000;

// Text date like 9/19/2005, 09-19-2005, 7/16/24, optionally followed by a time
// part ("7/16/24 14:20" / "2024-01-22T00:00") which we strip.
const TEXT_DATE_RE = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T].*)?$/;

// Pure-number string ("45313", "45489.59")
const NUMERIC_STR_RE = /^\d+(\.\d+)?$/;

// Two-digit-year pivot: 00-69 -> 2000-2069, 70-99 -> 1970-1999.
function expandTwoDigitYear(yy) {
  const n = parseInt(yy, 10);
  return (n <= 69 ? 2000 + n : 1900 + n).toString();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Convert an Excel serial number (integer or fractional) to "MM-DD-YYYY".
 * The fractional part (time of day) is intentionally dropped.
 */
function excelSerialToMDY(serial) {
  const ms = EXCEL_EPOCH_UTC + Math.round(serial) * MS_PER_DAY;
  const d = new Date(ms);
  return `${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}-${d.getUTCFullYear()}`;
}

/**
 * Is this a plausible Excel date serial we can convert?
 */
function isConvertibleSerial(n) {
  return typeof n === 'number' && isFinite(n) && n > SERIAL_MIN && n < SERIAL_MAX;
}

/**
 * Decide whether a column's number-format code represents a date.
 * Used so we convert date-typed cells even when the header name is not obviously
 * "date-like". Guards against percent / general / plain-number formats.
 */
function isDateNumberFormat(z) {
  if (!z || typeof z !== 'string') return false;
  let fmt = z.trim();
  if (fmt === '' || fmt === 'General' || fmt === '@') return false;

  // Only look at the positive section of the format (Excel sections are
  // positive;negative;zero;text separated by ';'). The negative section is
  // where "[Red]" usually lives.
  fmt = fmt.split(';')[0];

  // Strip the parts of a format code that are NOT date/number tokens but can
  // still contain the letters d/m/y:
  //   - [Red], [Blue], [$-409], [>100] ... bracketed color/locale/condition tokens
  //   - "literal text"  (e.g. "$", "Date: ")
  //   - \x escaped single chars (e.g. \( \) )
  fmt = fmt
    .replace(/\[[^\]]*\]/g, '')   // [Red], [$-409], [>0] ...
    .replace(/"[^"]*"/g, '')      // quoted literals
    .replace(/\\./g, '');         // escaped chars like \( \)

  if (fmt === '' ) return false;
  if (fmt.includes('%')) return false;

  // A currency/number format now has no date letters left ("$"#,##0 -> #,##0).
  // A real date format keeps its tokens (mm-dd-yyyy, d/m/yy, yyyy ...).
  // Require a 'd' or 'y' (day/year) AND confirm with the broader d/m/y test —
  // 'm' alone is ambiguous (minutes), so it can't trigger on its own.
  return /[dy]/i.test(fmt) && /[dmy]/i.test(fmt);
}

/**
 * Decide whether a header name looks like a date column.
 */
function isDateHeaderName(name) {
  if (name === null || name === undefined) return false;
  return /date|dob|birth/i.test(name.toString());
}

/**
 * Normalize a single cell value to "MM-DD-YYYY" when it is a recoverable date.
 * Returns the ORIGINAL value untouched when it is empty, non-date, or an
 * unrecoverable foreign-encoded integer.
 *
 * This is safe to call on any value in a date column.
 */
function normalizeDateValue(raw) {
  if (raw === null || raw === undefined || raw === '') return raw;

  // Numeric Excel serial (from raw:true reads).
  if (typeof raw === 'number') {
    return isConvertibleSerial(raw) ? excelSerialToMDY(raw) : raw;
  }

  const s = raw.toString().trim();
  if (s === '') return raw;

  // Numeric string that is actually an Excel serial, e.g. "45313".
  if (NUMERIC_STR_RE.test(s)) {
    const n = parseFloat(s);
    return isConvertibleSerial(n) ? excelSerialToMDY(n) : s;
  }

  // Textual date, with any trailing time part stripped.
  const m = s.match(TEXT_DATE_RE);
  if (m) {
    const mo = pad2(m[1]);
    const dy = pad2(m[2]);
    const yr = m[3].length === 2 ? expandTwoDigitYear(m[3]) : m[3];
    return `${mo}-${dy}-${yr}`;
  }

  // Unknown format -> leave untouched.
  return raw;
}

/**
 * Given a worksheet (SheetJS Sheet object), build a Set of column indices that
 * hold dates, using BOTH the header name and the majority cell number-format.
 *
 * @param {object} worksheet  SheetJS worksheet (needs cellNF:true at read time
 *                            for format-based detection to work; header-name
 *                            detection still works without it).
 * @param {number} headerRowIndex  0-based row index of the header row.
 * @returns {Set<number>} set of 0-based column indices that are date columns.
 */
function detectDateColumns(worksheet, headerRowIndex = 0) {
  const dateCols = new Set();
  if (!worksheet || !worksheet['!ref']) return dateCols;

  const XLSX = require('xlsx');
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const SAMPLE = 50; // rows to sample for format detection

  for (let c = range.s.c; c <= range.e.c; c++) {
    // Header-name signal
    const headerCell = worksheet[XLSX.utils.encode_cell({ c, r: headerRowIndex })];
    const byName = headerCell ? isDateHeaderName(headerCell.v) : false;

    // Format signal (majority of numeric cells carry a date format)
    let fmtHits = 0;
    let fmtTotal = 0;
    for (let r = headerRowIndex + 1; r <= Math.min(range.e.r, headerRowIndex + SAMPLE); r++) {
      const cell = worksheet[XLSX.utils.encode_cell({ c, r })];
      if (cell && cell.t === 'n') {
        fmtTotal++;
        if (isDateNumberFormat(cell.z)) fmtHits++;
      }
    }
    const byFormat = fmtTotal > 0 && fmtHits / fmtTotal > 0.5;

    if (byName || byFormat) dateCols.add(c);
  }

  return dateCols;
}

/**
 * Convenience: detect date columns directly from a header-name array only.
 * Useful on code paths that have already reduced a sheet to a headers[] array
 * and lost the worksheet object (e.g. after processDataRows).
 *
 * @param {Array} headers array of header names (0-based, aligned to columns)
 * @returns {Set<number>}
 */
function detectDateColumnsByName(headers) {
  const dateCols = new Set();
  if (!Array.isArray(headers)) return dateCols;
  headers.forEach((h, i) => {
    if (isDateHeaderName(h)) dateCols.add(i);
  });
  return dateCols;
}

/**
 * Normalize every date cell in a rows[][] block in place-ish (returns a new
 * data array; rows are new arrays, original input is not mutated).
 *
 * @param {Array<Array>} data  array of row arrays
 * @param {Set<number>} dateColumnIndices columns to normalize
 * @returns {Array<Array>} data with date columns normalized
 */
function normalizeDateColumnsInData(data, dateColumnIndices) {
  if (!Array.isArray(data) || !dateColumnIndices || dateColumnIndices.size === 0) {
    return data;
  }
  return data.map(row => {
    if (!Array.isArray(row)) return row;
    const copy = row.slice();
    for (const ci of dateColumnIndices) {
      copy[ci] = normalizeDateValue(copy[ci]);
    }
    return copy;
  });
}

module.exports = {
  normalizeDateValue,
  excelSerialToMDY,
  isConvertibleSerial,
  isDateNumberFormat,
  isDateHeaderName,
  detectDateColumns,
  detectDateColumnsByName,
  normalizeDateColumnsInData,
};