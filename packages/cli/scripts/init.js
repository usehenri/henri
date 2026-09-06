const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');

const adapters = require('./adapters');
const { writeAgentFiles } = require('./agents');
const { CliError } = require('./errors');
const { format, insideGit, packageManagerChoice, version } = require('./utils');

/**
 * Template files written by writeAgentFiles (with the placeholders filled)
 * instead of the plain copy
 */
const AGENT_FILES = ['AGENTS.md', 'CLAUDE.md', 'mcp.json'];

/**
 * Checks if a file exists
 *
 * @param {string} file A file to check in cwd
 * @returns {boolean} result
 */
const check = (file) => fs.existsSync(path.join(process.cwd(), file));

// --- renderer selection (@usehenri/inertia) --------------------------------
// `henri new <app> --renderer inertia` scaffolds from template/inertia and
// writes "renderer": "inertia"; the default stays template/default (react).
const RENDERERS = { inertia: 'inertia', react: 'default' };
let renderer = 'react';

/**
 * Pick the renderer (and its template) from the CLI arguments
 *
 * @param {object} args CLI arguments
 * @returns {string} the renderer
 */
const selectRenderer = (args) => {
  const wanted = String(args.renderer || args.r || 'react').toLowerCase();

  if (!RENDERERS[wanted]) {
    throw new CliError('USAGE', `Unknown renderer '${wanted}'`, {
      hint: `Valid values: ${Object.keys(RENDERERS).join(', ')}`,
    });
  }

  renderer = wanted;

  return renderer;
};

/**
 * Template directory of the selected renderer
 *
 * @returns {string} absolute path
 */
const templateDir = () =>
  path.resolve(__dirname, '../template', RENDERERS[renderer]);
// --- end renderer selection -------------------------------------------------

// --- store selection --------------------------------------------------------
// `henri new <app> --adapter drizzle --dialect postgres` writes the store of
// that adapter in config/default.json, depends on its package and driver and
// generates the sample resource against its model API. The default stays the
// zero-config `disk` adapter (see scripts/adapters.js).
let adapter = adapters.DEFAULT_ADAPTER;
let dialect = adapters.DEFAULT_DIALECT;

/**
 * Pick the store adapter (and its dialect) from the CLI arguments
 *
 * @param {object} args CLI arguments
 * @returns {string} the adapter
 */
const selectAdapter = (args) => {
  ({ adapter, dialect } = adapters.select(args));

  return adapter;
};
// --- end store selection ----------------------------------------------------

/**
 * Initialize a new install in the current directory
 *
 * @param {object} args CLI arguments
 * @param {string} [name] Project name, when called from `new`
 * @returns {Promise<void>} Resolves when done
 */
const main = async (args, name) => {
  const cwd = process.cwd();
  const force = args.force === true;
  const skipInstall = args['skip-install'] === true;
  const skipGit = args.git === false;
  const projectName = slug(name) || slug(path.basename(cwd)) || 'henri-app';

  selectRenderer(args);
  selectAdapter(args);

  const store = adapters.describe({ adapter, dialect, name: projectName });

  console.log('');

  if (check('app') && !force) {
    throw new CliError(
      'EXISTS',
      "It looks like you already have an 'app' folder",
      { hint: 'Use --force or -f to copy the new structure anyway' }
    );
  }

  const { pm, source } = packageManagerChoice(cwd, args.pm);

  console.log(` - Using ${pm} (${source})`);

  copyTemplate();
  buildPackage(projectName, store);
  generateConfig(store);
  allowBuilds(store);
  await portSample(store);

  // The react template gets its Task sample from the scaffold generator;
  // the other templates ship their own sample pages.
  if (renderer === 'react') {
    await sampleResource(force);
  }

  createReadme(projectName, pm, store);
  createAgentFiles(projectName, force);
  initGit(skipGit);

  if (!skipInstall) {
    installPackages(pm);
  }

  console.log(`
    Your new project is ready to run!

    You can start coding right away with:

    # cd ${name || '.'}${skipInstall ? ` && ${pm} install` : ''} && henri server
${storeNotice(store)}
    Coding agents: AGENTS.md holds the conventions of the app (CLAUDE.md
    points to it) and .mcp.json starts the henri MCP server (henri mcp).
    Check the app anytime with: henri doctor
  `);

  !skipInstall && console.log(`    (dependencies were installed with ${pm})\n`);
};

