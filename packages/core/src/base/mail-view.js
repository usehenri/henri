const path = require('path');
const fs = require('fs');

const TemplateEngine = require('../engines/template');
const { htmlToText } = require('./mail-text');

/** View and layout extensions, in order of preference */
const EXTENSIONS = ['hbs', 'html', 'htm'];

/** The layout used when the mailer, the configuration and the call are silent */
const DEFAULT_LAYOUT = 'mailer';

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
 * The views of the mailers, in app/views/mailers
 *
 * A message is rendered by the same engine that renders the pages: when the
 * application's view engine implements `renderMail({ view, layout, data })`
 * it is asked first, and henri's handlebars environment (the one behind
 * `res.hbs`, with the application's partials and helpers) renders it
 * otherwise. That environment exists in every application, whatever the
 * renderer, which is what makes mail views portable: email html is a
 * different medium from a page (no scripts, inlined styles, table layouts),
 * so it is written on its own rather than reused from the pages.
 *
 * Resolution, for the mailer `welcome` and the action `confirm`:
 *
 * - `app/views/mailers/welcome/confirm.hbs`  the rich part
 * - `app/views/mailers/welcome/confirm.text.hbs`  the plain part (optional)
 * - `app/views/mailers/layouts/mailer.hbs`  the layout, `{{{body}}}` inside
 * - `app/views/mailers/layouts/mailer.text.hbs`  the layout of the plain part
 *
 * @class MailViews
 */
class MailViews {
  /**
   * Creates an instance of MailViews.
   *
   * @param {Henri} henri the henri instance
   * @memberof MailViews
   */
  constructor(henri) {
    this.henri = henri;
    /** Used when the view module is not up (console, runlevel < 3) */
    this._standalone = null;
    this._ready = null;

    this.render = this.render.bind(this);
    this.resolve = this.resolve.bind(this);
  }

  /**
   * The mail views directory
   *
   * @readonly
   * @returns {string} app/views/mailers, absolute
   * @memberof MailViews
   */
  get root() {
    return path.join(this.henri.cwd(), 'app/views/mailers');
  }

  /**
   * The handlebars engine rendering the mail: the application's own when the
   * view module is up, a standalone one otherwise
   *
   * @returns {TemplateEngine} the engine
   * @memberof MailViews
   */
  template() {
    const { view } = this.henri;

    if (view && view.hbs) {
      return view.hbs;
    }

    if (!this._standalone) {
      this._standalone = new TemplateEngine(this.henri);
      this._ready = this._standalone.init();
    }

    return this._standalone;
  }

  /**
   * Wait for the partials of the standalone engine, if any
   *
   * @async
   * @returns {Promise<boolean>} always true
   * @memberof MailViews
   */
  async ready() {
    const engine = this.template();

    try {
      await (engine.ready || this._ready);
    } catch (error) {
      this.henri.pen.warn('mailers', 'partials', error.message);
    }

    return true;
  }

  /**
   * Resolve a view name to a file under app/views/mailers
   * `welcome/confirm` matches `welcome/confirm.{hbs,html,htm}` then
   * `welcome/confirm/index.{hbs,html,htm}`. Nothing outside the directory is
   * ever resolved.
   *
   * @param {string} name the view name (ex: welcome/confirm)
   * @param {string} [suffix=''] `.text` for the plain part
   * @returns {?string} the absolute path, or null
   * @memberof MailViews
   */
  resolve(name, suffix = '') {
    const clean = path.posix.normalize(`/${String(name || '')}`).slice(1);

    if (!clean || clean.startsWith('..') || clean.includes('\0')) {
      return null;
    }

    const candidates = [
      ...EXTENSIONS.map((ext) => `${clean}${suffix}.${ext}`),
      ...EXTENSIONS.map((ext) => `${clean}/index${suffix}.${ext}`),
    ];

    for (const candidate of candidates) {
      const file = path.join(this.root, candidate);

      if (!file.startsWith(`${this.root}${path.sep}`)) {
        return null;
      }

      if (isFile(file)) {
        return file;
      }
    }

    return null;
  }

