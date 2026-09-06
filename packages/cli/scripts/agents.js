const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');

const { APIS, DEFAULT_ADAPTER, PRESET_DIALECTS } = require('./adapters');
const { expand } = require('./routing');
const {
  DEFAULT_RENDERER,
  RENDERERS,
  readConfig,
  readRoutes,
} = require('./utils');

/**
 * `AGENTS.md`, generated from the application rather than templated.
 *
 * **Why it is generated.** The file a coding agent reads before it writes
 * anything used to be a template with conditionals, which meant two things
 * that got worse as henri grew. A template cannot leave out what an
 * application does not use, so a drizzle application carried Mongoose
 * sentences and an application with no queue carried the queue's; and it
 * described the application `henri new` made, not the one in front of the
 * agent, so it went stale the first time somebody added a store or
 * installed a package. Reading the application answers both: a section that
 * has nothing true to say is not written at all, and running the command
 * again is how the file catches up.
 *
 * **What earns a line.** The file is loaded on every task, so its size is
 * the constraint that makes it good, not an afterthought: the generated
 * region is budgeted at `BUDGET` lines, and a fresh application lands well
 * under it. A line earns its place by being one of three things -- a
 * convention that changes what an agent writes here, a fact about *this*
 * application it cannot get from the framework's documentation, or a
 * command that will actually run here. Everything else is a manual, and a
 * manual belongs where an agent can fetch it when it needs it: the `guide`
 * tool of `henri mcp` serves henri's documentation at the version
 * installed, and `routes`, `models` and `config` answer for the
 * application. Those three fit together deliberately -- this file is the
 * always-loaded part, `henri mcp` is the part fetched on demand, and
 * `henri doctor` is what checks the claims (`agents.missing`,
 * `agents.stale`).
 *
 * **Why regenerating cannot lose a developer's text.** Everything henri
 * writes sits between two markers and nothing else in the file is ever
 * read, let alone rewritten: regeneration replaces the bytes between the
 * markers and copies everything before and after them through untouched.
 * The opening marker carries a digest of what henri last wrote there, so
 * the command can tell its own text from a hand edit inside the region --
 * and when they differ it writes nothing and says so. A file with no
 * markers at all is somebody's own `AGENTS.md`: henri does not touch it
 * either. Both refusals are the ordinary generator `skipped`, and `--force`
 * is the only way past them, which makes the failure mode "your text is
 * kept" rather than "your text was kept unless".
 *
 * **Why a scaffolded application and a regenerated one agree.** They agree
 * because there is one input: the directory. `henri new` writes the
 * configuration, the models, the routes and the sample resource before it
 * calls this, and passes nothing else; `henri generate agents` reads the
 * same files afterwards. There is no path where the two could differ,
 * rather than a convention that they should not.
 */

/** The files that make an application readable by coding agents */
const TEMPLATE_DIR = path.resolve(__dirname, '../template/default');

/**
 * The plain copies. `AGENTS.md` is generated and is not among them.
 */
const FILES = [
  { source: 'CLAUDE.md', target: 'CLAUDE.md' },
  { source: 'mcp.json', target: '.mcp.json' },
];

/** The generated file itself */
const AGENTS = 'AGENTS.md';

/**
 * The format of the generated region. It is in the marker so a file written
 * by another henri is recognised as one this version cannot compare itself
 * with, rather than silently mis-read. Bump it when the *facts* change
 * shape, never for a wording change.
 */
const FORMAT = 1;

/** The marker that opens the generated region (the rest of the line is data) */
const OPEN = '<!-- henri:agents';

/** The marker that closes it */
const CLOSE = '<!-- /henri:agents -->';

/**
 * The size the generated region is held to, in lines. A budget, not a
 * target: a file nobody reads to the end is a file that stops working, and
 * a generated one that grows without bound is the template's problem with a
 * new cause. Every list below is capped so that an application with two
 * hundred models does not spend the budget on an inventory.
 */
const BUDGET = 150;

/** How many entries a generated list prints before it says "and N more" */
const CAP = 12;

/** The henri packages worth naming, and what each one adds to an application */
const KNOWN = {
  '@usehenri/graphql': 'graphql',
  '@usehenri/jobs': 'jobs',
  '@usehenri/redis': 'redis',
  '@usehenri/uploads': 'uploads',
  '@usehenri/webhooks': 'webhooks',
};

/** The model API of each adapter, as an agent would call it */
const MODEL_API = {
  drizzle:
    '`Post.where({ done: false })`, `.order(...)`, `.include(...)`, `Post.findById(id)`, `Post.create(attrs)`, then `row.update(attrs)` and `row.destroy()`. Rows carry `id`.',
  mongoose:
    '`Post.find()`, `Post.findById(id)`, `Post.create(attrs)`, then `doc.set(attrs)`, `doc.save()` and `doc.deleteOne()`. Documents carry `_id`.',
  sequelize:
    '`Post.findAll()`, `Post.findByPk(id)`, `Post.create(attrs)`, then `row.update(attrs)` and `row.destroy()`. Rows carry `id`.',
};

/** What each adapter does about the schema of the database */
const MIGRATIONS = {
  drizzle:
    'Migrations are versioned in `db/migrations`: after a model change run `henri db:generate` and commit what it writes (`henri db:migrate` applies it, `henri db:push` skips the files in development, `henri db:status` says where the database stands).',
  mongoose: 'There are no migrations: MongoDB takes the documents as they are.',
  sequelize:
    'There are no migrations: a development boot runs `sequelize.sync()` and creates the tables that are missing, a production boot changes nothing, and `henri db:status` reports what the database and the models disagree about.',
};

