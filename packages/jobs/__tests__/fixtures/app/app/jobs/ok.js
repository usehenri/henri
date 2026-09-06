// Answers with what it was given
module.exports = {
  perform: async (args, context) => ({ args, attempt: context.job.attempt }),
};
