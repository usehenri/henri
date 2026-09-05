/* eslint-disable no-console */
const spawn = require('cross-spawn');
const fs = require('fs-extra');
const path = require('path');

const { detectPackageManager, format, insideGit, version } = require('./utils');

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
    console.log(
      `
      Unknown renderer '${wanted}'. Valid values: ${Object.keys(RENDERERS).join(', ')}
    `
    );
    process.exit(-1);
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

  console.log('');

  if (check('app') && !force) {
    console.log(
      `
      It looks like you already have an 'app' folder. Use --force or -f to
      copy the new structure...
    `
    );
    process.exit(1);
  }

  const pm = detectPackageManager(cwd);

  copyTemplate(pm);
  buildPackage(projectName);
  generateConfig();
  await sampleResource(force);
  createReadme(projectName, pm);
  initGit(skipGit);

  if (!skipInstall) {
    installPackages(pm);
  }

  console.log(`
    Your new project is ready to run!

    You can start coding right away with:

    # cd ${name || '.'}${skipInstall ? ` && ${pm} install` : ''} && henri server
  `);

  !skipInstall && console.log(`    (dependencies were installed with ${pm})\n`);
};

/**
 * Creates or completes the package.json file.
 * Runs after the template copy so template dependencies are merged with
 * anything that already existed in the folder.
 *
 * @param {string} name Project name
 * @returns {void}
 */
const buildPackage = (name) => {
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

  const pkg = {
    ...templatePkg,
    ...existing,
    dependencies: {
      ...withCliVersion(templatePkg.dependencies),
      ...(existing.dependencies || {}),
    },
    devDependencies: {
      ...withCliVersion(templatePkg.devDependencies),
      ...(existing.devDependencies || {}),
    },
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
 * @returns {void}
 */
const createReadme = (name, pm) => {
  const cwd = process.cwd();

  console.log(' - Adding new readme file...');

  if (check('README.md')) {
    fs.renameSync(path.join(cwd, 'README.md'), path.join(cwd, 'README.old.md'));
  }

  fs.writeFileSync(path.join(cwd, 'README.md'), readme(name, pm));
};

/**
 * The README content
 *
 * @param {string} name Project name
 * @param {string} pm Package manager
 * @returns {string} Markdown
 */
const readme = (name, pm) => `# ${name}

A [henri](https://usehenri.io) application: models, controllers, routes and
server-side rendered React views, Rails style.

## Getting started

\`\`\`bash
${pm} install
henri server          # development server with hot reload
\`\`\`

The home page lists the sample \`Task\` resource; add tasks at \`/tasks\`.
It is a regular scaffold (\`app/models/Task.js\`, \`app/controllers/tasks.js\`,
\`app/views/pages/tasks/\`, the \`resources tasks\` key of \`config/routes.js\`
and \`test/tasks.test.js\`): edit it, or remove it with
\`henri destroy scaffold Task\`.

## Commands

\`\`\`bash
henri server                  # start (--production for the production build)
henri console                 # REPL with henri and the models loaded
henri routes                  # the routes table from config/routes.js
henri generate scaffold Post title:string! body:text
henri generate model|controller|worker|test <name>
henri destroy scaffold Post   # undo a generator
henri test                    # run test/**/*.test.js
henri build                   # build the production views
${pm} run lint                # eslint
\`\`\`

## Layout

| Path                   | Role                                             |
| ---------------------- | ------------------------------------------------ |
| \`app/models\`           | Models, autoloaded and exposed as globals        |
| \`app/controllers\`      | Controllers (\`name#action\` in the routes)         |
| \`app/views/pages\`      | React pages rendered by next.js                  |
| \`app/views/components\` | Shared components (\`import x from 'components/x'\`) |
| \`app/workers\`          | Background workers started with the server       |
| \`app/helpers\`          | Server-side helpers                              |
| \`config/routes.js\`     | Routes                                           |
| \`config/default.json\`  | Configuration (stores, renderer, user model)     |
| \`test\`                 | Tests, run by \`henri test\`                       |

## Configuration

\`config/default.json\` is committed. \`config/<NODE_ENV>.json\` overrides it for
an environment (\`config/local.json\` is ignored by git). Secrets do not belong
in these files: the session and token secret is \`HENRI_SECRET\` in \`.env\`,
which is not committed. Add a \`User\` model to get password hashing, sessions
and roles.

See the [documentation](https://usehenri.io) for models, routes, views,
GraphQL, mail and workers.
`;

/**
 * Copies the template from @usehenri/cli/template
 *
 * @param {string} pm Package manager (pnpm-workspace.yaml is pnpm only)
 * @returns {void}
 */
const copyTemplate = (pm) => {
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

  fs.copySync(templatePath, cwd, {
    filter: (src) => {
      const base = path.basename(src);

      if (base === '.gitignore') {
        return false;
      }

      return base !== 'pnpm-workspace.yaml' || pm === 'pnpm';
    },
  });
  fs.moveSync(path.resolve(cwd, 'gitignore'), path.resolve(cwd, '.gitignore'), {
    overwrite: true,
  });
};

/**
 * Generate the configuration: config/default.json (committed, no secret)
 * and .env (ignored) with the secret
 *
 * @returns {void}
 */
const generateConfig = () => {
  const cwd = process.cwd();

  console.log(' - Generating config/default.json and .env...');

  const configuration = {
    baseRole: 'guest',
    renderer,
    stores: {
      default: {
        adapter: 'disk',
      },
    },
    user: 'user',
  };

  fs.writeJsonSync(path.join(cwd, 'config', 'default.json'), configuration, {
    spaces: 2,
  });

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
