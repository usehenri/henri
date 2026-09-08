// Two at a time per tenant, and no bound at all between tenants: the key
// is what partitions it
module.exports = {
  concurrency: { key: 'tenant', limit: 2 },

  perform: async (args) => {
    const live = require('../../../../live');

    return live.inside(`tenanted:${args.tenant}`, args.token, 25);
  },
};
