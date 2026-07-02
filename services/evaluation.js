const normalizeKey = key => typeof key === 'string' ? key.replace(/[^a-zA-Z0-9_]/g, '_') : '';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const US_DATE_REGEX = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

const isDateLike = (v) => typeof v === 'string' && (DATE_REGEX.test(v) || US_DATE_REGEX.test(v));

const toDateOnly = (v) => {
  if (typeof v !== 'string') return v;
  if (DATE_REGEX.test(v)) return v.slice(0, 10);         // "2025-10-18T04:32:18" → "2025-10-18"
  const match = v.match(US_DATE_REGEX);
  if (match) return `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;  // "10/17/2025" → "2025-10-17"
  return v;
};

const valuesEqual = (a, b) => {
  if (isDateLike(a) && isDateLike(b)) {
    return toDateOnly(a) === toDateOnly(b);
  }
  return a === b;
};

function evaluateConditions(rowData, conditionBlock) {
  const getValue = (field) => {
    const normalizedField = normalizeKey(field);
    return rowData[normalizedField]?.value ?? null;
  }; 

  const evaluateSingle = (cond) => {
    if (cond.operator === 'isEqualTo') {
      const val1 = getValue(cond.field1 || cond.field);
      const val2 = getValue(cond.field2);
      return valuesEqual(val1, val2);
    }
    
    if (cond.operator === 'isNotEqualTo') {
      const val1 = getValue(cond.field1);
      const val2 = getValue(cond.field2);
      if ((val1 === null || val1 === '' || val1 === "NULL" || val1 === "null") && (val2 === null || val2 === '' || val2 === "NULL" || val2 === "null")) return false;
      return !valuesEqual(val1, val2);
    }

    const value = getValue(cond.field);
    const target = cond.value;

    switch (cond.operator) {
      case 'equal': return value === target;
      case 'notEqual': return value !== target;
      case 'isNull': return value === null || value === '' || value === "NULL" || value === "null";
      case 'isNotNull': return value !== null && value !== '' && value !== "NULL" && value !== "null";
      case 'contains': return typeof value === 'string' && value.includes(target);
      case 'notContains': return typeof value === 'string' && !value.includes(target);
      case 'startsWith': return typeof value === 'string' && value.startsWith(target);
      case 'endsWith': return typeof value === 'string' && value.endsWith(target);
      case 'greaterThan': return parseFloat(value) > parseFloat(target);
      case 'lessThan': return parseFloat(value) < parseFloat(target);
      case 'greaterThanEqual': return parseFloat(value) >= parseFloat(target);
      case 'lessThanEqual': return parseFloat(value) <= parseFloat(target);
      default: return false;
    }
  };

  // Recursive evaluation for nested blocks
  if (conditionBlock.all) {
    return conditionBlock.all.every(sub => evaluateConditions(rowData, sub));
  }

  if (conditionBlock.any) {
    return conditionBlock.any.some(sub => evaluateConditions(rowData, sub));
  }

  return evaluateSingle(conditionBlock);
}

function evaluateBound(value, bound) {
  if (!bound || !bound.operator || bound.value === undefined || bound.value === null || bound.value === "" || value === null || value === '' || value === "NULL" || value === "null") {
    return false; // no restriction
  }
 
  // Text/string equality comparisons (e.g. "Y"/"N" flags) — do NOT force numeric parsing
  if (bound.operator === "isEqualTo" || bound.operator === "isNotEqualTo") {
    if (isNaN(bound.value)) {
      const strValue = String(value).trim().toUpperCase();
      const strBound = String(bound.value).trim().toUpperCase();
      return bound.operator === "isEqualTo" ? strValue === strBound : strValue !== strBound;
    }
  }
 
  // Numeric comparisons
  if (isNaN(value) || isNaN(bound.value)) return false;
 
  const numValue = parseFloat(value);
  const numBound = parseFloat(bound.value);
  switch (bound.operator) {
    case "greaterThan": return numValue > numBound;
    case "greaterThanEqual": return numValue >= numBound;
    case "lessThan": return numValue < numBound;
    case "lessThanEqual": return numValue <= numBound;
    case "isNotEqualTo": return numValue !== numBound;
    case "isEqualTo": return numValue === numBound;
    default: return false; // unknown operator → ignore
  }
}


module.exports = { evaluateConditions, evaluateBound };