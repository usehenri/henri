// A memo belongs to whoever wrote it, and to nobody else: `ownerId` is not a
// reference henri can infer, so the model names it. `onErase: 'delete'` is
// the right answer here and it is not the default one -- a memo is private
// to its author, so erasing the author erases the memos, where a proposal or
// an invoice would have survived them.
module.exports = {
  // GraphQL is derived: the type, the queries, the mutations and the
  // resolvers come from the schema below (base/graphql-schema.js). `body` is
  // personal
  // and exposed, so it is a field and never an argument; `ownerId` is a
  // declared reference, so it travels as the owner's externalId in both
  // directions; and everything a client may see is what app/policies/memo.js
  // says it is
  graphql: { generate: true, mutations: true },
  options: {
    personal: { onErase: 'delete', subject: 'ownerId' },
    // A memo is kept for thirty days after it was archived, and an archived
    // memo is the only kind that ages: `from` is what says so. Measuring
    // from `createdAt` would take a memo somebody still uses (see
    // base/retention.js)
    retention: { after: '30d', from: 'archivedAt' },
    timestamps: true,
    // A memo keeps its history: who changed the title, what the body used
    // to say, and enough to bring one back after it was deleted. It is
    // off for every other model of this application, which is the point
    versioned: true,
  },
  schema: {
    // When the author put it away. Null while they have not: a memo whose
    // clock never started is never swept
    archivedAt: { type: 'date' },
    body: { personal: true, type: 'text' },
    // Who wrote it: everything app/policies/memo.js decides comes from here.
    // `ref` is what makes it a foreign key henri can see: without it this is
    // a string column holding a document id, and a memo leaves the server
    // carrying the internal id of its owner (see base/references.js). With
    // it, the column still holds the document id and what leaves is the
    // owner's externalId.
    ownerId: { index: true, ref: 'User', type: 'string' },
    // Not marked: a mark is on the name, everywhere, and `title` is a column
    // half the models of an application have
    title: { type: 'string' },
  },
};