/**
 * Writes AGENTS.md (the conventions for coding agents, with the name and
 * the renderer filled in), CLAUDE.md and .mcp.json
 *
 * @param {string} name Project name
 * @param {boolean} force Overwrite existing files
 * @returns {void}
 */
const createAgentFiles = (name, force) => {
  console.log(
    ' - Writing AGENTS.md, CLAUDE.md and .mcp.json for coding agents...'
  );

  const { skipped } = writeAgentFiles(process.cwd(), {
    adapter,
    force,
    name,
    renderer,
  });

  for (const file of skipped) {
    console.log(`   (${file} exists, kept)`);
  }
};

/**
 * Sorts the keys of a dependency map
 *
 * @param {object} [deps={}] Dependencies
 * @returns {object} The same entries, sorted by name
 */
const sorted = (deps = {}) =>
  Object.fromEntries(
    Object.entries(deps).sort(([left], [right]) => left.localeCompare(right))
  );

/**
 * Creates or completes the package.json file.
 * Runs after the template copy so template dependencies are merged with
 * anything that already existed in the folder.
 *
 * @param {string} name Project name
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {void}
 */
const buildPackage = (name, store) => {
  const cwd = process.cwd();
  let existing = {};

  const templatePkg = fs.readJsonSync(path.join(templateDir(), 'package.json'));

  try {
    existing = fs.readJsonSync(path.join(cwd, 'package.old.json'));
  } catch {
    // Nothing existed before the template copy
  }

  console.log(' - Building new package file...');

  // The template's @usehenri/* ranges are placeholders: a generated app
  // depends on the same version as the CLI that created it.
  const withCliVersion = (deps = {}) =>
    Object.fromEntries(
      Object.entries(deps).map(([dep, range]) => [
        dep,
        dep.startsWith('@usehenri/') ? `^${version}` : range,
      ])
    );

  // The templates depend on the default adapter: swap it for the selected
  // one and add the driver it needs (drizzle keeps its drivers optional).
  const dependencies = withCliVersion(templatePkg.dependencies);

  delete dependencies[adapters.PACKAGES[adapters.DEFAULT_ADAPTER]];
  dependencies[store.package] = `^${version}`;
  Object.assign(dependencies, store.drivers);

  const pkg = {
    ...templatePkg,
    ...existing,
    dependencies: sorted({
      ...dependencies,
      ...(existing.dependencies || {}),
    }),
    devDependencies: sorted({
      ...withCliVersion(templatePkg.devDependencies),
      ...(existing.devDependencies || {}),
    }),
    henri: version,
    name: existing.name || name,
    scripts: {
      ...templatePkg.scripts,
      ...(existing.scripts || {}),
    },
  };

  fs.writeJsonSync(path.join(cwd, 'package.json'), pkg, { spaces: 2 });
  fs.removeSync(path.join(cwd, 'package.old.json'));
};

/**
 * Writes the application README (an existing one is kept as README.old.md)
 *
 * @param {string} name Project name
 * @param {string} pm Package manager
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {void}
 */
const createReadme = (name, pm, store) => {
  const cwd = process.cwd();

  console.log(' - Adding new readme file...');

  if (check('README.md')) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }

  fs.writeFileSync(path.join(cwd, 'README.md'), readme(name, pm, store));
};

/**
 * The README content
 *
 * @param {string} name Project name
 * @param {string} pm Package manager
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {string} Markdown
 */
