const fs = require('fs-extra');
const path = require('path');
const util = require('util');
const handlebars = require('handlebars');

const { apiOf } = require('./adapters');
const { CliError } = require('./errors');
const { usage } = require('./help');
const Report = require('./report');
const {
  DEFAULT_RENDERER,
  format,
  names,
  readRoutes,
  rendererOf,
  validInstall,
} = require('./utils');

/**
 * The attribute types of the henri model format. Adapters map them to
 * their own types (mongoose: integer -> Number, json -> Mixed, ...).
 *
 * `decimal` and `bigint` are the two whose value a JavaScript number
 * cannot carry, so they are exact decimal strings on every adapter; a
 * generated `decimal` gets `precision` and `scale` written into the model
 * file, because the default (19, 4) is rarely what money wants.
 */
const TYPES = [
  'string',
  'text',
  'number',
  'integer',
  'float',
  'decimal',
  'bigint',
  'boolean',
  'date',
  'json',
  'uuid',
];

/** What `price:decimal` writes: money, which is what people mean by one */
const DECIMAL_SETTINGS = { precision: 12, scale: 2 };

const VIEWS = ['index', '_form', 'new', 'edit', 'show'];

/** The extension of a page, per renderer */
const PAGE_EXTENSIONS = { inertia: 'jsx', react: 'js' };

/**
 * Generators that take no name
 */
const NAMELESS = ['agents', 'authentication'];

/**
 * Initial function
 *
 * @param {*} args command line arguments
 * @return {Promise<void>} Resolves when done
 * @throws {CliError} USAGE for an unknown generator or a missing name
 */
const main = async (args) => {
  const [cmd, target, ...rest] = args._;
  const report = new Report({ command: 'generate', json: args.json === true });
  const opts = { force: args.force === true, report };

  if (!cmd) {
    console.log(usage('generate'));

    return;
  }

  const generator = generators[cmd];

  if (!generator) {
    throw new CliError('USAGE', `Unknown generator "${cmd}"`, {
      hint: `Available: ${Object.keys(generators).join(', ')}`,
    });
  }

  if (!target && !NAMELESS.includes(cmd)) {
    throw new CliError('USAGE', `Missing name: henri generate ${cmd} <name>`, {
      hint: 'henri generate --help',
    });
  }

  validInstall({ fatal: true });

  report.target = cmd;
  report.name = target || null;

  await generator(target, rest, opts);

  report.print();
};

/**
 * Parse `name:type!` attributes into a schema
 *
 * @param {string[]} [attributes=[]] Attributes as typed on the command line
 * @returns {object} The schema ({ name: { type, required } })
 * @throws {CliError} USAGE on an unknown type
 */
const parseAttributes = (attributes = []) => {
  const schema = {};

  for (const attribute of attributes) {
    let [name, rawType = 'string'] = attribute.split(':');
    let required = false;

    if (name.endsWith('!')) {
      required = true;
      name = name.slice(0, -1);
    }

    if (rawType.endsWith('!')) {
      required = true;
      rawType = rawType.slice(0, -1);
    }

    const type = rawType.toLowerCase() || 'string';

    if (!name) {
      throw new CliError(
        'USAGE',
        `Invalid attribute "${attribute}": expected name:type`,
        { hint: 'ex: title:string! body:text' }
      );
    }

    if (!TYPES.includes(type)) {
      throw new CliError(
        'USAGE',
        `Unknown type "${type}" for attribute "${name}". Valid types: ${TYPES.join(', ')}`,
        { hint: 'ex: title:string! body:text' }
      );
    }

    // A decimal with no settings is 19 digits with 4 after the point,
    // which is not what somebody who typed `price:decimal` meant
    const settings = type === 'decimal' ? DECIMAL_SETTINGS : {};

    schema[name] = required
      ? { required: true, ...settings, type }
      : { ...settings, type };
  }

  return schema;
};

