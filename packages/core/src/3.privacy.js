const BaseModule = require('./base/module');

const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:privacy');

const { fail } = require('./base/errors');
const { userConfig } = require('./base/auth');
const { mapOf, privacyConfig, stripPersonal } = require('./base/privacy');
const {
  eraseOf,
  exportOf,
  findSubject,
  planOf,
  plainOf,
} = require('./base/erasure');

/**
 * Privacy module: `henri.privacy`, the map of what is personal and the two
 * operations that follow from it.
 *
 * The mark is on the field, in the model (see `base/privacy.js`); this
 * module is what reads it back at runtime, so that everything else can ask
 * one question instead of parsing schemas:
 *
 * - `henri.privacy.keys` -- every personal field name, which `pen` and the
 *   runtime log mask exactly (`base/redact.js`).
 * - `henri.privacy.private` -- the names marked `expose: false`, which
 *   `res.resource()`, `res.collection()`, `res.render()` and the public
 *   user drop from what they send (`strip()`).
 * - `henri.privacy.export(who)` and `henri.privacy.erase(who)` -- the two
 *   operations, driven by `henri privacy:export` and `henri privacy:erase`
 *   and callable from an application that puts them on a page. The
 *   questions they answer are in the header of `base/erasure.js`.
 *
 * The person is the user model. `henri.privacy.subject(who)` finds one by
 * email address, by external id or by primary key.
 *
 * @class Privacy
 * @extends {BaseModule}
 */
class Privacy extends BaseModule {
  /**
   * Creates an instance of Privacy.
   * @memberof Privacy
   */
  constructor() {
    super();

    this.reloadable = true;
    // The map is built from the models, so it is built after them
    this.needs = ['config', 'model'];
    // The router strips the private fields out of every answer it builds
    this.before = ['router'];
    this.runlevel = 3;
    this.name = 'privacy';
    this.henri = null;

    /** `config.privacy`, normalized */
    this.settings = privacyConfig(null);
    /** The map: one entry per model that holds something personal */
    this.entries = [];
    /** Every personal field name (exact match, for the logs) */
    this.keys = new Set();
    /** The names marked `expose: false` (dropped from every answer) */
    this.private = new Set();

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.strip = this.strip.bind(this);
    this.subject = this.subject.bind(this);
    this.export = this.export.bind(this);
    this.erase = this.erase.bind(this);
    this.plan = this.plan.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: reads the marks of every model
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @throws when a model marks a field in a way henri does not understand
   * @memberof Privacy
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = privacyConfig(config);

    const models = (this.henri.model && this.henri.model.models) || [];
    const identity = userConfig(config).model.toLowerCase();
    const user = models.find((model) => model.identity === identity);
    const map = mapOf(models, {
      orm: (name) => this.modelOf(name, { quiet: true }),
      settings: this.settings,
      subject: user ? user.globalId : null,
    });

    this.entries = map.entries;
    this.keys = map.keys;
    this.private = map.private;
    this.subjectModel = map.subject ? map.subject.name : null;

    if (this.keys.size > 0) {
      pen.info(
        'privacy',
        `${this.keys.size} personal field${this.keys.size === 1 ? '' : 's'} in ${this.entries.length} model${this.entries.length === 1 ? '' : 's'}`,
        this.private.size > 0
          ? `${this.private.size} never leave the server`
          : 'redacted in the logs, exported and erased'
      );
    }

    debug(
      'map %o',
      this.entries.map((entry) => entry.name)
    );

    return this.name;
  }

  /**
   * Rebuilds the map after a reload of the models
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @memberof Privacy
   */
  async reload() {
    return this.init();
  }

  /**
   * The ORM model of a name
   *
   * @param {string} name The global id of the model
   * @param {object} [options={}] Options
   * @param {boolean} [options.quiet=false] Answer null instead of throwing
   * @returns {*} The ORM model
   * @throws when the model is not loaded
   * @memberof Privacy
   */
  modelOf(name, { quiet = false } = {}) {
    const stores = (this.henri.model && this.henri.model.stores) || {};

    for (const store of Object.values(stores)) {
      const models = typeof store.getModels === 'function' && store.getModels();

      if (models && models[name]) {
        return models[name];
      }
    }

    if (global[name]) {
      return global[name];
    }

    if (quiet) {
      return null;
    }

    throw fail(
      'HENRI_PRIVACY_NO_SUBJECT',
      `the model ${name} is not loaded: nothing to export or erase`
    );
  }

  /**
   * The entry of a model in the map
   *
   * @param {string} name The global id of the model
   * @returns {?object} The entry, or null when it holds nothing personal
   * @memberof Privacy
   */
  entryOf(name) {
    return this.entries.find((entry) => entry.name === name) || null;
  }

  /**
   * The personal fields of a model, by name
   *
   * @param {string} name The global id of the model
   * @returns {object} The marks by field name (empty when there are none)
   * @memberof Privacy
   */
  fields(name) {
    const entry = this.entryOf(name);

    return entry ? entry.fields : {};
  }

