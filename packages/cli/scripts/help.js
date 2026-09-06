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
      'Boots the application, prints what the boot did and stops it again:',
      'the order the modules ran in, how long each one took, what it waited',
      'on and why, the chain that decided the total, and the level chart a',
      'numeric pin lands in. With a module name, prints that module only:',
      'where it landed, what held it up and what was waiting on it.',
      '',
      'The boot is a real one, so it opens the stores and binds a port like',
      'henri server does. --level stops it earlier: 3 for the models, 4 for',
      'the users, 5 for the routes.',
    ],
    examples: [
      {
        command: 'henri analyze',
        description: 'The boot chart of the application',
      },
      {
        command: 'henri analyze router',
        description: 'Where the router module landed and what it waited on',
      },
      {
        command: 'henri analyze --level 3 --json',
        description: 'The chart of a boot that stops at the models, as JSON',
      },
    ],
    flags: [
      {
        description: 'stop the boot at this level (0 to 6, default 6)',
        flag: '--level=<n>',
      },
      JSON_FLAG,
    ],
    name: 'analyze',
    summary: 'the boot chart: order, timings, dependencies and critical path',
    usage: ['henri analyze [module] [--level=<n>] [--json]'],
  },
  {
    description: [
      'Checks the application against the checkable requirements of the',
      'OWASP Application Security Verification Standard 4.0.3, without',
      'starting it. Every finding names the file and the line it comes from,',
      'the ASVS requirement and level it maps to and the Top 10 (2021)',
      'category it falls in, so the report reads against a standard rather',
      'than against an opinion.',
      '',
      'It reports what the application says, never what henri does for it:',
      'a protection turned off in config/*.json, a secret or a credentials',
      'key that reached a commit, a model write that takes the whole request',
      'body, a route left without a role where its siblings have one, a raw',
      'query built by interpolation, unescaped output in a view, and the',
      'known advisories of the production dependencies (--no-deps skips',
      'that one, which is the only step that goes to the network).',
      '',
      'Findings are high, medium or low; --fail-on says which of them exits',
      'with 1 (medium by default, none never fails). A finding in',
      'config/test.json is reported one severity lower.',
      '',
      '--checks prints the catalogue instead of running it: every check, the',
      'ASVS requirement and level it maps to and what it determines, so the',
      'answer is what you have covered and not only what you failed.',
    ],
    examples: [
      {
        command: 'henri audit',
        description: 'The findings of the application, worst first',
      },
      {
        command: 'henri audit --json --no-deps',
        description: 'The static findings as JSON, without the network',
      },
      {
        command: 'henri audit --checks',
        description: 'What the audit can determine, and against what',
      },
      {
        command: 'henri audit --fail-on=high',
        description: 'Exit 1 on the high findings only',
      },
    ],
    flags: [
      {
        description:
          'exit 1 on this severity or above: high, medium (default), low, none',
        flag: '--fail-on=<severity>',
      },
      {
        description: 'print the catalogue of checks instead of running them',
        flag: '--checks',
      },
      {
        description: 'skip the dependency advisories (no network)',
        flag: '--no-deps',
      },
      {
        description:
          'print { ok, findings: [{ severity, check, owasp, asvs, level, file, line, message, hint }], summary }',
        flag: '--json',
      },
    ],
    name: 'audit',
    summary: 'check the application against the ASVS and the OWASP Top 10',
    usage: [
      'henri audit [--fail-on=<severity>] [--no-deps] [--json]',
      'henri audit --checks [--json]',
    ],
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
    description: [
      'The secrets of an environment, encrypted with AES-256-GCM in',
      'config/credentials/<env>.json.enc, which is committed. The key that',
      'opens it is HENRI_CREDENTIALS_KEY or config/credentials/<env>.key,',
      'which is never committed (henri new ignores it, henri doctor checks',
      'it). On boot henri decrypts the file and applies it over the',
      'configuration, under the environment variables: what is in there is',
      'read with henri.config.get("mail.auth.pass").',
      '',
      'edit decrypts into a file only you can read, opens EDITOR (or VISUAL)',
      'and encrypts what comes back; the plaintext is removed on every exit',
      'path. The first edit of an environment generates the key and the file.',
      'Neither command prints a secret with --json.',
    ],
    examples: [
      {
        command: 'henri credentials:edit',
        description: 'Edits the credentials of the development environment',
      },
      {
        command: 'henri credentials:edit --env production',
        description: 'Creates them on the first run, with a fresh secret',
      },
      {
        command: 'henri credentials:show --env production --json',
        description: 'The key paths the file holds, without their values',
      },
    ],
    flags: [
      {
        description:
          'the environment (default: NODE_ENV, or dev when it is unset)',
        flag: '--env=<name>',
      },
      {
        description: 'print the environment, the file and its key paths',
        flag: '--json',
      },
    ],
    name: 'credentials',
    summary: 'encrypted secrets, per environment',
    targets: [
      {
        description: 'decrypt, open EDITOR, encrypt what comes back',
        name: 'edit',
      },
      {
        description: 'print the decrypted credentials on stdout',
        name: 'show',
      },
    ],
    usage: [
      'henri credentials <command> [--env=<name>] [--json]',
      'henri credentials:<command>',
    ],
  },
  {
    description: [
      'Boots the models only (no views, no workers) and drives the database.',
      'seed runs db/seeds.js on any adapter; the migration commands need the',
      'drizzle adapter and its db/migrations folder (drizzle-kit layout). In',
      'development the server pushes the schema at boot unless the store sets',
      '"sync": false; in production it applies the migrations when the store',
      'sets "migrate": true.',
    ],
    examples: [
      {
        command: 'henri db:seed',
        description: 'Runs db/seeds.js with the models loaded',
      },
      {
        command: 'henri db:generate --name=add-priority',
        description: 'Writes db/migrations/0001_add_priority.sql',
      },
      {
        command: 'henri db:migrate --production',
        description:
          'Applies the pending migrations to the production database',
      },
    ],
    flags: [
      {
        description: 'the store to migrate (default: default)',
        flag: '--store=<name>',
      },
      {
        description: 'label of the generated migration',
        flag: '--name=<label>',
      },
      {
        description: 'seed: the file to run (default: db/seeds.js)',
        flag: '--file=<path>',
      },
      {
        description: 'push: apply statements that lose data',
        flag: '--force',
      },
      { description: 'print the result as JSON', flag: '--json' },
    ],
    name: 'db',
    summary: 'seeds and migrations of a store',
    targets: [
      {
        description:
          'run db/seeds.js with the models loaded (--file=<path> for another file)',
        name: 'seed',
      },
      {
        description: 'the applied and pending migrations of db/migrations',
        name: 'status',
      },
      {
        description:
          'write a migration for the schema changes (--name=<label>)',
        name: 'generate',
      },
      { description: 'apply the pending migrations', name: 'migrate' },
      {
        description:
          'make the database match the models without a migration (--force applies statements that lose data)',
        name: 'push',
      },
    ],
    usage: [
      'henri db <command> [--store=<name>] [--name=<label>] [--file=<path>] [--force] [--json]',
      'henri db:<command>',
    ],
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
      { description: 'delete app/jobs/<name>.js', name: 'job <name>' },
      {
        description:
          'delete app/mailers/<name>.js and app/views/mailers/<name>',
        name: 'mailer <name>',
      },
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
      '',
      'It also runs the static checks of henri audit and warns when they',
      'find something, without repeating them: run henri audit for the',
      'findings, their OWASP category and how to fix them.',
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
      'Writes models, controllers, routes, views, mailers, workers and tests',
      'in the henri layout. Existing files are skipped; --force overwrites',
      'them.',
      `Field types: ${FIELD_TYPES} (default: string).`,
      'A trailing ! makes the field required.',
      'Scaffolded controllers answer HAL to JSON clients (Accept:',
      'application/json or application/hal+json): res.collection() for the',
      'index (paginated with ?page=&per_page=), res.resource() for one',
      'document (201 + Location on create, 204 on destroy), req.permit()',
      'for the attributes. Mutating routes honour Idempotency-Key. The test',
      'generator checks the HAL links when the name has a resources/crud',
      'route.',
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
        command: 'henri g job welcome',
        description: 'Creates app/jobs/welcome.js, run by henri jobs',
      },
      {
        command: 'henri g mailer welcome confirm',
        description:
          'Creates app/mailers/welcome.js and app/views/mailers/welcome/confirm.hbs; preview it on /_mailers',
      },
      {
        command: 'henri g test highscores',
        description: 'Creates test/highscores.test.js using @usehenri/testing',
      },
      {
        command: 'henri g authentication',
        description:
          'Registration, password reset and email confirmation: the pages, the controller, the mailer and the tests',
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
    summary:
      'write models, controllers, routes, views, mailers, workers and tests',
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
        description: 'app/jobs/<name>.js with perform, retries and a queue',
        name: 'job <name>',
      },
      {
        description:
          'app/mailers/<name>.js, a mail view per action and the layout',
        name: 'mailer <name> [action ...]',
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
          'the account flows: turns config.user.signup, passwordReset and confirmation on, and writes the pages, the controller, the mailer, the user model and the tests around the endpoints henri mounts',
        name: 'authentication',
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
        description: 'inertia (default) or react',
        flag: '--renderer <name>',
      },
      {
        description:
          'store adapter: disk (default), drizzle, mongoose, mysql, postgresql, mssql',
        flag: '--adapter <name>',
      },
      {
        description: 'drizzle dialect: sqlite (default), postgres or mysql',
        flag: '--dialect <name>',
      },
      {
        description:
          'install with pnpm, yarn or npm instead of the detected one',
        flag: '--pm <name>',
      },
    ],
    name: 'init',
    summary: 'add the henri structure to the current directory',
    usage: [
      'henri init [--force | -f] [--skip-install] [--no-git] [--renderer <name>] [--adapter <name>] [--dialect <name>] [--pm <name>]',
    ],
  },
  {
    description: [
      'Runs a worker process that claims jobs from the queue and performs',
      'them, keeps the recurring schedules of config/<env>.json moving and',
      'puts back the jobs a runner died on. Several runners are meant to run',
      'at once against one database. It stops on SIGINT, SIGTERM and SIGQUIT,',
      'finishing the jobs it already claimed. Without a command it runs;',
      'install, status, list, dead, show, perform, retry and discard drive',
      'the queue from the outside.',
    ],
    examples: [
      {
        command: 'henri jobs --queue=mailers --concurrency=10',
        description: 'A runner for one queue only',
      },
      {
        command: 'henri jobs --once',
        description: 'Perform everything that is due, then exit',
      },
      {
        command: 'henri jobs:dead --json',
        description: 'The dead letter queue, as JSON',
      },
      {
        command: 'henri jobs:retry --all',
        description: 'Put every dead job back in its queue',
      },
    ],
    flags: [
      {
        description: 'only these queues, comma separated (default: all)',
        flag: '--queue=<a,b>',
      },
      {
        description: 'how many jobs at once (default: jobs.concurrency, 5)',
        flag: '--concurrency=<n>',
      },
      {
        description: 'perform what is due and exit instead of looping',
        flag: '--once',
      },
      {
        description: 'do not honour the recurring schedules',
        flag: '--no-recurring',
      },
      {
        description: 'list/retry/discard: how many, and which job or state',
        flag: '--limit=<n> --name=<job> --state=<state>',
      },
      { description: 'retry, discard: every matching job', flag: '--all' },
      {
        description: 'perform: enqueue it later instead of now',
        flag: '--in=<duration> --at=<date>',
      },
      {
        description: 'perform: run it here and now instead of enqueuing',
        flag: '--now',
      },
      { description: 'print the result as JSON', flag: '--json' },
    ],
    name: 'jobs',
    summary: 'run the background jobs, and drive the queue',
    targets: [
      {
        description: 'claim and perform jobs until a signal stops it',
        name: 'run',
      },
      {
        description: 'create the queue tables (idempotent)',
        name: 'install',
      },
      {
        description: 'counts by queue and state, timings and schedules',
        name: 'status',
      },
      {
        description: 'the jobs of the queue (--state, --queue, --name)',
        name: 'list',
      },
      { description: 'the dead letter queue', name: 'dead' },
      {
        description: 'one job with its error, its stack and its history',
        name: 'show <id>',
      },
      {
        description: 'enqueue a job by hand (JSON arguments)',
        name: 'perform <name> [json]',
      },
      {
        description: 'put a dead job back in its queue (or --all)',
        name: 'retry <id>',
      },
      {
        description: 'delete a dead job for good (or --all)',
        name: 'discard <id>',
      },
    ],
    usage: [
      'henri jobs [--queue=<a,b>] [--concurrency=<n>] [--once] [--no-recurring]',
      'henri jobs <command> [options] [--json]',
      'henri jobs:<command>',
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
      'CLAUDE.md and .mcp.json. The sample resource is written against the',
      'model API of the selected --adapter.',
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
        description: 'inertia (default) or react',
        flag: '--renderer <name>',
      },
      {
        description:
          'store adapter: disk (default), drizzle, mongoose, mysql, postgresql, mssql',
        flag: '--adapter <name>',
      },
      {
        description: 'drizzle dialect: sqlite (default), postgres or mysql',
        flag: '--dialect <name>',
      },
      {
        description:
          'install with pnpm, yarn or npm instead of the detected one',
        flag: '--pm <name>',
      },
    ],
    name: 'new',
    summary: 'create a new application',
    usage: [
      'henri new <folder> [--force | -f] [--skip-install] [--no-git] [--renderer <name>] [--adapter <name>] [--dialect <name>] [--pm <name>]',
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
      'Every answer carries X-Request-Id and the helmet headers; requests are',
      'rate limited (config.rateLimit, 600/min per user or ip, 10/min on',
      'POST /login and /register; not enforced in development) and time out',
      'after config.requestTimeout (30s). GET /_henri/health pings the stores',
      '(200 or 503).',
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
