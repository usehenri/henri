// A talk proposal, with the speaker and the edition the schema requires and
// nothing else: `trackId` is nullable because a draft has no track yet, so
// the factory leaves it alone and the states that mean "the committee has
// it" fill it in.
//
// That is what the traits are for. A submitted proposal has a `state` *and*
// a `submittedAt` *and* a track; an accepted one has a `decidedAt` too. None
// of that is knowledge about a test, so none of it belongs in one.
//
// `trackId` reads `attrs.eventId` rather than making a second edition, so
// `create('proposal', 'submitted', { eventId: event.id })` keeps the track
// with its edition. The key order below is alphabetical because `sort-keys`
// says so; the values resolve in the order they are read, not written.
const track = async ({ attrs, create }) =>
  (await create('track', { eventId: await attrs.eventId })).id;

module.exports = {
  attributes: {
    abstract:
      'An abstract that is comfortably longer than the sixty characters the model asks for.',
    eventId: async ({ create }) => (await create('event')).id,
    speakerId: async ({ create }) => (await create('user')).id,
    title: 'A proposal with a long enough title',
  },

  traits: {
    accepted: {
      decidedAt: () => new Date(),
      state: 'accepted',
      submittedAt: () => new Date(),
      trackId: track,
    },
    rejected: {
      decidedAt: () => new Date(),
      state: 'rejected',
      submittedAt: () => new Date(),
      trackId: track,
    },
    submitted: {
      state: 'submitted',
      submittedAt: () => new Date(),
      trackId: track,
    },
  },
};
