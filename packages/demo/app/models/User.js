// The user model: `config.user.model` names it, so the adapter adds `email`,
// `password`, `roles`, `confirmedAt` and `passwordChangedAt` to the schema
// below.
//
// The three fields it does declare are about a person, and they say so:
// `personal` is what puts them in an export, erases them on an erasure and
// masks them in the logs. `gender` says more than `true`: it never leaves
// the server, whatever a controller hands to res.render() or res.resource().
module.exports = {
  options: {
    timestamps: true,
  },
  schema: {
    age: { personal: true, type: 'integer' },
    gender: { personal: { expose: false }, type: 'string' },
    name: { personal: true, type: 'string' },
  },
};
