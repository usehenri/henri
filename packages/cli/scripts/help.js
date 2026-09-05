const { EXIT_CODES } = require('./errors');
const { helpHeader, version } = require('./utils');

/**
 * Flags every command accepts (handled by index.js)
 */
const GLOBAL_FLAGS = [
  { description: 'same as NODE_ENV=production', flag: '--production' },
  { description: 'same as DEBUG. ex: --debug=henri:*', flag: '--debug[=*]' },
  { description: 'start with debugging / profiling', flag: '--inspect' },
  { description: 'force wait / use with --inspect', flag: '--wait' },
  {
    description: 'force a production rebuild (views)',
    flag: '--force-build',
  },
  { description: 'do not start workers', flag: '--skip-workers' },
  {
    description: 'bind the server to this address (same as HENRI_HOST)',
    flag: '--host=<ip>',
  },
  {
    description:
      'machine readable output; errors become { "error": { command, message, hint, code, exitCode } } on stderr',
    flag: '--json',
  },
  { alias: '-v', description: 'print the henri version', flag: '--version' },
  { alias: '-h', description: 'print the help of a command', flag: '--help' },
];

const JSON_FLAG = { description: 'print as JSON', flag: '--json' };
const FORCE_FLAG = {
  alias: '-f',
  description: 'overwrite existing files',
  flag: '--force',
};

const FIELD_TYPES =
  'string, text, number, integer, float, boolean, date, json, uuid';

/**
 * The catalogue of commands: one entry per command, rendered as text by
 * `henri help` and as JSON by `henri help --json`.
 */