  /**
   * A copy of what is about to leave the server, without the fields marked
   * `expose: false`
   *
   * @param {*} value A record, a list of records, or anything else
   * @param {Array<string>} [include=[]] Names to leave in place
   * @returns {*} The value, without the private fields
   * @memberof Privacy
   */
  strip(value, include = []) {
    return stripPersonal(value, this.private, include);
  }

  /**
   * The map, as data: what `henri privacy` prints and what an agent reads
   *
   * @returns {object} The models, their personal fields and their links
   * @memberof Privacy
   */
  describe() {
    return {
      models: this.entries.map((entry) => ({
        exported: entry.export,
        fields: Object.keys(entry.fields)
          .sort()
          .map((field) => ({ name: field, ...entry.fields[field] })),
        link: entry.link,
        model: entry.name,
        onErase: entry.onErase,
        paranoid: entry.paranoid,
        subject: entry.isSubject,
      })),
      private: [...this.private].sort(),
      settings: this.settings,
      subject: this.subjectModel,
    };
  }

  /**
   * The context the export and the erasure run in
   *
   * @returns {object} `{ application, map, modelOf, secret }`
   * @throws HENRI_PRIVACY_NO_SUBJECT when the application has no user model
   * @memberof Privacy
   */
  context() {
    if (!this.subjectModel) {
      throw fail(
        'HENRI_PRIVACY_NO_SUBJECT',
        'this application has no user model, so it has nobody to export or erase'
      );
    }

    const { config } = this.henri;

    return {
      application: this.applicationName(),
      map: {
        entries: this.entries,
        keys: this.keys,
        private: this.private,
        subject: this.entryOf(this.subjectModel),
      },
      modelOf: (name) => this.modelOf(name),
      secret: config.has('secret') ? config.get('secret') : '',
    };
  }

  /**
   * The name of the application, for the documents it produces
   *
   * @returns {?string} The name from its package.json, or null
   * @memberof Privacy
   */
  applicationName() {
    try {
      return require(path.join(this.henri.cwd(), 'package.json')).name || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * The person an export or an erasure is about
   *
   * @async
   * @param {(string|object)} who An email, an external id, an id, or a record
   * @returns {Promise<object>} The person, as a plain object
   * @throws HENRI_PRIVACY_UNKNOWN_SUBJECT when nobody matches
   * @memberof Privacy
   */
  async subject(who) {
    const context = this.context();

    if (who && typeof who === 'object') {
      return plainOf(who);
    }

    const found = await findSubject(
      { Model: context.modelOf(this.subjectModel), name: this.subjectModel },
      who
    );

    return plainOf(found);
  }

  /**
   * Everything held about one person
   *
   * @async
   * @param {(string|object)} who The person
   * @returns {Promise<object>} The export document
   * @memberof Privacy
   */
  async export(who) {
    const context = this.context();
    const subject = await this.subject(who);

    return exportOf(context, subject);
  }

  /**
   * What an erasure would do, without doing it
   *
   * @async
   * @param {(string|object)} who The person
   * @param {object} [options={}] `strategy`
   * @returns {Promise<object>} The plan
   * @memberof Privacy
   */
  async plan(who, options = {}) {
    const context = this.context();
    const subject = await this.subject(who);

    return planOf(context, subject, options);
  }

  /**
   * Erases one person, and writes the receipt
   *
   * @async
   * @param {(string|object)} who The person
   * @param {object} [options={}] `strategy`, `dryRun`
   * @returns {Promise<object>} The receipt, with the file it was written to
   * @throws HENRI_PRIVACY_ERASE_REFUSED when the plan cannot be carried out
   * @memberof Privacy
   */
  async erase(who, options = {}) {
    const context = this.context();
    const subject = await this.subject(who);
    const receipt = await eraseOf(context, subject, options);

    receipt.file = options.dryRun ? null : this.record(receipt);

    this.henri.pen.info(
      'privacy',
      options.dryRun ? 'erasure (dry run)' : 'erased',
      `${receipt.subject.model} ${receipt.subject.externalId || ''}`.trim(),
      receipt.file || ''
    );

    return receipt;
  }

  /**
   * Writes a receipt where `config.privacy.receipts` says
   *
   * @param {object} receipt The receipt
   * @returns {?string} The path it was written to, or null
   * @throws HENRI_PRIVACY_RECEIPT_UNWRITABLE when it cannot be written
   * @memberof Privacy
   */
  record(receipt) {
    const { receipts } = this.settings;

    if (receipts === false) {
      return null;
    }

    const folder = path.resolve(this.henri.cwd(), receipts);
    const stamp = receipt.at.replace(/[:.]/gu, '-');
    const file = path.join(folder, `erasure-${stamp}-${receipt.id}.json`);

    try {
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`);
    } catch (error) {
      const failure = fail(
        'HENRI_PRIVACY_RECEIPT_UNWRITABLE',
        `the erasure happened and its receipt could not be written to ${file}: ${error.message}`,
        { cause: error }
      );

      failure.hint =
        'Make the directory writable, point config.privacy.receipts elsewhere, or set it to false and keep the receipt the command printed';

      throw failure;
    }

    return path.relative(this.henri.cwd(), file);
  }
}

module.exports = Privacy;
