// GET /admin, the landing page of the program committee.
//
// `namespace admin` in config/routes.js prefixes the path with /admin and the
// controller with admin/, which is this directory. The role guard runs before
// anything here: nobody without the `admin` role reaches this file.
const { averageScore } = require('../../helpers/proposals');

/** The states a proposal moves through, in the order the dashboard shows */
const STATES = ['draft', 'submitted', 'accepted', 'rejected'];

module.exports = {
  index: async () => {
    const [events, counts, withdrawn, reviews, speakers] = await Promise.all([
      Event.order('-year'),
      Promise.all(STATES.map((state) => Proposal.count({ state }))),
      Proposal.onlyDeleted().count(),
      Review.include('reviewer', 'proposal').order('-createdAt').limit(5),
      User.count(),
    ]);
    const undecided = await Proposal.where({ state: 'submitted' })
      .include('speaker', 'track')
      .order('id')
      .limit(200);
    const scores = await Promise.all(
      undecided.map((proposal) =>
        Review.where({ proposalId: proposal.id }).pluck('score')
      )
    );
    const queue = undecided
      .map((proposal, index) => ({
        id: proposal.id,
        reviews: scores[index].length,
        score: averageScore(scores[index]),
        speaker: proposal.speaker ? proposal.speaker.name : null,
        title: proposal.title,
        track: proposal.track ? proposal.track.name : null,
      }))
      .sort((left, right) => (right.score ?? -9) - (left.score ?? -9))
      .slice(0, 8);

    return {
      counts: Object.fromEntries(
        STATES.map((state, index) => [state, counts[index]])
      ),
      events: events.map((event) => ({
        id: event.id,
        name: event.name,
        state: event.state,
        year: event.year,
      })),
      queue,
      reviews: reviews.map((review) => ({
        comment: review.comment,
        id: review.id,
        proposal: review.proposal
          ? { id: review.proposal.id, title: review.proposal.title }
          : null,
        reviewer: review.reviewer ? review.reviewer.name : null,
        score: review.score,
      })),
      speakers,
      unreviewed: queue.filter((entry) => entry.reviews === 0).length,
      withdrawn,
    };
  },
};
