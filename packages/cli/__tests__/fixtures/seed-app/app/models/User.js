// The person: `config.user.model` defaults to `user`, so the adapter adds
// `email`, `password` and `roles` to this schema. `personal` is what
// `henri privacy` reads back.
module.exports = {
  schema: {
    name: { personal: true, type: 'string' },
    // Never in an answer henri builds, exported, and gone with the person
    phone: { personal: { expose: false }, type: 'string' },
  },
};