/**
 * Handle models
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const model = async (name, attributes = [], opts = {}) => {
  const { doc } = names(name);
  const schema = parseAttributes(attributes);

  const code = `
// Models are autoloaded from app/models and exposed globally (here: \`${doc}\`).
// Types: ${TYPES.join(', ')}.
// Keys: type, required, default, enum, unique, index (anything else is
// handed to the adapter as is).

/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { timestamps: true },
  schema: ${util.inspect(schema, { depth: 6 })},
  store: 'default', // a store name from config/default.json
};
`;

  return output('model', 'app/models', `${doc}.js`, code, opts);
};

/**
 * Generates a controller and one route per action
 *
 * @param {string} name Controller name (ex: locations)
 * @param {string[]} actions Actions (ex: index show)
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const controller = async (name, actions = [], opts = {}) => {
  const lower = name.toLowerCase();
  const methods = actions.map(
    (action) => `
  ${action}: async (req, res) => {
    res.boom.notImplemented('${lower}#${action} is not implemented yet');
  },`
  );
  const code = `// Actions are \`(req, res)\`; one that returns without answering renders
// app/views/pages/${lower}/<action> with what it returned. Add a \`before\`
// block ({ all: [...], 'show,edit': [...] }) to run hooks ahead of them.
module.exports = {${methods.join('\n')}\n};`;

  const written = await output(
    'controller',
    'app/controllers',
    `${lower}.js`,
    code,
    opts
  );

  if (written && actions.length > 0) {
    await addRoutes(
      Object.fromEntries(
        actions.map((action) => [
          `get /${lower}/${action}`,
          `${lower}#${action}`,
        ])
      ),
      opts
    );
  }

  return written;
};

/**
 * Generates a worker (app/workers) with start and stop
 *
 * @param {string} name Worker name
 * @param {string[]} rest Unused
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const worker = async (name, rest = [], opts = {}) => {
  const lower = name.toLowerCase();
  const code = `
// Workers start with the server and stop with it (skip them with
// --skip-workers). Both functions receive the running henri instance.
let timer = null;

module.exports = {
  name: '${lower}',

  start: async (henri) => {
    henri.pen.info('${lower}', 'started');
    // timer = setInterval(() => henri.pen.info('${lower}', 'tick'), 60000);
  },

  stop: async (henri) => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    henri.pen.info('${lower}', 'stopped');
  },
};
`;

  return output('worker', 'app/workers', `${lower}.js`, code, opts);
};

/**
 * Generates a mailer (app/mailers), its views and the mail layout
 *
 * @param {string} name Mailer name (ex: welcome)
 * @param {string[]} actions Actions (ex: confirm reset)
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when the mailer was written
 */
const mailer = async (name, actions = [], opts = {}) => {
  const lower = name.toLowerCase();
  const templates = require('./generate/mailers');
  const list =
    actions.length > 0 ? actions.map((one) => one.toLowerCase()) : ['notify'];

  const written = await output(
    'mailer',
    'app/mailers',
    `${lower}.js`,
    templates.mailer({ actions: list, name: lower }),
    opts
  );

  for (const action of list) {
    await output(
      'view',
      `app/views/mailers/${lower}`,
      `${action}.hbs`,
      templates.view({ action, name: lower }),
      { ...opts, raw: true }
    );
  }

  // The layout is shared by every mailer: only written when missing
  await output(
    'view',
    'app/views/mailers/layouts',
    'mailer.hbs',
    templates.layout(),
    { ...opts, force: false, raw: true }
  );
  await output(
    'view',
    'app/views/mailers/layouts',
    'mailer.text.hbs',
    templates.textLayout(),
    { ...opts, force: false, raw: true }
  );

  return written;
};

/**
 * Turns the account flows on in every `config/*.json` that does not already
 * mention them, and answers the files it changed
 *
 * @param {object} [opts] { report }
 * @returns {Array<string>} The relative paths of the files that changed
 */
const enableAccounts = (opts = {}) => {
  const report = opts.report || new Report();
  const dir = path.join(process.cwd(), 'config');
  const changed = [];
  let files;

  try {
    files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
  } catch {
    return changed;
  }

  for (const file of files) {
    const location = path.join(dir, file);
    const config = fs.readJsonSync(location);
    // `user` is either the model name or its settings; both get the blocks
    const user =
      typeof config.user === 'string'
        ? { model: config.user }
        : Object.assign({ model: 'user' }, config.user);
    const missing = ['confirmation', 'passwordReset', 'signup'].filter(
      (key) => typeof user[key] === 'undefined'
    );

    if (missing.length === 0) {
      continue;
    }

    for (const key of missing) {
      user[key] = key === 'signup' ? { fields: ['name'] } : true;
    }

    config.user = user;
    fs.writeJsonSync(location, config, { spaces: 2 });

    const relative = path.join('config', file);

    changed.push(relative);
    report.add('updated', relative);
    report.log(`> turned the account flows on @ ${relative}`);
  }

  return changed;
};

