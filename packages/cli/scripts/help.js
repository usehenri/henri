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
      '',
      'rotate re-encrypts the file under a fresh key, which is what to run',
      'when a key may have leaked. The old key has to open the file first,',
      'and the new file is read back before the new key is stored, so a',
      'rotation cannot lose the contents. The new key is written to the key',
      'file, or printed once when HENRI_CREDENTIALS_KEY held the old one.',
      '',
      'No command prints a secret with --json.',
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
      {
        command: 'henri credentials:rotate --env production',
        description: 'Re-encrypts under a new key; the old one opens nothing',
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
        description: 're-encrypt under a new key, keeping the values',
        name: 'rotate',
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
      'seed runs db/seeds.js on any adapter; the migration commands need a',
      'drizzle store -- drizzle, postgresql, mysql, mariadb -- and its',
      'db/migrations folder (drizzle-kit layout). In development the server',
      'pushes the schema at boot unless the store sets "sync": false; in',
      'production it applies the migrations when the store sets',
      '"migrate": true.',
      '',
      'status answers on the mssql store too, the one adapter left on',
      'Sequelize, which has no migrations: it reads the database back and',
      'reports what it and the models disagree about. --sql writes the DDL',
      'that would close it, for you to review; henri applies none of it.',
      '',
      'rollback undoes the last migration, or the last --step=<n>. The',
      'inverse is computed from the snapshots in db/migrations/meta, so',
      'there is no down file to write and none to forget. It refuses a',
      'migration that dropped a table or a column, since putting them back',
      'empty is not undoing anything, and refuses without --force when the',
      'rows it would drop are actually there -- counted first, so undoing a',
      'migration nothing was written into needs no flag.',
      '',
      'schema:dump reads the database back into db/schema.sql: the shape of',
      'the database, ordered so two runs give the same bytes, headed with',
      'the migration it was taken at. It needs a database to read, so it is',
      'written where one is. schema:load creates all of it in an empty',
      'database and records the migrations through that one as applied,',
      'which is how a test database is built without replaying the chain.',
      'It refuses a table it is about to create that is already there, and',
      'there is no flag: db:drop and db:create are how a database is',
      'emptied.',
      '',
      'create and drop are the database itself, which every other command',
      'assumes exists: they read the configuration without connecting to the',
      'store, then talk to the server with the driver the application',
      'installed. PostgreSQL and MySQL are created on their maintenance',
      'connection, a SQLite database is a file, and MongoDB makes one on its',
      'first write. reset drops, creates, brings the schema up (from the',
      'migrations, or from the models when there are none) and runs the',
      'seeds. Both refuse to act against NODE_ENV=production without --force.',
      'The environment is NODE_ENV, as everywhere else: NODE_ENV=test henri',
      'db:create is the test database.',
    ],
    examples: [
      {
        command: 'henri db:create',
        description: 'Creates the database the default store points at',
      },
      {
        command: 'NODE_ENV=test henri db:reset',
        description: 'Drops, creates, migrates and seeds the test database',
      },
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
      {
        command: 'henri db:rollback --step=2',
        description: 'Undoes the last two migrations, if nothing is lost',
      },
      {
        command: 'henri db:schema:dump',
        description: 'Writes db/schema.sql from the database',
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
        description:
          'seed: the file to run (default: db/seeds.js); schema:dump and schema:load: the dump (default: db/schema.sql)',
        flag: '--file=<path>',
      },
      {
        description: 'rollback: how many migrations to undo (default: 1)',
        flag: '--step=<n>',
      },
      {
        description:
          'push and rollback: act although data would be lost; drop and reset: act in production',
        flag: '--force',
      },
      {
        description:
          'status: print the DDL that would close the difference, for review',
        flag: '--sql',
      },
      { description: 'print the result as JSON', flag: '--json' },
    ],
    name: 'db',
    summary: 'the database of a store: create, migrate, seed',
    targets: [
      {
        description: 'create the database the store points at',
        name: 'create',
      },
      {
        description: 'drop it (--force in production)',
        name: 'drop',
      },
      {
        description:
          'drop, create, bring the schema up and seed (--force in production)',
        name: 'reset',
      },
      {
        description:
          'run db/seeds.js with the models loaded (--file=<path> for another file)',
        name: 'seed',
      },
      {
        description:
          'the applied and pending migrations of db/migrations, or what a Sequelize store and the models disagree about (--sql for the DDL)',
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
          'undo the last migration, or the last --step=<n> (--force when rows would be lost)',
        name: 'rollback',
      },
      {
        description:
          'make the database match the models without a migration (--force applies statements that lose data)',
        name: 'push',
      },
      {
        description: 'write db/schema.sql from the database',
        name: 'schema:dump',
      },
      {
        description:
          'create the schema of db/schema.sql in an empty database and record its migrations',
        name: 'schema:load',
      },
    ],
    usage: [
      'henri db <command> [--store=<name>] [--name=<label>] [--file=<path>] [--step=<n>] [--force] [--sql] [--json]',
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
      {
        description:
          'delete app/policies/<name>.js and test/<name>-policy.test.js',
        name: 'policy <Name>',
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
      'It also reads what would fail a boot: a model naming a store the',
      'configuration does not hold, a store adapter another environment',
      'configures and nothing installs, a route asking for a policy that is',
      'not there, a file of app/jobs with no perform, a recurring schedule',
      'naming a job that does not exist, a mailer action with no view, an',
      'app/modules file whose name is taken or whose needs nothing provides,',
      'and the henri packages installed at two different versions. Such a',
      'problem carries the henri error code the boot would raise.',
      '',
      'It also runs the static checks of henri audit and warns when they',
      'find something, without repeating them: run henri audit for the',
      'findings, their OWASP category and how to fix them.',
    ],
    flags: [
      {
        description:
          'print { ok, problems: [{ level, check, code, file, message, hint }] }',
        flag: '--json',
      },
      {
        description:
          'skip the two checks that open a connection: whether the shared store of config.shared answers, and whether a store holds the migrations of db/migrations',
        flag: '--no-reach',
      },
    ],
    name: 'doctor',
    summary: 'check the application against the henri conventions',
    usage: ['henri doctor [--json] [--no-reach]'],
  },
  {
    description: [
      'The fields this application encrypts at rest: which of them, whether',
      'each one is randomised or deterministic, and the ids of the keys the',
      'application holds. Without a command it prints that map. No key is',
      'ever printed, by this or anything else.',
      '',
      'status counts what the columns hold, by key id, without opening a',
      'single value. It is the command a rotation finishes with: an old key',
      'may be dropped once nothing names it, and not a deploy before -- a',
      'record nobody writes again is only ever moved by the rotation.',
      '',
      'rotate rewrites every value that is not under the key that writes',
      'today, soft deleted rows included, one column of one row at a time so',
      'that updatedAt does not move. A value that will not open is counted',
      'and left exactly as it is. A backfill is the same command: a column',
      'that held plaintext before the field was marked encrypted is rewritten',
      'too, with config.encryption.readPlaintext on for the length of it.',
      '',
      'All three boot the models only: no port is bound.',
    ],
    examples: [
      {
        command: 'henri encryption',
        description: 'What this application encrypts, and under which keys',
      },
      {
        command: 'henri encryption:status',
        description: 'Whether the old key may be dropped yet',
      },
      {
        command: 'henri encryption:rotate --dry-run',
        description: 'What a rotation would rewrite, without writing',
      },
    ],
    flags: [
      {
        description: 'rotate: report what it would do and write nothing',
        flag: '--dry-run',
      },
      {
        description: 'rotate: one model only',
        flag: '--model=<Name>',
      },
      {
        description: 'rotate: one field only',
        flag: '--field=<name>',
      },
      JSON_FLAG,
    ],
    name: 'encryption',
    summary: 'the encrypted fields of this application, and the key rotation',
    targets: [
      {
        description: 'the encrypted fields and the key ids (the default)',
        name: 'map',
      },
      {
        description: 'what the columns hold, counted by key id',
        name: 'status',
      },
      {
        description: 'rewrite everything under the key that writes today',
        name: 'rotate',
      },
    ],
    usage: [
      'henri encryption [--json]',
      'henri encryption:status [--json]',
      'henri encryption:rotate [--dry-run] [--model=<Name>] [--field=<name>] [--json]',
    ],
  },
  {
    aliases: ['g'],
    description: [
      'Writes models, controllers, routes, views, policies, mailers, workers',
      'and tests',
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
        command: 'henri g policy HighScore playerId',
        description:
          'Creates app/policies/highscore.js and its test: who may read and write one record',
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
          'Rewrites AGENTS.md from the application (the generated section only), CLAUDE.md and .mcp.json',
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
        description:
          'app/policies/<name>.js: who may read and write one record, and its test',
        name: 'policy <Name> [ownerColumn]',
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
          'AGENTS.md, generated from this application (the renderer, the stores, the models and their marks, the routes, the jobs, the packages installed), plus CLAUDE.md and .mcp.json. Only the region between its markers is rewritten: your own text around it is kept, and a region edited by hand or a file henri did not write is skipped unless --force',
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
          'store adapter: drizzle (default), disk, mongoose, postgresql, mysql, mssql',
        flag: '--adapter <name>',
      },
      {
        description:
          'dialect of --adapter drizzle: sqlite (default), postgres or mysql',
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
      'The personal data of this application: which fields of which models',
      'are marked `personal`, which of them never leave the server, how each',
      'model reaches the person, and what an erasure would do to it. Without',
      'a command it prints that map, the way henri routes prints the routes.',
      '',
      'export writes everything the application holds about one person, in',
      'one document they can read: their own record and every record of',
      'every model linked to them, soft deleted ones included.',
      '',
      'erase removes them. The default is to anonymize the person in place',
      'rather than delete the row, so the records that reference them stay',
      'consistent and their own personal fields are erased too; a model says',
      'otherwise with options: { personal: { onErase } }. A soft delete is',
      'never an erasure: the walk reaches the stamped rows and a delete is a',
      'real one. It refuses before writing anything when the plan cannot be',
      'carried out, asks for confirmation, and leaves a receipt naming every',
      'record it touched, with an HMAC of the identity instead of the',
      'identity (config.privacy.receipts, "privacy" by default).',
      '',
      'The person is named by email address, external id or id, and all',
      'three commands boot the models only: no port is bound.',
    ],
    examples: [
      {
        command: 'henri privacy',
        description: 'What this application says is personal',
      },
      {
        command: 'henri privacy:export ada@example.com --out ada.json',
        description: 'Everything held about one person',
      },
      {
        command: 'henri privacy:erase ada@example.com --dry-run',
        description: 'What an erasure would do, without doing it',
      },
    ],
    flags: [
      {
        description: 'export: write the document to this file too',
        flag: '--out=<file>',
      },
      {
        description: 'erase: print the plan and write nothing',
        flag: '--dry-run',
      },
      {
        description:
          'erase: anonymize, delete, orphan or retain, for the models that do not say it themselves',
        flag: '--strategy=<name>',
      },
      { alias: '-y', description: 'erase: do not ask', flag: '--yes' },
      JSON_FLAG,
    ],
    name: 'privacy',
    summary:
      'the personal data of this application, and the export and erasure of one person',
    targets: [
      {
        description: 'the personal fields, model by model (the default)',
        name: 'map',
      },
      {
        description: 'everything held about one person',
        name: 'export <who>',
      },
      {
        description: 'erase one person, and leave a receipt',
        name: 'erase <who>',
      },
    ],
    usage: [
      'henri privacy [--json]',
      'henri privacy:export <who> [--out=<file>] [--json]',
      'henri privacy:erase <who> [--dry-run] [--strategy=<name>] [--yes] [--json]',
    ],
  },
  {
    description: [
      'How long this application keeps its records, and the sweep that',
      'enforces it. A model says it in its options -- retention: { after,',
      'action, from, where } -- and henri retention prints every rule with',
      'the token that approves it.',
      '',
      'henri retention:sweep is a dry run unless it is given --yes: it',
      'plans, counts and prints, and writes nothing. A rule whose token is',
      'not in config.retention.approved never writes either, however the',
      'sweep was run, so a new rule cannot delete anything until a person',
      'has approved it in the configuration.',
      '',
      'With @usehenri/jobs installed and config.retention.schedule set,',
      'the same sweep runs as the recurring henri/retention job. Without',
      'the package this command is what a cron line runs. Both boot the',
      'models only: no port is bound.',
    ],
    examples: [
      {
        command: 'henri retention',
        description: 'The rules, and which of them are approved',
      },
      {
        command: 'henri retention:sweep',
        description: 'What a sweep would do, without doing it',
      },
      {
        command: 'henri retention:sweep --yes --only=Proposal',
        description: 'Sweep one model, for real',
      },
    ],
    flags: [
      {
        description: 'sweep: only this model, or Model:rule',
        flag: '--only=<name>',
      },
      {
        alias: '-y',
        description: 'sweep: write; without it nothing is written',
        flag: '--yes',
      },
      JSON_FLAG,
    ],
    name: 'retention',
    summary: 'how long the models keep their records, and the sweep',
    targets: [
      {
        description: 'the retention rules, model by model (the default)',
        name: 'map',
      },
      {
        description: 'sweep every rule (a dry run without --yes)',
        name: 'sweep',
      },
    ],
    usage: [
      'henri retention [--json]',
      'henri retention:sweep [--only=<name>] [--yes] [--json]',
    ],
  },
  {
    description: [
      'The append-only record of who read or changed personal data, read',
      'back. It holds field names, counts and public identifiers, never a',
      'value, and every entry is hash-chained onto the one before it.',
      '',
      'henri trail:about <who> answers "prove the erasure happened" from an',
      'email address: the address is not in the table, its digest is, and',
      'the digest is recomputed from what you were asked about.',
      '',
      'henri trail:verify walks the chain and says whether a row was edited',
      'or removed, and where. The trail is off until config.trail says',
      'otherwise; all three boot the models only.',
    ],
    examples: [
      {
        command: 'henri trail --action=privacy.erase',
        description: 'Every erasure this application performed',
      },
      {
        command: 'henri trail:about ada@example.com',
        description: 'Everything recorded about one person',
      },
      {
        command: 'henri trail:verify',
        description: 'Whether anything was edited or removed',
      },
    ],
    flags: [
      {
        description: 'only this action (privacy.erase)',
        flag: '--action=<name>',
      },
      { description: 'only this model', flag: '--model=<name>' },
      { description: 'only this actor, by external id', flag: '--actor=<id>' },
      {
        description: 'entries at or after this moment',
        flag: '--since=<date>',
      },
      {
        description: 'entries at or before this moment',
        flag: '--until=<date>',
      },
      { description: 'how many entries to print (25)', flag: '--limit=<n>' },
      JSON_FLAG,
    ],
    name: 'trail',
    summary: 'who read or changed personal data, and whether the chain holds',
    targets: [
      {
        description: 'the latest entries (the default)',
        name: 'list',
      },
      {
        description: 'everything recorded about one person',
        name: 'about <who>',
      },
      {
        description: 'walk the hash chain and report the first break',
        name: 'verify',
      },
    ],
    usage: [
      'henri trail [--action=<name>] [--model=<name>] [--limit=<n>] [--json]',
      'henri trail:about <who> [--json]',
      'henri trail:verify [--json]',
    ],
  },
  {
    description: [
      'The calls this application answered and the calls it made, joined by',
      'the request id henri threads through everything. It holds values --',
      'the body that came in, the body that went out -- which is what makes',
      'it the opposite of the access trail rather than a second one.',
      '',
      'henri calls <request-id> is what the two records are for: the call',
      'that came in, every call that went out because of it, in order, with',
      'the timings.',
      '',
      'It is off until config.calls says otherwise, and it is sampled, capped',
      'and swept: henri calls:stats says what was written and what was',
      'dropped rather than written.',
    ],
    examples: [
      {
        command: 'henri calls 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56',
        description: 'One request and everything it caused',
      },
      {
        command: 'henri calls --direction=out --service=billing',
        description: 'The latest calls to one service',
      },
      {
        command: 'henri calls:stats',
        description: 'What was written, and what was dropped',
      },
      {
        command: 'henri calls:sweep --yes',
        description: 'Take the calls past calls.keep away',
      },
    ],
    flags: [
      { description: 'only in or only out', flag: '--direction=<in|out>' },
      { description: 'only this service, outbound', flag: '--service=<name>' },
      { description: 'only this status', flag: '--status=<n>' },
      { description: 'only ok, failed or aborted', flag: '--outcome=<name>' },
      { description: 'calls at or after this moment', flag: '--since=<date>' },
      { description: 'calls at or before this moment', flag: '--until=<date>' },
      { description: 'how many calls to print (25)', flag: '--limit=<n>' },
      { description: 'required by calls:sweep', flag: '--yes' },
      JSON_FLAG,
    ],
    name: 'calls',
    summary: 'the calls answered and the calls made, joined by request id',
    targets: [
      {
        description: 'the latest calls, or one request id (the default)',
        name: 'list',
      },
      {
        description: 'what was written, and what was dropped',
        name: 'stats',
      },
      {
        description: 'take the calls past calls.keep away',
        name: 'sweep',
      },
    ],
    usage: [
      'henri calls [<request-id>] [--direction=<in|out>] [--limit=<n>] [--json]',
      'henri calls:stats [--json]',
      'henri calls:sweep --yes [--json]',
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
          'store adapter: drizzle (default), disk, mongoose, postgresql, mysql, mssql',
        flag: '--adapter <name>',
      },
      {
        description:
          'dialect of --adapter drizzle: sqlite (default), postgres or mysql',
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
      'Writes the OpenAPI 3.1 description of what the application exposes,',
      'built from config/routes.js, app/models and the configuration, without',
      'starting the server or touching a database. JSON on stdout by default.',
      '',
      'It describes the answers henri produces itself: the HAL collection and',
      'resource of every resources/crud route, the error envelope of every',
      'failure henri answers, the paging, the versioned media type,',
      'Idempotency-Key, the roles and the policy of each route, and the',
      'endpoints henri mounts (POST /login, the account flows, the health',
      'probes). What a controller writes itself it does not describe: those',
      'operations carry the statuses henri produces and say, in words, that',
      "the body is the application's. --summary prints which is which.",
      '',
      'Out of scope on purpose: a UI, request validation, client generation',
      'and GraphQL, which has a schema of its own.',
    ],
    examples: [
      {
        command: 'henri openapi > openapi.json',
        description: 'The document, on stdout',
      },
      {
        command: 'henri openapi --out openapi.json',
        description: 'The same, written to a file the application commits',
      },
      {
        command: 'henri openapi --summary',
        description: 'What it covers, and what henri cannot know',
      },
    ],
    flags: [
      {
        description: 'write the document to a file instead of stdout',
        flag: '--out <file>',
      },
      {
        description:
          'print what the document covers instead of the document itself',
        flag: '--summary',
      },
    ],
    name: 'openapi',
    summary: 'the OpenAPI 3.1 description of what the application exposes',
    usage: ['henri openapi [--out <file>] [--summary]'],
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
      'after config.requestTimeout (30s). GET /livez says the process answers,',
      'GET /readyz (and /_henri/health) that it can serve. SIGTERM drains: the',
      'port closes, the requests in flight finish (config.shutdown), then the',
      'modules stop.',
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
      'The endpoints this application sends signed webhooks to: register',
      'one, change it, give it a new secret, stop sending to it. Every',
      'delivery is a job on the webhooks queue, so what happened to one is',
      "the queue's answer, not this command's: henri jobs:list --queue",
      'webhooks, henri jobs:dead and henri jobs:show <id>. Needs',
      '@usehenri/webhooks and @usehenri/jobs. Without a command it lists.',
    ],
    examples: [
      {
        command:
          "henri webhooks:add https://acme.example/hooks --events 'invoice.*'",
        description: 'Register an endpoint and print its signing secret',
      },
      {
        command: 'henri webhooks:rotate <id> --grace 24h',
        description: 'A new secret, the old one signing for another day',
      },
      {
        command: 'henri webhooks:send <id> invoice.paid --data \'{"total":1}\'',
        description: 'Queue one delivery by hand, to try a receiver',
      },
      {
        command: 'henri jobs:dead --queue webhooks',
        description: 'The deliveries that ran out of attempts',
      },
    ],
    flags: [
      {
        description: 'add, update: what it subscribes to (or `*`)',
        flag: '--events=<a,b>',
      },
      {
        description: 'add, list: the tenant the endpoint belongs to',
        flag: '--owner=<id>',
      },
      {
        description: 'add, update: a header of its own, repeatable',
        flag: "--header='X-Name: value'",
      },
      {
        description: 'add, update: what it is, for the operator',
        flag: '--description=<text>',
      },
      { description: 'update: where the deliveries go', flag: '--url=<url>' },
      {
        description: 'rotate: how long the old secret keeps signing',
        flag: '--grace=<duration>',
      },
      {
        description: 'disable: why, kept on the endpoint',
        flag: '--reason=<text>',
      },
      {
        description: 'send: the JSON payload of the delivery',
        flag: '--data=<json>',
      },
      { description: 'show: print the signing secrets too', flag: '--reveal' },
      { description: 'list: only the disabled endpoints', flag: '--disabled' },
      { description: 'print the result as JSON', flag: '--json' },
    ],
    name: 'webhooks',
    summary: 'the endpoints this application sends signed webhooks to',
    targets: [
      { description: 'the endpoints (--owner, --disabled)', name: 'list' },
      {
        description: 'create the endpoints table (idempotent)',
        name: 'install',
      },
      {
        description: 'the endpoints, and what the queue holds for them',
        name: 'status',
      },
      {
        description: 'register one, and print its signing secret once',
        name: 'add <url> --events <a,b>',
      },
      {
        description: 'one endpoint (--reveal prints its secrets)',
        name: 'show <id>',
      },
      {
        description: 'change the url, the events, the headers',
        name: 'update <id>',
      },
      {
        description: 'a new secret, the old one signing for --grace',
        name: 'rotate <id>',
      },
      { description: 'stop sending to it', name: 'disable <id>' },
      { description: 'send to it again', name: 'enable <id>' },
      { description: 'forget it for good', name: 'remove <id>' },
      {
        description: 'queue one delivery by hand',
        name: 'send <id> [event]',
      },
    ],
    usage: [
      'henri webhooks [command] [options] [--json]',
      'henri webhooks:<command>',
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
