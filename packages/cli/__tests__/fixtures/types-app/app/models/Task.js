// Everything the generated declarations have to get right, in one model:
// the two exact types, an enum, a slug, soft deletes, a declared foreign
// key and a column that never leaves the server.
/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { paranoid: true, slug: 'title', timestamps: true },
  schema: {
    body: { type: 'text' },
    dueOn: { type: 'date' },
    // What a JavaScript number cannot carry: both cross as strings
    estimate: { precision: 12, scale: 2, type: 'decimal' },
    // A declared foreign key: the column holds the owner's key, and what
    // leaves the server is their externalId
    ownerId: { ref: 'User', type: 'string' },
    payload: { type: 'json' },
    points: { type: 'integer' },
    reference: { type: 'bigint', unique: true },
    // Never in an answer henri builds, and on the record all the same
    secret: { personal: { expose: false }, type: 'string' },
    status: {
      default: 'draft',
      enum: ['draft', 'in_review', 'live'],
      type: 'string',
    },
    title: { required: true, type: 'string' },
    urgent: { default: false, type: 'boolean' },
  },
};
