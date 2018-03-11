/**
 * BaseModuleClass
 *
 * henri modules should extend this class
 */

class BaseModuleClass {
  constructor() {
    /** the name given to the module */
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

    /** not reloadable by default */
    this.reloadable = false;

    /** the key that we should bind to to display terminal info. */
    this.key = null;
  }

  /** this is called when the modules started */
  init() {
    this._out(this.name, 'init method is not implemented');
  }

  /** method to be called if 'key' is defined */
  info() {
    this._out(this.name, 'info method is not implemented');
  }

  /** will be called if reloadable === true */
  reload() {
    this._out(this.name, 'reload method is not implemented');
  }

  /** method to set things up before starting */
  setup() {
    this._out(this.name, 'setup method is not implemented');
  }

  /** this should be called by init after setup */
  start() {
    this._out(this.name, 'start method is not implemented');
  }

  /** will be called if reloadable and on clean teardown */
  stop() {
    this._out(this.name, 'stop method is not implemented');
  }

  _out(...args) {
    // eslint-disable-next-line no-console
    return console.log(...args);
  }
}

module.exports = BaseModuleClass;
