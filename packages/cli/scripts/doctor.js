const fs = require('fs-extra');
const path = require('path');

const { APIS, packagesFor } = require('./adapters');
const { CliError } = require('./errors');
const { controllerOf, expand } = require('./routing');
const {
  detectPackageManager,
  isProject,
  readConfig,
  readRoutes,
  resolvePackageJson,
  validInstall,
} = require('./utils');

/**
 * Conventions check: file-system only, nothing is started. This is the seed
 * of the henri conventions linter; every check has a stable name (the
 * `check` field), a level (`error` fails, `warning` does not) and a hint.
 */

const MINIMUM_NODE = 22;

/** The adapters core can load (scripts/adapters.js is the catalogue) */
const ADAPTERS = Object.keys(APIS).sort();

/**
 * Packages the renderers need in the app's package.json. What a store
 * needs (its adapter package, and the driver of a drizzle dialect) comes
 * from packagesFor().
 */
const NEEDS = {
  inertia: [
    '@usehenri/inertia',
    '@inertiajs/react',
    'react',
    'react-dom',
    'vite',
  ],
  react: ['@usehenri/react', 'next', 'react', 'react-dom'],
};

/** Page files a resources route needs, per renderer */
const PAGES = {
  inertia: ['index'],
  react: ['index', 'new', 'show', 'edit'],
};

const PAGE_EXTENSIONS = ['.js', '.jsx'];

/**
 * Does a model name look plural? (ends with an s that is not part of
 * -ss, -us or -is: Tasks yes, Status, Address and Analysis no)
 *
 * @param {string} name A model name
 * @returns {boolean} Plural looking or not
 */
const looksPlural = (name) => /(?<![sui])s$/i.test(name);

/**
 * List the .js files of a directory, recursively, as posix paths relative
 * to it (without the extension)
 *
 * @param {string} dir The directory
 * @returns {Array<string>} The entries (`tasks`, `admin/users`)
 */
const listModules = (dir) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const entries = [];

  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.js')) {
        entries.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };

  walk(dir, '');

  return entries.sort();
};

/**
 * Does a controller source define an action? (`show: async (req, res)`,
 * `async show(req, res)`, `show(req, res)`, `show: handler`)
 *
 * @param {string} source The controller source
 * @param {string} action The action name
 * @returns {boolean} Defined or not
 */
const definesAction = (source, action) =>
  new RegExp(`(^|[\\s,{])(async\\s+)?${action}\\s*[:(]`, 'm').test(source);

/**
 * Is a file ignored by a .gitignore? (whole-line match on the usual forms:
 * `.env`, `/.env`, `*.env`, `.env*`)
 *
 * @param {string} ignore The .gitignore content
 * @param {string} file The file name (ex: .env)
 * @returns {boolean} Ignored or not
 */
const ignores = (ignore, file) =>
  ignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some(
      (line) =>
        line === file ||
        line === `/${file}` ||
        line === `${file}/` ||
        line === `*${file}` ||
        line === `${file}*`
    );

/**
 * Run every check on an application directory
 *
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {{ok: boolean, problems: Array<object>, summary: object}} The report
 * @throws {CliError} NOT_A_PROJECT when dir is not a henri application
 */
