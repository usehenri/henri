const path = require('path');
const fs = require('fs');
const { glob } = require('glob');
const handlebars = require('handlebars');
const { negotiate } = require('../base/http');

/** Page and partial extensions, in order of preference */
const EXTENSIONS = ['hbs', 'html', 'htm'];

/**
 * Is the path an existing file?
 *
 * @param {string} file the path
 * @returns {boolean} exists and is a file
 */
const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch (error) {
    return false;
  }
};

/**
 * Handlebars engine
 *
 * Pages live in app/views/pages and are resolved exactly: `/artwork` is
 * `pages/artwork.{hbs,html,htm}`, then `pages/artwork/index.*`. Compiled
 * templates are cached by file (invalidated when the file changes and on
 * reload). Partials in app/views/partials are registered by relative name.
 *
 * @class TemplateEngine
 */
class TemplateEngine {
  /**
   * Creates an instance of TemplateEngine.
   * @param {Henri} thisHenri The current instance of henri
   * @memberof TemplateEngine
   */
  constructor(thisHenri) {
    this.henri = thisHenri;

    /** An isolated handlebars environment (helpers and partials) */
    this.hbs = handlebars.create();
    this.cache = new Map();
    this.partials = [];
    this.ready = null;

    /**
     * The engine writes the nonce of the response wherever a template asks
     * for it: `{{nonce}}` (the helper below) or `{{@nonce}}` (the view
     * option, like `{{@user}}` or `{{@paths}}`). A template that ships an
     * inline script is the one that knows where it is, so henri does not
     * rewrite the html it compiles.
     */
    this.supportsNonce = true;

    this.hbs.registerHelper('nonce', (options) => {
      const data = (options && options.data) || {};

      // Never `undefined` in the document: an empty attribute is refused by
      // the browser, which is the truthful answer when there is no nonce
      return data.nonce || '';
    });

    this.registerI18n();

    /** Kept for res.hbs, which renders through the instance */
    this.instance = {
      render: (req, res, route, opts) => this.renderPage(req, res, route, opts),
    };

    this.init = this.init.bind(this);
    this.fallback = this.fallback.bind(this);
    this.render = this.render.bind(this);
    this.renderPage = this.renderPage.bind(this);
    this.resolvePage = this.resolvePage.bind(this);
    this.prepare = this.prepare.bind(this);
    this.reload = this.reload.bind(this);
  }

  /**
   * The views directory
   *
   * @readonly
   * @returns {string} app/views, absolute
   * @memberof TemplateEngine
   */
  get root() {
    return path.join(this.henri.cwd(), 'app/views');
  }

  /**
   * The init method: registers the partials
   *
   * @async
   * @returns {Promise<boolean>} success
   * @throws when the partials directory cannot be read
   * @memberof TemplateEngine
   */
  async init() {
    this.ready = this.registerPartials();
    await this.ready;

    return true;
  }

  /**
   * Called after init to prepare the server
   *
   * @async
   * @returns {Promise<boolean>} always true (for compatibility)
   * @memberof TemplateEngine
   */
  async prepare() {
    return true;
  }

  /**
   * Add catchall route to render directly from the folder
   * Requests without a matching page are passed on (to the 404 handler).
   *
   * @param {Express.Router} router A router to register the catchall
   * @returns {void}
   * @memberof TemplateEngine
   */
  fallback(router) {
    router.use(
      this.henri.server.express.static(path.join(this.root, 'public'))
    );
    router.get('/{*splat}', (req, res, next) => {
      if (!this.resolvePage(req.path)) {
        return next();
      }

      return this.renderPage(req, res, req.path, {});
    });
  }

  /**
   * Used by res.render
   *
   * @param {Express.Request} req Request
   * @param {Express.Response} res Response
   * @param {String} route A string matching the location from ./app/views/pages
   * @param {Object} opts Data or any other options going to the view
   * @returns {Promise<void>} resolves once the response is sent
   * @memberof TemplateEngine
   */
  render(req, res, route, opts) {
    return this.renderPage(req, res, route, opts);
  }

