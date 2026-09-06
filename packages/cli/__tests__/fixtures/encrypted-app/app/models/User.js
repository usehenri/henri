// The person, with two fields the database never holds in the clear.
//
// The key is not here, and it is not in config/default.json either: the
// suite passes it in HENRI_ENCRYPTION_KEYS, which is the shape a
// deployment uses. `henri audit` reports a key found in a committed file.
module.exports = {
  schema: {
    name: { personal: true, type: 'string' },
    // Deterministic: the application looks a person up by it, which is
    // what makes an equality possible and what gives away that two rows
    // hold the same value
    nationalId: { encrypted: { deterministic: true }, type: 'string' },
    // Randomised: nothing ever queries it
    phone: { encrypted: true, personal: { expose: false }, type: 'string' },
  },
};
