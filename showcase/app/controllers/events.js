// The public program: the editions of the conference.
//
// Both actions use henri's implicit rendering: an action that returns an
// object without answering renders its own page with it, so `index` renders
// `/events` and `show` renders `/events/show`. A client asking for JSON gets
// the same object with the `_links` of the route.
const { present } = require('../helpers/proposals');

/**
 * Loads the edition of `:id` (a number or a slug), or answers a 404
 *
 * @param {object} req Express request
 * @param {object} res Express response
 * @returns {Promise<object|undefined>} The 404 answer, or nothing
 */
const loadEvent = async (req, res) => {
  const { id } = req.params;

  req.event =
    (await Event.findById(id)) || (await Event.findOne({ slug: String(id) }));

  if (!req.event) {
    return res.boom.notFound(`No edition ${id}`);
  }
};

module.exports = {
  before: { show: loadEvent },

  index: async () => {
    const events = await Event.order('-year');
    const counts = await Promise.all(
      events.map((event) => Proposal.count({ eventId: event.id }))
    );

    return {
      events: events.map((event, index) => ({
        ...event.toJSON(),
        proposals: counts[index],
      })),
    };
  },

  show: async (req) => {
    const { event } = req;
    const [tracks, accepted] = await Promise.all([
      Track.where({ eventId: event.id }).order('name'),
      Proposal.where({ eventId: event.id, state: 'accepted' })
        .include('speaker', 'track')
        .order('title'),
    ]);

    return {
      event: event.toJSON(),
      lineup: accepted.map((proposal) => present(proposal)),
      tracks: tracks.map((track) => track.toJSON()),
    };
  },
};
