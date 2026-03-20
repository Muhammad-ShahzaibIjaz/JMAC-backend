const normalizeKey = key => typeof key === 'string' ? key.replace(/[^a-zA-Z0-9_]/g, '_') : '';

function evaluateConditions(rowData, conditionBlock) {
  const getValue = (field) => {
    const normalizedField = normalizeKey(field);
    return rowData[normalizedField]?.value ?? null;
  }; 

  const evaluateSingle = (cond) => {
    if (cond.operator === 'isEqualTo') {
      const val1 = getValue(cond.field1);
      const val2 = getValue(cond.field2);
      return val1 === val2;
    }
    if (cond.operator === 'isNotEqualTo') {
      const val1 = getValue(cond.field1);
      const val2 = getValue(cond.field2);
      if ((val1 === null || val1 === '' || val1 === "NULL" || val1 === "null") && (val2 === null || val2 === '' || val2 === "NULL" || val2 === "null")) return false;
      return val1 !== val2;
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
  if (!bound || !bound.operator || bound.value === undefined || bound.value === null || bound.value === "" || isNaN(bound.value) || value === null || value === '' || value === "NULL" || value === "null" || isNaN(value)) {
    return false; // no restriction
  }

  const numBound = parseFloat(bound.value);
  switch (bound.operator) {
    case "greaterThan": return value > numBound;
    case "greaterThanEqual": return value >= numBound;
    case "lessThan": return value < numBound;
    case "lessThanEqual": return value <= numBound;
    default: return false; // unknown operator → ignore
  }
}


module.exports = { evaluateConditions, evaluateBound };