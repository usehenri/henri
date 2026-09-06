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

  schema: {
    comment: {
      maxLength: 2000,
      minLength: 10,
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
