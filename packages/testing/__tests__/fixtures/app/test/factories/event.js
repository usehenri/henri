// A factory of the fixture application: read from disk by the registry, the
// way an application's own factories are.
module.exports = {
  attributes: {
    name: ({ sequence }) => `Event ${sequence}`,
    slug: ({ sequence, uid }) => `event-${uid}-${sequence}`,
    state: 'draft',
  },
  traits: {
    open: { state: 'open' },
  },
};
