// A speaker, and with the `admin` trait a member of the program committee.
//
// `password` goes through the model, so the row holds a hash and no test has
// to know that; `roles` is stripped from mass assignment, which is why the
// factory sets it after the write and reads the row back.
const { PASSWORD } = require('../helpers');

module.exports = {
  after: async (user, { attrs }) => {
    if (!Array.isArray(attrs.roles) || attrs.roles.length === 0) {
      return user;
    }

    await User.setRoles(user.externalId, attrs.roles);

    // The row it just wrote: a primary key, so the key lookup
    return User.findByKey(user.id);
  },

  attributes: {
    email: ({ sequence, uid }) => `speaker-${uid}-${sequence}@example.test`,
    name: 'A Speaker',
    password: PASSWORD,
  },

  traits: {
    // Everything /admin asks for, and nothing else: a trait says what makes
    // this record that kind of record, so it grants the roles and leaves the
    // name alone. `speaker` comes along because a chair submits talks too,
    // which is what the seeds do
    admin: { roles: ['speaker', 'admin'] },
  },
};