/**
 * A short digest of a string. Twelve hex characters: this tells a hand edit
 * from henri's own text, which is not a place an attacker sits.
 *
 * @param {string} value The text
 * @returns {string} The digest
 */
const digest = (value) =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);

/**
 * A markdown table with its columns padded, so the raw file reads as a
 * table and not as a wall of pipes
 *
 * @param {Array<string>} headers The column headers
 * @param {Array<Array<string>>} rows The rows
 * @returns {string} The table
 */
const table = (headers, rows) => {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;

  return [
    line(headers),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
};

/**
 * A list of names as inline code, capped so one enormous application does
 * not spend the budget on an inventory
 *
 * @param {Array<string>} names The names
 * @param {number} [cap=CAP] How many to print
 * @returns {string} The list, or `none` when there are none
 */
const listed = (names, cap = CAP) => {
  if (names.length === 0) {
    return 'none';
  }

  const shown = names.slice(0, cap).map((name) => `\`${name}\``);

  return names.length > cap
    ? `${shown.join(', ')} and ${names.length - cap} more`
    : shown.join(', ');
};

/**
 * The `{ ... }` that starts at an index, its braces balanced
 *
 * @param {string} source The file source, comments already blanked
 * @param {number} start The index of the opening brace
 * @returns {?string} The body including its braces, or null when it never closes
 */
const balanced = (source, start) => {
  let depth = 0;

  for (let at = start; at < source.length; at++) {
    if (source[at] === '{') {
      depth += 1;
    } else if (source[at] === '}') {
      depth -= 1;

      if (depth === 0) {
        return source.slice(start, at + 1);
      }
    }
  }

  return null;
};

/**
 * The balanced `{ ... }` that follows a key in an object literal
 *
 * The only reader here that henri did not already have: `exportsOf` answers
 * the top level of a file, and the marks that matter (`personal`,
 * `encrypted`, `paranoid`, a `retention` rule) live one level below it, in
 * the schema and in the options. Like every other reader of this command it
 * reads what the file *says*: a schema built at runtime answers nothing,
 * and the section then leaves it out rather than guessing.
 *
 * @param {string} source The file source, comments already blanked
 * @param {string} key The key to open
 * @returns {?string} The body including its braces, or null
 */
const blockOf = (source, key) => {
  const opening = new RegExp(
    `(^|[\\s,{])["']?${key}["']?\\s*:\\s*\\{`,
    'mu'
  ).exec(source);

  return opening
    ? balanced(source, opening.index + opening[0].length - 1)
    : null;
};

/**
 * The top level keys of an object literal body, with the body of each one
 * that is itself an object
 *
 * @param {string} body The body including its braces
 * @returns {Array<{name: string, body: string}>} The entries, in order
 */
const entriesOf = (body) => {
  const inner = body.slice(1, -1);
  const found = [];
  let at = 0;
  let depth = 0;
  let fresh = true;

  while (at < inner.length) {
    const char = inner[at];

    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      at += 1;
      fresh = false;
      continue;
    }

    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      at += 1;
      continue;
    }

    if (char === ',' && depth === 0) {
      fresh = true;
      at += 1;
      continue;
    }

    if (/\s/.test(char)) {
      at += 1;
      continue;
    }

    const key =
      depth === 0 && fresh
        ? /^(?:(['"])([^'"\n]*)\1|([A-Za-z_$][\w$]*))\s*:/.exec(inner.slice(at))
        : null;

    if (!key) {
      fresh = false;
      at += 1;
      continue;
    }

    const name = typeof key[2] === 'string' ? key[2] : key[3];
    const value = at + key[0].length;
    const opens = /^\s*\{/.exec(inner.slice(value));

    found.push({
      body: opens ? balanced(inner, value + opens[0].length - 1) || '' : '',
      name,
    });
    at = value;
    fresh = false;
  }

  return found;
};

/** Is a key set to something other than `false` inside a body? */
const marked = (body, key) =>
  new RegExp(`(^|[\\s,{])["']?${key}["']?\\s*:\\s*(?!false\\b)`, 'mu').test(
    body
  );

/**
 * What one model file says about itself: the store it names and the marks
 * that change how an agent must treat it
 *
 * @param {string} source The model source
 * @param {string} name The model name
 * @returns {object} The model facts
 */
const modelFacts = (source, name) => {
  const { storeOf, uncommented } = require('./doctor');
  const clean = uncommented(source);
  const schema = blockOf(clean, 'schema');
  const options = blockOf(clean, 'options') || '';
  const fields = schema ? entriesOf(schema) : [];

  return {
    encrypted: fields
      .filter((field) => marked(field.body, 'encrypted'))
      .map((field) => field.name),
    name,
    paranoid: marked(options, 'paranoid'),
    personal: fields
      .filter((field) => marked(field.body, 'personal'))
      .map((field) => field.name),
    retention: marked(options, 'retention'),
    store: storeOf(source),
  };
};

/**
 * One line per controller the routes reach, with the actions the router
 * really expands each entry into and the guards it registers.
 *
 * The expansion collapsed rather than printed: seven lines of a `resources`
 * are seven routes and one convention, and `henri routes` prints the table
 * when the table is what is wanted.
 *
 * @param {Array<object>} routes The expanded routes
 * @returns {Array<string>} The lines
 */
const routeLines = (routes) => {
  const byKey = new Map();

  for (const route of routes) {
    const [controller, action] = String(route.controller).split('#');
    const held = byKey.get(controller) || {
      actions: new Set(),
      guards: new Set(),
      prefix: route.route,
      verb: route.verb,
    };

    // Two verbs answering one action (`put` and `patch` on `update`) are one
    // action, and the shortest path is the one an agent reasons from
    held.actions.add(action);
    held.prefix =
      route.route.length < held.prefix.length ? route.route : held.prefix;

    if (route.roles) {
      held.guards.add(`roles ${[].concat(route.roles).join('+')}`);
    }

    if (route.policy) {
      held.guards.add('policy');
    }

    byKey.set(controller, held);
  }

  return [...byKey.entries()].map(([controller, held]) => {
    const guards = [...held.guards];
    const actions = [...held.actions];
    const target =
      actions.length === 1
        ? `\`${held.verb} ${held.prefix}\` -> \`${controller}#${actions[0]}\``
        : `\`${held.prefix}\` -> \`${controller}\` (${actions.join(', ')})`;

    return `- ${target}${guards.length > 0 ? ` -- ${guards.join(', ')}` : ''}`;
  });
};

/**
 * What sits directly under `app/views/pages`: a directory is a resource
 * (`tasks/`) and a file is a page (`index`). One level only -- the point is
 * to say which pages exist, not to print the tree.
 *
 * @param {string} dir The pages directory
 * @returns {Array<string>} The entries, sorted
 */
const pagesOf = (dir) => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) =>
        entry.isDirectory()
          ? `${entry.name}/`
          : entry.name.replace(/\.\w+$/u, '')
      )
      .sort();
  } catch {
    return [];
  }
};

