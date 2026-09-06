const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const debug = require('debug')('henri:inertia');
const shell = require('./shell');
const { VIEW_FILES } = require('./files');
const { coded } = require('./shell');

/**
 * `inertia` key of the application configuration
 */
const DEFAULTS = {
  // Client entry, relative to app/views
  entry: 'main.jsx',
  // Id of the root element (and of the <script data-page>)
  id: 'app',
  // Render pages on the server (false: the browser renders everything)
  ssr: true,
  // Server entry, relative to app/views
  ssrEntry: 'ssr.jsx',
  // The html shell, relative to app/views
  template: 'index.html',
};

const CONFIG_FILES = [
  'vite.config.mjs',
  'vite.config.js',
  'vite.config.mts',
  'vite.config.ts',
  'vite.config.cjs',
];

const SAFE_METHODS = ['GET', 'HEAD'];
const REDIRECT_303 = ['PUT', 'PATCH', 'DELETE'];

/**
 * Is this request made by the Inertia client?
 *
 * @param {import('http').IncomingMessage} req the request
 * @returns {boolean} yes or no
 */
const isInertia = (req) =>
  String((req.headers && req.headers['x-inertia']) || '') === 'true';

/**
 * Read a request header (lowercase name)
 *
 * @param {import('http').IncomingMessage} req the request
 * @param {string} name the header name
 * @returns {string} its value or ''
 */
const header = (req, name) => String((req.headers && req.headers[name]) || '');

/**
 * Split a comma separated header
 *
 * @param {string} value the header value
 * @returns {string[]} the items
 */
const list = (value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Inertia component name for a route passed to res.render()
 * '/' and '/index' -> 'index', '/tasks/index' -> 'tasks/index'
 *
 * @param {string} route the route
 * @returns {string} the component name
 */
function componentName(route = '/') {
  const name = trimSlashes(String(route).replace(/\\/g, '/'));

  return name === '' ? 'index' : name;
}

/**
 * Removes the leading and trailing slashes of a path
 *
 * @param {string} value the path
 * @returns {string} the path without its outer slashes
 */
function trimSlashes(value) {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === '/') {
    start += 1;
  }
  while (end > start && value[end - 1] === '/') {
    end -= 1;
  }

  return value.slice(start, end);
}

/**
 * The CSRF token of a request: what henri's router passed to the view, what
 * its csrf middleware set (`req.csrfToken`, a string) or a csurf-style
 * `req.csrfToken()` function
 *
 * @param {import('express').Request} req the request
 * @param {object} [opts={}] the view options
 * @returns {?string} the token or null
 */
function csrfToken(req, opts = {}) {
  if (typeof opts.csrf === 'string') {
    return opts.csrf;
  }

  if (req._henri && typeof req._henri.csrf === 'string') {
    return req._henri.csrf;
  }

  if (typeof req.csrfToken === 'function') {
    return req.csrfToken();
  }

  return typeof req.csrfToken === 'string' ? req.csrfToken : null;
}

/**
 * The Content Security Policy nonce of this response: the view option
 * henri's router built, or `res.locals.cspNonce` where the header was set
 *
 * It never reaches the page object. An Inertia visit after the first one is
 * answered as JSON and swaps the props of a document the browser already
 * has, whose policy is the one it was loaded with: a nonce arriving in those
 * props would be a value no policy names, and a page stamping it on a script
 * would be writing something the browser refuses. The nonce belongs to the
 * document, so it stays in the document.
 *
 * @param {import('express').Response} res the response
 * @param {object} [opts={}] the view options
 * @returns {?string} the nonce or null
 */
function nonceOf(res, opts = {}) {
  if (typeof opts.nonce === 'string' && opts.nonce.length > 0) {
    return opts.nonce;
  }

  const locals = (res && res.locals) || {};

  return typeof locals.cspNonce === 'string' && locals.cspNonce.length > 0
    ? locals.cspNonce
    : null;
}

/**
 * The absolute url of a request
 *
 * @param {import('express').Request} req the request
 * @returns {string} the url
 */
