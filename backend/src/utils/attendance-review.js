'use strict';

// Both the submitting account and the subject's linked account are conflicted.
function selfReview(userId, correction) {
  return correction.requestedByUserId === userId || correction.employee?.userId === userId;
}
function reviewableWhere(userId) {
  return { status: 'PENDING', requestedByUserId: { not: userId },
    employee: { is: { OR: [{ userId: null }, { userId: { not: userId } }] } } };
}
module.exports = { selfReview, reviewableWhere };