/**
 * Everything the file says, read from the application and from nothing
 * else. One argument, one answer: that is what makes a scaffolded
 * application and a regenerated one agree.
 *
 * Nothing is booted and nothing of the application is `require`d except
 * `config/routes.js`, which the router expands the same way (`henri routes`
 * and `henri doctor` read it through the same module).
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {object} The facts
 */
const describe = (dir = process.cwd()) => {
  const { exportsOf, listModules, mailerActions } = require('./doctor');
  const inside = (...parts) => path.join(dir, ...parts);
  const readFile = (file) => {
    try {
      return fs.readFileSync(inside(file), 'utf8');
    } catch {
      return '';
    }
  };

  let manifest = {};
  let config = {};
  let routes = [];

  try {
    manifest = fs.readJsonSync(inside('package.json'));
  } catch {
    // A directory that is not an application still gets the conventions
  }

  try {
    config = readConfig(dir, undefined) || {};
  } catch {
    // An unreadable configuration: the defaults describe it
  }

  try {
    routes = expand(readRoutes(dir));
  } catch {
    // A routes file that does not load is doctor's problem, not this one
  }

  const declared = {
    ...(manifest.dependencies || {}),
    ...(manifest.devDependencies || {}),
  };
  const stores = Object.entries(config.stores || {}).map(([name, store]) => ({
    adapter: String((store || {}).adapter || DEFAULT_ADAPTER).toLowerCase(),
    dialect: String(
      (store || {}).dialect ||
        PRESET_DIALECTS[String((store || {}).adapter || '').toLowerCase()] ||
        ''
    ),
    name,
  }));
  const primary = stores.find((store) => store.name === 'default') ||
    stores[0] || { adapter: DEFAULT_ADAPTER, dialect: '', name: 'default' };
  const renderer = String(config.renderer || DEFAULT_RENDERER).toLowerCase();
  const models = listModules(inside('app', 'models'))
    .filter((name) => !name.includes('/'))
    .map((name) => modelFacts(readFile(`app/models/${name}.js`), name));
  const user = String(
    (config.user && config.user.model) || config.user || ''
  ).toLowerCase();
  const person = user ? user.charAt(0).toUpperCase() + user.slice(1) : null;

  return {
    adapter: primary.adapter,
    api: APIS[primary.adapter] || 'mongoose',
    controllers: listModules(inside('app', 'controllers')).map((name) => ({
      actions: [...exportsOf(readFile(`app/controllers/${name}.js`)).keys()]
        .filter((action) => action !== 'before' && action !== 'params')
        .sort(),
      name,
    })),
    dialect: primary.dialect,
    factories: listModules(inside('test', 'factories')),
    jobs: listModules(inside('app', 'jobs')),
    mailers: listModules(inside('app', 'mailers')).map((name) => ({
      actions: mailerActions(readFile(`app/mailers/${name}.js`)).sort(),
      name,
    })),
    mcp: Boolean(declared['@usehenri/mcp']),
    models,
    modules: listModules(inside('app', 'modules')),
    name: String(manifest.name || path.basename(path.resolve(dir))),
    packages: Object.keys(KNOWN).filter((name) => declared[name]),
    pages: pagesOf(inside('app', 'views', 'pages')),
    policies: listModules(inside('app', 'policies')),
    renderer: RENDERERS[renderer] ? renderer : DEFAULT_RENDERER,
    routes: { count: routes.length, lines: routeLines(routes) },
    stores,
    user: {
      configured: person,
      model: models.some((model) => model.name.toLowerCase() === user)
        ? models.find((model) => model.name.toLowerCase() === user).name
        : null,
    },
    workers: listModules(inside('app', 'workers')),
  };
};