const readme = (name, pm, store) => {
  const react = renderer === 'react';
  const sample = react
    ? `The home page lists the sample \`Task\` resource; add tasks at \`/tasks\`.
It is a regular scaffold (\`app/models/Task.js\`, \`app/controllers/tasks.js\`,
\`app/views/pages/tasks/\`, the \`resources tasks\` key of \`config/routes.js\`
and \`test/tasks.test.js\`): edit it, or remove it with
\`henri destroy scaffold Task\`.`
    : `The home page links to the sample tasks page (\`app/models/Tasks.js\`,
\`app/controllers/tasks.js\`, \`app/views/pages/tasks/index.jsx\` and the
\`/tasks\` keys of \`config/routes.js\`): edit it, or remove those files.`;
  const generators = react
    ? `henri generate scaffold Post title:string! body:text
henri generate model|controller|worker|test <name>
henri destroy scaffold Post   # undo a generator`
    : `henri generate model|controller|worker|test <name>
henri destroy model Post      # undo a generator`;
  const pages = react
    ? 'React pages rendered by next.js                  '
    : 'Inertia (React) pages, built by vite            ';
  const migrations =
    store.adapter === 'drizzle'
      ? `
The \`drizzle\` store has migrations (drizzle-kit, \`db/migrations\`):

\`\`\`bash
henri db:status                        # applied and pending migrations
henri db:generate --name=add-priority  # write a migration from the models
henri db:migrate                       # apply the pending migrations
henri db:push                          # match the database to the models
\`\`\`
`
      : '';
  const styles = react
    ? `To drop Tailwind, replace the content of that file with your own CSS
and remove \`tailwindcss\`, \`@tailwindcss/postcss\` and
\`app/views/postcss.config.mjs\`.`
    : `To drop Tailwind, replace the content of that file with your own CSS
and remove \`tailwindcss\`, \`@tailwindcss/vite\` and the plugin it adds in
\`app/views/vite.config.mjs\`.`;
  const database = store.store.url
    ? `The default store is \`${store.adapter}\`${store.dialect ? ` (\`${store.dialect}\`)` : ''} at
\`${store.store.url}\`${store.test ? `, and \`${store.test.url}\` under \`NODE_ENV=test\`` : ''}. Change it in \`config/default.json\`.`
    : `The default store is \`${store.adapter}\`: a local MongoDB started with the
application, no server to install. Change it in \`config/default.json\`.`;

  return `# ${name}

A [henri](https://usehenri.io) application: models, controllers, routes and
server-side rendered React views, Rails style.

## Getting started

\`\`\`bash
${pm} install
henri server          # development server with hot reload
\`\`\`

${sample}

## Commands

\`\`\`bash
henri server                  # start (--production for the production build)
henri console                 # REPL with henri and the models loaded
henri routes                  # the routes table from config/routes.js
${generators}
henri test                    # run test/**/*.test.js
henri build                   # build the production views
henri doctor                  # check the app against the henri conventions
${pm} run lint                # eslint
\`\`\`
${migrations}
## Layout

| Path                   | Role                                             |
| ---------------------- | ------------------------------------------------ |
| \`app/models\`           | Models, autoloaded and exposed as globals        |
| \`app/controllers\`      | Controllers (\`name#action\` in the routes)         |
| \`app/views/pages\`      | ${pages}|
| \`app/views/components\` | Shared components (\`import x from 'components/x'\`) |
| \`app/views/styles\`     | Tailwind CSS v4: \`index.css\` is the stylesheet     |
| \`app/jobs\`             | Background jobs (\`henri jobs\`, needs \`@usehenri/jobs\`) |
| \`app/workers\`          | Long-lived processes started with the server     |
| \`app/helpers\`          | Server-side helpers                              |
| \`config/routes.js\`     | Routes                                           |
| \`config/default.json\`  | Configuration (stores, renderer, user model)     |
| \`test\`                 | Tests, run by \`henri test\`                       |

## Styles

The pages are styled with [Tailwind CSS](https://tailwindcss.com) v4.
\`app/views/styles/index.css\` is the whole stylesheet: the theme goes in its
\`@theme\` block, and dark mode follows the operating system through the
\`dark:\` variant. ${styles}

## Configuration

\`config/default.json\` is committed. \`config/<NODE_ENV>.json\` replaces it as a
whole for an environment (\`config/local.json\` is ignored by git). Secrets do not belong
in these files: the session and token secret is \`HENRI_SECRET\` in \`.env\`,
which is not committed. Add a \`User\` model to get password hashing, sessions
and roles.

${database}

See the [documentation](https://usehenri.io) for models, routes, views,
GraphQL, mail, background jobs and workers.
`;
};