const COMMANDS = [
  {
    description: [
      'Prints the versions of node, the package managers, henri and the',
      '@usehenri packages installed in the current project, and the models,',
      'controllers, views and helpers of the application.',
    ],
    flags: [JSON_FLAG],
    name: 'about',
    summary: 'versions of node, henri and the packages of this project',
    usage: ['henri about [--json]'],
  },
  {
    description: [
      'Builds the production views without starting the server or the',
      'databases: the next.js pages for the react renderer, the vite client',
      'and SSR bundles (app/views/dist) for inertia. Nothing to do for the',
      'template renderer.',
    ],
    name: 'build',
    summary: 'build the production views (next.js or vite)',
    usage: ['henri build'],
  },
  {
    description: [
      'Removes build artifacts and caches (.tmp, .henri, logs, node_modules,',
      'app/views/.cache, app/views/.next) and recreates them empty. Without',
      'arguments, asks which folders to remove; when stdin is not a terminal,',
      'pass --all or list the folders.',
    ],
    flags: [
      { description: 'remove every candidate without asking', flag: '--all' },
      { alias: '-y', description: 'same as --all', flag: '--yes' },
      { description: 'print the removed folders as JSON', flag: '--json' },
    ],
    name: 'clean',
    summary: 'remove build artifacts and caches',
    usage: ['henri clean [folder ...] [--all | -y, --yes] [--json]'],
  },
  {
    description: [
      'Boots the application and opens a REPL with henri and the models loaded.',
    ],
    name: 'console',
    summary: 'REPL with henri and the models loaded',
    usage: ['henri console [--production]'],
  },
  {
    aliases: ['d'],
    description: [
      'Removes what a generator created. Files are backed up in .backup/',
      'unless the project is a git repository.',
    ],
    examples: [
      {
        command: 'henri destroy model User',
        description: 'Deletes the User model',
      },
      {
        command: 'henri destroy controller locations',
        description: 'Deletes a controller and its routes',
      },
      {
        command: 'henri d scaffold HighScore',
        description:
          'Deletes a model, a controller with resources actions, the matching resources routes and the views',
      },
    ],
    flags: [
      {
        description: 'print the removed files and routes as JSON',
        flag: '--json',
      },
    ],
    name: 'destroy',
    summary: 'undo a generator',
    targets: [
      { description: 'delete app/models/<Name>.js', name: 'model <Name>' },
      {
        description: 'delete app/controllers/<name>.js and its routes',
        name: 'controller <name>',
      },
      {
        description:
          'remove one key from config/routes.js. ex: henri destroy route "get /about"',
        name: 'route <key>',
      },
      {
        description: 'delete app/views/pages/<folder>',
        name: 'view <folder>',
      },
      { description: 'delete app/workers/<name>.js', name: 'worker <name>' },
      { description: 'delete test/<name>.test.js', name: 'test <name>' },
      { description: 'undo "generate crud"', name: 'crud <Name>' },
      { description: 'undo "generate scaffold"', name: 'scaffold <Name>' },
    ],
    usage: [
      'henri destroy <what> <target> [--json]',
      'henri d <what> <target> [--json]',
    ],
  },
  {
    description: [
      'Checks the application against the henri conventions without starting',
      'it: model files singular and PascalCase, controllers lowercase and',
      'routed, every resources route backed by a controller, its actions and',
      'its pages, .env present and ignored by git, no secret in config/*.json,',
      'AGENTS.md and vitest.config.js present, dependencies installed.',
      'Exits with 1 when a problem is found; warnings do not fail.',
    ],
    flags: [
      {
        description:
          'print { ok, problems: [{ level, check, file, message, hint }] }',
        flag: '--json',
      },
    ],
    name: 'doctor',
    summary: 'check the application against the henri conventions',
    usage: ['henri doctor [--json]'],
  },
  {
    aliases: ['g'],
    description: [
      'Writes models, controllers, routes, views, workers and tests in the',
      'henri layout. Existing files are skipped; --force overwrites them.',
      `Field types: ${FIELD_TYPES} (default: string).`,
      'A trailing ! makes the field required.',
    ],
    examples: [
      {
        command: 'henri generate model User name:string! birthday:date',
        description: 'Creates a model with these attributes',
      },
      {
        command: 'henri generate controller locations index show gps',
        description: 'Creates a controller and routes to those actions',
      },
      {
        command: 'henri g scaffold HighScore game:string score:integer',
        description:
          'Creates a model, a controller with the resources actions, the matching resources routes and the views',
      },
      {
        command: 'henri g worker cleanup',
        description: 'Creates app/workers/cleanup.js with start and stop',
      },
      {
        command: 'henri g test highscores',
        description: 'Creates test/highscores.test.js using @usehenri/testing',
      },
      {
        command: 'henri g agents',
        description:
          'Writes AGENTS.md, CLAUDE.md and .mcp.json in an existing application',
      },
    ],
    flags: [
      FORCE_FLAG,
      {
        description: 'print the files written and the routes added as JSON',
        flag: '--json',
      },
    ],
    name: 'generate',
    summary: 'write models, controllers, routes, views, workers and tests',
    targets: [
      {
        description: 'app/models/<Name>.js (singular, PascalCase)',
        name: 'model <Name> [field:type[!] ...]',
      },
      {
        description: 'app/controllers/<name>.js and one route per action',
        name: 'controller <name> [action ...]',
      },
      {
        description: 'app/workers/<name>.js with start and stop',
        name: 'worker <name>',
      },
      {
        description: 'test/<name>.test.js using @usehenri/testing',
        name: 'test <name>',
      },
      {
        description: 'model, JSON controller and the crud routes',
        name: 'crud <Name> [field:type[!] ...]',
      },
      {
        description:
          'model, resources controller, resources routes and the pages',
        name: 'scaffold <Name> [field:type[!] ...]',
      },
      {
        description:
          'AGENTS.md (the conventions for coding agents), CLAUDE.md and .mcp.json',
        name: 'agents',
      },
    ],
    usage: [
      'henri generate <what> <target> [options] [--force] [--json]',
      'henri g <what> <target> [options] [--force] [--json]',
    ],
  },
  {
    description: [
      'Prints this help, or the help of a command. With --json, prints the',
      'catalogue of commands, flags and exit codes.',
    ],
    flags: [JSON_FLAG],
    name: 'help',
    summary: 'this help, or the help of a command',
    usage: ['henri help [command] [--json]'],
  },
  {
    description: [
      'Adds the henri structure to the current directory. The project name',
      'is the name of the directory. Writes AGENTS.md (the conventions for',
      'coding agents), CLAUDE.md and .mcp.json along with the application.',
    ],
    flags: [
      {
        alias: '-f',
        description: 'write into a directory that already has an app/ folder',
        flag: '--force',
      },
      {
        description: 'do not install the dependencies',
        flag: '--skip-install',
      },
      { description: 'do not run "git init"', flag: '--no-git' },
      {
        description: 'react (default) or inertia',
        flag: '--renderer <name>',
      },
    ],
    name: 'init',
    summary: 'add the henri structure to the current directory',
    usage: [
      'henri init [--force | -f] [--skip-install] [--no-git] [--renderer <name>]',
    ],
  },
  {
    description: [
      'Starts the MCP server of @usehenri/mcp on stdio for the application',
      'in the current directory. Claude Code reads it from .mcp.json, Cursor',
      'from .cursor/mcp.json (both: { "command": "henri", "args": ["mcp"] }).',
      'Tools: routes, models, controllers, config, generate, destroy, test,',
      'lint, doctor. Resources: henri://agents.md, henri://routes,',
      'henri://conventions.',
    ],
    name: 'mcp',
    summary: 'MCP server (stdio) for coding agents',
    usage: ['henri mcp'],
  },
  {
    description: [
      'Creates a new henri application in <folder>, with a sample Task',
      'resource, a README, AGENTS.md (the conventions for coding agents),',
      'CLAUDE.md and .mcp.json.',
    ],
    flags: [
      {
        alias: '-f',
        description: 'write into an existing folder',
        flag: '--force',
      },
      {
        description: 'do not install the dependencies',
        flag: '--skip-install',
      },
      { description: 'do not run "git init"', flag: '--no-git' },
      {
        description: 'react (default) or inertia',
        flag: '--renderer <name>',
      },
    ],
    name: 'new',
    summary: 'create a new application',
    usage: [
      'henri new <folder> [--force | -f] [--skip-install] [--no-git] [--renderer <name>]',
    ],
  },
  {
    description: [
      'Prints the routes expanded from config/routes.js (verb, path,',
      'controller and path helper) without starting the server.',
    ],
    flags: [
      {
        description:
          'print [{ verb, route, controller, path, roles? }] as JSON',
        flag: '--json',
      },
    ],
    name: 'routes',
    summary: 'the routes table from config/routes.js',
    usage: ['henri routes [--json]'],
  },
  {
    aliases: ['s'],
    description: [
      'Starts the application (development mode with hot reload by default).',
      'The server binds to 127.0.0.1 in development and 0.0.0.0 in production',
      'unless --host, HENRI_HOST or config.host says otherwise.',
    ],
    name: 'server',
    summary: 'start the application',
    usage: [
      'henri server [--production] [--skip-workers] [--force-build] [--host=<ip>]',
      'henri s',
    ],
  },
  {
    description: [
      "Runs the project's tests (test/**/*.test.js) with vitest and henri",
      "booted under NODE_ENV=test. Exits with vitest's code; other arguments",
      'are passed to vitest (--watch, -t <name>, ...).',
    ],
    name: 'test',
    summary: 'run the tests',
    usage: ['henri test [files ...] [vitest args ...]'],
  },
];