/**
 * The opening paragraph: what this application is, and where an agent goes
 * for what this file deliberately leaves out
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const intro = (facts) => {
  const store = facts.dialect
    ? `\`${facts.adapter}\` (${facts.dialect})`
    : `\`${facts.adapter}\``;
  const more = facts.mcp
    ? "\n\nWhen you need more than this file, ask the `henri` MCP server that `.mcp.json` starts: `guide` is henri's documentation at the version installed here, `routes`, `models`, `config` and `openapi` answer for this application, and `errors`, `logs` and `request` answer for the running one. Read those rather than recalling henri."
    : '';

  return `# ${facts.name}: conventions for coding agents

A [henri](https://usehenri.io) application: Rails-like MVC for Node.js, CommonJS on the server, renderer \`${facts.renderer}\`, store ${store}. Everything here is read from this application by \`henri generate agents\`, so it says what is in front of you rather than what henri can do, and \`henri doctor\` reports it when the two drift apart. Keep the \`/** @type ... */\` line the generators write above \`module.exports\`: \`jsconfig.json\` points at the types every package ships, so \`req\`, \`res\` and \`henri\` complete instead of being guessed.${more}`;
};

/**
 * Where a new file goes, and what is already there. One row per place, so
 * the inventory costs no lines of its own.
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const layout = (facts) => {
  const ext = facts.renderer === 'inertia' ? 'jsx' : 'js';
  const engine = facts.renderer === 'inertia' ? 'Inertia' : 'next.js';
  const rows = [
    [
      '`app/models/`',
      `One model per file, singular PascalCase, autoloaded and exposed as a global. Here: ${listed(facts.models.map((model) => model.name))}.`,
    ],
    [
      '`app/controllers/`',
      `A plain object of \`async (req, res)\` actions, lowercase and plural. Here: ${listed(facts.controllers.map((controller) => controller.name))}.`,
    ],
    [
      '`app/policies/`',
      `One file per model, lowercase and singular: who may act on one record. Here: ${listed(facts.policies)}.`,
    ],
    [
      '`app/views/pages/`',
      `${engine} pages (\`.${ext}\`); \`pages/posts/index.${ext}\` answers \`/posts\`. Components in \`app/views/components/\`, the one stylesheet in \`app/views/styles/index.css\`. Here: ${listed(facts.pages)}.`,
    ],
    [
      '`config/routes.js`',
      `The routes, expanded at boot (below). Here: ${facts.routes.count} route${facts.routes.count === 1 ? '' : 's'}.`,
    ],
    [
      '`config/default.json`',
      'The committed configuration; `config/<NODE_ENV>.json` replaces it as a whole, not key by key. Secrets go in `.env` (`HENRI_SECRET`), never here.',
    ],
    [
      '`test/`',
      `Vitest files (\`*.test.js\`) run by \`henri test\`. Factories here: ${listed(facts.factories)}.`,
    ],
  ];

  if (facts.packages.includes('@usehenri/jobs') || facts.jobs.length > 0) {
    rows.push([
      '`app/jobs/`',
      `\`{ queue, maxAttempts, timeout, perform(args, context) }\`, performed by \`henri jobs\`. Here: ${listed(facts.jobs)}.`,
    ]);
  }

  if (facts.mailers.length > 0) {
    rows.push([
      '`app/mailers/`',
      `Every export is an action returning the message to send; the views are \`app/views/mailers/\`. Here: ${listed(facts.mailers.map((mailer) => mailer.name))}.`,
    ]);
  }

  if (facts.workers.length > 0) {
    rows.push([
      '`app/workers/`',
      `\`{ name, start(henri), stop(henri) }\`, long-lived processes started with the server. Here: ${listed(facts.workers)}.`,
    ]);
  }

  if (facts.modules.length > 0) {
    rows.push([
      '`app/modules/`',
      `Framework modules of this application, reached as \`henri.<name>\`. Here: ${listed(facts.modules)}.`,
    ]);
  }

  return `## Where things go\n\n${table(['Path', 'What goes there, and what is there now'], rows)}`;
};

/**
 * The generators, which is how a file of this application gets written
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const generators = (facts) => {
  const lines = [
    'henri generate scaffold Post title:string! body:text  # model + controller + routes + pages',
    'henri generate model Post title:string!               # app/models/Post.js only',
    'henri generate controller reports index monthly       # controller + one GET route per action',
    'henri generate crud Item name:string                  # model + JSON controller + crud routes',
    'henri generate policy Post authorId                   # app/policies/post.js + its test',
  ];

  if (facts.packages.includes('@usehenri/jobs')) {
    lines.push(
      'henri generate job welcome                            # app/jobs/welcome.js'
    );
  }

  if (!facts.user.model) {
    lines.push(
      'henri generate authentication                         # sign-up, sign-in, reset, confirm'
    );
  }

  lines.push(
    'henri generate test posts | mailer welcome | worker cleanup',
    'henri destroy scaffold Post                           # undo any of them'
  );

  return `## Generate, do not hand-write

\`\`\`bash
${lines.join('\n')}
\`\`\`

Types are \`string, text, number, integer, float, decimal, bigint, boolean, date, json, uuid\`, and a trailing \`!\` makes the field required. \`Post\` gives \`posts\` (\`Category\` -> \`categories\`, \`Person\` -> \`people\`). An existing file is skipped unless \`--force\`; \`--json\` prints the files written or removed and the routes added. The generators rewrite \`config/routes.js\` through prettier, so comments in that file are lost. Regenerate this file with \`henri generate agents\` whenever the application changes shape.`;
};

/**
 * The model contract: the API of the store this application uses, and the
 * marks its own models carry
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const modelSection = (facts) => {
  const marks = [];

  for (const model of facts.models) {
    const held = [];

    if (model.personal.length > 0) {
      held.push(`personal: ${listed(model.personal, 6)}`);
    }

    if (model.encrypted.length > 0) {
      held.push(`encrypted: ${listed(model.encrypted, 6)}`);
    }

    if (model.paranoid) {
      held.push('paranoid (soft deletes)');
    }

    if (model.retention) {
      held.push('a retention rule');
    }

    if (held.length > 0) {
      marks.push(`\`${model.name}\` carries ${held.join(', ')}`);
    }
  }

  const carried =
    marks.length === 0
      ? ''
      : `\n\nMarks this application already made: ${marks.join('; ')}. Keep them when you edit those models: \`personal\` is what henri masks in the logs, hands to \`henri privacy:export\` and removes in \`henri privacy:erase\`; \`encrypted\` is ciphertext in the column and the plain string on the model; a \`retention\` rule is swept by \`henri retention:sweep\`.`;

  return `## Models (\`${facts.api}\`)

${MODEL_API[facts.api]} ${MIGRATIONS[facts.api]}

A field is \`{ type, required, default, enum, unique, index }\` and anything else is handed to the adapter as is. Every model gets \`createdAt\`/\`updatedAt\`, \`paginate({ page, perPage })\` answering \`{ records, page, perPage, total, pages }\`, and \`externalId\` -- a uuid, and the only identifier that leaves the server: routes, links and payloads carry it and \`findById()\` takes it, while the numeric key stays inside. \`henri.model.errors(error)\` turns a validation failure into \`{ field: message }\`.${carried}`;
};

/**
 * The controller contract
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const controllerSection = (facts) => {
  const reference = facts.controllers.find(
    (controller) =>
      controller.name !== 'main' && controller.actions.includes('index')
  );

  return `## Controllers

- An action that returns without answering renders its own page with what it returned: \`show: async (req) => ({ post: req.post })\` renders \`/posts/show\`, and \`index\` renders \`/posts\`.
- \`before: { all: [...], 'show,edit,update,destroy': loadPost }\` runs hooks ahead of those actions, and one that answers ends the request. \`params: { create: { title: { type: 'string', required: true, maxLength: 120 } } }\` declares what an action accepts and answers 422 when it does not match. Those two exports are never actions.
- \`req.permit('title', 'body')\` picks the allowed fields out of the query, the body and the params (with no field it answers the whole \`params\` declaration). Never hand \`req.body\` to a model.
- \`res.negotiate({ html, json })\` answers the page or the JSON; \`res.resource(post)\` and \`res.collection(posts, req.pagination())\` answer HAL with the links the roles and the policies allow. \`res.boom.notFound()\`, \`badData\` (422), \`unauthorized\`, \`forbidden\` and \`conflict\` answer the error envelope.
- \`req.flash('notice', 'Saved')\` before a redirect, \`req.user\` for the signed-in user, and \`henri.pen.info|warn|error('scope', ...)\` to log -- never \`console.log\`.${
    reference
      ? `\n- \`app/controllers/${reference.name}.js\` is the worked example in this application: follow it.`
      : ''
  }`;
};

/**
 * The routes of this application and the DSL that produced them
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const routeSection = (facts) => {
  const lines = facts.routes.lines.slice(0, CAP);
  const rest = facts.routes.lines.length - lines.length;
  const listing =
    facts.routes.lines.length === 0
      ? '_No routes yet._'
      : [...lines, rest > 0 ? `- and ${rest} more (\`henri routes\`)` : null]
          .filter(Boolean)
          .join('\n');

  return `## Routes

${listing}

A key is \`'<verb> /path'\` (the verb defaults to \`get\`), \`root\`, \`resources|crud <name>\` or \`namespace <name>\`; a value is \`'controller#action'\` or \`{ controller, roles, policy, scope, only, except, member, collection, nested }\`. \`roles\` gates the endpoint for a signed-in user holding every one of them (401/403 as JSON, a redirect to \`/login\` for a browser) and \`policy: true\` adds the record check. \`henri routes --json\` prints the table with the helper names (\`show_posts_path\`); views link with \`getRoute()\` and \`pathFor()\`, never a hard-coded path.`;
};

/**
 * The view contract of this application's renderer, and nothing about the
 * other one
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const viewSection = (facts) => {
  const body =
    facts.renderer === 'inertia'
      ? "Pages are `.jsx` components bundled by Vite and swapped by Inertia without a document reload: `res.render('/posts')` resolves `pages/posts/index.jsx` and `res.render('/posts/show')` resolves `pages/posts/show.jsx`. `useHenri()` from `@usehenri/inertia` gives `data`, `user`, `paths`, `errors`, `flash`, `csrf`, `getRoute`, `pathFor`, `fetch` and `hydrate`; `Form` (POST by default, the CSRF field injected, children a render prop taking `{ errors, processing }`), `Link`, `Head`, `router`, `usePage` and `useForm` come from the same package. A form submits, the controller redirects, and the client renders the page it lands on; to refuse a write, `res.inertia.errors({ field: 'msg' })` and render the page again."
      : 'Pages are next.js pages (the pages router; the app router is not supported) exported through `withHenri` from `@usehenri/react`. They receive `data`, `user`, `paths`, `errors`, `flash`, `csrf`, `getRoute`, `pathFor`, `fetch`, `hydrate` and `router`, and a nested component reads the same values with `useHenri()`. Forms come from `@usehenri/react/forms` and show the 422 a controller answers with, field by field. `app/views/next.config.js` is generated: extend next.js from `config/next.js` instead.';

  return `## Views (\`${facts.renderer}\`)

${body}

Styling is Tailwind CSS v4 and \`app/views/styles/index.css\` is the whole stylesheet: utility classes in the pages, no CSS module and no second file, no \`tailwind.config.js\` (v4 has none -- the theme is \`@theme\` in that file). Dark mode is the \`dark:\` variant and follows the system, so a colour class wants its counterpart, and Tailwind only reads the \`@source\` globs of \`index.css\`.`;
};

/**
 * Record-level authorization. Written whether or not the application has a
 * policy yet: an empty `app/policies` is exactly when the ownership `if`
 * gets written in a controller instead.
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const policySection = (facts) => `## Policies

\`roles\` on a route says who may reach it; \`app/policies/<model>.js\` says who may act on one record -- one exported function per action, \`(user, record) => boolean\`. Ask with \`req.can('update', post)\` or \`await req.authorize('update', post)\`, and put \`policy: true\` on the route so henri asks too. It fails closed: no policy, no rule, a rule that threw and anything but the boolean \`true\` are all no, and a rule that declares a record is never asked without one, so \`index\`/\`new\`/\`create\` are answered at the route. A refusal is a 404, and \`paths\` and \`_links\` lose what it refuses, so a page never offers a button the request would deny. ${
  facts.policies.length === 0
    ? 'This application has no policy yet: write ownership checks here with `henri generate policy <Model> <ownerColumn>`, never as an `if` in a controller.'
    : `Here: ${listed(facts.policies)}.`
}`;

/**
 * The test contract
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const testSection = (facts) => `## Tests

\`henri test\` runs Vitest with henri booted under \`NODE_ENV=test\`: \`henri\` and the models are globals, and \`request()\` and \`agent()\` from \`@usehenri/testing\` are bound to the server. Records come from \`test/factories/<name>.js\` (\`{ attributes, traits, model, after }\`, a value being a literal or a function of \`{ attrs, build, create, sequence, traits, uid }\`): \`create('post', 'published', { title })\` saves one and makes what it references, \`build()\` answers the attributes and \`createList()\` several. Whatever the test asserts on goes in the call, everything else in the factory.${
  facts.factories.length === 0
    ? ' There is no factory yet; `henri generate test <controller>` writes the skeleton of a test.'
    : ''
}`;

/**
 * The sections a package earns by being installed. An application without
 * the package gets none of them, which is the whole point of generating
 * this file.
 *
 * @param {object} facts What describe() read
 * @returns {Array<string>} The sections
 */