  /**
   * Render a page: 404 when no page matches, 500 (with the stack logged)
   * when the template fails at runtime
   *
   * The template context is `opts.data`; the other view options (user,
   * paths, query, localUrl, errors) are exposed as handlebars data
   * variables: `{{@user.email}}`, `{{@paths.index_artwork_path.route}}`.
   *
   * @async
   * @param {Express.Request} req Request
   * @param {Express.Response} res Response
   * @param {String} route A string matching the location from ./app/views/pages
   * @param {Object} [opts={}] Data or any other options going to the view
   * @returns {Promise<void>} resolves once the response is sent
   * @memberof TemplateEngine
   */
  async renderPage(req, res, route, opts = {}) {
    const { pen } = this.henri;

    if (!this.ready) {
      this.ready = this.registerPartials();
    }

    try {
      await this.ready;
    } catch (error) {
      return this.fail(res, route, error);
    }

    const file = this.resolvePage(route);

    if (!file) {
      pen.warn('template', `no page found for ${route}`);

      return negotiate(
        res,
        404,
        this.henri.isProduction
          ? 'Not Found'
          : `No page found for ${route} in app/views/pages`
      );
    }

    try {
      const view = this.compile(file);
      const { data = {}, ...rest } = opts || {};
      const html = view(data || {}, { data: rest });

      return res.send(html);
    } catch (error) {
      return this.fail(res, route, error);
    }
  }

  /**
   * Answer a 500 for a template error, logging the stack
   *
   * @param {Express.Response} res Response
   * @param {string} route the route being rendered
   * @param {Error} error the error
   * @returns {void}
   * @memberof TemplateEngine
   */
  fail(res, route, error) {
    const { pen } = this.henri;
    const dev = !this.henri.isProduction;

    pen.error('template', `An error occured while rendering ${route}`);
    pen.error('template', error.stack || error.message);

    return negotiate(
      res,
      500,
      dev ? error.message : 'Internal Server Error',
      dev ? { stack: error.stack } : {},
      dev ? error.stack || error.message : ''
    );
  }

  /**
   * Resolve a route to a page file, exactly
   * `/artwork` matches `pages/artwork.{hbs,html,htm}` then
   * `pages/artwork/index.{hbs,html,htm}`; `/` is `/index`.
   *
   * @param {string} route the route (ex: /artwork, /artwork/index)
   * @returns {?string} the absolute file path, or null
   * @memberof TemplateEngine
   */
  resolvePage(route) {
    let clean = String(route || '/').split('?')[0];

    try {
      clean = decodeURIComponent(clean);
    } catch (error) {
      return null;
    }

    if (clean.includes('\0')) {
      return null;
    }

    clean = path.posix.normalize(`/${clean}`);

    if (clean.endsWith('/')) {
      clean = `${clean}index`;
    }

    const pages = path.join(this.root, 'pages');
    const candidates = [
      ...EXTENSIONS.map((ext) => `${clean}.${ext}`),
      ...EXTENSIONS.map((ext) => `${clean}/index.${ext}`),
    ];

    for (const candidate of candidates) {
      const file = path.join(pages, candidate);

      // Never leave the pages directory
      if (!file.startsWith(`${pages}${path.sep}`)) {
        return null;
      }

      if (isFile(file)) {
        return file;
      }
    }

    return null;
  }

  /**
   * Compile a template file (cached until the file changes)
   *
   * @param {string} file absolute path of the template
   * @returns {function} the compiled template
   * @throws when the template does not compile
   * @memberof TemplateEngine
   */
  compile(file) {
    const { mtimeMs } = fs.statSync(file);
    const cached = this.cache.get(file);

    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.compiled;
    }

    // Parse eagerly: handlebars compiles lazily and would only report a
    // syntax error at render time
    const ast = this.hbs.parse(fs.readFileSync(file, 'utf8'), {
      srcName: file,
    });
    const compiled = this.hbs.compile(ast);

    this.cache.set(file, { compiled, mtimeMs });

