const BaseModule = require('./base/module');

const debug = require('debug')('henri:i18n');

const { Translator, i18nConfig } = require('./base/i18n');
const { check } = require('./base/arguments');
const { fail } = require('./base/errors');

/**
 * The i18n module: `henri.i18n`.
 *
 * What a translation is, which locale a request is in and what a missing
 * key does are all in `base/i18n.js`, and its header is the document. This
 * is the module around it: where it sits in the boot, what it costs an
 * application that has one language, what the boot line says and what a
 * reload does.
 *
 * It runs at runlevel 1, next to the mailer and the encryption keyring, for
 * one reason: everything that renders text is above it. The controllers and
 * the mailers are loaded at 2, the view engine at 3, the account flows at 4
 * and the router at 5, and each of them finds `henri.i18n` already there.
 *
 * **An application with one language pays a directory read.** No
 * `config/locales` and no `config.i18n` means `enabled` is false: no
 * catalogue is held, no middleware is mounted, `req.t` and `req.locale` do
 * not exist, `res.render()` puts no `i18n` in the view options, nothing
 * reaches the client and there is no boot line. That is the call log's
 * rule, and it is deliberate -- a feature that is present and quiet still
 * costs a property read on every request forever.
 *
 * A reload re-reads the files. Nothing else has to happen: the catalogues
 * are the only state, `henri.i18n` is the same object afterwards, and the
 * keys nobody translated are forgotten with the rest so a reload is also
 * how you clear that record.
 *
 * @class I18nModule
 * @extends {BaseModule}
 */
class I18nModule extends BaseModule {
  /**
   * Creates an instance of I18nModule.
   * @memberof I18nModule
   */
  constructor() {
    super();

    this.name = 'i18n';
    this.runlevel = 1;
    this.needs = ['config'];
    // The router mounts the middleware and the catalogue endpoint, and the
    // view engines read the locale of a request
    this.before = ['router', 'view'];
    this.reloadable = true;
    this.henri = null;

    /** The translator, until init() there is none */
    this.translator = null;
    /** `config.i18n`, normalized (see base/i18n.js) */
    this.settings = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.t = this.t.bind(this);
    this.has = this.has.bind(this);
    this.supports = this.supports.bind(this);
    this.forUser = this.forUser.bind(this);
    this.catalogue = this.catalogue.bind(this);
    this.url = this.url.bind(this);
    this.decide = this.decide.bind(this);
  }

  /**
   * Module initialization
   *
   * @async
   * @returns {!string} The name of the module
   * @throws when a locale file cannot be read
   * @memberof I18nModule
   */
  async init() {
    const { pen } = this.henri;

    this.settings = i18nConfig(this.henri.config, this.henri.cwd());
    this.translator = new Translator({
      henri: this.henri,
      settings: this.settings,
    });

    if (this.settings.problems.length > 0) {
      // A catalogue henri cannot read is a boot failure rather than a
      // language that silently answers its keys: the file is in the
      // repository, and the person who wrote it is the person running this
      const [first] = this.settings.problems;

      throw fail(
        'HENRI_LOCALE_CATALOGUE_INVALID',
        `${first.file}: ${first.reason}${
          this.settings.problems.length > 1
            ? ` (and ${this.settings.problems.length - 1} more)`
            : ''
        }`
      );
    }

    if (!this.enabled) {
      debug('no catalogue: this application has one language');

      return this.name;
    }

    if (!this.settings.locales.includes(this.settings.default)) {
      throw fail(
        'HENRI_LOCALE_UNKNOWN',
        `i18n.default is "${this.settings.default}" and there is no catalogue for it: ${this.settings.locales.join(', ')}`
      );
    }

    pen.info('i18n', this.settings.locales.join(', '), this.describe());
    debug('%o', this.settings.locales);

    return this.name;
  }

  /**
   * What the boot line says after the locales
   *
   * @returns {string} the description
   * @memberof I18nModule
   */
  describe() {
    const { client, default: fallback } = this.settings;
    const strings = Object.keys(
      this.settings.catalogues[fallback] || {}
    ).length;
    const said = {
      key: 'a missing key answers the key',
      throw: 'a missing key fails the request',
      warn: 'a missing key is said once',
    };

    return [
      `${strings} string${strings === 1 ? '' : 's'}`,
      `${fallback} by default`,
      said[this.translator.mode],
      client === false ? 'server only' : `the client reads ${client}`,
    ].join(', ');
  }

  /**
   * Does this application translate anything?
   *
   * @returns {boolean} yes or no
   * @memberof I18nModule
   */
  get enabled() {
    return Boolean(this.settings && this.settings.enabled);
  }

  /**
   * The locales this application has
   *
   * @returns {Array<string>} the locales, empty when there are none
   * @memberof I18nModule
   */
  get locales() {
    return this.settings ? this.settings.locales : [];
  }

  /**
   * The locale everything falls back to
   *
   * @returns {string} the locale
   * @memberof I18nModule
   */
  get fallback() {
    return this.settings ? this.settings.default : 'en';
  }

