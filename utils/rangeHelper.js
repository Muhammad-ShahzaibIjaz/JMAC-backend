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
    if (val != null && val !== '') values.add(val);
  }
  return Array.from(values);
}

function countBaseHeaderValues(data, baseKey, allPossibleValues = []) {
  const counts = Object.fromEntries(allPossibleValues.map(v => [v, 0]));
  for (let i = 0; i < data.length; i++) {
    const val = data[i][baseKey];
    if (val in counts) counts[val]++;
  }
  return counts;
}

// Utility: Sort by type
function sortByType(data, header) {
  return [...data].sort((a, b) => {
    const valA = a[header], valB = b[header];

    const numA = +valA, numB = +valB;
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;

    const dateA = Date.parse(valA), dateB = Date.parse(valB);
    if (!isNaN(dateA) && !isNaN(dateB)) return dateA - dateB;

    return String(valA).localeCompare(String(valB));
  });
}

// Utility: Split into buckets
function splitIntoBuckets(data, count) {
  const buckets = Array.from({ length: count }, () => []);
  data.forEach((item, i) => {
    buckets[Math.floor(i * count / data.length)].push(item);
  });
  return buckets;
}

// Utility: Extract range
function extractRange(bucket, header) {
  let min = null, max = null;
  for (const row of bucket) {
    const val = row[header];
    if (val == null) continue;

    const norm = typeof val === 'string' ? val.trim() : val;
    if (min === null || sortByType([{ [header]: norm }], header)[0][header] < min) min = norm;
    if (max === null || sortByType([{ [header]: norm }], header)[0][header] > max) max = norm;
  }
  return { start: min, end: max };
}

function looselyNormalize(value) {
  if (value == null) return '';
  const num = parseFloat(value);
  if (!isNaN(num)) return num.toFixed(4);
  const date = new Date(value);
  if (!isNaN(date)) return date.getTime().toString();
  return String(value).trim().toLowerCase();
}

module.exports = { buildRanges, countBaseHeaderValues, getAllBaseHeaderValues, sortByType, splitIntoBuckets, extractRange, looselyNormalize };