  /**
   * Resolve a layout name to a file under app/views/mailers/layouts
   *
   * @param {(string|boolean)} name the layout name, or false for none
   * @param {string} [suffix=''] `.text` for the plain part
   * @returns {?string} the absolute path, or null
   * @memberof MailViews
   */
  layout(name, suffix = '') {
    if (name === false || name === null || typeof name === 'undefined') {
      return null;
    }

    return this.resolve(path.posix.join('layouts', String(name)), suffix);
  }

  /**
   * The layouts available, by name
   *
   * @returns {Array<string>} the layout names
   * @memberof MailViews
   */
  layouts() {
    const dir = path.join(this.root, 'layouts');
    const names = new Set();

    try {
      for (const file of fs.readdirSync(dir)) {
        const ext = path.extname(file).replace('.', '');

        if (EXTENSIONS.includes(ext)) {
          names.add(path.basename(file, `.${ext}`).replace(/\.text$/, ''));
        }
      }
    } catch (error) {
      return [];
    }

    return Array.from(names).sort();
  }

  /**
   * Render one template file with the mail context
   *
   * @param {string} file absolute path of the template
   * @param {object} data the template context
   * @param {object} meta the handlebars data variables (@localUrl, ...)
   * @returns {string} the rendered string
   * @throws when the template does not compile or fails at runtime
   * @memberof MailViews
   */
  one(file, data, meta) {
    return this.template().compile(file)(data, { data: meta });
  }

  /**
   * Render a message: the rich part, the plain part and the layouts
   *
   * The application's view engine gets the first word: an engine that
   * implements `renderMail({ view, layout, data, meta })` and answers with
   * `{ html, text }` (or a string) renders the message itself.
   *
   * @async
   * @param {object} options the message
   * @param {string} options.view the view name (ex: welcome/confirm)
   * @param {(string|boolean)} [options.layout] the layout name, false for none
   * @param {object} [options.data={}] the template context
   * @param {object} [options.meta={}] the handlebars data variables
   * @returns {Promise<{html: string, text: string}>} the two parts
   * @throws when no view matches the name
   * @memberof MailViews
   */
  async render({ view, layout = DEFAULT_LAYOUT, data = {}, meta = {} } = {}) {
    const engine = this.henri.view && this.henri.view.engine;

    if (engine && typeof engine.renderMail === 'function') {
      const answer = await engine.renderMail({ data, layout, meta, view });
      const html = typeof answer === 'string' ? answer : answer.html;

      return {
        html,
        text:
          typeof answer === 'object' && typeof answer.text === 'string'
            ? answer.text
            : htmlToText(html),
      };
    }

    await this.ready();

    const file = this.resolve(view);

    if (!file) {
      throw new Error(
        `No mail view found for '${view}' in app/views/mailers (looked for ${view}.{${EXTENSIONS.join(',')}})`
      );
    }

    const body = this.one(file, data, meta);
    const shell = this.layout(layout);
    const html = shell
      ? this.one(shell, Object.assign({}, data, { body }), meta)
      : body;

    return { html, text: this.text({ data, layout, meta, view }, html) };
  }

  /**
   * The plain text part: the authored `<view>.text.*` when there is one,
   * derived from the rich part otherwise
   *
   * @param {object} options the message ({ view, layout, data, meta })
   * @param {string} html the rendered rich part
   * @returns {string} the plain text part
   * @memberof MailViews
   */
  text({ view, layout, data, meta }, html) {
    const file = this.resolve(view, '.text');

    if (!file) {
      return htmlToText(html);
    }

    const body = this.one(file, data, meta);
    const shell = this.layout(layout, '.text');

    return shell
      ? this.one(shell, Object.assign({}, data, { body }), meta)
      : body;
  }
}

module.exports = MailViews;
module.exports.DEFAULT_LAYOUT = DEFAULT_LAYOUT;
module.exports.EXTENSIONS = EXTENSIONS;
