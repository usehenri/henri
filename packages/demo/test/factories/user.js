// A user of the demo application. `password` goes through the model, so the
// row holds a bcrypt hash and nothing here has to know that; `roles` is
// stripped from mass assignment, so the factory sets it after the write --
// which is the whole reason `after` exists.
module.exports = {
  after: async (user, { attrs }) => {
    if (!Array.isArray(attrs.roles) || attrs.roles.length === 0) {
      return user;
    }

    await user.setRoles(attrs.roles);

    return User.findByKey(user.id);
  },

  attributes: {
    age: 42,
    email: ({ sequence, uid }) => `member-${uid}-${sequence}@usehenri.io`,
    name: ({ sequence }) => `Member ${sequence}`,
    password: 'difference-engine',
  },

  traits: {
    admin: { roles: ['admin'] },
  },
};
