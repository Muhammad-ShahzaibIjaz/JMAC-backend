function calculateNACUBODiscountRate(tuition, fees, totalUnfundedGift) {
  return (tuition + fees) - totalUnfundedGift;
}

function calculateTotalDiscountRate(netCharges, totalInstitutionalGift) {
  return netCharges - totalInstitutionalGift;
}

function calculateNetTuition(tuition, totalInstitutionalGift) {
  return tuition - totalInstitutionalGift;
}

function calculateNetCharges(tuition, fees, housingCost, food) {
  return tuition + fees + housingCost + food;
}

function calculateNeed(COA, SAI) {
  return COA - SAI;
}

function calculateNeedMet(need, totalInstitutionalGift) {
  return need - totalInstitutionalGift;
}

function calculateGap(needMet) {
  return needMet > 0 ? needMet : 0;
}

function matchCriteria(value, criteria) {
  if (criteria.includes('*') || criteria.includes('?')) {
    // Convert custom pattern to regex
    const regexPattern = '^' + criteria
      .replace(/\*/g, '.')
      .replace(/\?/g, '.*')
      + '$';

    const regex = new RegExp(regexPattern, 'i');
    return regex.test(value);
  } else {
    return value === criteria;
  }
}


module.exports = {
  calculateNACUBODiscountRate,
  calculateTotalDiscountRate,
  calculateNetTuition,
  calculateNetCharges,
  calculateNeed,
  calculateNeedMet,
  calculateGap,
  matchCriteria
};