const packageSections = (facts) => {
  const sections = [];
  const has = (name) => facts.packages.includes(name);

  if (has('@usehenri/jobs')) {
    sections.push(`## Jobs (\`@usehenri/jobs\`)

Work that must not block a request goes in \`app/jobs\`, never in a worker: \`henri.jobs.perform('welcome', { userId })\` (\`performIn('5m', ...)\`, \`performAt(date, ...)\`) writes one row and returns, and a \`henri jobs\` process performs it, retries it with a backoff and, out of attempts, keeps it in the dead letter queue (\`henri jobs:status|dead|retry\`). Arguments must survive JSON, so pass identifiers and never a model instance; the queue is at-least-once, so a job has to be idempotent. Recurring work is \`jobs.recurring\` in the configuration, never a \`setInterval\` in a worker. Here: ${listed(facts.jobs)}.`);
  }

  if (has('@usehenri/uploads')) {
    sections.push(`## Uploads (\`@usehenri/uploads\`)

\`req.files\`, \`req.file(field)\` and \`req.permitFiles(...fields)\` -- \`req.permit()\` for files, which unlinks what the controller did not list. A file's type comes from its bytes, not from its \`Content-Type\` or its extension, and the bounds are \`config.uploads\`. Nothing is kept unless the controller calls \`store()\`, which answers the record a model holds (\`{ key, name, type, size, checksum, storage, uploadedAt }\`); \`henri.uploads.send(res, record)\` hands the file back.`);
  }

  if (has('@usehenri/webhooks')) {
    sections.push(`## Webhooks (\`@usehenri/webhooks\`)

\`henri.webhooks.emit(event, data, { owner })\` writes one queue row per subscribed endpoint and returns; the endpoints are managed with \`henri webhooks:*\`, not with a model of your own. Deliveries are jobs, so \`henri jobs:list --queue webhooks\`, \`jobs:dead\` and \`jobs:show\` are what say whether one arrived. Signatures follow Standard Webhooks and henri signs them: do not roll one.`);
  }

  if (has('@usehenri/graphql')) {
    sections.push(`## GraphQL (\`@usehenri/graphql\`)

A model's \`graphql\` key holds its types and resolvers; they are merged into one schema and served at \`config.graphql\`. \`res.render(view, { graphql })\` runs a query for a page. Nothing else in the application talks to Apollo directly.`);
  }

  return sections;
};

