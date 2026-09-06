// A memo belongs to whoever wrote it, and to nobody else: `ownerId` is not a
// reference henri can infer, so the model names it. `onErase: 'delete'` is
// the right answer here and it is not the default one -- a memo is private
// to its author, so erasing the author erases the memos, where a proposal or
// an invoice would have survived them.
module.exports = {
  options: {
    personal: { onErase: 'delete', subject: 'ownerId' },
    timestamps: true,
  },
  schema: {
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
