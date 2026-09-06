// The pages that are not a resource: the home page, the colophon and the
// hypermedia explorer. Models are globals (Event, Proposal, ...) and `henri`
// is the running instance.
const { PUBLIC_STATES, present } = require('../helpers/proposals');

/**
 * The edition the site is about: the most recent one that left `draft`
 *
 * @returns {Promise<?object>} An Event instance, or null on an empty database
 */
const currentEvent = async () => {
  const open = await Event.where({ state: ['open', 'closed', 'announced'] })
    .order('-year')
    .first();

  return open || Event.order('-year').first();
};

module.exports = {
  about: (req, res) => res.render('/about'),

  // The explorer page calls this application's own JSON API from the
  // browser; all it needs from here is a record to point at
  api: async (req, res) => {
    const [proposal, event] = await Promise.all([
      Proposal.where({ state: PUBLIC_STATES }).order('-submittedAt').first(),
      Event.order('-year').first(),
    ]);

    return res.render('/api', {
      data: {
        sample: {
          event: event ? event.id : null,
          proposal: proposal ? proposal.id : null,
        },
      },
    });
  },

  home: async (req, res) => {
    const event = await currentEvent();

    if (!event) {
      return res.render('/', {
        data: { counts: null, event: null, highlight: null, lineup: [] },
      });
    }

    // While the call is open the interesting list is what came in; once the
    // committee has decided, it is the programme
    const highlight = event.state === 'announced' ? 'accepted' : 'submitted';
    const [submitted, accepted, speakers, tracks, lineup] = await Promise.all([
      Proposal.count({ eventId: event.id, state: 'submitted' }),
      Proposal.count({ eventId: event.id, state: 'accepted' }),
      Proposal.pluck('speakerId', { eventId: event.id }),
      Track.count({ eventId: event.id }),
      Proposal.where({ eventId: event.id, state: highlight })
        .include('speaker', 'track')
        .order('-submittedAt')
        .limit(6),
    ]);

    return res.render('/', {
      data: {
        counts: {
          accepted,
          speakers: new Set(speakers.map(String)).size,
          submitted,
          tracks,
        },
        event: event.toJSON(),
        highlight,
        lineup: lineup.map((proposal) => present(proposal)),
      },
    });
  },
};
