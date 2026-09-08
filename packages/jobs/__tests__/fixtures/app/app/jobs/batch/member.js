// One job of a batch. It stays inside for a moment so the jobs of a batch
// finish at the same time on several runners, and fails on demand: a batch
// finishes, it does not succeed, so a failure has to be part of the suite
module.exports = {
  backoff: { base: 25, factor: 1, jitter: 0, max: 25 },
  maxAttempts: 1,

  perform: async (args) => {
    global.__henriJobsRuns = global.__henriJobsRuns || [];
    global.__henriJobsRuns.push(args.token);

    await new Promise((resolve) => setTimeout(resolve, args.wait || 5));

    if (args.fail) {
      throw new Error(`refused ${args.token}`);
    }

    return args.token;
  },
};
