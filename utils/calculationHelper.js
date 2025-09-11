function calculateNACUBODiscountRate(tuition, fees, totalUnfundedGift) {
  if (tuition + fees === 0) return 0;
  const rate = ((tuition + fees) - totalUnfundedGift) / (tuition + fees);
  return (rate * 100).toFixed(2) + '%';
}

function calculateTotalDiscountRate(netCharges, totalInstitutionalGift) {
  if (netCharges === 0) return 0;
  const rate = ((netCharges - totalInstitutionalGift) / netCharges);
  return (rate * 100).toFixed(2) + '%';
}

function calculateNetTuition(tuition, totalInstitutionalGift) {
  return tuition - totalInstitutionalGift;
}

function calculateNetCharges(tuition, fees, housingCost, food, gift) {
  return (tuition + fees + housingCost + food) - gift;
}

function calculateNeed(COA, SAI) {
  return COA - SAI;
}

function calculateNeedMet(need, totalNeedBasedAid) {
  return need - totalNeedBasedAid;
}

function calculateGap(needMet) {
  return needMet > 0 ? needMet : 0;
}

function calculateTotalNeedMet(need, totalNeedBasedAid) {
  if (need === 0) return 0;
  const rate = (need - totalNeedBasedAid) / need;
  return (rate * 100).toFixed(2) + '%';
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
  matchCriteria,
  calculateTotalNeedMet
};