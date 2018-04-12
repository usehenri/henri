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
     * Module runlevel
     * This is in which order the module will be loaded unloaded
     *
     * 0 = Early stage, after config and log
     * 1 = Second stage (needs to be defined)
     * 2 = Third stage (needs to be defined)
     * 3 = Fourth stage (needs to be defined)
     * 4 = Fifth stage (needs to be defined)
     * 5 = Sixth stage (needs to be defined)
     * 6 = Last stage (needs to be defined)
     *
     * Modules are loaded in that order
     *
     * Reloadable modules are teared down in reverse order and loaded in order
     */
    this.runlevel = 5;

    /** Not reloadable by default */
    this.reloadable = false;

    /** The key that we should bind to to display terminal info. */
    this.key = null;

    this.consoleOnly = false;

    this.init = this.init.bind(this);
    this.info = this.info.bind(this);
    this.setup = this.setup.bind(this);
    this.start = this.start.bind(this);
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
   * Method to be called if 'key' is defined
   *
   * @returns {String} Message
   * @memberof BaseModuleClass
   */
  info() {
    BaseModuleClass._out(this.name, 'info method is not implemented');
  }

  /**
   * Method to set things up before starting
   *
   * @returns {String} Message
   * @memberof BaseModuleClass
   */
  setup() {
    BaseModuleClass._out(this.name, 'setup method is not implemented');
  }

  /**
   * This should be called by init after setup
   *
   * @returns {String} Message
   * @memberof BaseModuleClass
   */
  start() {
    BaseModuleClass._out(this.name, 'start method is not implemented');
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
