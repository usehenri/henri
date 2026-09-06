const fs = require('fs');
const path = require('path');

/**
 * Read-only inspection of a henri application directory: routes, models,
 * controllers, configuration and the conventions check. Everything reads
 * the file system; nothing is started. The generators (the only write
 * path) run through cli.js.
 */

/** Configuration keys whose values never leave the server */
const SENSITIVE = /secret|password|passwd|^pass$|token|api[-_]?key|private/i;

/** The user:password@ part of a connection url */
const CREDENTIALS = /^([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)([^/\s@]+)(@)/i;

const REDACTED = '[redacted]';

/** The henri packages an application may hold, for the guide tool */
const PACKAGES = [
  '@usehenri/core',
  '@usehenri/cli',
  '@usehenri/mcp',
  '@usehenri/testing',
  '@usehenri/disk',
  '@usehenri/drizzle',
  '@usehenri/graphql',
  '@usehenri/inertia',
  '@usehenri/jobs',
  '@usehenri/mongoose',
  '@usehenri/mssql',
  '@usehenri/mysql',
  '@usehenri/postgresql',
  '@usehenri/react',
  '@usehenri/sequelize',
];

/**
 * Locate the @usehenri/cli to use: the application's own when installed,
 * the one this package depends on otherwise
 *
 * @param {string} cwd The application directory
 * @returns {string} The directory of @usehenri/cli
 */
const locateCli = (cwd) => {
  try {
    return path.dirname(
      require.resolve('@usehenri/cli/package.json', { paths: [cwd] })
    );
  } catch {
    return path.dirname(require.resolve('@usehenri/cli/package.json'));
  }
};

/**
 * Require a module fresh from disk (no require cache), so edits made while
 * the server runs are seen
 *
 * @param {string} file Absolute path
 * @returns {*} The module
 */
const fresh = (file) => {
  delete require.cache[require.resolve(file)];

  return require(file);
};

/**
 * Turn a model file value into something JSON can carry: constructors and
 * functions become their names, nested objects are walked
 *
 * @param {*} value Anything from a model file
 * @param {number} [depth=0] Recursion guard
 * @returns {*} A JSON friendly value
 */
const plain = (value, depth = 0) => {
  if (typeof value === 'function') {
    return value.name ? `[${value.name}]` : '[Function]';
  }

  if (Array.isArray(value)) {
    return depth > 6
      ? '[Array]'
      : value.map((entry) => plain(entry, depth + 1));
  }

  if (value && typeof value === 'object') {
    if (depth > 6) {
      return '[Object]';
    }

    if (value instanceof Date || value instanceof RegExp) {
      return String(value);
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        plain(entry, depth + 1),
      ])
    );
  }

  return value;
};

/**
 * Describe one schema field the way the model format reads: a type name
 * plus the options (required, default, enum, unique, index, ...)
 *
 * @param {string} name The field name
 * @param {*} definition The definition from the model file
 * @returns {object} { name, type, ...options }
 */
const describeField = (name, definition) => {
  if (typeof definition === 'string') {
    return { name, type: definition };
  }

  if (typeof definition === 'function') {
    return { name, type: plain(definition) };
  }

  if (Array.isArray(definition)) {
    return {
      name,
      of: definition.map((entry) => describeField(name, entry).type),
      type: 'array',
    };
  }

  if (definition && typeof definition === 'object') {
    if (!('type' in definition)) {
      return {
        fields: Object.entries(definition).map(([key, entry]) =>
          describeField(key, entry)
        ),
        name,
        type: 'object',
      };
    }

    const { type, ...options } = definition;

    return { name, type: plain(type), ...plain(options) };
  }

  return { name, type: plain(definition) };
};

/**
 * Redact secrets from a configuration object, recursively
 *
 * @param {*} value The configuration (or a part of it)
 * @param {string} [key=''] The key the value sits under
 * @returns {*} The same structure with secrets replaced
 */
const redact = (value, key = '') => {
  if (SENSITIVE.test(key) && value !== null && typeof value !== 'undefined') {
    return REDACTED;
  }

  if (typeof value === 'string') {
    return value.replace(CREDENTIALS, `$1${REDACTED}$3`);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, entry]) => [name, redact(entry, name)])
    );
  }

  return value;
};

/**
 * List the .js files of a directory recursively, as posix names without
 * the extension (`tasks`, `admin/users`)
 *
 * @param {string} dir The directory
 * @returns {Array<string>} The names, sorted
 */
const listModules = (dir) => {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const found = [];
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name.endsWith('.js')) {
        found.push(`${prefix}${entry.name.slice(0, -3)}`);
      }
    }
  };

  walk(dir, '');

  return found.sort();
};

/**
 * Action names found in a controller source without loading it
 * (`show: async (req, res)`, `async show(req, res)`)
 *
 * @param {string} source The controller source
 * @returns {Array<string>} The action names
 */
const scanActions = (source) => {
  const names = new Set();
  const pattern =
    /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?::\s*(?:async\s*)?(?:\(|function)|\()/gm;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    names.add(match[1]);
  }

  return Array.from(names);
};

