const BaseModule = require('./base/module');

const debug = require('debug')('henri:encryption');
const { AsyncLocalStorage } = require('node:async_hooks');

const { check, unknown } = require('./base/arguments');
const {
  Keyring,
  decrypt,
  encrypt,
  isEnvelope,
  keyIdIn,
  keyringOf,
  parse,
  schemeOf,
} = require('./base/encryption');
const { fail } = require('./base/errors');
const { rotateOf, statusOf } = require('./base/rewrap');

/**
 * Encryption module: `henri.encryption`, the keys and the two operations
 * every adapter calls.
 *
 * The envelope, the derivation and the reasoning behind both are in
 * `base/encryption.js`. This is what holds them at runtime: it reads
 * `config.encryption` once, at runlevel 1, so that the models (runlevel 3)
 * find a keyring already built when they register a field marked
 * `encrypted`. An adapter never requires this package -- it reaches
 * `henri.encryption` the way it already reaches `henri.user.encrypt` for a
 * password.
 *
 * ```js
 * // packages/*\/index.js, on the write path
 * values.ssn = henri.encryption.encrypt(values.ssn, {
 *   context: 'Person.ssn',
 *   deterministic: false,
 * });
 * ```
 *
 * ## Reading something that will not decrypt
 *
 * `read()` is the one the adapters call, and by default it throws: the
 * code says which of the three things happened -- a key that is not here,
 * bytes that do not verify, or a column that is still in the clear.
 *
 * `tolerate(fn)` is the only way past it. Inside it a value that will not
 * open reads as `null` and the failure is collected, so the caller can
 * say which fields it could not read:
 *
 * ```js
 * const { failures, value } = await henri.encryption.tolerate(() =>
 *   henri.privacy.export(who)
 * );
 * ```
 *
 * It is an async context (`AsyncLocalStorage`), not a flag, so two
 * requests in flight never borrow each other's leniency, and it reaches
 * every adapter without any of them having to thread an option through
 * their query paths -- a Sequelize attribute getter has no options to
 * read.
 *
 * There is no configuration key for it. A silent null on a column that
 * will not decrypt is how a bad key turns into an overwrite: the page
 * renders empty, somebody saves the form, and the ciphertext is gone. It
 * stays a decision made in code, by code that then says so.
 *
 * ## What this module refuses
 *
 * `require()` is called by every adapter when a model declares an
 * encrypted field. Without a key it fails the boot. The alternative --
 * warning and writing the column in the clear -- would mean an
 * application that thinks it encrypts and does not, which is worse than
 * not booting.
 *
 * @class Encryption
 * @extends {BaseModule}
 */
