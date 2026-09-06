// The user model: `config.user.model` names it, so the adapter adds `email`,
// `password`, `roles`, `confirmedAt` and `passwordChangedAt` to the schema
// below.
//
// The fields it does declare are about a person, and they say so:
// `personal` is what puts them in an export, erases them on an erasure and
// masks them in the logs. `gender` says more than `true`: it never leaves
// the server, whatever a controller hands to res.render() or res.resource().
//
// Two of them are also `encrypted`, so the database holds ciphertext and the
// model hands back the string:
//
// - `phone` is randomised: different bytes every time, nothing to see in a
//   dump, and nothing henri will let you query it by.
// - `nationalId` is deterministic, because the application looks a person up
//   by it. That is what makes `User.findOne({ nationalId })` work, and it is
//   also what a dump gives away: two rows holding the same value hold the
//   same ciphertext.
//
// Neither says `personal`: `encrypted` implies it (see base/privacy.js).
module.exports = {
  options: {
    timestamps: true,
    // Versioned too, and it is the interesting one: `password` is never
    // stored in a version (it is named as changed and its values are not
    // kept), `phone` and `nationalId` are stored as their envelopes, and
    // `gender` -- personal, and never serialized to a client -- is stored
    // as it is, because a history that dropped it would answer nothing
    versioned: true,
  },
  schema: {
    age: { personal: true, type: 'integer' },
    gender: { personal: { expose: false }, type: 'string' },
    name: { personal: true, type: 'string' },
    nationalId: {
      encrypted: { deterministic: true },
      personal: { expose: false },
      type: 'string',
    },
    phone: { encrypted: true, personal: { expose: false }, type: 'string' },
  },
};