/**
 * A henri application on disk
 *
 * @class App
 */
class App {
  /**
   * @param {string} cwd The application directory
   */
  constructor(cwd) {
    this.cwd = path.resolve(cwd);
    this.cliDir = locateCli(this.cwd);
    this.cli = {
      agents: require(path.join(this.cliDir, 'scripts', 'agents')),
      audit: require(path.join(this.cliDir, 'scripts', 'audit')),
      doctor: require(path.join(this.cliDir, 'scripts', 'doctor')),
      help: require(path.join(this.cliDir, 'scripts', 'help')),
      openapi: require(path.join(this.cliDir, 'scripts', 'openapi')),
      routing: require(path.join(this.cliDir, 'scripts', 'routing')),
      utils: require(path.join(this.cliDir, 'scripts', 'utils')),
      version: require(path.join(this.cliDir, 'package.json')).version,
    };
  }

  /**
   * Is the directory a henri application?
   *
   * @returns {boolean} Yes or no
   */
  isProject() {
    return this.cli.utils.isProject(this.cwd);
  }

  /**
   * Resolve a path inside the application, refusing anything that would
   * leave it
   *
   * @param {string} relative A relative path
   * @returns {string} The absolute path
   * @throws when the path leaves the application directory
   */
  inside(relative) {
    const target = path.resolve(this.cwd, relative);

    if (target !== this.cwd && !target.startsWith(`${this.cwd}${path.sep}`)) {
      throw new Error(`"${relative}" is outside of the application`);
    }

    return target;
  }

  /**
   * The application name, renderer and default store adapter
   *
   * @returns {{name: string, renderer: string, adapter: string}} Identity
   */
  identity() {
    let name = path.basename(this.cwd);

    try {
      name =
        JSON.parse(fs.readFileSync(this.inside('package.json'), 'utf8')).name ||
        name;
    } catch {
      // The folder name will do
    }

    const config = this.cli.utils.readConfig(this.cwd, undefined);

    const stores = (config && config.stores) || {};
    const store = stores.default || Object.values(stores)[0] || {};

    return {
      adapter: String(store.adapter || 'disk').toLowerCase(),
      name,
      renderer: String(config.renderer || 'react').toLowerCase(),
    };
  }

  /**
   * The versions of the henri packages this application actually has, which
   * is what the documentation shipped with this server describes
   *
   * @returns {object} { node, cli, packages: { '@usehenri/core': '1.2.0' } }
   */
  installed() {
    const { utils } = this.cli;
    const packages = {};

    for (const name of PACKAGES) {
      const found = utils.resolvePackageJson(name, this.cwd);

      if (found) {
        packages[name] = found.version;
      }
    }

    return { cli: this.cli.version, node: process.version, packages };
  }

  /**
   * The routes expanded from config/routes.js
   *
   * @returns {Array<object>} [{ verb, route, controller, path, roles? }]
   */
  routes() {
    return this.cli.routing.expand(this.cli.utils.readRoutes(this.cwd));
  }

  /**
   * The OpenAPI 3.1 description of what the application exposes, built from
   * the routes, the models and the configuration without starting anything
   *
   * @returns {object} The document
   */
  openapi() {
    return this.cli.openapi.describe(this.cwd);
  }

  /**
   * The models of app/models, parsed
   *
   * @param {string} [name] Only this model
   * @returns {Array<object>} [{ name, file, identity, store, options, attributes, associate, graphql, error? }]
   */
  models(name) {
    const dir = this.inside('app/models');
    const models = [];

    for (const entry of listModules(dir)) {
      const modelName = path.posix.basename(entry);

      if (name && modelName.toLowerCase() !== name.toLowerCase()) {
        continue;
      }

      const file = `app/models/${entry}.js`;
      const model = {
        associate: false,
        attributes: [],
        file,
        graphql: false,
        identity: modelName.toLowerCase(),
        name: modelName,
        options: {},
        store: 'default',
      };

      try {
        const loaded = fresh(path.join(dir, `${entry}.js`)) || {};

        model.store = loaded.store || 'default';
        model.options = plain(loaded.options || {});
        model.associate = typeof loaded.associate === 'function';
        model.graphql = Boolean(loaded.graphql);
        model.attributes = Object.entries(loaded.schema || {}).map(
          ([field, definition]) => describeField(field, definition)
        );
      } catch (error) {
        model.error = error.message;
      }

      models.push(model);
    }

    return models;
  }

  /**
   * The controllers of app/controllers and their actions
   *
   * @param {string} [name] Only this controller (`tasks`, `admin/users`)
   * @returns {Array<object>} [{ name, file, actions, routes, error? }]
   */
  controllers(name) {
    const dir = this.inside('app/controllers');
    const routes = this.routes();
    const controllers = [];

    for (const entry of listModules(dir)) {
      if (name && entry !== name) {
        continue;
      }

      const file = path.join(dir, `${entry}.js`);
      const controller = {
        actions: [],
        file: `app/controllers/${entry}.js`,
        name: entry,
        routes: routes
          .filter((route) => route.controller.split('#')[0] === entry)
          .map((route) => ({
            action: route.controller.split('#')[1],
            path: route.path,
            route: `${route.verb} ${route.route}`,
          })),
      };

      try {
        const loaded = fresh(file) || {};

        controller.actions = Object.keys(loaded).filter(
          (key) => typeof loaded[key] === 'function'
        );
      } catch (error) {
        controller.error = error.message;
        controller.actions = scanActions(fs.readFileSync(file, 'utf8'));
      }

      controllers.push(controller);
    }

    return controllers;
  }

