const BaseModule = require('./base/module');

const path = require('path');
const debug = require('debug')('henri:mailers');

const { accountsConfig } = require('./base/accounts');
const { loadModules } = require('./utils');
const MailViews = require('./base/mail-view');
const Message = require('./base/mail-message');
const previews = require('./base/mail-preview');

/**
 * Exported keys of a mailer that describe it instead of being actions
 * (`identity` and `globalId` are added by the loader)
 */
const RESERVED = new Set(['defaults', 'globalId', 'identity', 'previews']);

/** Where the previews are mounted, in development only */
const PREVIEW_PATH = '/_mailers';

/**
 * The mailers henri ships, for the mails it sends itself.
 *
 * `auth` holds the account flows (`base/accounts.js`). An application
 * overrides it action by action by writing `app/mailers/auth.js`, or view by
 * view by writing `app/views/mailers/auth/<action>.hbs`; whatever it does not
 * write keeps working, which is what lets a fresh application reset a
 * password before anyone has written a template.
 */
const BUILTINS = Object.freeze({ auth: require('./mailers/auth') });

/**
 * Mailers module
 *
 * Loads `app/mailers/*.js`, the way the controllers module loads
 * `app/controllers`. Every exported function is an action returning the
 * message it wants sent; henri renders it through the mail views
 * (`app/views/mailers`) and delivers it through `henri.mail`:
 *
 *     // app/mailers/welcome.js
 *     module.exports = {
 *       defaults: { from: 'Henri <no-reply@example.com>' },
 *
 *       confirm(user) {
 *         return {
 *           data: { user },
 *           subject: 'Confirm your address',
 *           to: user.email,
 *         };
 *       },
 *
 *       previews: { confirm: () => [{ email: 'ada@example.com' }] },
 *     };
 *
 *     await henri.mailers.welcome.confirm(user).deliver();
 *
 * @class Mailers
 * @extends {BaseModule}
 */
class Mailers extends BaseModule {
  /**
   * Creates an instance of Mailers.
   * @memberof Mailers
   */
  constructor() {
    super();

    this.reloadable = true;
    this.needs = ['config', 'mail'];
    this.runlevel = 2;
    this.name = 'mailers';
    this.henri = null;

    /** The mailers loaded from app/mailers, by name */
    this._mailers = new Map();
    /** The names exposed as `henri.mailers.<name>` */
    this._exposed = [];
    /** The delivery handler of deliverLater(), if the application set one */
    this._handler = null;
    /** The deliveries the default handler still has in flight */
    this.pending = new Set();
    /** The mail views (app/views/mailers) */
    this.views = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.deliver = this.deliver.bind(this);
    this.enqueue = this.enqueue.bind(this);
    this.message = this.message.bind(this);
    this.previews = this.previews.bind(this);
  }

  /**
   * Loads the mailer files from disk
   * Sub-directories prefix the mailer name (`admin/digest`).
   *
   * @static
   * @async
   * @param {string} location defaults: ./app/mailers
   * @returns {Promise<object>} the mailers, by name
   * @throws when a mailer fails to load
   * @memberof Mailers
   */
  static async load(location) {
    return loadModules(path.resolve(location), { keepDirectoryPath: true });
  }