/**
 * Find a command in the catalogue, by name or alias
 *
 * @param {string} name A command name or alias
 * @returns {object|undefined} The catalogue entry
 */
const find = (name) =>
  COMMANDS.find(
    (command) => command.name === name || (command.aliases || []).includes(name)
  );

/**
 * Two columns, the first padded to the same width
 *
 * @param {Array<[string, string]>} rows Rows
 * @param {number} indent Spaces before the first column
 * @returns {string} The lines
 */
const columns = (rows, indent = 6) => {
  const width = Math.max(...rows.map(([left]) => left.length));
  const pad = ' '.repeat(indent);

  return rows
    .map(([left, right]) => `${pad}${left.padEnd(width)}  ${right}`)
    .join('\n');
};

/**
 * A flag and its alias, as printed in the help (`-f, --force`)
 *
 * @param {object} flag { flag, alias }
 * @returns {string} The label
 */
const flagLabel = ({ flag, alias }) => (alias ? `${alias}, ${flag}` : flag);

/**
 * The text of the global flags section
 *
 * @returns {string} The section
 */
const globalFlags = () =>
  `    Global flags\n${columns(
    GLOBAL_FLAGS.map((flag) => [flagLabel(flag), flag.description])
  )}`;

/**
 * The text of the exit codes section
 *
 * @returns {string} The section
 */
