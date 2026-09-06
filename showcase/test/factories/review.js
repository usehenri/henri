// A committee member's opinion on one proposal. Both associations are made
// unless the test names them, and the reviewer is an admin because that is
// who writes reviews.
module.exports = {
  attributes: {
    comment: 'A careful and quite specific opinion about this talk.',
    proposalId: async ({ create }) =>
      (await create('proposal', 'submitted')).id,
    reviewerId: async ({ create }) => (await create('user', 'admin')).id,
    score: 2,
  },
};