/**
 * Copies the template from @usehenri/cli/template
 *
 * @returns {void}
 */
const copyTemplate = () => {
  const cwd = process.cwd();

  console.log(' - Copying new directory structure...');

  const templatePath = templateDir();

  // Keep an existing package.json aside so buildPackage can merge it
  if (check('package.json')) {
    fs.moveSync(
      path.join(cwd, 'package.json'),
      path.join(cwd, 'package.old.json'),
      { overwrite: true }
    );
  }

  // The pnpm-workspace.yaml file is written whatever the package manager:
  // npm and yarn ignore it, and its absence is what breaks a pnpm install
  // (ERR_PNPM_IGNORED_BUILDS on the dependencies that need a build script).
  fs.copySync(templatePath, cwd, {
    filter: (src) => {
      const base = path.basename(src);

      return base !== '.gitignore' && !AGENT_FILES.includes(base);
    },
  });
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true,
  });
};

/**
 * Generate the configuration: config/default.json (committed, no secret),
 * config/test.json when the store needs a database of its own, and .env
 * (ignored) with the secret
 *
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {void}
 */
const generateConfig = (store) => {
  const cwd = process.cwd();
  const files = store.test
    ? 'config/default.json, config/test.json'
    : 'config/default.json';

  console.log(` - Generating ${files} and .env...`);

  const configuration = {
    baseRole: 'guest',
    renderer,
    stores: {
      default: store.store,
    },
    user: 'user',
  };

  fs.writeJsonSync(path.join(cwd, 'config', 'default.json'), configuration, {
    spaces: 2,
  });

  // The config/<NODE_ENV>.json file replaces default.json as a whole, so
  // `henri test` gets the same configuration on its own database.
  if (store.test) {
    fs.writeJsonSync(
      path.join(cwd, 'config', 'test.json'),
      { ...configuration, stores: { default: store.test } },
      { spaces: 2 }
    );
  }

  const secret = require('crypto').randomBytes(64).toString('hex');

  fs.writeFileSync(
    path.join(cwd, '.env'),
    `# Secrets and machine specific settings, not committed (see .gitignore).
# HENRI_SECRET signs the sessions and the JWT tokens once you add a User model.
HENRI_SECRET=${secret}
`
  );
};

/**
 * Adds the dependency build scripts the driver of the store needs to
 * pnpm-workspace.yaml (better-sqlite3 compiles a native addon).
 *
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {void}
 */
const allowBuilds = (store) => {
  const file = path.join(process.cwd(), 'pnpm-workspace.yaml');

  const entries = Object.entries(store.builds);

  if (entries.length === 0 || !fs.existsSync(file)) {
    return;
  }

  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const start = lines.findIndex((line) => line.trim() === 'allowBuilds:');

  if (start < 0) {
    return;
  }

  for (const [name, allowed] of entries) {
    if (lines.some((line) => line.trim().startsWith(`${name}:`))) {
      continue;
    }

    let at = start + 1;

    while (
      at < lines.length &&
      lines[at].startsWith('  ') &&
      lines[at].trim() < name
    ) {
      at += 1;
    }

    lines.splice(at, 0, `  ${name}: ${allowed}`);
  }

  console.log(
    ` - Allowing the ${Object.keys(store.builds).join(', ')} build in pnpm-workspace.yaml...`
  );
  fs.writeFileSync(file, lines.join('\n'));
};

/**
 * Ports the sample controllers the templates ship (written for the mongoose
 * API) to the model API of the selected store. The react template gets its
 * sample from the scaffold generator, which is adapter aware on its own.
 *
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {Promise<void>} Resolves when written
 */