/**
 * Generates the account flows: the pages of registration, password reset,
 * address confirmation and the identity providers of the account, the
 * controller rendering them, the mailer and its views, a user model when
 * there is none, and the tests.
 *
 * The endpoints are henri's own (`config.user.signup`, `passwordReset` and
 * `confirmation`), which this turns on; nothing written here reimplements a
 * token, a hash or a session.
 *
 * @param {string} [name] Unused (there is only one set of these)
 * @param {string[]} [rest] Unused
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when something was written
 */
const authentication = async (name, rest = [], opts = {}) => {
  const templates = require('./generate/authentication');
  const cwd = process.cwd();
  // The same fork the resource generator takes: the renderer of the
  // application, and the page extension that goes with it
  const renderer = rendererOf(cwd);
  const extension = PAGE_EXTENSIONS[renderer];
  const actions = ['confirm', 'connections', 'forgot', 'login', 'new', 'reset'];
  let written = false;

  enableAccounts(opts);

  // A user model is what the flows write to; only written when missing
  await output('model', 'app/models', 'User.js', templates.model(), {
    ...opts,
    force: false,
  });

  written =
    (await output(
      'controller',
      'app/controllers',
      'accounts.js',
      templates.controller(),
      opts
    )) || written;

  for (const action of actions) {
    await output(
      'view',
      'app/views/pages/accounts',
      `${action}.${extension}`,
      templates.view({ action, renderer }),
      opts
    );
  }

  await output('mailer', 'app/mailers', 'auth.js', templates.mailer(), opts);

  for (const [action, body] of Object.entries(templates.MAIL_VIEWS)) {
    await output('view', 'app/views/mailers/auth', `${action}.hbs`, body, {
      ...opts,
      raw: true,
    });
  }

  await output(
    'test',
    'test',
    'authentication.test.js',
    templates.test(),
    opts
  );

  await addRoutes(
    {
      'get /account/connections': 'accounts#connections',
      'get /confirm': 'accounts#confirm',
      'get /login': 'accounts#login',
      'get /password/forgot': 'accounts#forgot',
      'get /password/reset': 'accounts#reset',
      'get /signup': 'accounts#new',
    },
    opts
  );

  return written;
};

