// One at a time, across every runner. It records how many of it were
// running when it started and when it ended, so the suite can assert the
// bound was never exceeded rather than that it happened to hold
module.exports = {
  concurrency: 1,

  perform: async (args) => {
    const live = require('../../../../live');

    return live.inside('exclusive', args.token, 25);
  },
};
