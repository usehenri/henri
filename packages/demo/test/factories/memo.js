// A memo belongs to whoever wrote it: `ownerId` is a reference, so the
// factory makes the author unless the test names one.
module.exports = {
  attributes: {
    body: ({ sequence }) => `The body of memo ${sequence}`,
    ownerId: async ({ create }) => (await create('user')).id,
    title: ({ sequence }) => `Memo ${sequence}`,
  },

  traits: {
    archived: { archivedAt: () => new Date('2020-01-01T00:00:00Z') },
  },
};