class Encryption extends BaseModule {
  /**
   * Creates an instance of Encryption.
   * @memberof Encryption
   */
  constructor() {
    super();

    this.reloadable = true;
    this.needs = ['config'];
    this.runlevel = 1;
    this.name = 'encryption';
    this.henri = null;

    /** The keys, primary first. Empty until a key is configured */
    this.keyring = new Keyring([]);
    /** May a column declared encrypted answer with what it holds? */
    this.readPlaintext = false;
    /** The fields the models declared, by `<Model>.<field>` */
    this.fields = new Map();
    /** Where `tolerate()` keeps its leniency, one async context deep */
    this.lenient = new AsyncLocalStorage();

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.encrypt = this.encrypt.bind(this);
    this.decrypt = this.decrypt.bind(this);
    this.read = this.read.bind(this);
    this.tolerate = this.tolerate.bind(this);
    this.candidates = this.candidates.bind(this);
    this.register = this.register.bind(this);
    this.require = this.require.bind(this);
    this.rotate = this.rotate.bind(this);
    this.status = this.status.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: builds the keyring from the configuration
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @throws HENRI_ENCRYPTION_KEY_MALFORMED when a key is not one
   * @memberof Encryption
   */
  async init() {
    const { config, pen } = this.henri;
    const settings = config.has('encryption') ? config.get('encryption') : {};
    const values = settings && typeof settings === 'object' ? settings : {};

    // Not `this.fields`: what the models declared is the models' to say,
    // and `reset()` is called by `3.model.js` when it reloads them. A
    // reload of this module alone changes the keys, not the map
    this.readPlaintext = values.readPlaintext === true;
    this.keyring = keyringOf(
      typeof values.keys === 'undefined' ? [] : values.keys,
      this.sourceOf()
    );

    if (this.keyring.enabled) {
      pen.info(
        'encryption',
        `${this.keyring.entries.length} key${this.keyring.entries.length === 1 ? '' : 's'}`,
        `writing under ${this.keyring.primary.id}`,
        this.readPlaintext ? 'reading plaintext too' : ''
      );
    }

    if (this.readPlaintext) {
      pen.warn(
        'encryption',
        'readPlaintext is on: a column declared encrypted may answer with whatever it holds',
        'take it out once `henri encryption:status` reports no plaintext left'
      );
    }

    debug('keys %o', this.keyring.ids);

    return this.name;
  }

  /**
   * Rebuilds the keyring after a reload
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @memberof Encryption
   */
  async reload() {
    return this.init();
  }

  /**
   * Where the keys came from, by name. Never a value: this string reaches
   * an error message and a log line.
   *
   * @returns {string} the source
   * @memberof Encryption
   */
  sourceOf() {
    const { config } = this.henri;

    return typeof config.sourceOf === 'function'
      ? config.sourceOf('encryption.keys')
      : 'config.encryption.keys';
  }

  /**
   * Is anything encrypted at all?
   *
   * @readonly
   * @returns {boolean} true when at least one key is configured
   * @memberof Encryption
   */
  get enabled() {
    return this.keyring.enabled;
  }

  /**
   * The ids of the configured keys, primary first
   *
   * @readonly
   * @returns {Array<string>} the ids
   * @memberof Encryption
   */
  get keys() {
    return this.keyring.ids;
  }

  /**
   * The id of the key new values are written under
   *
   * @readonly
   * @returns {?string} the id, or null when there is no key
   * @memberof Encryption
   */
  get primary() {
    return this.keyring.primary ? this.keyring.primary.id : null;
  }

  /**
   * Records what a model declared, so the commands can walk it without
   * parsing schemas again.
   *
   * Called by every adapter from `addModel()`. It is also where the
   * absence of a key stops the boot: a model that says `encrypted` and an
   * application that has no key must not agree to run.
   *
   * @param {string} model The global id of the model
   * @param {object} fields `{ [field]: { deterministic } }`
   * @returns {void}
   * @throws HENRI_ENCRYPTION_NO_KEY when nothing can encrypt
   * @memberof Encryption
   */
  register(model, fields) {
    for (const field of Object.keys(fields || {})) {
      const mark = fields[field];

      this.require(`${model}.${field}`);
      this.fields.set(`${model}.${field}`, {
        deterministic: schemeOf(mark) === 'd',
        field,
        model,
      });
    }
  }

  /**
   * Forgets what the models declared.
   *
   * Called by `3.model.js` before it registers them again, so a model that
   * lost a field between two reloads does not leave an entry behind that
   * `henri encryption:rotate` would then walk into a column that is gone.
   *
   * @returns {void}
   * @memberof Encryption
   */
  reset() {
    this.fields = new Map();
  }

  /**
   * Refuses to go on without a key
   *
   * @param {string} context `<Model>.<field>`
   * @returns {void}
   * @throws HENRI_ENCRYPTION_NO_KEY when the keyring is empty
   * @memberof Encryption
   */
  require(context) {
    if (this.keyring.enabled) {
      return;
    }

    const error = fail(
      'HENRI_ENCRYPTION_NO_KEY',
      `${context} is marked encrypted and this application has no encryption key`
    );

    error.hint =
      'Generate one with `openssl rand -hex 32` and put it in the credentials of this environment: `henri credentials:edit`, then { "encryption": { "keys": ["..."] } }. henri refuses to boot rather than write that column in the clear';

    throw error;
  }

  /**
   * What a model declared for one field, when it declared anything
   *
   * @param {string} model The global id of the model
   * @param {string} field The field name
   * @returns {?object} `{ deterministic, field, model }`, or null
   * @memberof Encryption
   */
  markOf(model, field) {
    check('henri.encryption.markOf', [model, field]);

    return this.fields.get(`${model}.${field}`) || null;
  }

  /**
   * The check `encrypt()` and `decrypt()` make, by hand.
   *
   * These two are the one place `base/arguments.js` says not to put its
   * table: the three adapters call them once per row per encrypted column,
   * and a walk that allocates per call is not worth it there. So the two
   * things that actually go wrong are checked with three `typeof`s and no
   * allocation -- a missing `context`, which writes an envelope whose AAD
   * no read path can ever match, and a value that is not a string, which
   * used to be encrypted as `String(value)` and to come back as one.
   *
   * @param {string} where The entry point, for the message
   * @param {*} value The value
   * @param {object} options The options
   * @returns {void}
   * @throws HENRI_ARGUMENT_INVALID
   * @memberof Encryption
   */
  static guard(where, value, options) {
    if (!options || typeof options !== 'object') {
      throw fail(
        'HENRI_ARGUMENT_INVALID',
        `${where}(options) must be an object holding the context, but it is ${
          typeof options === 'undefined' ? 'missing' : `a ${typeof options}`
        }`
      );
    }

    if (typeof options.context !== 'string' || options.context === '') {
      throw fail(
        'HENRI_ARGUMENT_INVALID',
        `${where}(options.context) must be the "<Model>.<field>" the value belongs to, and it is missing: the envelope is bound to it, so one written without it never opens again`
      );
    }

    // Null and undefined are the documented pass-through: a column that
    // holds nothing stays holding nothing
    if (
      value !== null &&
      typeof value !== 'undefined' &&
      typeof value !== 'string'
    ) {
      throw fail(
        'HENRI_ARGUMENT_INVALID',
        `${where}(value) must be a string, but it is a ${typeof value}`
      );
    }
  }

  /**
   * Encrypts one value under the primary key
   *
   * @param {*} value The plaintext (anything else is returned untouched)
   * @param {object} options `context` and `deterministic`
   * @returns {*} The envelope
   * @throws HENRI_ENCRYPTION_NO_KEY, HENRI_ENCRYPTION_TOO_LONG
   * @memberof Encryption
   */
  encrypt(value, options) {
    Encryption.guard('henri.encryption.encrypt', value, options);

    if (value === null || typeof value === 'undefined') {
      return value;
    }

    return encrypt(value, { ...options, keyring: this.keyring });
  }

  /**
   * Decrypts one value, or says exactly why it could not
   *
   * @param {*} value The stored value
   * @param {object} options `context` and `deterministic`
   * @returns {*} The plaintext
   * @throws HENRI_ENCRYPTION_KEY_UNKNOWN, HENRI_ENCRYPTION_UNREADABLE,
   *   HENRI_ENCRYPTION_PLAINTEXT
   * @memberof Encryption
   */
  decrypt(value, options) {
    Encryption.guard('henri.encryption.decrypt', value, options);

    if (value === null || typeof value === 'undefined') {
      return value;
    }

    if (!isEnvelope(value)) {
      if (this.readPlaintext) {
        return value;
      }

      const error = fail(
        'HENRI_ENCRYPTION_PLAINTEXT',
        `${options.context} is declared encrypted and the stored value is not encrypted`
      );

      error.hint =
        'Set { "encryption": { "readPlaintext": true } } for the length of the migration, run `henri encryption:rotate`, then take it out again';

      throw error;
    }

    return decrypt(value, { ...options, keyring: this.keyring });
  }

  /**
   * Decrypts one value: what every adapter calls on the read path.
   *
   * The same as `decrypt()` unless the call sits inside `tolerate()`, in
   * which case a value that will not open reads as `null` and the failure
   * is collected rather than thrown.
   *
   * @param {*} value The stored value
   * @param {object} options `context` and `deterministic`
   * @returns {*} The plaintext, or null inside `tolerate()`
   * @memberof Encryption
   */
  read(value, options) {
    const scope = this.lenient.getStore();

    if (!scope) {
      return this.decrypt(value, options);
    }

    try {
      return this.decrypt(value, options);
    } catch (error) {
      scope.failures.push({
        code: error.code || error.henriCode || null,
        context: options.context,
        keyId: keyIdIn(value),
      });

      return null;
    }
  }

  /**
   * Runs something with every unreadable value reading as `null`, and
   * answers with what could not be read.
   *
   * The failures are the point: whoever asks for leniency has to be able
   * to say what it cost, which is why this answers a pair rather than
   * swallowing the problem.
   *
   * @async
   * @param {function} work What to run
   * @returns {Promise<{failures: Array<object>, value: *}>} The result and
   *   the values that would not open (one entry per read, deduplicated by
   *   `<Model>.<field>` and key id)
   * @memberof Encryption
   */
  async tolerate(work) {
    check('henri.encryption.tolerate', [work]);

    const scope = { failures: [] };
    const value = await this.lenient.run(scope, async () => work());
    const seen = new Set();

    return {
      failures: scope.failures.filter((failure) => {
        const key = `${failure.context}:${failure.code}:${failure.keyId}`;

        if (seen.has(key)) {
          return false;
        }

        seen.add(key);

        return true;
      }),
      value,
    };
  }

  /**
   * Every envelope a deterministic value could be stored as: one per
   * configured key.
   *
   * This is what keeps a lookup working while a rotation is in flight.
   * Rows written before it are under the old key and rows written since
   * are under the new one, so `where: { email }` has to ask for both --
   * an `IN` over as many candidates as there are keys. Once
   * `henri encryption:rotate` has finished and the old key is dropped
   * there is one again.
   *
   * @param {*} value The plaintext
   * @param {object} options `context`
   * @returns {Array<string>} The envelopes, primary first
   * @memberof Encryption
   */
  candidates(value, options) {
    check('henri.encryption.candidates', [value, options]);

    return this.keyring.entries.map((key) =>
      encrypt(value, {
        ...options,
        deterministic: true,
        key,
        keyring: this.keyring,
      })
    );
  }

  /**
   * Is this value one of ours?
   *
   * @param {*} value Anything
   * @returns {boolean} true when it carries the envelope prefix
   * @memberof Encryption
   */
  isEnvelope(value) {
    return isEnvelope(value);
  }

  /**
   * The key id a stored value names
   *
   * @param {*} value Anything
   * @returns {?string} The key id, or null
   * @memberof Encryption
   */
  keyIdIn(value) {
    return keyIdIn(value);
  }

  /**
   * The parts of an envelope, without opening it
   *
   * @param {*} value Anything
   * @returns {?object} `{ body, id, scheme, version }`, or null
   * @memberof Encryption
   */
  parse(value) {
    return parse(value);
  }

  /**
   * The ORM model of a global id, wherever it was registered
   *
   * @param {string} name The global id
   * @returns {*} The ORM model
   * @throws HENRI_ARGUMENT_UNKNOWN_TARGET when the model is not loaded
   * @memberof Encryption
   */
  modelOf(name) {
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

    throw fail(
      'HENRI_ARGUMENT_UNKNOWN_TARGET',
      `there is no model named ${name} in this application: name one of app/models, or drop the --model of the rotation to walk every model that has an encrypted field`
    );
  }

  /** The context `base/rewrap.js` walks the models with */
  get walk() {
    return {
      encryption: this,
      fields: [...this.fields.values()],
      modelOf: (name) => this.modelOf(name),
    };
  }

  /**
   * What the encrypted columns hold, counted by key id.
   *
   * It opens nothing: the key id travels in the clear in every envelope,
   * so this is readable by a process that holds no key at all, and it
   * says nothing about the values.
   *
   * @async
   * @returns {Promise<object>} The report (`base/rewrap.js`)
   * @memberof Encryption
   */
  async status() {
    return statusOf(this.walk);
  }

  /**
   * Rewrites every value that is not already under the primary key, and
   * every value that is still in the clear
   *
   * @async
   * @param {object} [options={}] `dryRun`, `model`, `field`
   * @returns {Promise<object>} The report (`base/rewrap.js`)
   * @memberof Encryption
   */
  async rotate(options = {}) {
    check('henri.encryption.rotate', [options]);

    // A rotation over nothing reports `scanned: 0, rotated: 0` and a clean
    // exit, which is exactly what an operator reads before dropping the old
    // key. A `model` or a `field` that names no encrypted column is refused
    const marks = [...this.fields.values()];
    const wanted = (name, of) =>
      typeof options[name] === 'string' &&
      !marks.some((mark) => mark[name] === options[name]) &&
      unknown('henri.encryption.rotate', `options.${name}`, options[name], [
        ...new Set(marks.map(of)),
      ]);
    const refusal =
      wanted('model', (mark) => mark.model) ||
      wanted('field', (mark) => mark.field);

    if (refusal) {
      throw refusal;
    }

    return rotateOf(this.walk, options);
  }

  /**
   * The map, as data: what `henri encryption` prints and what an agent
   * reads. Key ids, never keys.
   *
   * @returns {object} The keys, the settings and the encrypted fields
   * @memberof Encryption
   */
  describe() {
    return {
      enabled: this.enabled,
      fields: [...this.fields.values()]
        .map((mark) => ({
          deterministic: mark.deterministic,
          field: mark.field,
          model: mark.model,
        }))
        .sort(
          (left, right) =>
            left.model.localeCompare(right.model) ||
            left.field.localeCompare(right.field)
        ),
      keys: this.keyring.describe(),
      readPlaintext: this.readPlaintext,
    };
  }
}

module.exports = Encryption;