const portSample = async (store) => {
  if (store.api === 'mongoose') {
    return;
  }

  const cwd = process.cwd();
  const controllers = require('./generate/controllers');
  const home = path.join(cwd, 'app', 'controllers', 'main.js');

  console.log(
    ` - Porting the sample controllers to the ${store.adapter} store...`
  );

  if (store.api === 'sequelize' && fs.existsSync(home)) {
    fs.writeFileSync(
      home,
      fs.readFileSync(home, 'utf8').replace('Task.find()', 'Task.findAll()')
    );
  }

  if (renderer === 'inertia') {
    fs.writeFileSync(
      path.join(cwd, 'app', 'controllers', 'tasks.js'),
      await format(
        controllers.inertia({
          api: store.api,
          doc: 'Task',
          lower: 'task',
          plural: 'tasks',
        })
      )
    );
  }
};

/**
 * What to know about the store before the first `henri server`: where the
 * database is expected, and how to migrate it when it has migrations
 *
 * @param {object} store The selected store (see scripts/adapters.js)
 * @returns {string} A paragraph for the closing message, or an empty string
 */
const storeNotice = (store) => {
  const url = store.store.url || '';
  const server =
    store.adapter !== 'disk' && url !== '' && !url.startsWith('file:')
      ? `
    The "${store.adapter}" store expects a database at ${url}
    (config/default.json${store.test ? ', config/test.json for henri test' : ''}). Create it, then start the server.
`
      : '';
  const migrations =
    store.adapter === 'drizzle'
      ? `
    Development pushes the schema on boot. For production, write the first
    migration and apply it: henri db:generate --name=init && henri db:migrate
    (henri db:status lists them, henri db:push skips the migration files).
`
      : '';

  return `${server}${migrations}`;
};

/**
 * The sample Task resource: model, controller, routes, views and a test
 *
 * @param {boolean} force Overwrite existing files
 * @returns {Promise<void>} Resolves when written
 */
const sampleResource = async (force) => {
  const generate = require('./generate');
  const attributes = ['name:string!', 'category:string', 'done:boolean'];
  const location = path.join(process.cwd(), 'app', 'models', 'Task.js');

  console.log(' - Scaffolding the sample Task resource...');

  if (force || !fs.existsSync(location)) {
    fs.outputFileSync(
      location,
      await format(`
// Models are autoloaded from app/models and exposed globally (here: \`Task\`).
// Types: string, text, number, integer, float, boolean, date, json, uuid.
// Keys: type, required, default, enum, unique (anything else is handed to
// the adapter as is).

/** @type {import('@usehenri/core').ModelFile} */
module.exports = {
  options: { timestamps: true },
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      enum: ['urgent', 'high', 'medium', 'low'],
      default: 'low',
    },
    done: { type: 'boolean', default: false },
  },
  store: 'default', // a store name from config/default.json
};
`)
    );
  }

  await generate.resources('Task', attributes, { force });
  await generate.generators.test('tasks', [], { force });
};

/**
 * Run `git init` unless asked not to or already inside a repository
 *
 * @param {boolean} skip --no-git
 * @returns {boolean} True when a repository was created
 */
const initGit = (skip) => {
  const cwd = process.cwd();

  if (skip) {
    return false;
  }

  if (insideGit(cwd)) {
    console.log(' - Already inside a git repository, skipping git init');

    return false;
  }

  const result = spawn.sync('git', ['init', '-q'], { cwd, stdio: 'ignore' });

  if (result.error || result.status !== 0) {
    console.log(' - git is not available, skipping git init');

    return false;
  }

  console.log(' - Initialized a git repository');

  return true;
};

/**
 * Installs packages with pnpm, yarn or npm
 *
 * @param {string} pm The package manager
 * @returns {boolean} True when the install succeeded
 */
const installPackages = (pm) => {
  console.log(` - Installing packages using ${pm}...`);

  const result = spawn.sync(pm, ['install'], { stdio: 'inherit' });

  if (result.status !== 0) {
    console.log(
      `
      ${pm} install failed. Fix the error above then run "${pm} install" again.
    `
    );

    return false;
  }

  return true;
};

/**
 * Turns a folder name into a package name
 *
 * @param {string} [name] Folder name
 * @returns {string|null} A safe package name
 */
const slug = (name) =>
  name
    ? path
        .basename(name)
        .toLowerCase()
        .replace(/[^a-z0-9-_.]+/g, '-')
        .replace(/^[-_.]+|[-_.]+$/g, '') || null
    : null;

module.exports = main;
