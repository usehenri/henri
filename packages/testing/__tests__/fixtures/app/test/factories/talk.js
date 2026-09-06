// Named after neither its model nor its associations: `model` says which
// table it writes to, and the two ids below share one event without the file
// caring which key `sort-keys` puts first.
module.exports = {
  after: (record) => ({ ...record, seen: true }),

  attributes: {
    eventId: async ({ create }) => (await create('event', 'open')).id,
    title: ({ sequence }) => `Talk ${sequence}`,
    trackId: async ({ attrs, create }) =>
      (await create('track', { eventId: await attrs.eventId })).id,
  },

  model: 'Proposal',

  traits: {
    accepted: { decidedAt: () => new Date(0), state: 'accepted' },
    lightning: { format: 'lightning' },
  },
};