function absoluteUrl(req) {
  const protocol = req.protocol || 'http';
  const host = (req.headers && req.headers.host) || 'localhost';

  return `${protocol}://${host}${req.originalUrl || req.url || '/'}`;
}

/**
 * Add a value to the Vary header
 *
 * @param {import('http').ServerResponse} res the response
 * @param {string} value the value
 * @returns {void}
 */
function vary(res, value) {
  const current = res.getHeader('Vary');
  const values = current ? String(current).split(/\s*,\s*/) : [];

  if (!values.map((item) => item.toLowerCase()).includes(value.toLowerCase())) {
    res.setHeader('Vary', [...values, value].join(', '));
  }
}

/**
 * Apply an Inertia partial reload (X-Inertia-Partial-Data / -Except) to a page
 *
 * @param {import('http').IncomingMessage} req the request
 * @param {object} page the page object
 * @returns {object} the page, with its props filtered when requested
 */
function partial(req, page) {
  const component = header(req, 'x-inertia-partial-component');

  if (!component || component !== page.component) {
    return page;
  }

  const only = list(header(req, 'x-inertia-partial-data'));
  const except = list(header(req, 'x-inertia-partial-except'));
  let entries = Object.entries(page.props);

  if (only.length > 0) {
    entries = entries.filter(([key]) => only.includes(key));
  }

  if (except.length > 0) {
    entries = entries.filter(([key]) => !except.includes(key));
  }

  return Object.assign({}, page, { props: Object.fromEntries(entries) });
}

/**
 * Express middleware registered on henri's router: `req.inertia`
 * ({ request, errors }), `res.inertia` ({ errors(), location() }) and 303
 * redirects after PUT/PATCH/DELETE, as the Inertia protocol requires
 *
 * @param {import('express').Request} req the request
 * @param {import('express').Response} res the response
 * @param {function} next next middleware
 * @returns {void}
 */
function middleware(req, res, next) {
  const inertia = isInertia(req);

  req.inertia = { errors: null, request: inertia };

  res.inertia = {
    // Validation errors for the page rendered next: res.render() adds them
    // to `props.errors`
    errors: (errors) => {
      req.inertia.errors = errors;

      return res;
    },
    // External redirect (409 + X-Inertia-Location for the Inertia client)
    location: (url) => {
      if (!inertia) {
        return res.redirect(url);
      }

      res.statusCode = 409;
      res.setHeader('X-Inertia-Location', url);

      return res.end();
    },
  };

  if (inertia && REDIRECT_303.includes(req.method)) {
    const redirect = res.redirect.bind(res);

    res.redirect = (...args) =>
      args.length === 1 ? redirect(303, args[0]) : redirect(...args);
  }

  next();
}

/**
 * Locate the package.json of a package installed in an application, the way
 * node walks up node_modules. `require.resolve` cannot reach ESM-only
 * packages (ex: @inertiajs/react) whose "exports" have no require entry.
 *
 * @param {string} name the package name
 * @param {string} cwd the application directory
 * @returns {?string} the package.json path or null
 */
