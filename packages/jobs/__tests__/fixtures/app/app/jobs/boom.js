// Always fails, with a message that says which attempt it was
module.exports = {
  // A backoff long enough that a drain never picks the job up again in
  // the same run: the suite moves run_at by hand instead of waiting
  backoff: { base: 60000, factor: 2, jitter: 0, max: 300000 },
  maxAttempts: 3,

  perform: async (args, context) => {
    throw new Error(`boom on attempt ${context.job.attempt}`);
  },
};
