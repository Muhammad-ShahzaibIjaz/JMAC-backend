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
  const set = new Set();
  data.forEach(row => {
    if (row[baseKey]) set.add(row[baseKey]);
  });
  return Array.from(set);
}

function countBaseHeaderValues(data, baseKey, allPossibleValues=[]) {
  const counts = {};

  allPossibleValues.forEach(val => {
    counts[val] = 0;
  })

  data.forEach(row => {
    const val = row[baseKey];
    if (val in counts) counts[val]++;
  });
  return counts;
}

module.exports = { buildRanges, countBaseHeaderValues, getAllBaseHeaderValues };