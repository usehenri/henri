// Records every run in a list the suites read, so a job performed twice
// cannot go unnoticed
module.exports = {
  perform: async (args) => {
    global.__henriJobsRuns = global.__henriJobsRuns || [];
    global.__henriJobsRuns.push(args.token);

    return args.token;
  },
};
