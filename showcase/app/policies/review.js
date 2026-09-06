// Who may do what to one review.
//
// The nested routes already carry `roles: ['admin']`, and the two guards
// compose rather than replace each other: the role says who may reach the
// endpoint at all, the policy who may act on the record. Saying it twice is
// the point -- the role is about the person, the rules below are about the
// review, and only one of them survives a reviewer being demoted while a
// page is still open.

/**
 * Is this user on the program committee?
 *
 * @param {?object} user `req.user`, or null
 * @returns {boolean} true for an admin
 */
const committee = (user) =>
  Boolean(user) && Array.isArray(user.roles) && user.roles.includes('admin');

/**
 * Did this user write this review?
 *
 * @param {?object} user `req.user`, or null
 * @param {object} review A Review instance
 * @returns {boolean} true when the review is theirs
 */
const wrote = (user, review) =>
  Boolean(user) && String(review.reviewerId) === String(user.id);

/** @type {import('@usehenri/core').Policy} */
module.exports = {
  create: (user) => committee(user),

  // No route reaches destroy, show or update yet; they are here because a
  // policy that leaves an action out refuses it, and because the day an edit
  // route appears the rule it needs is written and tested already
  destroy: (user, review) => wrote(user, review),

  index: (user) => committee(user),

  // The reviews this committee member wrote
  scope: (user) => ({ reviewerId: user && user.id }),

  show: (user, review) => committee(user) || wrote(user, review),

  update: (user, review) => wrote(user, review),
};