const check = (dir = process.cwd()) => {
  if (!isProject(dir)) {
    throw new CliError('NOT_A_PROJECT', `${dir} is not an henri project`, {
      hint: 'Run henri doctor from the root of your application',
    });
  }

  const problems = [];
  const problem = (level, name, message, { file = null, hint = null } = {}) =>
    problems.push({ check: name, file, hint, level, message });
  const exists = (relative) => fs.existsSync(path.join(dir, relative));
  const read = (relative) => fs.readFileSync(path.join(dir, relative), 'utf8');

  const pkg = fs.readJsonSync(path.join(dir, 'package.json'));
  const config = readConfig(dir, undefined);
  const renderer = String(config.renderer || 'react').toLowerCase();
  const models = listModules(path.join(dir, 'app', 'models'));
  const controllers = listModules(path.join(dir, 'app', 'controllers'));
  const pm = detectPackageManager(dir);
  let rawRoutes = {};
  let routes = [];

  // --- node -----------------------------------------------------------------
  const major = parseInt(process.versions.node.split('.')[0], 10);

  if (major < MINIMUM_NODE) {
    problem('error', 'node.version', `Node.js ${process.version} is too old`, {
      hint: `henri needs Node.js ${MINIMUM_NODE} or newer`,
    });
  }

  // --- routes ---------------------------------------------------------------
  try {
    rawRoutes = readRoutes(dir);
    routes = expand(rawRoutes);
  } catch (error) {
    problem(
      'error',
      'routes.syntax',
      `config/routes.js cannot be loaded: ${error.message}`,
      {
        file: 'config/routes.js',
        hint: 'config/routes.js must be a CommonJS module exporting an object',
      }
    );
  }

  if (!exists('config/routes.js')) {
    problem('error', 'routes.missing', 'config/routes.js is missing', {
      file: 'config/routes.js',
      hint: "module.exports = { 'get /': 'main#home' }",
    });
  }

  // --- models ---------------------------------------------------------------
  for (const model of models) {
    const file = `app/models/${model}.js`;
    const base = path.posix.basename(model);

    if (model.includes('/')) {
      problem(
        'error',
        'models.location',
        `${file} is in a sub-folder: models live directly in app/models`,
        {
          file,
          hint: `Move it to app/models/${base}.js`,
        }
      );
      continue;
    }

    if (!/^[A-Z][A-Za-z0-9]*$/.test(base)) {
      const fixed = base.charAt(0).toUpperCase() + base.slice(1);

      problem(
        'error',
        'models.naming',
        `${file}: model files are PascalCase (the file name is the global)`,
        {
          file,
          hint: `Rename it to app/models/${fixed}.js and use the global ${fixed}`,
        }
      );
    } else if (looksPlural(base)) {
      const singular = base
        .replace(/ies$/, 'y')
        .replace(/(x|ch|sh|ss)es$/, '$1')
        .replace(/s$/, '');

      problem(
        'error',
        'models.naming',
        `${file}: model files are singular (${singular}.js, not ${base}.js)`,
        {
          file,
          hint: `Rename it to app/models/${singular}.js, the controller stays app/controllers/${base.toLowerCase()}.js`,
        }
      );
    }
  }

  // --- controllers ----------------------------------------------------------
  const routed = new Set(routes.map((route) => route.controller.split('#')[0]));

  for (const controller of controllers) {
    const file = `app/controllers/${controller}.js`;
    const base = path.posix.basename(controller);

    if (!/^[a-z][a-z0-9_-]*$/.test(base)) {
      problem(
        'error',
        'controllers.naming',
        `${file}: controller files are lowercase (tasks.js)`,
        {
          file,
          hint: `Rename it to app/controllers/${path.posix.dirname(controller) === '.' ? '' : `${path.posix.dirname(controller)}/`}${base.toLowerCase()}.js and update config/routes.js`,
        }
      );
    }

    if (routes.length > 0 && !routed.has(controller)) {
      problem(
        'warning',
        'controllers.unused',
        `${file} is not used by any route in config/routes.js`,
        {
          file,
          hint: `Add a route ('get /${base}': '${controller}#index') or remove it: henri destroy controller ${controller}`,
        }
      );
    }
  }

  // --- routes -> controllers, actions and pages -----------------------------
  const sources = {};
  const sourceOf = (controller) => {
    if (!(controller in sources)) {
      const file = path.join(dir, 'app', 'controllers', `${controller}.js`);

      sources[controller] = fs.existsSync(file)
        ? fs.readFileSync(file, 'utf8')
        : null;
    }

    return sources[controller];
  };
  const reported = new Set();

  for (const route of routes) {
    const [controller, action] = route.controller.split('#');
    const key = `${route.verb} ${route.route}`;
    const source = sourceOf(controller);

    if (source === null) {
      if (!reported.has(controller)) {
        reported.add(controller);
        problem(
          'error',
          'routes.controller',
          `"${key}" points to "${controller}" but app/controllers/${controller}.js does not exist`,
          {
            file: 'config/routes.js',
            hint: `henri generate controller ${controller} ${action}, or remove the route: henri destroy route "${key}"`,
          }
        );
      }
      continue;
    }

    if (
      source.includes('module.exports = {') &&
      !definesAction(source, action)
    ) {
      problem(
        'error',
        'routes.action',
        `app/controllers/${controller}.js does not define "${action}" (route "${key}")`,
        {
          file: `app/controllers/${controller}.js`,
          hint: `Add \`${action}: async (req, res) => {}\` to the controller or remove the route`,
        }
      );
    }
  }

  for (const [key, value] of Object.entries(rawRoutes)) {
    const [verb] = key.trim().split(/\s+/);
    const kind = verb.toLowerCase();

    if (
      !['resources', 'crud'].includes(kind) ||
      value === null ||
      typeof value === 'undefined'
    ) {
      continue;
    }

    const controller = controllerOf(value);

    if (controller && !looksPlural(path.posix.basename(controller))) {
      problem(
        'warning',
        'controllers.plural',
        `"${key}": ${kind} controllers are plural (app/controllers/${controller}s.js)`,
        {
          file: 'config/routes.js',
          hint: `henri generate scaffold <Name> writes the plural for you`,
        }
      );
    }

    if (kind !== 'resources' || !PAGES[renderer] || !controller) {
      continue;
    }

    const actions = new Set(
      routes
        .filter((route) => route.controller.startsWith(`${controller}#`))
        .map((route) => route.controller.split('#')[1])
    );

    for (const page of PAGES[renderer]) {
      if (!actions.has(page)) {
        continue;
      }

      const found = PAGE_EXTENSIONS.some((ext) =>
        exists(`app/views/pages/${controller}/${page}${ext}`)
      );

      if (!found) {
        problem(
          'error',
          'views.pages',
          `"${key}" renders app/views/pages/${controller}/${page}${PAGE_EXTENSIONS[renderer === 'inertia' ? 1 : 0]} which does not exist`,
          {
            file: `app/views/pages/${controller}`,
            hint: `henri generate scaffold ${path.posix.basename(controller).replace(/s$/, '')} --force rewrites the pages`,
          }
        );
      }
    }
  }

  // --- configuration --------------------------------------------------------
  const configDir = path.join(dir, 'config');
  const configFiles = fs.existsSync(configDir)
    ? fs.readdirSync(configDir).filter((file) => file.endsWith('.json'))
    : [];

  if (!configFiles.includes('default.json')) {
    problem('error', 'config.missing', 'config/default.json is missing', {
      file: 'config/default.json',
      hint: '{ "stores": { "default": { "adapter": "disk" } }, "renderer": "react" }',
    });
  }

  for (const file of configFiles) {
    let content;

    try {
      content = fs.readJsonSync(path.join(configDir, file));
    } catch (error) {
      problem(
        'error',
        'config.syntax',
        `config/${file} is not valid JSON: ${error.message}`,
        {
          file: `config/${file}`,
        }
      );
      continue;
    }

    if (content && typeof content.secret !== 'undefined') {
      problem('error', 'config.secret', `config/${file} contains "secret"`, {
        file: `config/${file}`,
        hint: 'Move it to HENRI_SECRET in .env (ignored by git) and delete the key',
      });
    }

    for (const [name, store] of Object.entries(
      (content && content.stores) || {}
    )) {
      if (!store || !ADAPTERS.includes(store.adapter)) {
        problem(
          'error',
          'config.adapter',
          `config/${file}: store "${name}" uses the unknown adapter "${store && store.adapter}"`,
          {
            file: `config/${file}`,
            hint: `Adapters: ${ADAPTERS.join(', ')}`,
          }
        );
      }
    }
  }

  // --- secrets --------------------------------------------------------------
  const hasEnv = exists('.env');
  const hasIgnore = exists('.gitignore');

  if (!hasEnv) {
    problem('warning', 'env.missing', '.env is missing', {
      file: '.env',
      hint: 'Write HENRI_SECRET=<64 random hex characters> in .env; it signs the sessions once a User model exists',
    });
  } else if (!/^\s*(export\s+)?HENRI_SECRET\s*=\s*\S+/m.test(read('.env'))) {
    problem('warning', 'env.secret', '.env does not set HENRI_SECRET', {
      file: '.env',
      hint: 'HENRI_SECRET=<64 random hex characters>',
    });
  }

  if (!hasIgnore) {
    problem('warning', 'git.ignore', '.gitignore is missing', {
      file: '.gitignore',
      hint: 'Ignore at least .env, node_modules, .henri, .backup and .next',
    });
  } else {
    const ignore = read('.gitignore');

    if (hasEnv && !ignores(ignore, '.env')) {
      problem('error', 'env.ignored', '.env is not ignored by git', {
        file: '.gitignore',
        hint: 'Add a ".env" line to .gitignore (the secret must never be committed)',
      });
    }

    for (const folder of ['.henri', '.backup']) {
      if (!ignores(ignore, folder)) {
        problem('warning', 'git.ignore', `${folder} is not ignored by git`, {
          file: '.gitignore',
          hint: `Add a "${folder}/" line to .gitignore`,
        });
      }
    }
  }

  // --- agents, tests --------------------------------------------------------
  if (!exists('AGENTS.md')) {
    problem(
      'warning',
      'agents.missing',
      'AGENTS.md is missing (the conventions coding agents read)',
      {
        file: 'AGENTS.md',
        hint: 'henri generate agents',
      }
    );
  }

  if (!exists('vitest.config.js')) {
    problem(
      'warning',
      'tests.config',
      'vitest.config.js is missing: henri test cannot run',
      {
        file: 'vitest.config.js',
        hint: 'Copy vitest.config.js from a fresh henri app (setupFiles: @usehenri/testing/setup-file) and add vitest + @usehenri/testing to devDependencies',
      }
    );
  }

  // --- dependencies ---------------------------------------------------------
  const declared = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  const needed = new Set(['@usehenri/core']);

  for (const name of NEEDS[renderer] || []) {
    needed.add(name);
  }

  for (const store of Object.values(config.stores || {})) {
    for (const name of packagesFor(store)) {
      needed.add(name);
    }
  }

  const undeclared = [...needed].filter((name) => !declared[name]);

  if (undeclared.length > 0) {
    problem(
      'error',
      'deps.declared',
      `package.json does not depend on ${undeclared.join(', ')}`,
      {
        file: 'package.json',
        hint: `${pm === 'npm' ? 'npm install --save' : `${pm} add`} ${undeclared.join(' ')}`,
      }
    );
  }

  if (!exists('node_modules')) {
    problem(
      'warning',
      'deps.installed',
      'node_modules is missing: the dependencies are not installed',
      {
        hint: `${pm} install`,
      }
    );
  } else {
    const missing = [...needed].filter(
      (name) => declared[name] && !resolvePackageJson(name, dir)
    );

    if (missing.length > 0) {
      problem(
        'warning',
        'deps.installed',
        `${missing.join(', ')} declared in package.json but not installed`,
        {
          hint: `${pm} install`,
        }
      );
    }
  }

  const errors = problems.filter((entry) => entry.level === 'error').length;

  return {
    ok: errors === 0,
    problems,
    summary: {
      controllers: controllers.length,
      errors,
      models: models.length,
      renderer,
      routes: routes.length,
      warnings: problems.length - errors,
    },
  };
};

