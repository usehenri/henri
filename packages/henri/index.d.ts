// Type definitions for henri v0.17.0
// Project: http://usehenri.io/
// Definitions by: Felix-Antoine Paradis <https://github.com/reel>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/// <reference types="mongoose" />
/// <reference types="node" />
/// <reference types="config" />

declare namespace henri {
  /**
   * Logging facility backed by winston
   */
  namespace log {
    function error(message: string): void;
    function error(message: string, callback: () => void): void;
    function warn(message: string): void;
    function warn(message: string, callback: () => void): void;
    function info(message: string): void;
    function info(message: string, callback: () => void): void;
    function verbose(message: string): void;
    function verbose(message: string, callback: () => void): void;
    function debug(message: string): void;
    function debug(message: string, callback: () => void): void;
    function silly(message: string): void;
    function silly(message: string, callback: () => void): void;
    function notify(title: string, message: string): void;
    function space(): void;
    function fatalError(s: string): never;
  }

  /**
   * Private -- Holds the modules
   */
  const _modules: object;

  /**
   * Private -- Holds the loaders
   */
  const _loaders: any;

  /**
   * Private -- Holds the unloaders
   */
  const _unloaders: any;

  /**
   * Private -- Holds the models
   */
  const _models: any;
  /**
   * Private -- Holds the routes
   */
  const _routes: any;
  /**
   * Private -- Holds the middlewares
   */
  const _middlewares: any;

  /**
   * Private -- Holds the user model (to be called later by passport)
   */
  const _user: any;

  /**
   * folders are holding the configured targets for views
   * mostly used to mock testing locations
   */
  namespace folders {
    /**
     * view folder
     */
    const view: string;
  }

  /**
   * status holds different status of the application
   * is used by henri.getStatus() and henri.setStatus()
   */
  const status: object;

  /**
   * Set a status key
   */
  function setStatus(key: string, value: any = false): void;

  /**
   * Get a status key
   */
  function getStatus(key: string): any;

  /**
   * config is an interface to the config package
   */
  namespace config {
    /** returns setting or throws if inexistant */
    function get<T>(setting: string): T;
    /** checks if the setting exists... use before .get() */
    function has(setting: string): boolean;
  }

  /**
   * loads a module unto henri global object.
   * will kill process if it exists */
  function addModule(name: string, func: () => void, force: boolean): void;

  /**
   * add a locader function if not in production
   * this function will be called in order when the filesystem changes
   * triggers a backend reload (views excluded)
   */
  function addLoader(func: () => void): void;

  /**
   * add an unlocader function if not in production
   * this function will be called to tear down the application when the
   * filesystem changes triggers a backend reload (views excluded)
   */
  function addUnloader(func: () => void): void;

  /** adds an express middleware that needs to be added back on reload*/
  function addMiddleware(func: () => void): void;

  /** loads the loaders added by addLoader() */
  async function reload(): void;

  /** tears down the application on reload, executes unloaders added with addUnloader() */
  async function stop(): void;

  /**
   * Checks if the listed packages are installed
   */
  function checkPackages(packages: string[]): void;

  /**
   * Returns the current henri version
   */
  const release: string;

  /**
   * Returns true if in production (NODE_ENV)
   */
  const isProduction: boolean;

  /**
   * Returns true if in development or not in prod/test (NODE_ENV)
   */
  const isDev: boolean;

  /**
   * Returns true if in test (NODE_ENV)
   */
  const isTest: boolean;

  /**
   * Get the current working directory of the project
   */
  const cwd: string;

  /**
   * Returns the difference in ms from another process.hrtime
   */
  function getDiff(hrtime: [number, number]): number;
}