/**
 * Users and the account flows, when the application has a person model or
 * has asked for one
 *
 * @param {object} facts What describe() read
 * @returns {?string} Markdown, or null
 */
const userSection = (facts) => {
  if (!facts.user.configured) {
    return null;
  }

  if (!facts.user.model) {
    return `## Users

This application asks for a person (\`config.user\`) and \`app/models/${facts.user.configured}.js\` is not there yet. \`henri generate authentication\` writes the model, the pages, the controller, the mailer and the tests around the endpoints henri mounts itself -- do not hand-write a session, a password hash or a reset token.`;
  }

  return `## Users

\`app/models/${facts.user.model}.js\` is the person of this application: the store adds \`email\` (unique), \`password\` (hashed, never selected) and \`roles\`, and henri mounts \`POST /login\`, \`POST /logout\`, the session, the double-submit CSRF token and \`req.user\`. \`roles\` is stripped from mass assignment: \`user.setRoles()\`. Views and JSON only ever see \`publicUser()\` (\`{ id, email, roles }\` plus \`config.user.public\`). The secret is \`HENRI_SECRET\` in \`.env\`, never a \`config/*.json\`.`;
};

/**
 * The commands that will actually run in this application
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const commandSection = (facts) => {
  const rows = [
    ['`henri doctor [--json]`', 'The conventions check; run it after a change'],
    [
      '`henri audit [--json]`',
      'The security check (`--checks` says what it looks for)',
    ],
    ['`henri routes --json`', 'The expanded routes, helpers and guards'],
    ['`henri test [files]`', "The tests (exits with vitest's code)"],
    [
      '`henri generate\\|destroy ... --json`',
      'The files written or removed, and the routes',
    ],
  ];

  if (facts.api === 'drizzle') {
    rows.push([
      '`henri db:generate\\|migrate\\|push\\|status`',
      'The migrations of `db/migrations`',
    ]);
  }

  if (facts.api === 'sequelize') {
    rows.push([
      '`henri db:status [--sql]`',
      'What the database and the models disagree about',
    ]);
  }

  if (facts.packages.includes('@usehenri/jobs')) {
    rows.push([
      '`henri jobs [--once] [--queue=]`',
      'Perform the queue (`jobs:status`, `jobs:dead`, `jobs:retry`)',
    ]);
  }

  if (facts.models.some((model) => model.personal.length > 0)) {
    rows.push([
      '`henri privacy[:export\\|:erase]`',
      'The personal data map, and what is held about one person',
    ]);
  }

  if (facts.models.some((model) => model.encrypted.length > 0)) {
    rows.push([
      '`henri encryption:rotate`',
      'Re-encrypt the rows under a new key',
    ]);
  }

  if (facts.models.some((model) => model.retention)) {
    rows.push([
      '`henri retention[:sweep]`',
      'The retention rules, and one run of them',
    ]);
  }

  rows.push([
    '`henri server`, `build`, `console`',
    'Dev server with hot reload, production views, a REPL',
  ]);
  rows.push(['`eslint .`', 'The linter (the model globals are declared)']);

  return `## Commands

${table(['Command', 'Result'], rows)}

With \`--json\` a failure prints \`{ "error": { command, message, hint, code, exitCode } }\` on stderr; the exit codes are 0 ok, 1 failed, 2 usage, 3 not a henri application, 4 needs a terminal.`;
};

/**
 * The mistakes worth naming, and the ones this application can actually
 * make
 *
 * @param {object} facts What describe() read
 * @returns {string} Markdown
 */