/**
 * Print the report as text
 *
 * @param {object} report The report from check()
 * @returns {void}
 */
const print = ({ problems, summary }) => {
  const { errors, warnings } = summary;
  const count = (number, word) => `${number} ${word}${number === 1 ? '' : 's'}`;

  console.log('');

  if (problems.length === 0) {
    console.log(
      `  henri doctor: no problems found (${count(summary.models, 'model')}, ${count(summary.controllers, 'controller')}, ${count(summary.routes, 'route')})`
    );
    console.log('');

    return;
  }

  console.log(
    `  henri doctor: ${count(problems.length, 'problem')} (${count(errors, 'error')}, ${count(warnings, 'warning')})`
  );
  console.log('');

  for (const entry of problems) {
    console.log(
      `  ${entry.level.padEnd(8)} ${entry.check.padEnd(20)} ${entry.file || ''}`
    );
    console.log(`           ${entry.message}`);

    if (entry.hint) {
      console.log(`           -> ${entry.hint}`);
    }
    console.log('');
  }
};

/**
 * Check the application in the current directory
 *
 * @param {object} [args] CLI arguments (--json prints the report as JSON)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} CHECKS_FAILED (exit 1) when a problem is found
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const report = check(process.cwd());

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    print(report);
  }

  if (!report.ok) {
    throw new CliError(
      'CHECKS_FAILED',
      `${report.summary.errors} problem${report.summary.errors === 1 ? '' : 's'} found`,
      { hint: 'Fix them and run henri doctor again' }
    );
  }
};

module.exports = main;
module.exports.check = check;
module.exports.definesAction = definesAction;
module.exports.ignores = ignores;
module.exports.looksPlural = looksPlural;
