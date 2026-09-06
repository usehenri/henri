module.exports = {
  options: { timestamps: true },
  schema: {
    body: { type: 'text' },
    // Who wrote it: everything app/policies/memo.js decides comes from here
    ownerId: { index: true, type: 'string' },
    title: { type: 'string' },
  },
};
