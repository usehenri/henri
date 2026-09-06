// Writes what it was given where the suite can read it back, so a run
// through the command line can be observed from the outside
const fs = require('fs');

module.exports = {
  queue: 'default',

  perform: async (args) => {
    if (process.env.HENRI_JOBS_REPORT) {
      fs.appendFileSync(
        process.env.HENRI_JOBS_REPORT,
        `${JSON.stringify(args)}\n`
      );
    }

    return args;
  },
};
