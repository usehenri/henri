const BaseModule = require('./base/module');

const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:privacy');

const { EXTERNAL_ID } = require('./base/external-id');
const { check } = require('./base/arguments');
const { fail } = require('./base/errors');
const { userConfig } = require('./base/auth');
const { mapOf, privacyConfig, stripPersonal } = require('./base/privacy');
const {
  eraseOf,
  exportOf,
  findSubject,
  planOf,
  plainOf,
  primaryOf,
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
 * ## The two framework tables, and why only one of them answers
 *
 * The walk of `base/erasure.js` is over *models*, and the tables henri owns
 * itself are not models. Two of them hold something about a person, and
 * they answer differently on purpose:
 *
 * - **the call log** does, through `henri.calls`. It holds values -- the
 *   bodies of a request, and now the address it came from -- so there is
 *   something to hand over and something to write over, and "wait for
 *   `calls.keep` to come round" is a deadline rather than an answer to a
 *   data subject request. Its rows join on the `externalId`, so only the
 *   requests a person was signed in for are theirs;
 * - **the access trail** does not, and `base/trail.js` argues it where it
 *   lives: it holds field *names*, counts, public identifiers and digests
 *   and refuses a value, which is what lets it outlive the erasure it
 *   recorded. It is also hash-chained, so a row written over would break
 *   the chain that makes it evidence. Its retention is its own clock.
 *
 * The call log is best effort here and says so in the receipt: an erasure
 * that already wrote over a person's records must not fail because a
 * debugging log was unreachable, and a receipt that says the log was not
 * reached is better than no receipt at all.
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
    // Only the name is checked: a model that holds nothing personal is not
    // a mistake, and `{}` is the honest answer for it. An unknown-target
    // refusal belongs where an empty answer would be a false success
    check('henri.privacy.fields', [name]);

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
    // `include` is the one way back for a field marked `expose: false`, and
    // it is matched with `Array#includes`: a string there is a *substring*
    // test, which un-hides every private field whose name it contains
    check('henri.privacy.strip', [value, include]);

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
    check('henri.privacy.subject', [who]);

    const context = this.context();

    if (who && typeof who === 'object') {
      const plain = plainOf(who);
      const primary = primaryOf(context.modelOf(this.subjectModel));

      // A record is taken as the person it is, without a lookup -- so a
      // record that does not say which row it is names everybody. The
      // erasure downstream builds `where: { [primary]: plain[primary] }`,
      // and `{ id: undefined }` is every row on some adapters
      if (plain[primary] === null || typeof plain[primary] === 'undefined') {
        throw fail(
          'HENRI_PRIVACY_UNKNOWN_SUBJECT',
          `the record given to henri.privacy is not one: it carries no "${primary}", so it names nobody`
        );
      }

      return plain;
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
   * @param {object} [options={}] `source`, for the trail entry
   * @returns {Promise<object>} The export document
   * @memberof Privacy
   */
  async export(who, options = {}) {
    check('henri.privacy.export', [who, options]);

    const context = this.context();
    let subject;
    // Tolerant, because a person asking for their data is entitled to an
    // answer even when a key is gone, and recorded, because an application
    // asked to prove the export happened has to be able to show it. The
    // lookup is inside the scope too: the person's own row is the first
    // thing that has to open, and it holds encrypted fields like any other
    const document = await this.tolerantly(async () => {
      subject = await this.subject(who);

      return exportOf(context, subject);
    });

    document.calls = await this.callsOf(subject);

    await this.tell(subject, {
      action: 'privacy.export',
      meta: { models: Object.keys(document.records).length },
      records: Object.values(document.counts).reduce(
        (total, count) => total + count,
        0
      ),
      source: options.source,
    });

    return document;
  }

  /**
   * Records one operation in the access trail, when there is one.
   *
   * Every operation of this module goes through here, including the ones
   * that were refused: an application asked to prove an erasure happened
   * has to be able to show the attempts as well as the successes.
   *
   * @async
   * @param {object} subject The person, as a plain object
   * @param {object} event The entry
   * @returns {Promise<?object>} The entry, or null
   * @memberof Privacy
   */
  async tell(subject, event) {
    const { trail } = this.henri;

    if (!trail || !trail.enabled) {
      return null;
    }

    const named = trail.identify(subject);

    return trail.record({
      model: this.subjectModel,
      outcome: 'ok',
      source: 'app',
      ...named,
      ...event,
    });
  }

  /**
   * Runs a walk that must not fail on a field that will not decrypt.
   *
   * A person asking for their data is entitled to an answer, and "one of
   * the keys is gone" is an answer -- a stack trace is not. The same goes,
   * more so, for the person asking to be removed: an erasure that refuses
   * because it could not *read* what it was about to write over would be
   * the worst possible reading of the word.
   *
   * So the export, the plan and the erasure run inside
   * `henri.encryption.tolerate()`: an encrypted value that cannot be
   * opened reads as `null`, and the document says which fields those
   * were, with the code and the key id that names the reason. The receipt
   * carries the same list, so an erasure that ran over a column nobody
   * could read is written down rather than assumed.
   *
   * Nothing else in henri reads this way, and an application never gets it
   * by configuration: a silent null on an encrypted column is how a
   * missing key turns into an overwrite.
   *
   * @async
   * @param {function} work What to run
   * @returns {Promise<object>} What it answered, plus `unreadable`
   * @memberof Privacy
   */
  async tolerantly(work) {
    const { encryption } = this.henri;

    if (!encryption || typeof encryption.tolerate !== 'function') {
      return { ...(await work()), unreadable: [] };
    }

    const { failures, value } = await encryption.tolerate(work);

    if (failures.length > 0) {
      this.henri.pen.warn(
        'privacy',
        `${failures.length} encrypted field(s) could not be read`,
        failures.map((failure) => failure.context).join(', ')
      );
    }

    return { ...value, unreadable: failures };
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
    check('henri.privacy.plan', [who, options]);

    const context = this.context();

    return this.tolerantly(async () =>
      planOf(context, await this.subject(who), options)
    );
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
    check('henri.privacy.erase', [who, options]);

    const context = this.context();
    let receipt;
    let subject;

    try {
      // Tolerant for the same reason the export is: an erasure that refused
      // because it could not read what it was about to write over would be
      // the worst possible reading of the word
      receipt = await this.tolerantly(async () => {
        subject = await this.subject(who);

        return eraseOf(context, subject, options);
      });
    } catch (error) {
      // A refusal is written down too: "we were asked and we said no" is
      // part of the record, and an entry that only ever appears on success
      // is not evidence of anything. Nobody to name means the lookup itself
      // is what failed, and the trail records what henri did to a person
      if (!subject) {
        throw error;
      }

      await this.tell(subject, {
        action: 'privacy.erase',
        meta: {
          dryRun: options.dryRun === true,
          reason: error.code || 'refused',
        },
        outcome: 'refused',
        source: options.source,
      });

      throw error;
    }

    receipt.calls = await this.forgetCalls(subject, options);
    receipt.file = options.dryRun ? null : this.record(receipt);

    await this.tell(subject, {
      action: 'privacy.erase',
      ids: receipt.records.flatMap((entry) => entry.ids).filter(Boolean),
      meta: {
        dryRun: receipt.dryRun,
        receipt: receipt.id,
        strategy: options.strategy || this.settings.onErase,
      },
      records: receipt.records.reduce(
        (total, entry) => total + entry.written,
        0
      ),
      source: options.source,
    });

    this.henri.pen.info(
      'privacy',
      options.dryRun ? 'erasure (dry run)' : 'erased',
      `${receipt.subject.model} ${receipt.subject.externalId || ''}`.trim(),
      receipt.file || ''
    );

    return receipt;
  }

  /**
   * The person's own rows of the call log, for an export.
   *
   * Best effort, like the erasure below: a person is entitled to what the
   * application holds about them, and a debugging log that is off or
   * unreachable is not a reason to refuse them the rest of it. What
   * happened is in the answer either way.
   *
   * @async
   * @param {object} subject The person, as a plain object
   * @returns {Promise<?object>} `{ records }`, `{ problem }`, or null when
   *   this application keeps no call log
   * @memberof Privacy
   */
  async callsOf(subject) {
    const { calls } = this.henri;
    const actor = subject && subject[EXTERNAL_ID];

    if (!calls || !calls.enabled || typeof actor !== 'string') {
      return null;
    }

    try {
      return { records: await calls.forPerson(actor, { limit: 1000 }) };
    } catch (error) {
      debug('unable to read the call log: %s', error.message);

      return { problem: error.code || 'unreadable' };
    }
  }

  /**
   * Takes the person out of the call log.
   *
   * The row survives and the person does not (`base/call-store.js` says
   * exactly which columns are written over). A dry run counts and writes
   * nothing, the way every other step of a plan does.
   *
   * @async
   * @param {object} subject The person, as a plain object
   * @param {object} options `dryRun`
   * @returns {Promise<?object>} `{ action, count, written }`, `{ problem }`,
   *   or null when this application keeps no call log
   * @memberof Privacy
   */
  async forgetCalls(subject, options) {
    const { calls } = this.henri;
    const actor = subject && subject[EXTERNAL_ID];

    if (!calls || !calls.enabled || typeof actor !== 'string') {
      return null;
    }

    try {
      const count = options.dryRun
        ? await calls.count({ actor })
        : await calls.forget(actor);

      return {
        action: 'anonymize',
        count,
        written: options.dryRun ? 0 : count,
      };
    } catch (error) {
      // An erasure that has already written over a person's records must
      // not fail because a debugging log was unreachable; the receipt is
      // what says it was not reached
      this.henri.pen.warn(
        'privacy',
        'the call log was not reached; its rows still name this person',
        error.message
      );

      return { problem: error.code || 'unreachable' };
    }
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
