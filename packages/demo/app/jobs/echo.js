// A job for the core test suite: it answers with what it was given, and
// throws when asked to, so the retries and the dead letter queue are covered.
module.exports = {
  maxAttempts: 2,
  queue: 'default',

  perform: async (args, context) => {
    if (args && args.explode) {
      throw new Error(`boom: ${args.explode}`);
    }

    return { attempt: context.job.attempt, echo: args };
  },
};