  /**
   * Puts henri's own mailers behind the application's: an action the
   * application declares wins, one it left out falls back to henri's
   *
   * @static
   * @param {object} mailers the mailers loaded from app/mailers
   * @param {boolean} [wanted=true] false when the application asked for none
   *   of the flows they belong to, so nothing is registered
   * @returns {object} the mailers, by name
   * @memberof Mailers
   */
  static merge(mailers, wanted = true) {
    const merged = Object.assign({}, mailers);

    if (!wanted) {
      return merged;
    }

    for (const [name, builtin] of Object.entries(BUILTINS)) {
      const own = merged[name];

      merged[name] =
        own && typeof own === 'object'
          ? Object.assign({}, builtin, own, {
              defaults: Object.assign({}, builtin.defaults, own.defaults),
              previews: Object.assign({}, builtin.previews, own.previews),
            })
          : builtin;
    }

    return merged;
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {!string} The name of the module
   * @throws when a mailer fails to load
   * @memberof Mailers
   */
  async init() {
    this.views = new MailViews(this.henri);

    // The `auth` mailer only exists in an application that turned one of the
    // account flows on: nothing else has a use for it
    const flows = accountsConfig(this.henri.config);

    this.configure(
      Mailers.merge(
        await Mailers.load(path.join(this.henri.cwd(), 'app/mailers')),
        Object.values(flows).some((block) => block.enabled)
      )
    );

    const count = this._mailers.size;

    count > 0 &&
      this.henri.pen.info(
        'mailers',
        `${count} mailer${count > 1 ? 's' : ''} loaded`,
        this.previewable ? `previews on ${PREVIEW_PATH}` : ''
      );

    return this.name;
  }

  /**
   * Registers the loaded mailers and exposes them as
   * `henri.mailers.<name>.<action>()`
   *
   * @param {object} mailers the mailers loaded from disk
   * @returns {boolean} success
   * @memberof Mailers
   */
  configure(mailers) {
    for (const name of Object.keys(mailers).sort()) {
      const mailer = mailers[name];

      if (!mailer || typeof mailer !== 'object') {
        continue;
      }

      this._mailers.set(name, mailer);
      this.expose(name, mailer);
    }

    return true;
  }

  /**
   * Expose a mailer as `henri.mailers.<name>`, whose actions build messages
   * A name that would shadow the module's own API (or that lives in a
   * sub-directory) is only reachable through `message()` and `deliver()`.
   *
   * @param {string} name the mailer name
   * @param {object} mailer the mailer
   * @returns {boolean} exposed or not
   * @memberof Mailers
   */
  expose(name, mailer) {
    if (name.includes('/') || typeof this[name] !== 'undefined') {
      debug('%s is not exposed as henri.mailers.%s', name, name);

      return false;
    }

    const bound = {};

    for (const action of this.actions(name)) {
      bound[action] = (...args) => this.message(name, action, args);
    }

    this[name] = bound;
    this._exposed.push(name);

    return true;
  }

  /**
   * The mailer names, sorted
   *
   * @returns {Array<string>} the names
   * @memberof Mailers
   */
  names() {
    return Array.from(this._mailers.keys()).sort();
  }

  /**
   * A mailer, by name
   *
   * @param {string} name the mailer name (ex: welcome, admin/digest)
   * @returns {?object} the mailer, or undefined
   * @memberof Mailers
   */
  get(name) {
    return this._mailers.get(String(name));
  }

  /**
   * The action names of a mailer, sorted
   *
   * @param {string} name the mailer name
   * @returns {Array<string>} the actions
   * @memberof Mailers
   */
  actions(name) {
    const mailer = this.get(name);

    if (!mailer) {
      return [];
    }

    return Object.keys(mailer)
      .filter((key) => !RESERVED.has(key) && typeof mailer[key] === 'function')
      .sort();
  }

  /**
   * Every mailer with its actions
   *
   * @returns {object} { mailer: [action, ...] }
   * @memberof Mailers
   */
  tree() {
    return Object.fromEntries(
      this.names().map((name) => [name, this.actions(name)])
    );
  }

  /**
   * Does this mailer have this action?
   *
   * @param {string} name the mailer name
   * @param {string} action the action name
   * @returns {boolean} yes or no
   * @memberof Mailers
   */
  has(name, action) {
    const mailer = this.get(name);

    return Boolean(
      mailer && !RESERVED.has(action) && typeof mailer[action] === 'function'
    );
  }

  /**
   * Build the message of a mailer action, without rendering or sending it
   *
   * @param {string} name the mailer name
   * @param {string} action the action name
   * @param {Array} [args=[]] the arguments of the action
   * @returns {Message} the message
   * @throws when the mailer or the action does not exist
   * @memberof Mailers
   */
  message(name, action, args = []) {
    const mailer = this.get(name);

    if (!mailer) {
      throw new Error(
        `No mailer '${name}' in app/mailers (known: ${this.names().join(', ') || 'none'})`
      );
    }

    if (!this.has(name, action)) {
      throw new Error(
        `Mailer '${name}' has no action '${action}' (known: ${this.actions(name).join(', ') || 'none'})`
      );
    }

    const envelope = mailer[action].apply(mailer, args);

    if (!envelope || typeof envelope !== 'object') {
      throw new Error(
        `Mailer action ${name}#${action} must return the message it wants sent, got ${typeof envelope}`
      );
    }

    return new Message(this.henri, {
      action,
      defaults: mailer.defaults || {},
      envelope,
      mailer: name,
    });
  }

  /**
   * Build, render and deliver a message in one call
   *
   * @async
   * @param {string} name the mailer name
   * @param {string} action the action name
   * @param {...any} args the arguments of the action
   * @returns {Promise<object>} nodemailer's info
   * @memberof Mailers
   */
  async deliver(name, action, ...args) {
    return this.message(name, action, args).deliver();
  }

  /**
   * The `mailers` configuration of the application
   * `{ from, layout, previews }`
   *
   * @readonly
   * @returns {object} the configuration (empty when there is none)
   * @memberof Mailers
   */
  get settings() {
    const { config } = this.henri;
    const found = config && config.has('mailers') && config.get('mailers');

    return found && typeof found === 'object' ? found : {};
  }

  /**
   * Register the handler that `deliverLater()` hands rendered messages to.
   * This is the seam a job queue plugs into: the handler receives the
   * message as a plain, serializable nodemailer payload and the options of
   * the call, and answers whatever it wants (a job id, typically).
   *
   *     henri.mailers.onDeliverLater((message, opts) =>
   *       henri.jobs.enqueue('mail.deliver', message, opts)
   *     );
   *
   * @param {?function} handler the handler, or null to go back to the default
   * @returns {boolean} success
   * @memberof Mailers
   */
  onDeliverLater(handler) {
    if (handler !== null && typeof handler !== 'function') {
      this.henri.pen.error(
        'mailers',
        'the delivery handler must be a function'
      );

      return false;
    }

    this._handler = handler;

    return true;
  }

  /**
   * Hand a rendered message to the delivery handler
   * Without one, henri delivers it out of band: the send is started but not
   * awaited, failures are logged, and `drain()` waits for the ones in
   * flight. That is deliberately not a queue: nothing survives a restart.
   *
   * @async
   * @param {object} message the rendered message (nodemailer's shape)
   * @param {object} [options={}] passed on to the handler
   * @returns {Promise<object>} what the handler answered, or `{ queued: true }`
   * @memberof Mailers
   */
  async enqueue(message, options = {}) {
    if (this._handler) {
      return this._handler(message, options);
    }

    const flight = this.henri.mail.send(message).catch((error) => {
      this.henri.pen.error(
        'mailers',
        'deferred delivery failed',
        error.message
      );

      return null;
    });

    this.pending.add(flight);
    flight.finally(() => this.pending.delete(flight));

    return { deferred: true, handler: 'inline' };
  }

  /**
   * Wait for the deferred deliveries the default handler still has in flight
   *
   * @async
   * @returns {Promise<boolean>} true once everything settled
   * @memberof Mailers
   */
  async drain() {
    while (this.pending.size > 0) {
      await Promise.all(Array.from(this.pending));
    }

    return true;
  }

  /**
   * Render a mailer action with the sample data declared next to it, the way
   * a preview does. Nothing is delivered.
   *
   * @async
   * @param {string} name the mailer name
   * @param {string} action the action name
   * @returns {Promise<object>} the rendered message
   * @throws when the action, its sample data or its view fails
   * @memberof Mailers
   */
  async preview(name, action) {
    return this.message(name, action, await this.sample(name, action)).render();
  }

  /**
   * The sample arguments of an action: `previews[action]`, called when it is
   * a function. An action without sample data is previewed without arguments.
   *
   * @async
   * @param {string} name the mailer name
   * @param {string} action the action name
   * @returns {Promise<Array>} the arguments
   * @memberof Mailers
   */
  async sample(name, action) {
    const mailer = this.get(name);
    const declared = mailer && mailer.previews && mailer.previews[action];

    if (typeof declared === 'undefined') {
      return [];
    }

    const value =
      typeof declared === 'function' ? await declared(this.henri) : declared;

    return Array.isArray(value) ? value : [value];
  }

  /**
   * Are the previews mounted? Development only, and never anywhere else:
   * `config.mailers.previews: false` turns them off, nothing turns them on.
   *
   * @readonly
   * @returns {boolean} mounted or not
   * @memberof Mailers
   */
  get previewable() {
    return Boolean(this.henri.isDev) && this.settings.previews !== false;
  }

  /**
   * The preview router, mounted by the router module at `/_mailers` behind
   * the loopback guard
   *
   * @param {string} [base=PREVIEW_PATH] the mount path, for the links
   * @returns {Express.Router} the router
   * @memberof Mailers
   */
  previews(base = PREVIEW_PATH) {
    return previews(this.henri, base);
  }

  /**
   * Reloads the module
   *
   * @async
   * @returns {string} Module name
   * @memberof Mailers
   */
  async reload() {
    for (const name of this._exposed.splice(0)) {
      delete this[name];
    }

    this._mailers.clear();
    await this.init();

    return this.name;
  }

  /**
   * Stops the module: waits for the deferred deliveries in flight
   *
   * @async
   * @returns {Promise<string>} Module name
   * @memberof Mailers
   */
  async stop() {
    await this.drain();

    return this.name;
  }
}

module.exports = Mailers;
module.exports.BUILTINS = BUILTINS;
module.exports.PREVIEW_PATH = PREVIEW_PATH;
module.exports.RESERVED = RESERVED;
