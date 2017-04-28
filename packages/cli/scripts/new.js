const fs = require('fs-extra');
const path = require('path');
const { version, commands, check, cwd } = require('./utils');

const main = args => {
  // Do we have the force flag on?
  const force = args.force === true || args.f === true;

  // Is is a request for help?
  if (args.h === true || args.help === true || !args._[0]) {
    return help(args);
  }

  // We won't create a new structure in an existing
  // directory if the force flag is off
  if (check(args._[0]) && !force) {
    console.log(
      `
      The folder specified is exists. Use -f or --force if you really want
      to create a structure there.
    `
    );
    process.exit(-1);
  }

  // Get the new full path
  const newPath = path.resolve(cwd, args._[0]);

  // Create the directory
  fs.mkdirpSync(newPath);

  // Change active directory to the new path
  process.chdir(newPath);

  // Initiate the application scaffolding
  const init = require('./init');
  init(args, args._[0]);
};

// Output help. Does nothing right now
const help = args => {
  console.log(
    `
    henri (${version})

    Usage
      $ henri new <folder> [-f | --force]

    Available commands
      ${Array.from(commands).join(', ')}

    For more information run a command with the --help flag
      $ henri ${commands[0]} --help
  `
  );
  process.exit(0);
};

module.exports = main;
