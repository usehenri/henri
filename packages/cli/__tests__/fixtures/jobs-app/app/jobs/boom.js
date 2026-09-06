// Always fails: one attempt, so it lands in the dead letter queue at once
module.exports = {
  maxAttempts: 1,

  perform: async () => {
    throw new Error('boom from the fixture');
  },
};
