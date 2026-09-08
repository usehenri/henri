const BaseModule = require('./base/module');
const { assetOrigin, assetPrefix } = require('./base/assets');
const { cspLosses, nonceEnabled } = require('./base/headers');
const { suggestedRenderer } = require('./base/renderer');

const allowed = {
  inertia: 'inertia',
  react: 'react',
  template: 'template',
};

/** The renderers with a production build, so the ones an asset prefix reaches */
const BUILT = ['inertia', 'react'];

/** Renderers that only load when `config.experimental.<name>` is true */
const experimental = {
  vue: 'vue',
};

/**
 *  View module
 *
 * @class View
 * @extends {BaseModule}
 */
class View extends BaseModule {
  /**
   * Creates an instance of View.
   * @memberof View
   */
  constructor() {
    super();
    this.reloadable = true;
    this.needs = ['config', 'server'];
    this.runlevel = 3;
    this.name = 'view';
    this.henri = null;
    this.consoleOnly = true;
    this.hbs = undefined;

    this.renderer = 'template';
    this.engine = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @throws
   * @returns {!string} The name of the module
   * @memberof View
   */
  async init() {
    const { config, pen } = this.henri;

    const configured = config.has('renderer');

    this.renderer = configured
      ? config.get('renderer').toLowerCase()
      : 'template';

    if (!configured) {
      const suggestion = suggestedRenderer(process.cwd());

      suggestion &&
        pen.warn(
          'view',
          `${suggestion.package} is installed but "renderer" is not set, so pages are rendered with handlebars`,
          `=> add "renderer": "${suggestion.renderer}" to your configuration`
        );
    }

    const engines = Object.assign({}, allowed);

    for (const name of Object.keys(experimental)) {
      if (config.get(`experimental.${name}`, true) === true) {
        engines[name] = experimental[name];
      }
    }

    if (!Object.prototype.hasOwnProperty.call(engines, this.renderer)) {
      throw pen.fatal(
        'view',
        `Unable to load '${
          this.renderer
        }' renderer. See your configuration file...

      Valid entries are: ${Object.keys(allowed).join(' ')}
      Experimental (enable with "experimental": { "<name>": true }): ${Object.keys(
        experimental
      ).join(' ')}
      `,
        null,
        null,
        'HENRI_VIEW_UNKNOWN_RENDERER'
      );
    }

    const Template = require(`./engines/template.js`);

    this.hbs = new Template(this.henri);

    if (this.renderer === 'template') {
      this.engine = this.hbs;
    } else {
      const Engine = require(`./engines/${engines[this.renderer]}`);

      this.engine = new Engine(this.henri);
    }

    // A nonce that is generated, named by the header and then not written
    // into the document is worse than none: the page reads as protected and
    // every inline script it ships is refused instead. An engine says it can
    // carry one with `supportsNonce`; anything else fails the boot rather
    // than serving a policy it cannot honour
    if (nonceEnabled(config) && this.engine.supportsNonce !== true) {
      throw pen.fatal(
        'view',
        `The '${this.renderer}' renderer cannot carry a Content Security Policy nonce.

      "csp": { "nonce": true } asks every response for a nonce and names it
      in script-src. This renderer does not write it into the document, so
      the inline scripts it does ship would be refused by the browser.

      Renderers that carry it: inertia, react, template.
      `,
        null,
        null,
        'HENRI_VIEW_NONCE_UNSUPPORTED'
      );
    }

    this.assets(config, pen);

    this.engine.init && (await this.engine.init());

    return this.name;
  }

  /**
   * Say where the compiled assets come from.
   *
   * `config.assets.prefix` is read by the engine that has a production
   * build and by the Content Security Policy, and by nothing else -- so a
   * renderer with no build is told the key does nothing rather than left to
   * wonder, and the boot line says both where the urls point and that the
   * policy already allows them.
   *
   * That last half is a claim, so it is checked rather than asserted: an
   * application whose `config.helmet` replaced one of the asset directives
   * no longer names the origin there (`base/headers.js` says which, and
   * warns), and this line says nothing about a policy it no longer knows.
   *
   * @param {object} config henri's config module
   * @param {object} pen the pen
   * @returns {string} the prefix, or '' when there is none
   * @memberof View
   */
  assets(config, pen) {
    const prefix = assetPrefix(config);

    if (!prefix) {
      return '';
    }

    if (!BUILT.includes(this.renderer)) {
      pen.warn(
        'view',
        `"assets": { "prefix": "${prefix}" } is set, but the '${this.renderer}' renderer has no build to serve from somewhere else`,
        '=> the prefix is ignored; only the inertia and react renderers write asset urls'
      );

      return prefix;
    }

    const origin = assetOrigin(prefix);
    const lost = origin ? cspLosses({ config, isDev: this.henri.isDev }) : {};
    const named =
      origin && !Object.keys(lost).some((name) => lost[name].includes(origin));

    pen.info(
      'view',
      `assets from ${prefix}`,
      this.henri.isProduction ? '' : '(production builds only)',
      named ? `${origin} is named in the content security policy` : ''
    );

    return prefix;
  }

  /**
   * Stops the module: closes the engine (Next.js workers, watchers)
   *
   * @async
   * @returns {Promise<string>} Module name
   * @memberof View
   */
  async stop() {
    if (this.engine && typeof this.engine.close === 'function') {
      await this.engine.close();
    }

    return this.name;
  }

  /**
   * Reloads the module
   *
   * @async
   * @throws
   * @returns {string} Module name
   * @memberof View
   */
  async reload() {
    if (typeof this.engine.reload === 'function') {
      await this.engine.reload();
    }

    return this.name;
  }
}

module.exports = View;
