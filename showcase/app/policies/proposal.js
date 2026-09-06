// Who may do what to one proposal.
//
// This file used to be three helpers and two `before` hooks spread over
// app/helpers/proposals.js and app/controllers/proposals.js: `owns`,
// `mayRead` and `mustOwnIt`. They are here now, in one place, and the
// controller asks through `req.can()` -- the same question the router asks
// at the route (`policy: true` in config/routes.js) and the same one the
// `_links` of every JSON answer and the `paths` of every page are filtered
// by, so a page cannot offer a button the request behind it would refuse.
//
// The rules that take a proposal are only asked when there is one: at the
// route henri answers `index`, `new`, `create` and `mine`, and leaves the
// rest to the moment the controller has loaded the record.
const { PUBLIC_STATES } = require('../helpers/proposals');

/**
 * Is this user the speaker of this proposal?
 *
 * @param {?object} user `req.user`, or null for an anonymous visitor
 * @param {object} proposal A Proposal instance
 * @returns {boolean} true when the proposal is the user's own
 */
const owns = (user, proposal) =>
  Boolean(user) && String(proposal.speakerId) === String(user.id);

/**
 * Is this user on the program committee?
 *
 * @param {?object} user `req.user`, or null
 * @returns {boolean} true for an admin
 */
const committee = (user) =>
  Boolean(user) && Array.isArray(user.roles) && user.roles.includes('admin');

/** @type {import('@usehenri/core').Policy} */
module.exports = {
  // Writing one needs an account, and nothing more
  create: (user) => Boolean(user),

  edit: (user, proposal) => owns(user, proposal),

  // The programme is public: anyone may read the list, and the controller
  // narrows it to the states a visitor is allowed to see
  index: () => true,

  mine: (user) => Boolean(user),

  new: (user) => Boolean(user),

  // Which proposals are this speaker's own? `mine` reads it rather than
  // writing the same `where` again next to a rule that says the same thing
  scope: (user) => ({ speakerId: user && user.id }),

  // Everyone reads what was submitted or accepted; a draft and a rejection
  // belong to their speaker and to the committee. A refusal here is a 404,
  // because knowing a proposal exists is already something
  show: (user, proposal) =>
    PUBLIC_STATES.includes(proposal.state) ||
    committee(user) ||
    owns(user, proposal),

  // The two transitions a speaker may trigger. Whether the proposal is in
  // the right state for them is not an authorization question and stays in
  // the controller: "you may not" and "not from here" are different answers
  // and deserve different statuses
  submit: (user, proposal) => owns(user, proposal),

  update: (user, proposal) => owns(user, proposal),

  withdraw: (user, proposal) => owns(user, proposal),
};
