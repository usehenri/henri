const BaseModule = require('./base/module');
const { nonceEnabled } = require('./base/headers');
const { suggestedRenderer } = require('./base/renderer');

const allowed = {
  inertia: 'inertia',
  react: 'react',
  template: 'template',
};

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

    this.engine.init && (await this.engine.init());

    return this.name;
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
