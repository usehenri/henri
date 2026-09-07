const BaseModule = require('./base/module');

const debug = require('debug')('henri:time');

const { Zones, canonical, isZone, timeConfig } = require('./base/time');
const { check } = require('./base/arguments');

/**
 * The time zone module: `henri.time`.
 *
 * Which zone an application renders in, which zone a person is in and
 * where a request's comes from are all in `base/time.js`, and its header
 * is the document -- including the survey of what each adapter stores,
 * which is what decided the design. This is the module around it.
 *
 * It runs at runlevel 1, next to i18n, the mailer and the encryption
 * keyring, and for the same reason i18n does: everything that renders a
 * moment is above it. The mailers are loaded at 2, the view engine at 3
 * and the router at 5, and each of them finds `henri.time` already there.
 *
 * **`henri.time.zone` always answers.** Unlike a catalogue, a zone has no
 * "off": something formats every date a server prints, and the question is
 * only whether the application chose it. Absent, it is `UTC` -- not
 * `process.env.TZ`, because what a person sees must not depend on where
 * the process was deployed. What `config.timeZone` being absent does buy
 * is silence: no boot line, and no middleware in the stack unless a
 * `from` step asks for a per-person zone.
 *
 * @class TimeModule
 * @extends {BaseModule}
 */
class TimeModule extends BaseModule {
  /**
   * Creates an instance of TimeModule.
   * @memberof TimeModule
   */
  constructor() {
    super();

    this.name = 'time';
    this.runlevel = 1;
    this.needs = ['config'];
    // The router mounts the middleware and puts the zone in the view
    // options, and the view engines render a moment in it
    this.before = ['router', 'view'];
    this.reloadable = true;
    this.henri = null;

    /** The zones, until init() there are none */
    this.zones = null;
    /** `config.timeZone`, normalized (see base/time.js) */
    this.settings = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.decide = this.decide.bind(this);
    this.format = this.format.bind(this);
    this.forUser = this.forUser.bind(this);
    this.supports = this.supports.bind(this);
    this.canonical = this.canonical.bind(this);
    this.view = this.view.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @throws when config.timeZone names a zone this runtime has no rules for
   * @memberof TimeModule
   */
  async init() {
    const { pen } = this.henri;

    this.settings = timeConfig(this.henri.config);
    this.zones = new Zones({ henri: this.henri, settings: this.settings });

    if (!this.settings.configured) {
      debug('no timeZone: every moment is rendered in %s', this.zone);

      return this.name;
    }

    pen.info('time', this.zone, this.describe());
    debug('%o', this.settings);

    return this.name;
  }

  /**
   * What the boot line says after the zone
   *
   * @returns {string} the description
   * @memberof TimeModule
   */
  describe() {
    const { from } = this.settings;
    const steps = ['user', 'query', 'cookie', 'header'].filter(
      (name) => from[name] !== false
    );

    return [
      steps.length > 0
        ? `a person's own from ${steps.join(', ')}`
        : 'every answer in it',
      'storage is UTC',
    ].join(', ');
  }

  /**
   * The zone this application renders in when nothing knows better
   *
   * @returns {string} the zone
   * @memberof TimeModule
   */
  get zone() {
    return this.zones ? this.zones.zone : 'UTC';
  }

  /**
   * Can a request or a person be in a zone of their own?
   *
   * @returns {boolean} yes or no
   * @memberof TimeModule
   */
  get personal() {
    return Boolean(this.settings && this.settings.personal);
  }

  /**
   * Did the application say anything about time zones?
   *
   * What the boot line is gated on. `zone` answers either way.
   *
   * @returns {boolean} yes or no
   * @memberof TimeModule
   */
  get configured() {
    return Boolean(this.settings && this.settings.configured);
  }

  /**
   * Is this a zone this runtime can render in?
   *
   * @param {*} zone the zone
   * @returns {boolean} yes or no
   * @memberof TimeModule
   */
  supports(zone) {
    return isZone(zone);
  }

  /**
   * The canonical name of a zone, or null when there is no such zone
   *
   * @param {*} zone the zone
   * @returns {?string} the canonical name, or null
   * @memberof TimeModule
   */
  canonical(zone) {
    return canonical(zone);
  }

  /**
   * The zone a person's record says they read in.
   *
   * This is how a mail sent from a job is in the right zone: a job has no
   * request to ask, so it asks the recipient (see base/mail-message.js).
   *
   * @param {*} user the user record, or null
   * @returns {?string} the zone, or null
   * @memberof TimeModule
   */
  forUser(user) {
    check('henri.time.forUser', [user]);

    return this.zones ? this.zones.forUser(user) : null;
  }

  /**
   * One instant, written for a person to read.
   *
   * `Intl.DateTimeFormat` with the zone filled in; every other option is
   * passed through unchanged, and henri invents none.
   *
   * @param {*} value a Date, an ISO string or epoch milliseconds
   * @param {object} [options={}] `zone`, `locale`, and Intl's own options
   * @returns {string} the formatted moment, or '' when there is none
   * @memberof TimeModule
   */
  format(value, options = {}) {
    return this.zones ? this.zones.format(value, options) : '';
  }

  /**
   * Which zone a request is in, and which step decided it
   *
   * @param {object} req the request
   * @returns {{source: string, zone: string}} the decision
   * @memberof TimeModule
   */
  decide(req) {
    return this.zones
      ? this.zones.decide(req)
      : { source: 'default', zone: 'UTC' };
  }

  /**
   * What a rendered answer carries about the zone
   *
   * @param {?object} decided `{ source, zone }`, or nothing
   * @returns {object} `{ source, zone }`
   * @memberof TimeModule
   */
  view(decided) {
    return this.zones
      ? this.zones.view(decided)
      : { source: 'default', zone: 'UTC' };
  }

  /**
   * Re-reads the configuration
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof TimeModule
   */
  async reload() {
    await this.init();

    return this.name;
  }

  /**
   * Stops the module
   *
   * @async
   * @static
   * @returns {(string|boolean)} Module name or false
   * @memberof TimeModule
   */
  static async stop() {
    return false;
  }
}

module.exports = TimeModule;