const dontSection = (facts) => {
  const missing = Object.entries(KNOWN)
    .filter(([name]) => !facts.packages.includes(name))
    .map(([, what]) => what);
  const driver = {
    drizzle: '`drizzle-orm` or the database driver',
    mongoose: '`mongoose` or the MongoDB driver',
    sequelize: '`sequelize` or the database driver',
  }[facts.api];
  const lines = [
    `- Do not \`require\` a model or \`henri\`: they are globals. Do not reach for ${driver} directly -- go through the model.`,
    '- Do not put a secret in `config/*.json`, and do not commit `.env`, `.henri/` or `.backup/`.',
    '- Do not set `roles` from request data, do not mass-assign `req.body`, and do not write an ownership `if` in a controller: that is what `app/policies` and `req.can()` are for, and the views and the links then get the same answer.',
    '- Do not add `tailwind.config.js`, a CSS module or a second stylesheet: the theme is `@theme` in `app/views/styles/index.css`.',
    facts.renderer === 'inertia'
      ? "- Keep the `resolvePage` resolver and `import.meta.glob('./pages/**/*.jsx')` in `app/views/main.jsx` and `ssr.jsx`; do not rename a generated file by hand (regenerate with `--force`, or `destroy` first)."
      : '- Do not edit `app/views/next.config.js`; do not rename a generated file by hand (regenerate with `--force`, or `destroy` first).',
    '- Do not leave `henri server` running in a non-interactive session: verify with `henri test`, `henri doctor` and `henri audit`.',
    '- Do not add a protection henri already applies (the helmet headers, the CSRF token, the session cookie flags, password hashing, the rate limits): `henri audit --checks` says what is there.',
  ];

  if (missing.length > 0) {
    lines.push(
      `- Do not import what this application does not have: no ${missing.join(', ')}. Install the package and regenerate this file before writing against one.`
    );
  }

  return `## Do not\n\n${lines.join('\n')}`;
};

/**
 * The generated region, without its markers
 *
 * @param {object|string} [options=process.cwd()] The application directory,
 *   or the facts describe() read
 * @returns {string} Markdown
 */
