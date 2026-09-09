// A tenanted model carrying the marks a skill has to mention: rows that
// belong to one account, an exact type, an enum and a personal column.
/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { paranoid: true, tenant: true, versioned: true },
  schema: {
    number: { required: true, type: 'string' },
    ownerId: { ref: 'User', type: 'string' },
    status: {
      default: 'draft',
      enum: ['draft', 'sent', 'paid'],
      type: 'string',
    },
    total: { precision: 12, scale: 2, type: 'decimal' },
  },
};
