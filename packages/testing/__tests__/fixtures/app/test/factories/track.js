module.exports = {
  attributes: {
    eventId: async ({ create }) => (await create('event')).id,
    name: ({ sequence }) => `Track ${sequence}`,
  },
};
