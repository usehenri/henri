// The demo's record-level authorization surface.
//
// `app/routes.js` gives the memos resource `policy: true`, so henri asks
// this file before every action: the rules that need no record are answered
// at the route, the ones that take a memo when the controller has it.
//
// It deliberately leaves `new` out: a missing rule refuses, and the `new`
// link never reaches a client.

/**
 * Is this memo this user's own?
 *
 * @param {*} user the user, or null
 * @param {object} memo the memo
 * @returns {boolean} yes or no
 */
const owns = (user, memo) =>
  Boolean(user) && String(memo.ownerId) === String(user.id || user._id);

/**
 * Does this user carry the admin role?
 *
 * @param {*} user the user, or null
 * @returns {boolean} yes or no
 */
const admin = (user) =>
  Boolean(user) && [].concat(user.roles || []).includes('admin');

module.exports = {
  // A rule that throws is a refusal, never an allow
  boom: () => {
    throw new Error('the policy is broken');
  },

  create: (user) => Boolean(user),

  destroy: (user, memo) => admin(user) || owns(user, memo),

  index: (user) => Boolean(user),

  // Declared with a record, so it is never asked without one
  peek: (user, memo) => owns(user, memo),

  // Which memos may this user see? henri hands the value to the controller
  // and never looks inside it
  scope: (user) => ({ ownerId: String((user && (user.id || user._id)) || '') }),

  show: (user, memo) => owns(user, memo),

  update: (user, memo) => owns(user, memo),
};
