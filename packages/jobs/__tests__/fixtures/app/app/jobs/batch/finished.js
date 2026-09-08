// The callback of a batch. It records the counts it was handed and, at the
// same moment, asks the queue how many jobs of that batch are still waiting
// or running -- which is the negative property: the callback must never run
// before the last job of its batch is terminal, and a count taken by the
// suite afterwards could not tell.
module.exports = {
  maxAttempts: 1,

  perform: async (args, context) => {
    const queue = context.henri && context.henri.jobs;
    const record = {
      at: Date.now(),
      batch: args.batch,
      // The runner that performed it, so two callbacks would be two records
      runner: context.job.runner,
      unfinished: null,
    };

    if (queue) {
      const waiting = await queue.list({
        batch: args.batch.id,
        limit: 500,
        state: 'pending',
      });
      const running = await queue.list({
        batch: args.batch.id,
        limit: 500,
        state: 'running',
      });

      record.unfinished = waiting.length + running.length;
    }

    global.__henriJobsCallbacks = global.__henriJobsCallbacks || [];
    global.__henriJobsCallbacks.push(record);

    return record;
  },
};
