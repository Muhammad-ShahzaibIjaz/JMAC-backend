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

function detectType(data, header, options = {}) {
  const {
    sampleSize = 50,
    confidenceThreshold = 0.8
  } = options;

  // Early return for empty data
  if (!data || !Array.isArray(data) || data.length === 0) {
    return 'string';
  }

  let numericCount = 0;
  let dateCount = 0;
  let totalChecked = 0;

  const sample = data.slice(0, Math.min(sampleSize, data.length));

  for (let i = 0; i < sample.length; i++) {
    const row = sample[i];
    if (!row || row[header] === undefined) continue;

    const value = row[header];

    if (value === null || value === undefined || value === '' || value === 'NULL' || value === 'null') {
      continue;
    }

    totalChecked++;
    const stringValue = String(value).trim();

    if (isValidNumber(stringValue)) {
      numericCount++;
    }
    else if (isValidDate(stringValue)) {
      dateCount++;
    }
  }

  if (totalChecked > 0) {
    const numericRatio = numericCount / totalChecked;
    const dateRatio = dateCount / totalChecked;

    if (numericRatio >= confidenceThreshold) {
      return 'number';
    }
    if (dateRatio >= confidenceThreshold) {
      return 'date';
    }
  }

  return 'string';
}

function isValidNumber(value) {

  if (value === '' || 
      value === 'true' || 
      value === 'false' || 
      /[a-df-zA-DF-Z]/.test(value)) { 
    return false;
  }

  const num = Number(value);
  
  return !isNaN(num) && 
         isFinite(num) && 
         (String(num) === value || String(num) === value.trim());
}

function isValidDate(value) {
  if (value.length < 6 || !/[\d\/\-\.]/.test(value)) {
    return false;
  }

  const datePatterns = [
    /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/,
    /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/,
    /^\d{1,2}[\/\-]\d{4}$/,
    /^\d{4}[\/\-]\d{1,2}$/,
    /^\d{1,2}\.\d{1,2}\.\d{4}$/
  ];

  const isDatePattern = datePatterns.some(pattern => pattern.test(value));
  
  if (!isDatePattern) {
    return false;
  }

  const date = new Date(value);
  return !isNaN(date.getTime()) && 
         date instanceof Date && 
         String(date) !== 'Invalid Date';
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
  if (count <= 0 || data.length === 0) return [];
  if (count === 1) return [data];
  
  const buckets = Array.from({ length: count }, () => []);
  const total = data.length;
  
  for (let i = 0; i < total; i++) {
    const bucketIndex = Math.floor((i * count) / total);
    buckets[bucketIndex].push(data[i]);
  }
  
  return buckets.filter(bucket => bucket.length > 0);
}

function splitByCount(data, bucketCount, targetHeader) {
  const sorted = sortByType(data, targetHeader, 'number');
  const total = sorted.length;
  const perBucket = Math.floor(total / bucketCount);
  const buckets = [];

  let start = 0;
  for (let i = 0; i < bucketCount; i++) {
    const end = i === bucketCount - 1 ? total : start + perBucket;
    buckets.push(sorted.slice(start, end));
    start = end;
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
  if (String(value).trim() === '') return 'blanks';
  const num = parseFloat(value);
  if (!isNaN(num)) return num.toFixed(4);
  const date = new Date(value);
  if (!isNaN(date)) return date.getTime().toString();
  return String(value).trim().toLowerCase();
}

// Helper function to get the last value in a bucket
function getLastValue(bucket, targetHeader) {
  if (bucket.length === 0) return null;
  return +bucket[bucket.length - 1][targetHeader];
}

// Helper function to get the first value in a bucket
function getFirstValue(bucket, targetHeader) {
  if (bucket.length === 0) return null;
  return +bucket[0][targetHeader];
}


function splitIntoValueAwareBuckets(sortedData, bucketCount, targetHeader) {
  if (bucketCount <= 0) return [];
  if (bucketCount === 1) return [sortedData];
  
  let buckets = splitIntoBuckets(sortedData, bucketCount);
  let hasOverlap = true;
  let maxIterations = 10; // Prevent infinite loops
  
  while (hasOverlap && maxIterations > 0) {
    hasOverlap = false;
    
    for (let i = 0; i < buckets.length - 1; i++) {
      const currentBucket = buckets[i];
      const nextBucket = buckets[i + 1];
      
      if (currentBucket.length === 0 || nextBucket.length === 0) continue;
      
      const currentEnd = getLastValue(currentBucket, targetHeader);
      const nextStart = getFirstValue(nextBucket, targetHeader);
      
      // Check if boundary values are the same
      if (currentEnd === nextStart) {
        hasOverlap = true;
        
        // Find all rows in nextBucket with the same boundary value
        const boundaryValue = nextStart;
        const moveRows = [];
        const keepRows = [];
        
        for (const row of nextBucket) {
          if (+row[targetHeader] === boundaryValue) {
            moveRows.push(row);
          } else {
            keepRows.push(row);
          }
        }
        
        // Move rows to current bucket
        buckets[i] = [...currentBucket, ...moveRows];
        buckets[i + 1] = keepRows;
        
        // If next bucket becomes empty, remove it and redistribute
        if (keepRows.length === 0) {
          buckets.splice(i + 1, 1);
          // Rebalance remaining data into remaining buckets
          const allRemaining = buckets.flat();
          const remainingBucketCount = Math.max(1, bucketCount - (buckets.length - i - 1));
          buckets = [
            ...buckets.slice(0, i + 1),
            ...splitIntoBuckets(allRemaining.slice(buckets[i].length), remainingBucketCount)
          ];
        }
        
        break; // Restart checking from beginning after modification
      }
    }
    
    maxIterations--;
  }
  
  // Remove any empty buckets
  return buckets.filter(bucket => bucket.length > 0);
}

module.exports = { buildRanges, countBaseHeaderValues, getAllBaseHeaderValues, sortByType, detectType, splitIntoBuckets, extractRange, looselyNormalize, splitByCount, splitIntoValueAwareBuckets };