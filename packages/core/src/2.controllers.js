const BaseModule = require('./base/module');
const path = require('path');
const { loadModules } = require('./utils');
const { RESERVED, chain, hooksFor } = require('./base/hooks');

/**
 * Controllers module
 * @module Controllers
 */
class Controllers extends BaseModule {
  /**
   * Creates an instance of Controllers.
   * @memberof Controllers
   */
  constructor() {
    super();
    this.reloadable = true;
    this.needs = ['config'];
    this.runlevel = 2;
    this.name = 'controllers';
    this.henri = null;

    this._controllers = new Map();
    /** The controller modules, for the `before` hooks they export */
    this._modules = new Map();

    this.configure = this.configure.bind(this);
    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.get = this.get.bind(this);
    this.hooks = this.hooks.bind(this);
    this.set = this.set.bind(this);
  }

  /**
   * Loads the files from disk
   * Sub-directories prefix the controller name (`admin/users#index`).
   *
   * @static
   * @param {string} location defaults: ./app/controllers
   * @returns {Promise<object>} list of objects
   * @throws when a controller fails to load
   * @memberof Controllers
   */
  static async load(location) {
    return loadModules(path.resolve(location), { keepDirectoryPath: true });
  }

  /**
   *
   * Configure the models and adapters
   *
   * Every exported function becomes an action (`tasks#index`), except the
   * reserved keys (`before`), which describe the controller instead.
   *
   * @param {object} controllers Controllers loaded from disk
   * @returns {boolean} success
   * @memberof Controllers
   */
  async configure(controllers) {
    for (const id in controllers) {
      if (typeof controllers[id] !== 'undefined') {
        const controller = controllers[id];

        this._modules.set(id, controller);

        for (const key in controller) {
          if (typeof controller[key] !== 'undefined' && !RESERVED.has(key)) {
            const method = controller[key];

            if (typeof method === 'function') {
              this._controllers.set(`${id}#${key}`, method);
            }
          }
        }
      }
    }

    return true;
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @throws when a controller fails to load
   * @returns {!string} The name of the module
   * @memberof Controllers
   */
  async init() {
    await this.configure(
      await Controllers.load(path.join(this.henri.cwd(), 'app/controllers'))
    );

    return this.name;
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Controllers
   */
  async reload() {
    this._controllers.clear();
    this._modules.clear();
    await this.init();

    return this.name;
  }

  /**
   * The `before` hooks of an action, as express middlewares
   *
   * A controller exports them as `before`: an object keyed by action
   * (`all`, `show`, `'create,update'`) or an array of functions and
   * `{ run, only, except }` selectors. See base/hooks.js.
   *
   * @param {string} key The controller name (ex: tasks#show)
   * @returns {Array<function>} The middlewares, in declaration order
   * @memberof Controllers
   */
  hooks(key) {
    const [name, action] = String(key).split('#');
    const controller = this._modules.get(name);

    if (!controller || !action) {
      return [];
    }

    return chain(hooksFor(controller.before, action, controller));
  }

  /**
   * Getter for controllers
   *
   * @param {string} key The controller name (ex: main#index)
   * @returns {function} The express signed function (req, res)
   * @memberof Controllers
   */
  get(key) {
    return this._controllers.get(key);
  }

  /**
   * Set a controller
   *
   * @param {string} key  Controller name (ex: main#index)
   * @param {any} value The express signed function (req, res)
   * @returns {boolean} success?
   * @memberof Controllers
   */
  set(key, value) {
    if (typeof value === 'function') {
      this._controllers.set(key, value);

      return true;
    }

    return false;
  }

  /**
   * Returns an iterable for all the controllers
   *
   * @returns {Iterable} Controllers
   * @memberof Controllers
   */
  all() {
    return Array.from(this._controllers);
  }

  /**
   * Number of controllers registered
   *
   * @returns {number} Controllers size
   * @memberof Controllers
   */
  size() {
    return this._controllers.size;
  }

  /**
   * Stops the module
   *
   * @async
   * @static
   * @returns {(string|boolean)} Module name or false
   * @memberof Controllers
   */
  static async stop() {
    return false;
  }
}

module.exports = Controllers;
