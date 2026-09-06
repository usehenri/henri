// A track belongs to an edition, so the factory makes one unless the test
// names it: `create('track', { eventId: event.id })`.
module.exports = {
  attributes: {
    eventId: async ({ create }) => (await create('event')).id,
    name: 'Backend',
    slug: 'backend',
  },
};
