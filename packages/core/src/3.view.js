const BaseModule = require('./base/module');

const allowed = {
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

    this.renderer = config.has('renderer')
      ? config.get('renderer').toLowerCase()
      : 'template';

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
      `
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
