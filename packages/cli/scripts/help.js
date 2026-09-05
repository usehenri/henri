/* eslint-disable no-console */
const { commands, helpHeader } = require('./utils');

const FLAGS = `
    Global flags
      --production    same as NODE_ENV=production
      --debug[=*]     same as DEBUG. ex: --debug=henri:*
      --inspect       start with debugging / profiling
      --wait          force wait / use with --inspect
      --force-build   force a production rebuild (views)
      --skip-workers  do not start workers
      --host=<ip>     bind the server to this address (same as HENRI_HOST)
      --version, -v   print the henri version
      --help, -h      print the help of a command`;

/**
 * Help text of every command, printed by `henri <command> --help`
 */
const USAGE = {
  about: `
    Usage
      $ henri about

    Prints the versions of node, the package managers, henri and the
    @usehenri packages installed in the current project.`,

  build: `
    Usage
      $ henri build

    Builds the production views (next.js) without starting the server or
    the databases. Nothing to do when the renderer is 'template'.`,

  clean: `
    Usage
      $ henri clean

    Interactively removes build artifacts and caches (.next, .tmp, .henri,
    logs, node_modules).`,

  console: `
    Usage
      $ henri console [--production]

    Boots the application and opens a REPL with henri and the models loaded.`,

  destroy: `
    Usage
      $ henri destroy <what> <target>
      $ henri d <what> <target>

    Available commands
      model <Name>           delete app/models/<Name>.js
      controller <name>      delete app/controllers/<name>.js and its routes
      route <key>            remove one key from config/routes.js
                             ex: henri destroy route "get /about"
      view <folder>          delete app/views/pages/<folder>
      worker <name>          delete app/workers/<name>.js
      test <name>            delete test/<name>.test.js
      crud <Name>            undo "generate crud"
      scaffold <Name>        undo "generate scaffold"

    Files are backed up in .backup/ unless the project is a git repository.

    Examples

      $ henri destroy model User
        --> Deletes the User model

      $ henri destroy controller locations
        --> Deletes a controller and routes

      $ henri d scaffold HighScore
        --> Deletes a model, a controller with resources actions,
            the matching resources routes and the views`,

  generate: `
    Usage
      $ henri generate <what> <target> [options] [--force]
      $ henri g <what> <target> [options] [--force]

    Available commands
      model <Name> [field:type[!] ...]
      controller <name> [action ...]
      worker <name>
      test <name>
      crud <Name> [field:type[!] ...]
      scaffold <Name> [field:type[!] ...]

    Field types
      string, text, number, integer, float, boolean, date, json, uuid
      (default: string). A trailing ! makes the field required.

    Existing files are skipped; --force overwrites them.

    Examples

      $ henri generate model User name:string! birthday:date
        --> Creates a model with these attributes

      $ henri generate controller locations index show gps
        --> Creates a controller and routes to those actions

      $ henri g scaffold HighScore game:string score:integer
        --> Creates a model, a controller with the resources actions,
            the matching resources routes and the views

      $ henri g worker cleanup
        --> Creates app/workers/cleanup.js with start and stop

      $ henri g test highscores
        --> Creates test/highscores.test.js using @usehenri/testing`,

  init: `
    Usage
      $ henri init [--force | -f] [--skip-install] [--no-git]

    Adds the henri structure to the current directory. The project name is
    the name of the directory.

      -f, --force       write into a directory that already has an app/ folder
      --skip-install    do not install the dependencies
      --no-git          do not run "git init"`,

  new: `
    Usage
      $ henri new <folder> [--force | -f] [--skip-install] [--no-git]

    Creates a new henri application in <folder>.

      -f, --force       write into an existing folder
      --skip-install    do not install the dependencies
      --no-git          do not run "git init"`,

  routes: `
    Usage
      $ henri routes [--json]

    Prints the routes expanded from config/routes.js (verb, path,
    controller and path helper) without starting the server.`,

  server: `
    Usage
      $ henri server [--production] [--skip-workers] [--force-build] [--host=<ip>]
      $ henri s

    Starts the application (development mode with hot reload by default).
    The server binds to 127.0.0.1 in development and 0.0.0.0 in production
    unless --host, HENRI_HOST or config.host says otherwise.`,

  test: `
    Usage
      $ henri test [files ...]

    Runs the project's tests (test/**/*.test.js) with henri booted under
    NODE_ENV=test.`,
};

/* eslint-disable id-length */
USAGE.d = USAGE.destroy;
USAGE.g = USAGE.generate;
USAGE.s = USAGE.server;
/* eslint-enable id-length */

/**
 * The help text of a command, or the general help
 *
 * @param {string} [command] A command name
 * @returns {string} The text
 */
const usage = (command) => {
  if (command && USAGE[command]) {
    return `${helpHeader()}${USAGE[command]}\n${FLAGS}\n`;
  }

  return `
    ${helpHeader()}
    Usage
      $ henri <command> [options]

    Available commands
      ${commands.join(', ')}
${FLAGS}

    For more information run a command with the --help flag
      $ henri generate --help
  `;
};

/**
 * Show help
 *
 * @param {string} [command] Show the help of this command only
 * @returns {void}
 */
const main = (command) => {
  console.log(usage(typeof command === 'string' ? command : undefined));
};

module.exports = main;
module.exports.usage = usage;
