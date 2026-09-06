/**
 * Henri modules should extend this class
 *
 * @class BaseModuleClass
 */
class BaseModuleClass {
  /**
   * Creates an instance of BaseModuleClass.
   * @memberof BaseModuleClass
   */
  constructor() {
    /** Make henri available to the module */
    this.henri = null;

    /** The name given to the module */
    this.name = 'unnamed';

    /**
     * The modules this one cannot work without
     *
     * They have to be registered, and they finish before this one starts:
     * `needs = ['model']` says "the models exist when my init() runs". The
     * boot fails, naming both modules, when nobody provides one of them.
     *
     * @type {Array<string>}
     */
    this.needs = [];

    /**
     * Ordering only: the modules that go first when they are there
     * Same as `needs`, without requiring them to be registered. Use it for
     * what the module works around when it is missing.
     *
     * @type {Array<string>}
     */
    this.after = [];

    /**
     * Ordering only: the modules that wait for this one when they are there
     *
     * The other half of the pin, and the one a dependency cannot express:
     * `before = ['router']` says "I run before the routes are mounted",
     * which is what a module adding middlewares needs.
     *
     * @type {Array<string>}
     */
    this.before = [];

    /**
     * Module runlevel: the slot it sits in
     *
     * A module that names nothing (no `needs`, `after` or `before`) is
     * ordered by this number alone: it starts after every module of a lower
     * level and before every module of a higher one. Naming replaces it,
     * but the number stays the module's slot, which is what other people's
     * numeric pins and the boot ceiling (`new Henri({ runlevel })`) are
     * measured against.
     *
     * 0 = Early stage: configuration, log and modules bootstrapping is done here
     * 1 = Second stage: graphql and mailer are loaded here
     * 2 = Third stage: controllers are loaded and express is getting ready
     * 3 = Fourth stage: models are loaded, added to gql and the view is compiling
     * 4 = Fifth stage: user (login, passwords and routes protections)
     * 5 = Sixth stage: routes are read and setup, workers are started here
     * 6 = Last stage: application modules, once henri is up
     *
     * Reloadable modules are reloaded in the same order they started in
     */
    this.runlevel = 6;

    /**
     * Not reloadable by default
     *
     * A reloadable module implements `reload()`, called in graph order on
     * every reload. Any module, reloadable or not, may also implement
     * `release()`: it is called first, in the reverse order, so a module can
     * let go of what it holds before the modules it depends on rebuild
     * under it. Neither is required.
     */
    this.reloadable = false;

    /** The key that we should bind to to display terminal info. */
    this.key = null;

    this.consoleOnly = false;

    this.init = this.init.bind(this);
  }

  /**
   * This is called when the modules started
   *
   * @returns {String} Message
   * @memberof BaseModuleClass
   */
  init() {
    BaseModuleClass._out(this.name, 'init method is not implemented');
  }

  /**
   * Private method
   *
   * @returns {String} Message
   * @memberof BaseModuleClass
   */
  static _out(...args) {
    // eslint-disable-next-line no-console
    return console.log(...args);
  }
}

module.exports = BaseModuleClass;