/**
 * Generates a job (app/jobs) with perform and a retry policy
 *
 * @param {string} name Job name
 * @param {string[]} rest Unused
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const job = async (name, rest = [], opts = {}) => {
  const lower = name.toLowerCase();
  const code = `
// Jobs run outside the request, in a \`henri jobs\` worker process. Enqueue
// one with \`henri.jobs.perform('${lower}', args)\`, later with
// \`henri.jobs.performIn('5m', '${lower}', args)\`.
//
// The queue is a package of its own: \`npm install @usehenri/jobs\` once, and
// \`henri.jobs\` is there (\`henri doctor\` says so when it is not).
//
// \`args\` is stored as JSON: strings, numbers, booleans, null, plain objects
// and arrays only. Pass an id, never a model instance.
/** @type {import('@usehenri/core').JobDefinition} */
module.exports = {
  // The queue a runner picks this job up from
  queue: 'default',

  // Attempts before the job goes to the dead letter queue (henri jobs:dead)
  maxAttempts: 5,

  // How long one attempt may take; the job is failed when it runs over
  timeout: '5m',

  perform: async (args, { henri, job, signal }) => {
    henri.pen.info('${lower}', job.id, \`attempt \${job.attempt}\`);
    // Throw to fail the attempt: it is retried with an exponential backoff.
  },
};
`;

  return output('job', 'app/jobs', `${lower}.js`, code, opts);
};

/**
 * Generates a policy and its test.
 *
 * `henri generate policy Proposal` writes `app/policies/proposal.js` with
 * the seven actions of a resource stubbed on an ownership check, and
 * `test/proposal-policy.test.js` proving the three refusals that matter:
 * somebody else's record, an anonymous visitor and an action nobody wrote a
 * rule for. The column the ownership is read from defaults to `userId`:
 *
 *     henri generate policy Proposal speakerId
 *
 * @param {string} name Policy name (the model it is about, ex: Proposal)
 * @param {string[]} rest The ownership column, when it is not `userId`
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when the policy was written
 */
const policy = async (name, rest = [], opts = {}) => {
  const { doc, lower, plural } = names(name);
  const templates = require('./generate/policies');
  const owner = rest[0] || 'userId';
  const written = await output(
    'policy',
    'app/policies',
    `${lower}.js`,
    templates.policy({ doc, name: lower, owner }),
    opts
  );

  await output(
    'test',
    'test',
    `${lower}-policy.test.js`,
    templates.test({ name: lower, owner }),
    opts
  );

  // A policy nothing asks decides nothing, and that is the one mistake this
  // feature exists to stop, so the last line of the generator says so
  if (written) {
    (opts.report || new Report()).log(
      `> add "policy": true to the ${plural} routes of config/routes.js, or call req.authorize(action, record) in the controller`
    );
  }

  return written;
};

/**
 * The `resources`/`crud` route of a name in config/routes.js, if any
 *
 * @param {string} lower The resource name (ex: tasks)
 * @returns {?{scope: string, kind: string}} The route options or null
 */
const resourceRoute = (lower) => {
  const routes = readRoutes(process.cwd());

  for (const kind of ['resources', 'crud']) {
    const entry = routes[`${kind} ${lower}`] || routes[`${kind} /${lower}`];

    if (entry) {
      return typeof entry === 'string'
        ? { kind, scope: '' }
        : { ...entry, kind };
    }
  }

  return null;
};

/**
 * Generates a test file using @usehenri/testing. When config/routes.js has
 * a `resources`/`crud` entry for the name, the test checks the HAL answers
 * (`_links.self`, `_embedded`), and a `resources` route of an Inertia
 * application also gets the page object its browser renders.
 *
 * @param {string} name Test name (ex: tasks, the path it requests)
 * @param {string[]} rest Unused
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const test = async (name, rest = [], opts = {}) => {
  const lower = name.toLowerCase();
  const templates = require('./generate/tests');
  const route = resourceRoute(lower);
  const scope =
    route && route.scope ? `/${route.scope}`.replace(/\/+/g, '/') : '';
  // A `crud` route answers JSON only: there is no page to ask for
  const pages =
    route &&
    route.kind === 'resources' &&
    rendererOf(process.cwd()) === 'inertia';
  const resourceTest = pages ? templates.inertiaResource : templates.resource;
  const code = route
    ? resourceTest({ lower, path: `${scope}/${lower}` })
    : templates.plain({ lower });

  return output('test', 'test', `${lower}.test.js`, code, opts);
};

/**
 * Writes AGENTS.md, CLAUDE.md and .mcp.json (the files coding agents read)
 * in an existing application.
 *
 * AGENTS.md is generated from the application, not copied from a template,
 * and only the region between its markers is ever rewritten: text a
 * developer added around it comes through untouched, and a file henri did
 * not write -- or one whose generated region was edited by hand -- is
 * skipped with the reason rather than replaced (`--force` is the way past
 * that, and it is the only one).
 *
 * @param {string} [name] Unused (the application name comes from package.json)
 * @param {string[]} [rest] Unused
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when at least one file was written
 */
const agents = async (name, rest = [], opts = {}) => {
  const { writeAgentFiles } = require('./agents');
  const report = opts.report || new Report();
  const { created, skipped, updated } = writeAgentFiles(process.cwd(), {
    force: opts.force === true,
  });

  for (const file of created) {
    report.add('created', file);
    report.log(`> created ${file}`);
  }

  for (const file of updated) {
    report.add('updated', file);
    report.log(`> updated ${file} (the generated section only)`);
  }

  for (const { file, reason } of skipped) {
    report.add('skipped', file);
    report.log(`> skipped ${file}: ${reason} (use --force to overwrite)`);
  }

  return created.length + updated.length > 0;
};

/**
 * Scaffold builder: model, resources controller, routes and views
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force, report }
 * @return {Promise<void>} Resolves when done
 */
const scaffold = async (name, attributes = [], opts = {}) => {
  await model(name, attributes, opts);
  await resources(name, attributes, opts);
};

/**
 * The resources of a scaffold without the model: controller, routes, views
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force, report }
 * @return {Promise<void>} Resolves when done
 */
const resources = async (name, attributes = [], opts = {}) => {
  const resource = {
    ...names(name),
    api: apiOf(process.cwd()),
    keys: extractKeys(attributes),
    renderer: rendererOf(process.cwd()),
  };
  const generator = require('./generate/controllers');

  await output(
    'controller',
    'app/controllers',
    `${resource.plural}.js`,
    generator.resources(resource),
    opts
  );
  await addRoutes({ [`resources ${resource.plural}`]: resource.plural }, opts);
  await views(resource, opts);
};

/**
 * Build the crud: model, json controller and routes
 *
 * @param {string} name Model name (singular, ex: Post)
 * @param {string[]} attributes Attributes (name:type!)
 * @param {object} [opts] { force, report }
 * @return {Promise<void>} Resolves when done
 */
const crud = async (name, attributes = [], opts = {}) => {
  const resource = {
    ...names(name),
    api: apiOf(process.cwd()),
    keys: extractKeys(attributes),
    renderer: rendererOf(process.cwd()),
  };
  const generator = require('./generate/controllers');

  await model(name, attributes, opts);
  await output(
    'controller',
    'app/controllers',
    `${resource.plural}.js`,
    generator.crud(resource),
    opts
  );
  await addRoutes({ [`crud ${resource.plural}`]: resource.plural }, opts);
};

/**
 * Handle views processing
 *
 * @param {object} resource { doc, lower, plural, keys, renderer }
 * @param {object} [opts] { force, report }
 * @returns {Promise<void>} Resolves when written
 */
const views = async (resource, opts = {}) => {
  for (const view of VIEWS) {
    await compileView({ ...resource, view }, opts);
  }
};

/**
 * Extract the attribute names from name:type arguments
 *
 * @param {string[]} [args=[]] arguments
 * @return {Array<string>} Results
 */
const extractKeys = (args = []) =>
  args.map((val) => val.split(':')[0].replace(/!$/, ''));

/**
 * Compile one view template into app/views/pages/<plural>/<view>, a `.jsx`
 * page for the Inertia renderer and a `.js` one for the Next.js renderer
 *
 * @param {object} resource { doc, lower, plural, keys, view, renderer }
 * @param {object} [opts] { force, report }
 * @return {Promise<boolean>} True when written
 */
const compileView = async (
  {
    doc,
    lower,
    plural,
    keys = [],
    view = 'index',
    renderer = DEFAULT_RENDERER,
  },
  opts = {}
) => {
  const data = fs.readFileSync(
    path.join(__dirname, `./generate/${renderer}-${view}.hbs`),
    'utf8'
  );
  const template = handlebars.compile(data.toString());

  return output(
    'view',
    `app/views/pages/${plural}`,
    `${view}.${PAGE_EXTENSIONS[renderer]}`,
    template({ doc, keys, lower, plural }),
    opts
  );
};

/**
 * Add routes to config/routes.js (existing keys are overwritten)
 *
 * @param {object} entries { 'verb /path': 'controller#action', ... }
 * @param {object} [opts] { report }
 * @return {Promise<void>} Resolves when written
 */
const addRoutes = async (entries, opts = {}) => {
  const report = opts.report || new Report();
  const location = path.join(process.cwd(), 'config', 'routes.js');
  const actual = Object.assign(readRoutes(process.cwd()), entries);

  fs.outputFileSync(
    location,
    await format(
      `/** @type {import('@usehenri/core').RoutesFile} */\nmodule.exports = ${util.inspect(
        actual,
        { depth: 6 }
      )};`
    )
  );

  for (const key of Object.keys(entries)) {
    report.add('routes.added', key);
    report.log(`> added route "${key}" @ config/routes.js`);
  }
};

/**
 * Outputs code into a file, unless it exists (see --force)
 *
 * @param {string} type Type of output (model, controller, ...)
 * @param {string} dir Target directory, relative to the project
 * @param {string} file Target file name
 * @param {string} code The code that should be written in the file
 * @param {object} [opts] { force, report, raw }
 * @return {Promise<boolean>} True when the file was written
 */
const output = async (type, dir, file, code, opts = {}) => {
  const { force = false, raw = false } = opts;
  const report = opts.report || new Report();
  const relative = path.join(dir, file);
  const location = path.join(process.cwd(), relative);

  if (fs.existsSync(location) && !force) {
    report.add('skipped', relative);
    report.log(
      `> skipped ${type} "${file}": ${relative} exists (use --force to overwrite)`
    );

    return false;
  }

  fs.outputFileSync(location, raw ? code : await format(code));
  report.add('created', relative);
  report.log(`> created ${type} "${file}" @ ${relative}`);

  return true;
};

const generators = {
  agents,
  authentication,
  controller,
  crud,
  job,
  mailer,
  model,
  policy,
  scaffold,
  test,
  worker,
};

module.exports = main;
module.exports.TYPES = TYPES;
module.exports.generators = generators;
module.exports.parseAttributes = parseAttributes;
module.exports.resources = resources;