  /**
   * The translation of a key.
   *
   * Not checked through `base/arguments.js` and it is in `UNCHECKED`
   * saying so: this is the one method a page calls once per string, and
   * walking a schema per string is a cost nobody asked for. It guards its
   * key by hand instead, in `Translator#t`.
   *
   * @param {string} key the key
   * @param {object} [values={}] the interpolation values (`count` also
   *   selects the plural form)
   * @param {object} [options={}] `locale`, `default`, `ordinal`, `escape`
   * @returns {string} the translation, or the key when there is none
   * @memberof I18nModule
   */
  t(key, values = {}, options = {}) {
    if (!this.enabled) {
      // Nothing to look in. The key is what comes back, for the same
      // reason it comes back when a catalogue has no entry: a guess reads
      // like a translation
      return typeof key === 'string' ? key : '';
    }

    return this.translator.t(key, values, options);
  }

  /**
   * Is this key translated?
   *
   * @param {string} key the key
   * @param {string} [locale=null] the locale, defaulting to `i18n.default`
   * @returns {boolean} yes or no
   * @memberof I18nModule
   */
  has(key, locale = null) {
    return this.enabled && typeof key === 'string'
      ? this.translator.has(key, this.supports(locale) ? locale : null)
      : false;
  }

  /**
   * Is this a locale the application has?
   *
   * @param {*} locale the locale
   * @returns {boolean} yes or no
   * @memberof I18nModule
   */
  supports(locale) {
    return this.enabled ? this.translator.supports(locale) : false;
  }

  /**
   * The locale a person's record says they read in.
   *
   * This is how a mail sent from a job is in the right language: a job has
   * no request to ask, so it asks the recipient (see base/mail-message.js).
   *
   * @param {*} user the user record, or null
   * @returns {?string} the locale, or null
   * @memberof I18nModule
   */
  forUser(user) {
    check('henri.i18n.forUser', [user]);

    return this.enabled ? this.translator.forUser(user) : null;
  }

  /**
   * The catalogue of a locale as it reaches a browser, without the
   * `serverOnly` prefixes
   *
   * @param {string} locale the locale
   * @returns {object} the flat catalogue
   * @memberof I18nModule
   */
  catalogue(locale) {
    check('henri.i18n.catalogue', [locale]);

    return this.enabled ? this.translator.catalogue(locale) : {};
  }

  /**
   * Where a browser fetches a locale, digest and all
   *
   * @param {string} locale the locale
   * @returns {?string} the path, or null when nothing reaches the client
   * @memberof I18nModule
   */
  url(locale) {
    check('henri.i18n.url', [locale]);

    return this.enabled && this.settings.client !== false
      ? this.translator.url(locale)
      : null;
  }

  /**
   * Which locale a request is in, and which step decided it
   *
   * @param {object} req the request
   * @returns {{locale: string, source: string}} the decision
   * @memberof I18nModule
   */
  decide(req) {
    return this.enabled
      ? this.translator.decide(req)
      : { locale: this.fallback, source: 'default' };
  }

  /**
   * What a rendered answer carries about the locale.
   *
   * `messages` is deliberately absent here: the catalogue is embedded by
   * whichever engine is answering a *document*, and left out of an XHR
   * answer, because a client that has already loaded a page has the
   * strings and asking it to carry them again on every visit is the naive
   * design this one exists to avoid (see guides/i18n.md).
   *
   * @param {object} decided `{ locale, source }`
   * @returns {?object} `{ locale, source, url }`, or null when off
   * @memberof I18nModule
   */
  view(decided) {
    if (!this.enabled) {
      return null;
    }

    const out = { locale: decided.locale, source: decided.source };

    if (this.settings.client === false) {
      return out;
    }

    out.url = this.translator.url(out.locale);

    // `always` is the other answer, for an application that would rather
    // carry the strings on every visit than make one request for them
    this.settings.client === 'always' &&
      (out.messages = this.catalogue(out.locale));

    return out;
  }

  /**
   * The same, with the catalogue in it: what a **document** carries.
   *
   * A view engine calls this on the render that produces a whole page, and
   * not on the XHR answer that follows it: the browser asking for the
   * second one loaded the first one to get here, so it already has the
   * strings. That is the entire payload argument, and it is the reason
   * `view()` leaves `messages` out by default.
   *
   * @param {?object} carried what `view()` answered
   * @returns {?object} the same, with `messages`
   * @memberof I18nModule
   */
  embed(carried) {
    if (!this.enabled || !carried || this.settings.client === false) {
      return carried;
    }

    return carried.messages
      ? carried
      : Object.assign({}, carried, {
          messages: this.catalogue(carried.locale),
        });
  }

  /**
   * Every key that was asked for and had no translation anywhere.
   *
   * The runtime half of "a missing key is findable". The other half is
   * `henri doctor`, which compares the files on disk and does not need the
   * application to have been asked.
   *
   * @returns {Array<object>} `{ key, locale, why }`
   * @memberof I18nModule
   */
  missing() {
    return this.enabled ? this.translator.missing() : [];
  }

  /**
   * How many lookups missed, remembered or not
   *
   * @returns {number} the count
   * @memberof I18nModule
   */
  misses() {
    return this.enabled ? this.translator.misses() : 0;
  }

  /**
   * Re-reads the locale files
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof I18nModule
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
   * @memberof I18nModule
   */
  static async stop() {
    return false;
  }
}

module.exports = I18nModule;
