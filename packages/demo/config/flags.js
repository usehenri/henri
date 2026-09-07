/**
 * The feature flags of the demo application.
 *
 * One of each shape, so the suite exercises the whole surface: the short
 * form, a declared default of `true`, a flag a page is allowed to see, and
 * one whose answer is a group rather than a switch.
 */
module.exports = {
  // The short form: the name, and what it answers until somebody flips it
  checkout: false,

  // A flag protecting the way back, so its default is on
  'legacy-editor': true,

  // Reaches a rendered page as `flags.newBanner`
  newBanner: {
    default: false,
    description: 'The banner nobody has approved yet',
    expose: true,
  },

  // The group gate: asked last, and only a `true` opens it
  staffTools: {
    default: false,
    description: 'The tools only the staff sees',
    group: (user) => Boolean(user) && (user.roles || []).includes('admin'),
  },
};