const exitCodes = () =>
  `    Exit codes\n${columns(
    EXIT_CODES.map(({ code, description }) => [String(code), description])
  )}`;

/**
 * The help text of one command
 *
 * @param {object} command A catalogue entry
 * @returns {string} The text
 */
const commandUsage = (command) => {
  const sections = [
    `    Usage\n${command.usage.map((line) => `      $ ${line}`).join('\n')}`,
    command.description.map((line) => `    ${line}`).join('\n'),
  ];

  if (command.targets) {
    sections.push(
      `    Available commands\n${columns(
        command.targets.map(({ name, description }) => [name, description])
      )}`
    );
  }

  if (command.flags) {
    sections.push(
      `    Flags\n${columns(
        command.flags.map((flag) => [flagLabel(flag), flag.description])
      )}`
    );
  }

  if (command.examples) {
    sections.push(
      `    Examples\n\n${command.examples
        .map(
          ({ command: example, description }) =>
            `      $ ${example}\n        --> ${description}`
        )
        .join('\n\n')}`
    );
  }

  sections.push(globalFlags());

  return `${helpHeader()}\n${sections.join('\n\n')}\n`;
};

/**
 * The general help text
 *
 * @returns {string} The text
 */
const generalUsage = () => {
  const rows = COMMANDS.map((command) => [
    [command.name, ...(command.aliases || [])].join(', '),
    command.summary,
  ]);

  return `${helpHeader()}
    Usage
      $ henri <command> [options]

    Commands
${columns(rows)}

${globalFlags()}

${exitCodes()}

    Conventions for coding agents: AGENTS.md in every application
    (henri new / henri generate agents), henri doctor and henri mcp.

    For more information run a command with the --help flag
      $ henri generate --help
  `;
};

/**
 * The help text of a command, or the general help
 *
 * @param {string} [command] A command name
 * @returns {string} The text
 */
const usage = (command) => {
  const found = command && find(command);

  return found ? commandUsage(found) : generalUsage();
};

/**
 * The catalogue as data (`henri help --json`)
 *
 * @param {string} [command] Only this command
 * @returns {object} { name, version, commands, globalFlags, exitCodes }
 */
const catalogue = (command) => {
  const found = command && find(command);
  const commands = (found ? [found] : COMMANDS).map((entry) => ({
    aliases: entry.aliases || [],
    description: entry.description.join(' '),
    examples: entry.examples || [],
    flags: entry.flags || [],
    name: entry.name,
    summary: entry.summary,
    targets: entry.targets || [],
    usage: entry.usage,
  }));

  return {
    commands,
    exitCodes: EXIT_CODES,
    globalFlags: GLOBAL_FLAGS,
    name: 'henri',
    version,
  };
};

/**
 * Show help
 *
 * @param {string} [command] Show the help of this command only
 * @param {object} [options] Options
 * @param {boolean} [options.json=false] Print the catalogue as JSON
 * @returns {void}
 */
const main = (command, { json = false } = {}) => {
  const name = typeof command === 'string' ? command : undefined;

  if (json) {
    console.log(JSON.stringify(catalogue(name), null, 2));

    return;
  }

  console.log(usage(name));
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.GLOBAL_FLAGS = GLOBAL_FLAGS;
module.exports.catalogue = catalogue;
module.exports.find = find;
module.exports.usage = usage;
