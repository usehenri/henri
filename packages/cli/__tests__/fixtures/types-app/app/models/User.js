// The user model: the adapter adds `email`, `password`, `roles` and the two
// dates the account flows write, so the declarations do too.
/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { timestamps: true },
  schema: {
    name: { personal: true, type: 'string' },
    phone: { encrypted: true, type: 'string' },
  },
};
