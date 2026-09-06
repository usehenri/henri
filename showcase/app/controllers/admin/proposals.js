// The review queue of the program committee, and the trash.
//
// Everything here is behind `roles: ['admin']` in config/routes.js. The path
// helpers a page receives are filtered by the same roles, so a speaker's page
// never even holds a link to these routes.
const { INCLUDE, averageScore, present } = require('../../helpers/proposals');

/** What a decision may set: nothing else, whatever the form posts */
const DECISIONS = ['accepted', 'rejected'];

/**
 * Loads the proposal of `:id`, soft deleted ones included, or answers a 404
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadProposal = async (req, res) => {
  req.proposal = await Proposal.withDeleted()
    .where({ id: req.params.id })
    .include(...INCLUDE)
    .first();

  if (!req.proposal) {
    return res.boom.notFound(`No proposal ${req.params.id}`);
  }

  return undefined;
};

/**
 * The reviews of a list of proposals, keyed by proposal id
 *
 * @param {Array<object>} proposals Proposal instances
 * @returns {Promise<object>} `{ [id]: { average, count } }`
 */
const scoresOf = async (proposals) => {
  const entries = await Promise.all(
    proposals.map(async (proposal) => {
      const scores = await Review.where({ proposalId: proposal.id }).pluck(
        'score'
      );

      return [
        proposal.id,
        { average: averageScore(scores), count: scores.length },
      ];
    })
  );

  return Object.fromEntries(entries);
};

module.exports = {
  before: [{ only: ['decide', 'restore', 'show'], run: loadProposal }],

  decide: async (req, res) => {
    const { state } = req.permit('state');

    if (!DECISIONS.includes(state)) {
      return res.boom.badData('a decision is accepted or rejected', {
        errors: { state: `must be one of ${DECISIONS.join(', ')}` },
      });
    }

    if (req.proposal.state === 'draft') {
      req.flash('alert', 'That proposal has not been submitted yet.');

      return res.redirect(`/admin/proposals/${req.proposal.id}`);
    }

    await req.proposal.update({ decidedAt: new Date(), state });
    req.flash('notice', `"${req.proposal.title}" was ${state}.`);

    return res.redirect('/admin/proposals');
  },

  index: async (req, res) => {
    const where = {};

    if (
      ['accepted', 'draft', 'rejected', 'submitted'].includes(req.query.state)
    ) {
      where.state = req.query.state;
    } else {
      where.state = 'submitted';
    }

    const { records, page, perPage, total, pages } = await Proposal.paginate({
      ...req.pagination(),
      include: INCLUDE,
      order: ['-submittedAt', '-id'],
      where,
    });
    const scores = await scoresOf(records);

    return res.render('/admin/proposals/index', {
      data: {
        page,
        pages,
        perPage,
        proposals: records.map((proposal) => ({
          ...present(proposal),
          reviews: scores[proposal.id].count,
          score: scores[proposal.id].average,
        })),
        state: where.state,
        total,
      },
    });
  },

  restore: async (req, res) => {
    if (!req.proposal.deletedAt) {
      req.flash('alert', 'That proposal was never withdrawn.');

      return res.redirect('/admin/proposals/withdrawn');
    }

    await req.proposal.restore();
    req.flash('notice', `"${req.proposal.title}" is back in the queue.`);

    return res.redirect('/admin/proposals/withdrawn');
  },

  show: async (req, res) => {
    const reviews = await Review.where({ proposalId: req.proposal.id })
      .include('reviewer')
      .order('-createdAt');

    return res.render('/admin/proposals/show', {
      data: {
        mine: reviews.some(
          (review) => String(review.reviewerId) === String(req.user.id)
        ),
        proposal: present(req.proposal, { reviews }),
      },
    });
  },

  // The soft deleted rows: `Proposal.onlyDeleted()` is what
  // `options: { paranoid: true }` buys, and restore() puts one back
  withdrawn: async (req, res) => {
    const proposals = await Proposal.onlyDeleted()
      .include(...INCLUDE)
      .order('-deletedAt');

    return res.render('/admin/proposals/withdrawn', {
      data: { proposals: proposals.map((proposal) => present(proposal)) },
    });
  },
};
