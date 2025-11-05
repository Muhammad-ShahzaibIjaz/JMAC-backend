function buildRanges(data, key, categoryCount) {
  const values = data.map(d => parseFloat(d[key])).filter(v => !isNaN(v));
  if (!values.length) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const step = Math.ceil((max - min + 1) / categoryCount);

  const ranges = [];
  for (let i = 0; i < categoryCount; i++) {
    const start = min + i * step;
    const end = i === categoryCount - 1 ? max : start + step - 1;
    ranges.push({ start, end });
  }
  return ranges;
}

function getAllBaseHeaderValues(data, baseKey) {
  const values = new Set();
  for (let i = 0; i < data.length; i++) {
    const val = data[i][baseKey];
    if (val != null && val !== '') {
      values.add(val);
    } else {
      values.add(val == null ? 'NULL' : 'blanks');
    }
  }
  return Array.from(values);
}

function countBaseHeaderValues(data, baseKey, allPossibleValues = []) {
  const counts = Object.fromEntries(allPossibleValues.map(v => [v, 0]));
  for (let i = 0; i < data.length; i++) {
    const raw = data[i][baseKey];
    let key;
    if (raw !== null && raw !== '') {
      key = raw;
    } else {
      key = raw == null ? 'NULL' : 'blanks';
    }
    if (key in counts) counts[key]++;
  }
  return counts;
}

function detectType(data, header) {
  for (let i = 0; i < data.length; i++) {
    const val = data[i][header];
    if (val == null) continue;
    if (!isNaN(+val)) return 'number';
    if (!isNaN(Date.parse(val))) return 'date';
  }
  return 'string';
}

// Utility: Sort by type
function sortByType(data, header, type) {
  return data.sort((a, b) => {
    const valA = a[header], valB = b[header];
    if (type === 'number') return +valA - +valB;
    if (type === 'date') return Date.parse(valA) - Date.parse(valB);
    return String(valA).localeCompare(String(valB));
  });
}


// Utility: Split into buckets
function splitIntoBuckets(data, count) {
  const buckets = Array.from({ length: count }, () => []);
  const total = data.length;
  const ratio = total / count;

  for (let i = 0; i < total; i++) {
    buckets[Math.floor(i / ratio)].push(data[i]);
  }
  return buckets;
}

// Utility: Extract range
function extractRange(bucket, header) {
  let min = null, max = null;
  let type = 'string';

  for (let i = 0; i < bucket.length; i++) {
    const val = bucket[i][header];
    if (val == null) continue;

    const num = +val;
    if (!isNaN(num)) {
      type = 'number';
      break;
    }

    const date = Date.parse(val);
    if (!isNaN(date)) {
      type = 'date';
      break;
    }
  }

  for (let i = 0; i < bucket.length; i++) {
    const val = bucket[i][header];
    if (val == null) continue;

    let norm;
    if (type === 'number') norm = +val;
    else if (type === 'date') norm = Date.parse(val);
    else norm = String(val).trim();

    if (min === null || norm < min) min = norm;
    if (max === null || norm > max) max = norm;
  }

  return { start: min, end: max };
}

function looselyNormalize(value) {
  if (value === null || value === 'NULL' || value === 'null') return 'NULL';
  if (String(value).trim() === '') return 'Blanks';
  const num = parseFloat(value);
  if (!isNaN(num)) return num.toFixed(4);
  const date = new Date(value);
  if (!isNaN(date)) return date.getTime().toString();
  return String(value).trim().toLowerCase();
}

module.exports = { buildRanges, countBaseHeaderValues, getAllBaseHeaderValues, sortByType, detectType, splitIntoBuckets, extractRange, looselyNormalize };