const renderAgents = (options = process.cwd()) => {
  const facts = typeof options === 'string' ? describe(options) : options;

  return [
    intro(facts),
    layout(facts),
    generators(facts),
    modelSection(facts),
    controllerSection(facts),
    routeSection(facts),
    viewSection(facts),
    policySection(facts),
    userSection(facts),
    testSection(facts),
    ...packageSections(facts),
    commandSection(facts),
    dontSection(facts),
  ]
    .filter(Boolean)
    .join('\n\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
};

/**
 * The marker line that opens a region, carrying the format, a digest of the
 * facts (which is what `henri doctor` compares to tell a stale file from a
 * current one) and a digest of the body (which is what tells henri's own
 * text from a hand edit inside the region)
 *
 * @param {object} facts What describe() read
 * @param {string} body The region
 * @returns {string} The line
 */
const openMarker = (facts, body) =>
  `${OPEN} ${FORMAT} app=${digest(JSON.stringify(facts))} gen=${digest(body)} -->`;

/**
 * Read a marker line back
 *
 * @param {string} line The line
 * @returns {?{app: string, format: number, gen: string}} What it says
 */
const readMarker = (line) => {
  const match =
    /^<!-- henri:agents (\d+) app=([0-9a-f]+) gen=([0-9a-f]+) -->/.exec(line);

  return match
    ? { app: match[2], format: Number(match[1]), gen: match[3] }
    : null;
};

/** The notice inside the region, and the one below it on a fresh file */
const NOTICE =
  '<!-- Generated by `henri generate agents` from this application. Everything\n     between these markers is rewritten; write your own notes outside them. -->';

/** What a freshly written file says under the region */
const FOOTER =
  '<!-- Below the marker is yours: `henri generate agents` never reads or\n     rewrites it. Run it again whenever the application changes shape. -->';

/**
 * The whole generated region, markers included
 *
 * @param {object} facts What describe() read
 * @returns {string} The region
 */
const region = (facts) => {
  const body = `${NOTICE}\n\n${renderAgents(facts)}`;

  return `${openMarker(facts, body)}\n${body}\n${CLOSE}`;
};

/**
 * Put a freshly generated region into whatever `AGENTS.md` already is,
 * without ever rewriting a byte henri did not write.
 *
 * @param {?string} existing The current file, or null when there is none
 * @param {object} facts What describe() read
 * @param {boolean} force Overwrite what would otherwise be kept
 * @returns {{action: string, content: ?string, reason: ?string}} What to do
 */
const merge = (existing, facts, force) => {
  const built = region(facts);

  if (existing === null) {
    return {
      action: 'created',
      content: `${built}\n\n${FOOTER}\n`,
      reason: null,
    };
  }

  const start = existing.indexOf(OPEN);
  const end = existing.indexOf(CLOSE);

  if (start === -1 || end === -1 || end < start) {
    if (!force) {
      return {
        action: 'skipped',
        content: null,
        reason:
          "it has no generated section, so it is somebody's own AGENTS.md and nothing here was written by henri",
      };
    }

    return {
      action: 'updated',
      content: `${built}\n\n${FOOTER}\n`,
      reason: null,
    };
  }

  const before = existing.slice(0, start);
  const after = existing.slice(end + CLOSE.length);
  const lineEnd = existing.indexOf('\n', start);
  const marker = readMarker(
    existing.slice(start, lineEnd === -1 ? end : lineEnd)
  );
  const body = existing.slice(
    lineEnd === -1 ? start : lineEnd + 1,
    end > 0 && existing[end - 1] === '\n' ? end - 1 : end
  );

  if (!force && (!marker || marker.gen !== digest(body))) {
    return {
      action: 'skipped',
      content: null,
      reason:
        'the generated section was edited by hand, and rewriting it would throw that away',
    };
  }

  return {
    action: 'updated',
    content: `${before}${built}${after}`,
    reason: null,
  };
};

/**
 * Write AGENTS.md, CLAUDE.md and .mcp.json in an application directory.
 *
 * The directory is the only input: `henri new` calls this once the
 * application is on disk and `henri generate agents` calls it later, so the
 * two cannot disagree.
 *
 * @param {string} dir The application directory
 * @param {object} [options] Options
 * @param {boolean} [options.force=false] Overwrite what would be kept
 * @returns {{created: Array<string>, updated: Array<string>, skipped: Array<object>}} What was written
 */
const writeAgentFiles = (dir, { force = false } = {}) => {
  const done = { created: [], skipped: [], updated: [] };
  const location = path.join(dir, AGENTS);
  const existing = fs.existsSync(location)
    ? fs.readFileSync(location, 'utf8')
    : null;
  const { action, content, reason } = merge(existing, describe(dir), force);

  if (content === null) {
    done.skipped.push({ file: AGENTS, reason });
  } else {
    fs.outputFileSync(location, content);
    done[action].push(AGENTS);
  }

  for (const { source, target } of FILES) {
    const where = path.join(dir, target);

    if (fs.existsSync(where) && !force) {
      done.skipped.push({ file: target, reason: 'it exists' });
      continue;
    }

    fs.outputFileSync(
      where,
      fs.readFileSync(path.join(TEMPLATE_DIR, source), 'utf8')
    );
    done.created.push(target);
  }

  return done;
};

/**
 * What the generated region of a file claims the application was, for
 * `henri doctor` to compare with what it is now
 *
 * @param {string} source The AGENTS.md content
 * @returns {?{app: string, format: number, gen: string}} The claim, or null
 */
const markerOf = (source) => {
  const start = source.indexOf(OPEN);

  if (start === -1) {
    return null;
  }

  const lineEnd = source.indexOf('\n', start);

  return readMarker(source.slice(start, lineEnd === -1 ? undefined : lineEnd));
};

/**
 * The digest of what an application is now, in the format a marker carries
 *
 * @param {string} dir The application directory
 * @returns {{app: string, format: number}} The digest and its format
 */
const fingerprint = (dir) => ({
  app: digest(JSON.stringify(describe(dir))),
  format: FORMAT,
});

module.exports = {
  AGENTS,
  BUDGET,
  FILES,
  FORMAT,
  describe,
  fingerprint,
  markerOf,
  merge,
  region,
  renderAgents,
  writeAgentFiles,
};
