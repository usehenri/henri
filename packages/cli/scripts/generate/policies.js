/**
 * Source of the files written by `henri generate policy`.
 *
 * A policy is a file next to the model it is about, one function per
 * action, and henri refuses everything it does not find there. The stub
 * writes all seven actions of a resource for that reason: an action a
 * policy leaves out is refused, and its link never reaches a client, so a
 * half-written policy is a page with missing buttons rather than a hole.
 *
 * The output goes through prettier.
 */

/**
 * The policy file (app/policies/<name>.js)
 *
 * @param {object} policy `{ doc, name, owner }`
 * @returns {string} the code
 */
const policy = ({ doc, name, owner }) => `
// Who may do what to one ${name}. henri asks this file through
// \`henri.can(user, action, ${name})\`, \`req.can()\` and \`req.authorize()\`,
// and \`policy: true\` on the ${name} routes of config/routes.js makes it
// the guard of every action.
//
// Two rules worth knowing, both of them about failing closed:
//
//  - only the boolean \`true\` allows. Anything else -- a truthy string, a
//    record, undefined, an exception -- is a no.
//  - a rule that declares a record is never asked without one. \`index\`,
//    \`new\` and \`create\` are answered at the route, before the action runs;
//    \`show\`, \`edit\`, \`update\` and \`destroy\` when the controller has the
//    record, through \`req.authorize('update', ${name})\` or \`res.resource()\`.
//
// An action missing from this file is refused. Delete the ones the resource
// does not have; do not leave them out and hope.

/**
 * Is this ${name} this user's own?
 *
 * @param {*} user the signed-in user, or null
 * @param {object} ${name} the record
 * @returns {boolean} yes or no
 */
const owns = (user, ${name}) =>
  Boolean(user) && String(${name}.${owner}) === String(user.id);

/** @type {import('@usehenri/core').Policy} */
module.exports = {
  // Everybody signed in may list them; the scope below says which ones
  index: (user) => Boolean(user),

  // The form, and the write behind it
  new: (user) => Boolean(user),
  create: (user) => Boolean(user),

  show: (user, ${name}) => owns(user, ${name}),

  edit: (user, ${name}) => owns(user, ${name}),
  update: (user, ${name}) => owns(user, ${name}),

  destroy: (user, ${name}) => owns(user, ${name}),

  // Which ${name}s may this user see? The other half of the question: "may
  // they read this one" is not "which ones are theirs". henri hands this
  // value straight to the controller and never looks inside it, so it is a
  // \`where\` for your ORM:
  //
  //   const ${name}s = await ${doc}.find(await req.scope('${name}'));
  scope: (user) => ({ ${owner}: user && user.id }),
};
`;

/**
 * The test of a policy (test/<name>-policy.test.js)
 *
 * The three refusals are the whole point of the file: a stranger, an
 * anonymous visitor and an action nobody wrote a rule for.
 *
 * @param {object} policy `{ name, owner }`
 * @returns {string} the code
 */
const test = ({ name, owner }) => `
// Runs with \`henri test\`: setup() boots henri under NODE_ENV=test, and
// henri.can() is the same question the router and the views ask.
//
// The records here are plain objects, so the policy is named explicitly --
// henri reads the model off an instance, and there is none to read here.
const { henri, setup } = require('@usehenri/testing');

const POLICY = '${name}';
const owner = { id: 1, roles: [] };
const stranger = { id: 2, roles: [] };
const ${name} = { ${owner}: 1 };

describe('the ${name} policy', () => {
  beforeAll(() => setup());

  test('the owner may update their own ${name}', async () => {
    expect(await henri.can(owner, 'update', ${name}, POLICY)).toBe(true);
  });

  test('somebody else may not, and gets nothing back', async () => {
    expect(await henri.can(stranger, 'update', ${name}, POLICY)).toBe(false);
    expect(await henri.can(stranger, 'destroy', ${name}, POLICY)).toBe(false);
  });

  test('an anonymous visitor may not', async () => {
    expect(await henri.can(null, 'show', ${name}, POLICY)).toBe(false);
    expect(await henri.can(null, 'index', null, POLICY)).toBe(false);
  });

  test('an action this policy does not declare is refused', async () => {
    expect(await henri.can(owner, 'publish', ${name}, POLICY)).toBe(false);
  });

  test('a rule that needs a ${name} is never answered without one', async () => {
    expect(await henri.can(owner, 'update', null, POLICY)).toBe(false);
  });

  test('the scope says which ${name}s a list may hold', async () => {
    expect(await henri.policies.scope(owner, POLICY)).toEqual({ ${owner}: 1 });
  });
});
`;

module.exports = { policy, test };
