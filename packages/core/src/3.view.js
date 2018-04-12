const BaseModule = require('./base/module');
const bounce = require('bounce');

const allowed = {
  inferno: 'react',
  preact: 'react',
  react: 'react',
  template: 'template',
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

    this.renderer = 'template';
    this.engine = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
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
      ? config.get('renderer')
      : 'template';

    if (!allowed.hasOwnProperty(this.renderer)) {
      pen.fatal(
        'view',
        `Unable to load '${
          this.renderer
        }' renderer. See your configuration file...
      
      Valid entries are: ${Object.keys(allowed).join(' ')}
      `
      );
    }

    // eslint-disable-next-line global-require
    const Engine = require(`./engines/${allowed[this.renderer]}`);

    this.engine = new Engine(this.henri);

    try {
      this.engine.init && (await this.engine.init());
    } catch (error) {
      bounce.rethrow(error, 'system');
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
      try {
        await this.engine.reload();
      } catch (error) {
        bounce.rethrow(error, 'system');
      }
    }

    return this.name;
  }
}

module.exports = View;