    return compiled;
  }

  /**
   * The three helpers a Handlebars page needs to speak a second language.
   *
   * **`{{t "key" name=value}}`** is the translation, and it is the one
   * place in henri that escapes anything. A translation is a template a
   * developer wrote and committed, so it goes out as written and may carry
   * markup on purpose; the values interpolated into it are application
   * data, so every one of them is escaped on the way in and the result is
   * a `SafeString`. That is the whole rule: the sentence is trusted
   * because a person wrote it, the values never are.
   *
   * **`{{number x}}`** and **`{{date x}}`** are `Intl.NumberFormat` and
   * `Intl.DateTimeFormat` with the locale of the render, and henri invents
   * no option for either: the hash *is* the options object, passed through
   * unchanged. They exist because Handlebars has no expressions -- a
   * `.jsx` page calls `Intl` itself and gets nothing from henri here --
   * and not because henri has an opinion about formatting.
   *
   * @returns {boolean} whether they were registered
   * @memberof TemplateEngine
   */
  registerI18n() {
    /**
     * The locale of the render being written, from the data frame
     *
     * @param {object} options the helper options
     * @returns {?string} the locale, or null
     */
    const localeOf = (options) => {
      const data = (options && options.data) || {};
      const hash = (options && options.hash) || {};

      return hash.locale || (data.i18n && data.i18n.locale) || null;
    };

    this.hbs.registerHelper('t', (key, options) => {
      const { i18n } = this.henri;
      const hash = Object.assign({}, (options && options.hash) || {});
      const locale = localeOf(options);

      delete hash.locale;

      if (!i18n || !i18n.enabled) {
        return typeof key === 'string' ? key : '';
      }

      const data = (options && options.data) || {};
      // The plain part of a mail says so, and nothing is escaped into it:
      // text/plain has no markup to hide a value in (see base/mail-view.js)
      const plain = Boolean(data.i18n && data.i18n.text);

      return new this.hbs.SafeString(
        i18n.t(key, hash, {
          escape: plain ? null : this.hbs.escapeExpression,
          locale: i18n.supports(locale) ? locale : null,
        })
      );
    });

    this.hbs.registerHelper('number', (value, options) => {
      const locale = localeOf(options) || undefined;
      const given = Number(value);

      if (!Number.isFinite(given)) {
        return '';
      }

      return new Intl.NumberFormat(
        locale,
        (options && options.hash) || {}
      ).format(given);
    });

    this.hbs.registerHelper('date', (value, options) => {
      const locale = localeOf(options) || undefined;
      const when = value instanceof Date ? value : new Date(value);

      if (Number.isNaN(when.getTime())) {
        return '';
      }

      return new Intl.DateTimeFormat(
        locale,
        (options && options.hash) || {}
      ).format(when);
    });

    return true;
  }

  /**
   * Registers the partials in ./app/views/partials
   * A partial that does not compile is reported and skipped.
   *
   * @returns {Promise<Array>} the partial files
   * @memberof TemplateEngine
   */
  async registerPartials() {
    const dir = path.join(this.root, 'partials');
    const files = (
      await glob(`**/*.{${EXTENSIONS.join(',')}}`, {
        cwd: dir,
        nodir: true,
        posix: true,
      })
    ).sort();

    this.partials.map((view) => this.hbs.unregisterPartial(view));
    this.partials = [];

    for (const view of files) {
      const name = view.replace(path.extname(view), '');

      try {
        this.hbs.registerPartial(name, this.compile(path.join(dir, view)));
        this.partials.push(name);
      } catch (error) {
        this.henri.pen.error('template', `partial ${view}`, error.message);
      }
    }

    return files;
  }

  /**
   * Triggered on reload: drops the cache and registers the partials again
   *
   * @async
   * @returns {Promise<boolean>} success
   * @memberof TemplateEngine
   */
  async reload() {
    this.cache.clear();
    this.ready = this.registerPartials();
    await this.ready;

    return true;
  }
}

module.exports = TemplateEngine;
