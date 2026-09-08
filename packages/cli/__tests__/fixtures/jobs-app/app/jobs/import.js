// One at a time per account, across every runner
module.exports = {
  concurrency: { key: 'account', limit: 1 },

  perform: async (args) => args,
};