  /**
   * The configuration henri would load for an environment, with the
   * secrets redacted
   *
   * @param {string} [env=process.env.NODE_ENV || 'dev'] The environment
   * @returns {object} { env, file, config, secretInConfig, secretInEnv }
   */
  config(env = process.env.NODE_ENV || 'dev') {
    const candidates = [`config/${env}.json`, 'config/default.json'];
    const file = candidates.find((candidate) =>
      fs.existsSync(this.inside(candidate))
    );
    const raw = file
      ? JSON.parse(fs.readFileSync(this.inside(file), 'utf8'))
      : {};
    let secretInEnv = Boolean(process.env.HENRI_SECRET);

    if (!secretInEnv && fs.existsSync(this.inside('.env'))) {
      secretInEnv = /^\s*(export\s+)?HENRI_SECRET\s*=\s*\S+/m.test(
        fs.readFileSync(this.inside('.env'), 'utf8')
      );
    }

    return {
      config: redact(raw),
      env,
      file: file || null,
      secretInConfig: typeof raw.secret !== 'undefined',
      secretInEnv,
    };
  }

  /**
   * The security audit: what the application's own files say about the
   * things a web application is judged on, each finding carrying the OWASP
   * category and the ASVS requirement it maps to
   *
   * @param {object} [options] Options
   * @param {boolean} [options.deps=false] Ask the package manager for the
   *   advisories of the production dependencies (this one goes to the
   *   network, so it is off unless the caller asks)
   * @returns {object} The audit report
   */
  audit({ deps = false } = {}) {
    return this.cli.audit.audit(this.cwd, { deps });
  }

  /**
   * The conventions check plus the environment: node, package manager,
   * the henri packages and whether a development server answers
   *
   * @returns {Promise<object>} The doctor report
   */
  async doctor() {
    const { utils } = this.cli;
    const report = this.cli.doctor.check(this.cwd);

    // The one check that opens a connection: whether the shared store of
    // `config.shared` answers. `henri doctor` runs it too.
    await this.cli.doctor.reach(this.cwd, report);

    const config = utils.readConfig(this.cwd, undefined);
    const core = utils.resolvePackageJson('@usehenri/core', this.cwd);
    const port = Number(config.port) || 3000;
    const url = `http://127.0.0.1:${port}/`;
    const server = await this.serverStatus(url);
    const stores = Object.entries(config.stores || {}).map(([name, store]) => {
      const adapter = store && store.adapter;
      const pkg = adapter
        ? utils.resolvePackageJson(`@usehenri/${adapter}`, this.cwd)
        : null;

      return {
        adapter: adapter || null,
        installed: Boolean(pkg),
        name,
        reachable: server.running
          ? {
              reason: 'the development server answers: its stores started',
              status: 'started',
            }
          : {
              reason:
                'no development server is running; stores are only reachable from a running henri',
              status: 'skipped',
            },
        version: (pkg && pkg.version) || null,
      };
    });

    return {
      ...report,
      environment: {
        cli: this.cli.version,
        core: (core && core.version) || null,
        node: process.version,
        packageManager: utils.detectPackageManager(this.cwd),
      },
      server,
      stores,
    };
  }

  /**
   * Does a henri development server of this application answer on the
   * loopback interface? (its /_routes must list the routes of this app, so
   * another henri app on the same port does not count)
   *
   * @param {string} url The server url
   * @returns {Promise<{url: string, running: boolean}>} The status
   */
  async serverStatus(url) {
    try {
      const response = await fetch(`${url}_routes`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(500),
      });

      if (!response.ok) {
        return { running: false, url };
      }

      const served = Object.keys((await response.json()) || {}).sort();
      const own = this.routes()
        .map((route) => `${route.verb} ${route.route}`)
        .sort();
      const running =
        served.length === own.length &&
        served.every((key, index) => key === own[index]);

      return { running, url };
    } catch {
      return { running: false, url };
    }
  }

  /**
   * AGENTS.md of the application, or the canonical text when missing
   *
   * @returns {{text: string, source: string}} The text and where it comes from
   */
  agents() {
    const file = this.inside('AGENTS.md');

    if (fs.existsSync(file)) {
      return { source: 'AGENTS.md', text: fs.readFileSync(file, 'utf8') };
    }

    return { source: 'template', text: this.conventions() };
  }

  /**
   * The canonical conventions (the CLI's AGENTS.md template rendered for
   * this application)
   *
   * @returns {string} Markdown
   */
  conventions() {
    return this.cli.agents.renderAgents(this.identity());
  }
}

module.exports = { App, describeField, locateCli, redact, scanActions };
