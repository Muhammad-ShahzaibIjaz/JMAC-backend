function calculateNACUBODiscountRate(tuition, fees, totalInstitutionalGift) {
  if (tuition + fees === 0) return 0;
  const rate = totalInstitutionalGift / (tuition + fees);
  return (rate * 100).toFixed(2);
}

function calculateTuitionDiscountRate(tuition, totalInstitutionalGift) {
  if (tuition === 0 || totalInstitutionalGift === 0) return 0;
  const rate = totalInstitutionalGift / tuition;
  return (rate * 100).toFixed(2);
}

function calculateTotalDiscountRate(totalInstitutionalGift, totalDirectCost) {
  if (totalDirectCost === 0 || totalInstitutionalGift === 0) return 0;
  const rate = (totalInstitutionalGift / totalDirectCost);
  return (rate * 100).toFixed(2);
}

function calculateNetTuitionFee(tuition, totalInstitutionalGift, fees) {
  return (tuition + fees) - totalInstitutionalGift;
}

function calculateNetTuition(tuition, totalInstitutionalGift) {
  return tuition - totalInstitutionalGift;
}

function calculateNetCharges(tuition, fees, housingCost, food, gift) {
  return (tuition + fees + housingCost + food) - gift;
}

function calculateTotalDirectCost(tuition, fees, housingCost, food) {
  return tuition + fees + housingCost + food;
}

function calculateNeed(COA, SAI) {
  if (SAI < 0) {
    SAI = 0;
  }
  const need = COA - SAI;
  return need > 0 ? need : 0;
}

function calculateNeedMet(need, giftAid, workAid, fnflAmount) {
  return need - (giftAid + workAid + fnflAmount);
}

function calculateGap(directCosts, gift, fnflAmount) {
  return directCosts - gift - fnflAmount;
}

function calculateTotalNeedMet(need, giftAid, workAid, fnflAmount) {
  if (need === 0 || (giftAid === 0 && workAid === 0 && fnflAmount === 0)) return 0;
  const rate = (giftAid + workAid + fnflAmount) / need;
  return (rate * 100).toFixed(2);
}

function calculateTotalInstitutionalMeritGift(need, totalGiftAid) {
  if (need === 0 || totalGiftAid === 0) return 0;
  const rate = totalGiftAid / need;
  return (rate * 100).toFixed(2);
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
  calculateNetTuitionFee,
  calculateTuitionDiscountRate,
  calculateNetCharges,
  calculateNeed,
  calculateNeedMet,
  calculateGap,
  matchCriteria,
  calculateTotalNeedMet,
  calculateTotalDirectCost,
  calculateTotalInstitutionalMeritGift
};