function findPackage(name, cwd) {
  let dir = path.resolve(cwd);

  for (;;) {
    const candidate = path.join(
      dir,
      'node_modules',
      ...name.split('/'),
      'package.json'
    );

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(dir);

    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

/**
 * Import vite from the application directory
 *
 * @param {string} cwd the application directory
 * @returns {Promise<typeof import('vite')>} the vite module
 */
function loadVite(cwd) {
  const entry = require.resolve('vite', { paths: [cwd] });

  return import(pathToFileURL(entry).href);
}

/**
 * Vite configuration of an application: its `app/views/vite.config.*` when it
 * has one, or the configuration shipped with this package
 *
 * @param {string} views absolute path of app/views
 * @returns {Promise<object>} inline vite configuration
 */
async function baseConfig(views) {
  const configFile = CONFIG_FILES.map((name) => path.join(views, name)).find(
    (file) => fs.existsSync(file)
  );

  if (configFile) {
    return { configFile, root: views };
  }

  const { henriViteConfig } = await import(
    pathToFileURL(path.join(__dirname, '..', 'vite.mjs')).href
  );

  return Object.assign({ configFile: false }, henriViteConfig({ views }));
}

/**
 * Inertia.js (Vite + React) view engine
 *
 * @class InertiaEngine
 */
class InertiaEngine {
  /**
   * Creates an instance of InertiaEngine.
   *
   * @param {Henri} thisHenri The current henri instance
   * @memberof InertiaEngine
   */
  constructor(thisHenri) {
    const { config } = thisHenri;

    this.henri = thisHenri;
    this.dir = path.resolve(thisHenri.cwd(), 'app/views');
    this.dist = path.join(this.dir, 'dist');
    this.renderer = config.has('renderer')
      ? String(config.get('renderer')).toLowerCase()
      : 'inertia';
    this.options = Object.assign(
      {},
      DEFAULTS,
      config.has('inertia') ? config.get('inertia') : {}
    );

    // Development: the vite dev server. Production: the static handler
    this.vite = null;
    this.styles = [];
    this.serve = null;
    // (page) => Promise<{ head: string[], body: string }>, null without ssr
    this.ssr = null;
    this.manifest = null;
    this.template = '';
    this.version = 'dev';

    /**
     * The engine writes the nonce of the response on every script, style and
     * stylesheet link of the document it builds, and hands it to Vite's own
     * runtime through `<meta property="csp-nonce">` (see ./shell.js).
     */
    this.supportsNonce = true;

    this.init = this.init.bind(this);
    this.build = this.build.bind(this);
    this.prepare = this.prepare.bind(this);
    this.fallback = this.fallback.bind(this);
    this.middleware = middleware;
    this.render = this.render.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Checks the application dependencies, creates the view files and registers
   * the Inertia request helpers on henri's router
   *
   * @async
   * @returns {Promise<boolean>} success
   * @memberof InertiaEngine
   */
  async init() {
    const {
      pen,
      utils: { checkPackages },
    } = this.henri;

    if (this.renderer !== 'inertia') {
      pen.warn('view', `renderer '${this.renderer}' is handled by inertia`);
    }

    // Does not depend on the checks below: never skip it
    this.registerMiddleware();

    try {
      await checkPackages(['react', 'react-dom', 'vite']);

      // Scoped packages are checked on disk: henri's checkPackages splits
      // names on '@' and @inertiajs/react is ESM only (no require entry)
      const missing = ['@inertiajs/react', '@vitejs/plugin-react'].filter(
        (name) => !findPackage(name, this.henri.cwd())
      );

      if (missing.length > 0) {
        throw coded(
          'HENRI_BOOT_PACKAGES_MISSING',
          `Unable to load ${missing
            .map((name) => `'${name}'`)
            .join(' and ')} from the current project.

      Try installing ${missing.length > 1 ? 'them' : 'it'}:

        # pnpm add ${missing.join(' ')}
      `
        );
      }
    } catch (error) {
      // Core may swallow the rejection: make sure the reason is visible
      pen.error('view', 'the inertia engine cannot start', error.message);
      throw error;
    }

    if (hasStylesheets(this.dir)) {
      try {
        this.resolve('sass');
      } catch (error) {
        pen.warn(
          'view',
          "'sass' is not installed: the .scss files of this app will not compile"
        );
      }
    }

    if (!this.henri.isTest) {
      this.ensureViewFiles();
    }

    return true;
  }

  /**
   * Resolve a module from the application directory
   *
   * @param {string} request module name
   * @returns {string} resolved path
   * @memberof InertiaEngine
   */
  resolve(request) {
    return require.resolve(request, { paths: [this.henri.cwd()] });
  }

  /**
   * Create the files the engine needs in app/views (index.html, main.jsx,
   * ssr.jsx and vite.config.mjs) when the application does not ship them.
   *
   * @returns {string[]} the files that were created
   * @memberof InertiaEngine
   */
  ensureViewFiles() {
    const created = [];

    for (const file of VIEW_FILES) {
      const exists = [file.name, ...file.alternatives].some((name) =>
        fs.existsSync(path.join(this.dir, name))
      );

      if (!exists) {
        try {
          fs.mkdirSync(this.dir, { recursive: true });
          fs.writeFileSync(path.join(this.dir, file.name), file.content);
          this.henri.pen.info('view', `created app/views/${file.name}`);
          created.push(file.name);
        } catch (error) {
          this.henri.pen.warn(
            'view',
            `unable to create app/views/${file.name}`,
            error.message
          );
        }
      }
    }

    return created;
  }

  /**
   * Register the request helpers (once) on henri's router
   *
   * @returns {boolean} registered?
   * @memberof InertiaEngine
   */
  registerMiddleware() {
    const { henri } = this;

    if (typeof henri.addMiddleware !== 'function') {
      return false;
    }

    const registered = (henri._middlewares || []).some(
      (middleware) => middleware.name === 'inertia'
    );

    if (registered) {
      return false;
    }

    henri.addMiddleware('inertia', (router) => router.use(middleware));

    return true;
  }

  /**
   * Production build: the client bundle (with its manifest) and the server
   * bundle. Does not need a running henri.
   *
   * @static
   * @async
   * @param {object} [options] options
   * @param {string} [options.cwd=process.cwd()] the application directory
   * @param {object} [options.config] the application configuration (its
   * `inertia` key is read)
   * @param {string} [options.logLevel='info'] vite log level
   * @returns {Promise<{ client: string, duration: number, ssr: ?string }>} the
   * manifest path, the elapsed time (ms) and the server bundle path
   * @memberof InertiaEngine
   */
  static async build({ cwd = process.cwd(), config = {}, logLevel } = {}) {
    const views = path.resolve(cwd, 'app/views');
    const options = Object.assign({}, DEFAULTS, config.inertia || {});
    const vite = await loadVite(cwd);
    const base = await baseConfig(views);
    const started = Date.now();
    const common = { logLevel, mode: 'production' };

    debug('building the client bundle of %s', views);

    await vite.build(
      vite.mergeConfig(base, {
        ...common,
        build: {
          manifest: true,
          outDir: 'dist/client',
          rollupOptions: { input: path.join(views, options.entry) },
        },
      })
    );

    let ssr = null;

    if (options.ssr !== false) {
      debug('building the server bundle of %s', views);

      await vite.build(
        vite.mergeConfig(base, {
          ...common,
          build: {
            manifest: false,
            outDir: 'dist/ssr',
            rollupOptions: { input: path.join(views, options.ssrEntry) },
            ssr: path.join(views, options.ssrEntry),
          },
        })
      );

      ssr = InertiaEngine.ssrBundle(views, options.ssrEntry);
    }

    return {
      client: path.join(views, 'dist', 'client', '.vite', 'manifest.json'),
      duration: Date.now() - started,
      ssr,
    };
  }

  /**
   * Path of the built server entry (`.mjs` when the app is CommonJS)
   *
   * @static
   * @param {string} views absolute path of app/views
   * @param {string} ssrEntry the server entry file
   * @returns {?string} the bundle path or null
   * @memberof InertiaEngine
   */
  static ssrBundle(views, ssrEntry) {
    const name = path.basename(ssrEntry, path.extname(ssrEntry));

    return (
      ['mjs', 'js', 'cjs']
        .map((ext) => path.join(views, 'dist', 'ssr', `${name}.${ext}`))
        .find((file) => fs.existsSync(file)) || null
    );
  }

  /**
   * Production build of this application
   *
   * @async
   * @returns {Promise<object>} see the static build()
   * @memberof InertiaEngine
   */
  async build() {
    const { pen } = this.henri;

    pen.info('view', 'building the inertia client and server bundles');

    this.ensureViewFiles();

    const result = await InertiaEngine.build({
      config: { inertia: this.options },
      cwd: this.henri.cwd(),
    });

    pen.info('view', `build done in ${result.duration}ms`);

    return result;
  }

  /**
   * The stylesheets the browser entry imports, as urls under app/views
   *
   * In development Vite hands a stylesheet over as a javascript module that
   * injects it once the entry has run, so a server rendered document paints
   * unstyled until then. Linking them in the head fixes that. Only relative
   * imports of the entry are read: a stylesheet imported by a component is
   * still injected by its module, as before.
   *
   * @returns {Array<string>} urls, empty when the entry imports no stylesheet
   * @memberof InertiaEngine
   */
  entryStylesheets() {
    const file = path.join(this.dir, this.options.entry);
    const relative =
      /^\s*import\s+['"](\.[^'"]+\.(?:css|scss|sass|less))['"]/gm;
    const found = [];

    try {
      const source = fs.readFileSync(file, 'utf8');

      let match = relative.exec(source);

      for (; match !== null; match = relative.exec(source)) {
        const href = path.posix.normalize(
          path.posix.join('/', path.posix.dirname(this.options.entry), match[1])
        );

        if (!found.includes(href)) {
          found.push(href);
        }
      }
    } catch (error) {
      this.henri.pen.warn(
        'view',
        `unable to read ${this.options.entry} for its stylesheets`,
        error.message
      );
    }

    return found;
  }

  /**
   * Reads the html template of the application
   *
   * @returns {string} the template
   * @memberof InertiaEngine
   */
  readTemplate() {
    return fs.readFileSync(path.join(this.dir, this.options.template), 'utf8');
  }

  /**
   * Called after init to prepare the server: the vite dev server in
   * development, the built assets and server bundle in production
   *
   * @async
   * @returns {Promise<boolean>} success
   * @memberof InertiaEngine
   */
  async prepare() {
    const { pen } = this.henri;

    if (this.henri.isProduction) {
      await this.prepareProduction();
    } else {
      await this.prepareDevelopment();
    }

    pen.info(
      'view',
      `inertia ready (${this.vite ? 'vite dev server' : 'production build'})`,
      `ssr = ${this.ssr ? 'on' : 'off'}`,
      `version = ${this.version}`
    );

    return true;
  }

  /**
   * Load the production build (building it when missing or forced)
   *
   * @async
   * @returns {Promise<void>} nothing
   * @memberof InertiaEngine
   */
  async prepareProduction() {
    const { pen } = this.henri;
    const manifest = path.join(this.dist, 'client', '.vite', 'manifest.json');

    if (!fs.existsSync(manifest) || process.env.FORCE_BUILD === 'true') {
      await this.build();

      /* istanbul ignore next */
      if (process.env.CMD_BUILD === 'true') {
        pen.info('view', 'build successful', 'exiting');
        process.exit(0);
      }
    } else {
      pen.info('view', 'reusing production build');
    }

    const raw = fs.readFileSync(manifest, 'utf8');

    this.manifest = JSON.parse(raw);
    this.version = shell.hash(raw);
    this.template = this.readTemplate();

    if (this.options.ssr !== false) {
      const bundle = InertiaEngine.ssrBundle(this.dir, this.options.ssrEntry);

      if (!bundle) {
        throw coded(
          'HENRI_VIEW_SSR_FAILED',
          `inertia: server bundle not found in ${path.join(this.dist, 'ssr')}`
        );
      }

      const mod = await import(pathToFileURL(bundle).href);
      const render = mod.render || (mod.default && mod.default.render);

      if (typeof render !== 'function') {
        throw coded(
          'HENRI_VIEW_SSR_FAILED',
          `inertia: ${bundle} does not export render()`
        );
      }

      this.ssr = render;
    }
  }

  /**
   * Start the vite dev server (middleware mode, hot reloading on henri's
   * http server)
   *
   * @async
   * @returns {Promise<void>} nothing
   * @memberof InertiaEngine
   */
  async prepareDevelopment() {
    const { pen } = this.henri;
    const httpServer = this.henri.server && this.henri.server.httpServer;
    const vite = await loadVite(this.henri.cwd());
    const base = await baseConfig(this.dir);

    pen.info(
      'view',
      'starting vite dev server...',
      `vite = ${vite.version}`,
      `react = ${this.packageVersion('react')}`,
      `inertia = ${this.packageVersion('@inertiajs/react')}`
    );

    this.vite = await vite.createServer(
      vite.mergeConfig(base, {
        appType: 'custom',
        logLevel: 'warn',
        server: {
          // Hot reloading rides on henri's http server (no second port)
          hmr: httpServer ? {} : false,
          middlewareMode: true,
          ws: httpServer ? { server: httpServer } : false,
        },
      })
    );

    try {
      this.version = shell.hash(
        fs.readFileSync(path.join(this.henri.cwd(), 'package.json'))
      );
    } catch (error) {
      this.version = 'dev';
    }

    this.template = this.readTemplate();
    this.styles = this.entryStylesheets();

    if (this.options.ssr !== false) {
      // Loaded on every render so hot updates of the pages apply
      this.ssr = async (page) => {
        const mod = await this.vite.ssrLoadModule(`/${this.options.ssrEntry}`);

        return mod.render(page);
      };
    }
  }

  /**
   * Version of a package installed in the application
   *
   * @param {string} name the package name
   * @returns {string} the version or '?'
   * @memberof InertiaEngine
   */
  packageVersion(name) {
    try {
      return this.henri.utils.resolvePackageJson(name, this.henri.cwd())
        .version;
    } catch (error) {
      const file = findPackage(name, this.henri.cwd());

      try {
        return file ? JSON.parse(fs.readFileSync(file, 'utf8')).version : '?';
      } catch (parseError) {
        return '?';
      }
    }
  }

  /**
   * Add the catchall: vite's middlewares in development (client entry,
   * modules, hot reloading), the built assets in production. Anything else
   * falls through to henri's 404.
   *
   * @param {Express.Router} router A router to register the catchall
   * @returns {void}
   * @memberof InertiaEngine
   */
  fallback(router) {
    if (!this.vite && !this.serve && this.henri.isProduction) {
      const { express } = this.henri.server;

      this.serve = express.static(path.join(this.dist, 'client'), {
        immutable: true,
        index: false,
        maxAge: '1y',
        redirect: false,
      });
    }

    router.use((req, res, next) => {
      if (!SAFE_METHODS.includes(req.method)) {
        return next();
      }

      if (this.vite) {
        return this.vite.middlewares(req, res, next);
      }

      if (this.serve) {
        return this.serve(req, res, next);
      }

      return next();
    });
  }

  /**
   * The Inertia page object for a route
   *
   * @param {import('express').Request} req the request
   * @param {string} route the route passed to res.render()
   * @param {object} [opts={}] the view options built by henri's router
   * @returns {{ component: string, props: object, url: string, version: string }} the page
   * @memberof InertiaEngine
   */
  page(req, route, opts = {}) {
    const errors = (req.inertia && req.inertia.errors) || opts.errors || {};

    return {
      component: componentName(route),
      props: {
        csrf: csrfToken(req, opts),
        data: opts.data || {},
        errors,
        flash: opts.flash || {},
        graphql: opts.graphql || null,
        localUrl: opts.localUrl || '',
        paths: opts.paths || {},
        query: opts.query || req.query || {},
        user: opts.user || null,
      },
      url: req.originalUrl || req.url || '/',
      version: this.version,
    };
  }

  /**
   * Used by res.render: the page object as JSON for the Inertia client, the
   * full document (server rendered when enabled) otherwise
   *
   * @param {import('express').Request} req Request
   * @param {import('express').Response} res Response
   * @param {string} route A string matching the location from ./app/views/pages
   * @param {object} opts Data or any other options going to the view
   * @returns {Promise<void>} nothing
   * @memberof InertiaEngine
   */
  async render(req, res, route, opts = {}) {
    const page = this.page(req, route, opts);

    vary(res, 'X-Inertia');

    if (page.props.csrf && typeof res.cookie === 'function') {
      // Inertia's client sends it back as X-XSRF-TOKEN on every visit
      res.cookie('XSRF-TOKEN', page.props.csrf, {
        path: '/',
        sameSite: 'lax',
        secure: req.secure === true,
      });
    }

    if (isInertia(req)) {
      if (
        req.method === 'GET' &&
        header(req, 'x-inertia-version') !== page.version
      ) {
        debug(
          'asset version mismatch, asking for a full visit of %s',
          page.url
        );
        res.statusCode = 409;
        res.setHeader('X-Inertia-Location', absoluteUrl(req));
        res.setHeader('X-Inertia-Version', page.version);

        return res.end();
      }

      res.setHeader('X-Inertia', 'true');
      // Overrides the text/html set by henri's res.format() (html branch)
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      return res.json(partial(req, page));
    }

    try {
      const html = await this.html(page, req, nonceOf(res, opts));

      res.setHeader('Content-Type', 'text/html; charset=utf-8');

      return res.send(html);
    } catch (error) {
      return this.fail(res, page, error);
    }
  }

  /**
   * The full html document of a page
   *
   * @async
   * @param {object} page the page object
   * @param {import('express').Request} req the request
   * @param {?string} [nonce=null] the CSP nonce of this response
   * @returns {Promise<string>} html
   * @memberof InertiaEngine
   */
  async html(page, req, nonce = null) {
    let template = this.template;
    let head = [];
    let body = null;

    if (this.vite) {
      template = await this.vite.transformIndexHtml(
        req.originalUrl || '/',
        this.readTemplate()
      );
    }

    if (this.ssr) {
      try {
        const rendered = await this.ssr(page);

        head = rendered.head || [];
        body = rendered.body;
      } catch (error) {
        if (this.vite && typeof this.vite.ssrFixStacktrace === 'function') {
          this.vite.ssrFixStacktrace(error);
        }

        if (!this.henri.isProduction) {
          throw error;
        }

        this.henri.pen.error(
          'view',
          `server rendering of '${page.component}' failed, rendering in the browser`,
          error.message
        );
        body = null;
      }
    }

    if (typeof body !== 'string') {
      body = shell.clientBody(this.options.id, page);
    }

    const assets = this.vite
      ? shell.devTags(this.options.entry, this.styles)
      : shell.assetTags(this.manifest, this.options.entry);
    const meta = nonce ? [shell.nonceMeta(nonce)] : [];

    // Every tag of the document is nonced at once, this engine's and the
    // ones vite and the server bundle wrote (see shell.withNonce)
    return shell.withNonce(
      shell.inject(template, {
        body,
        head: [].concat(meta, head, assets).join('\n    '),
      }),
      nonce
    );
  }

  /**
   * Answer a rendering error
   *
   * @param {import('express').Response} res the response
   * @param {object} page the page object
   * @param {Error} error the error
   * @returns {void}
   * @memberof InertiaEngine
   */
  fail(res, page, error) {
    this.henri.pen.error(
      'view',
      `unable to render '${page.component}'`,
      error.message
    );
    debug(error);

    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');

    if (this.henri.isProduction) {
      return res.send('Internal Server Error');
    }

    return res.send(
      `<!doctype html><title>henri - error</title><pre>${shell.escapeHtml(
        error.stack || error.message
      )}</pre>`
    );
  }

  /**
   * Stops the vite dev server
   *
   * @async
   * @returns {Promise<boolean>} success
   * @memberof InertiaEngine
   */
  async close() {
    if (this.vite) {
      await this.vite.close();
      this.vite = null;
    }

    return true;
  }
}

InertiaEngine.componentName = componentName;
InertiaEngine.findPackage = findPackage;
InertiaEngine.partial = partial;
InertiaEngine.DEFAULTS = DEFAULTS;

/**
 * Does the application still author any Sass?
 *
 * The scaffold styles with Tailwind and ships no `.scss`, so an app only
 * needs the `sass` package when it wrote some itself. Build output is
 * skipped: it holds the compiled css, never the sources.
 *
 * @param {string} dir the app/views directory
 * @returns {boolean} true when a .scss file is authored under it
 */
function hasStylesheets(dir) {
  const skipped = ['node_modules', 'dist', '.next', '.cache', '.turbo'];

  try {
    return fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .some(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith('.scss') &&
          !skipped.some((name) =>
            entry.parentPath.includes(`${path.sep}${name}`)
          )
      );
  } catch {
    return false;
  }
}

module.exports = InertiaEngine;
