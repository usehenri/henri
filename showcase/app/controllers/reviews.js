// The reviews of one proposal, nested under it:
//
//   GET  /proposals/:proposal_id/reviews  ->  reviews#index
//   POST /proposals/:proposal_id/reviews  ->  reviews#create
//
// Both routes carry `roles: ['admin']`, so henri's role guard answers before
// this file runs: a 401 or a 403 to an API client, a redirect to the login
// page to a browser. There is no reviews page: the committee writes them from
// the admin proposal page, and `index` exists for API clients.
const { speakerOf } = require('../helpers/proposals');

/** Attributes a review form may set */
const FIELDS = ['comment', 'score'];

/**
 * A review as it leaves the server
 *
 * @param {object} review A Review instance, with its reviewer loaded
 * @returns {object} A plain object
 */
const present = (review) => ({
  comment: review.comment,
  createdAt: review.createdAt,
  id: review.id,
  proposalId: review.proposalId,
  reviewer: speakerOf(review.reviewer),
  score: review.score,
});

module.exports = {
  before: {
    all: async (req, res) => {
      req.proposal = await Proposal.findById(req.params.proposal_id);

      if (!req.proposal) {
        return res.boom.notFound(`No proposal ${req.params.proposal_id}`);
      }
    },
  },

  create: async (req, res) => {
    const existing = await Review.findOne({
      proposalId: req.proposal.id,
      reviewerId: req.user.id,
    });

    if (existing) {
      req.flash('alert', 'You have already reviewed that proposal.');

      return res.negotiate({
        html: () => res.redirect(`/admin/proposals/${req.proposal.id}`),
        json: () => res.boom.conflict('You already reviewed this proposal'),
      });
    }

    let review;

    try {
      review = await Review.create({
        ...req.permit(...FIELDS),
        proposalId: req.proposal.id,
        reviewerId: req.user.id,
      });
    } catch (error) {
      const errors = henri.model.errors(error);

      if (!errors) {
        throw error;
      }

      req.flash('alert', 'That review could not be saved.');

      return res.negotiate({
        html: () => res.redirect(`/admin/proposals/${req.proposal.id}`),
        json: () => res.boom.badData(error.message, { errors }),
      });
    }

    req.flash('notice', 'Review recorded.');

    return res.negotiate({
      html: () => res.redirect(`/admin/proposals/${req.proposal.id}`),
      json: () =>
        res.resource(
          // The reviewer is whoever is signed in: no need to load it back
          { ...present(review), reviewer: speakerOf(req.user) },
          {
            links: { proposal: `/proposals/${req.proposal.id}` },
            status: 201,
          }
        ),
    });
  },

  index: async (req, res) => {
    const reviews = await Review.where({ proposalId: req.proposal.id })
      .include('reviewer')
      .order('-createdAt');
    const records = reviews.map(present);

    return res.negotiate({
      html: () => res.redirect(`/admin/proposals/${req.proposal.id}`),
      // No page, no perPage: an unpaginated collection answers `self`,
      // `count` and `total` without the paging links
      json: () =>
        res.collection(records, {
          links: { proposal: `/proposals/${req.proposal.id}` },
        }),
    });
  },
};
