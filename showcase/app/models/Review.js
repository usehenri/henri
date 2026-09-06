// One committee member's opinion on one proposal.
//
// `score` is a -2..2 scale (strong no, no, neutral, yes, strong yes); the
// average of the reviews is what the admin queue sorts on.
module.exports = {
  /**
   * Reviews belong to a proposal and to their reviewer
   *
   * @param {object} models The models of the store, by global name
   * @returns {void}
   */
  associate(models) {
    models.Review.belongsTo(models.Proposal, {
      as: 'proposal',
      foreignKey: 'proposalId',
    });
    models.Review.belongsTo(models.User, {
      as: 'reviewer',
      foreignKey: 'reviewerId',
    });
    models.Proposal.hasMany(models.Review, {
      as: 'reviews',
      foreignKey: 'proposalId',
    });
    models.User.hasMany(models.Review, {
      as: 'reviews',
      foreignKey: 'reviewerId',
    });
  },

  options: {
    // A review is the committee's record of a decision, so the row and the
    // score stay; the comment is the reviewer's own words about a talk, so
    // it goes with them. `anonymize` is both of those at once.
    personal: { onErase: 'anonymize' },
    // And the same answer on a clock rather than on a request: two years
    // after it was written, the words go and the score stays, so the
    // committee's history still counts and nobody's opinion of a talk is
    // still on file with their name one join away.
    retention: { action: 'anonymize', after: '2y' },
  },

  schema: {
    comment: {
      maxLength: 2000,
      minLength: 10,
      // Erased with the reviewer, not with the speaker: the link henri
      // follows is `reviewerId`, the one that points at a person
      personal: { erase: 'anonymize' },
      required: true,
      type: 'text',
    },
    proposalId: {
      index: true,
      references: { model: 'Proposal', onDelete: 'cascade' },
      required: true,
      type: 'integer',
    },
    reviewerId: {
      index: true,
      references: { model: 'User', onDelete: 'cascade' },
      required: true,
      type: 'integer',
    },
    score: { max: 2, min: -2, required: true, type: 'integer' },
  },
};
