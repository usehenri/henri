const BaseModule = require('./base/module');

const debug = require('debug')('henri:trail');

const { check } = require('./base/arguments');
const { fail } = require('./base/errors');
const { userConfig } = require('./base/auth');
const { EXTERNAL_ID } = require('./base/external-id');
const { storeFor } = require('./base/trail-store');
const {
  CHECKPOINT,
  appendTo,
  digestOf,
  toEntry,
  trailConfig,
  verifyChain,
} = require('./base/trail');

/**
 * The access trail: `henri.trail`, the append-only record of who read or
 * changed personal data.
 *
 * The design -- what is recorded, what it must never hold, and how a table
 * anyone can `UPDATE` is still evidence -- is in the header of
 * `base/trail.js`. This is the module: it owns the table, appends, reads
 * back, verifies the chain and prunes.
 *
 * It is off unless `config.trail` says otherwise, and off means off: no
 * table is created, no statement is issued, and `henri.trail.enabled` is
 * false. Every caller inside core goes through `record()`, which is a no-op
 * on a disabled trail, so nothing in the framework has to ask first.
 *
 * @class Trail
 * @extends {BaseModule}
 */
class Trail extends BaseModule {
  /**
   * Creates an instance of Trail.
   * @memberof Trail
   */
  constructor() {
    super();

    this.reloadable = true;
    // The models are where the table lives, and the privacy map is what
    // says which names must never reach it
    this.needs = ['config', 'model'];
    this.after = ['privacy'];
    // The router records the reads, and the router is 5
    this.before = ['router'];
    this.runlevel = 4;
    this.name = 'trail';
    this.henri = null;

    /** `config.trail`, normalized */
    this.settings = trailConfig(null);
    /** Whether anything is being recorded */
    this.enabled = false;
    /** The backend (`base/trail-store.js`), or null */
    this.store = null;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.record = this.record.bind(this);
    this.list = this.list.bind(this);
    this.about = this.about.bind(this);
    this.verify = this.verify.bind(this);
    this.prune = this.prune.bind(this);
    this.seen = this.seen.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: prepares the table when the trail is on
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @throws HENRI_TRAIL_UNSUPPORTED_STORE when the store cannot hold it
   * @memberof Trail
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = trailConfig(config);

    if (!this.settings.enabled) {
      debug('no config.trail: nothing is recorded');

      return this.name;
    }

    const stores = (this.henri.model && this.henri.model.stores) || {};
    const adapter = stores[this.settings.store];

    if (!adapter) {
      throw fail(
        'HENRI_TRAIL_UNSUPPORTED_STORE',
        `config.trail.store names "${this.settings.store}", which is not one of this application's stores`
      );
    }

    this.store = storeFor(adapter, this.settings.table);

    await this.store.install();

    this.enabled = true;

    pen.info(
      'trail',
      `appending to ${this.settings.table}`,
      this.settings.reads
        ? `${this.settings.reads} reads recorded`
        : 'privacy operations only'
    );

    return this.name;
  }

  /**
   * Rebuilds the module after a reload
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Trail
   */
  async reload() {
    this.enabled = false;
    this.store = null;

    return this.init();
  }

  /**
   * What `guard()` checks a `meta` against: the personal field names and
   * the parameters masked in every log line
   *
   * @returns {object} `{ filters, keys, secret }`
   * @memberof Trail
   */
  context() {
    const { config, privacy } = this.henri;
    const filters = config.has('filterParameters')
      ? config.get('filterParameters')
      : [];

    return {
      filters: Array.isArray(filters) ? filters : [],
      keys: (privacy && privacy.keys) || new Set(),
      secret: config.has('secret') ? config.get('secret') : '',
    };
  }

  /**
   * How an entry names a person: their public identifier when they have
   * one, and a digest of the address, which is what makes "was this person
   * erased" answerable from an address alone.
   *
   * The digest covers the subject model and the lowercased address, and
   * nothing else -- deliberately not the primary key, which whoever asks
   * the question does not have.
   *
   * @param {*} who a record, an email address or an external id
   * @returns {{subject: ?string, subjectDigest: ?string}} how to name them
   * @memberof Trail
   */
  identify(who) {
    const { secret } = this.context();
    const model =
      (this.henri.privacy && this.henri.privacy.subjectModel) ||
      userConfig(this.henri.config).model;
    const digest = (email) =>
      email
        ? digestOf(`${model}\n${String(email).toLowerCase()}`, secret)
        : null;

    if (who && typeof who === 'object') {
      const external = who[EXTERNAL_ID] || null;

      return {
        subject: typeof external === 'string' ? external : null,
        subjectDigest: digest(who.email),
      };
    }

    if (typeof who !== 'string' || who === '') {
      return { subject: null, subjectDigest: null };
    }

    return {
      subject: who.includes('@') ? null : who,
      subjectDigest: who.includes('@') ? digest(who) : null,
    };
  }

  /**
   * Appends one entry.
   *
   * A disabled trail answers null and does nothing, which is what lets core
   * call it from everywhere without a guard. A failure to append is *not*
   * swallowed: something that records who touched personal data has to say
   * when it could not.
   *
   * @async
   * @param {object} event `action`, `model`, `records`, `fields`, `ids`,
   *   `actor`, `subject`, `outcome`, `source`, `route`, `requestId`, `meta`
   * @returns {Promise<?object>} the entry, or null when the trail is off
   * @throws HENRI_TRAIL_VALUE_REFUSED when the meta holds something personal
   * @memberof Trail
   */
  async record(event) {
    if (!this.enabled || !this.store) {
      return null;
    }

    return appendTo(this.store, event, this.context());
  }

  /**
   * Appends an entry about one request, filling in what the request knows
   *
   * @async
   * @param {object} req the request
   * @param {object} event the entry
   * @returns {Promise<?object>} the entry, or null
   * @memberof Trail
   */
  async records(req, event) {
    if (!this.enabled || !this.store) {
      return null;
    }

    const user = (req && req.user) || null;

    return this.record({
      actor: user ? user[EXTERNAL_ID] || null : null,
      actorOf: user ? String(user.id || user._id || '') : null,
      requestId: (req && req.id) || null,
      route: req
        ? `${req.method} ${req.route ? req.route.path : req.path}`
        : null,
      source: 'http',
      ...event,
    });
  }

  /**
   * Every model instance in an answer, grouped by model.
   *
   * The constructor map built at boot (`base/references.js`) is what says
   * whether an object is a record: a class henri did not register is not a
   * model, whatever it is called. The walk is shallow on purpose -- an
   * answer is a record, a list of records, or an object holding some.
   *
   * @param {*} value what is about to be sent
   * @param {number} [depth=3] how far down to look
   * @param {Map} [found=new Map()] what has been found so far
   * @param {Set} [seen=new Set()] the objects already walked
   * @returns {Map<string, Array>} the records, by model
   * @memberof Trail
   */
  group(value, depth = 3, found = new Map(), seen = new Set()) {
    if (!value || typeof value !== 'object' || depth === 0 || seen.has(value)) {
      return found;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        this.group(item, depth, found, seen);
      }

      return found;
    }

    const classes =
      (this.henri.model && this.henri.model.referenceTable.classes) ||
      new Map();
    const model = classes.get(value.constructor);

    if (typeof model === 'string') {
      found.set(model, [...(found.get(model) || []), value]);

      return found;
    }

    for (const key of Object.keys(value)) {
      this.group(value[key], depth - 1, found, seen);
    }

    return found;
  }

  /**
   * Records what an answer carried, one entry per model.
   *
   * This is the read half of the trail and it costs a round trip and an
   * insert per answer, which is why it is off unless `config.trail.reads`
   * asks for it. A read that cannot be recorded is not sent: a trail with
   * holes in it reads as evidence and is not.
   *
   * @async
   * @param {object} req the request
   * @param {*} value the records about to be sent
   * @param {object} [options={}] `route` and anything else of the entry
   * @returns {Promise<Array<object>>} the entries that were appended
   * @memberof Trail
   */
  async seen(req, value, options = {}) {
    if (!this.enabled || !this.settings.reads) {
      return [];
    }

    const entries = [];
    const { privacy } = this.henri;

    for (const [model, records] of this.group(value)) {
      const fields = Object.keys(privacy.fields(model));

      // `personal` is the privacy map's own answer to "is this model about a
      // person": the fields it marked, *or* a link to the person. A proposal
      // marks nothing and is still the speaker's, and a trail that left it
      // out would answer "who saw this record" with silence
      if (this.settings.reads === 'personal' && !privacy.entryOf(model)) {
        continue;
      }

      entries.push(
        await this.records(req, {
          action: 'record.read',
          fields,
          ids: records.map((record) => record[EXTERNAL_ID]),
          model,
          records: records.length,
          ...options,
        })
      );
    }

    return entries;
  }

  /**
   * The entries matching a filter, newest first
   *
   * @async
   * @param {object} [filter={}] `action`, `model`, `actor`, `subject`,
   *   `outcome`, `since`, `until`, `limit`, `offset`
   * @returns {Promise<Array<object>>} the entries
   * @memberof Trail
   */
  async list(filter = {}) {
    // A filter value the store cannot use is dropped rather than matched,
    // so `list({ action: 42 })` used to answer the whole trail -- the
    // opposite of what it asked for, and no way to tell
    check('henri.trail.list', [filter]);

    const rows = await this.ready().list(this.filter(filter));

    return rows.map(toEntry);
  }

  /**
   * How many entries match a filter
   *
   * @async
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof Trail
   */
  async count(filter = {}) {
    check('henri.trail.count', [filter]);

    return this.ready().count(this.filter(filter));
  }

  /**
   * Everything recorded about one person
   *
   * @async
   * @param {*} who a record, an email address or an external id
   * @param {object} [filter={}] the rest of the filter
   * @returns {Promise<Array<object>>} the entries
   * @memberof Trail
   */
  async about(who, filter = {}) {
    check('henri.trail.about', [who, filter]);

    const { subject, subjectDigest } = this.identify(who);

    if (!subject && !subjectDigest) {
      return [];
    }

    // The digest is the stable name -- it survives the erasure that took
    // the address away -- so it answers when there is one
    return subjectDigest
      ? this.list({ ...filter, digest: subjectDigest })
      : this.list({ ...filter, subject });
  }

  /**
   * A filter with its moments turned into milliseconds
   *
   * @param {object} filter the filter
   * @returns {object} the filter the store reads
   * @memberof Trail
   */
  filter(filter) {
    const moment = (value) =>
      typeof value === 'undefined' || value === null
        ? undefined
        : new Date(value).getTime();

    return {
      ...filter,
      since: moment(filter.since),
      until: moment(filter.until),
    };
  }

  /**
   * Walks the chain and says whether anything was edited or removed
   *
   * @async
   * @returns {Promise<object>} `{ ok, entries, from, to, broken }`
   * @memberof Trail
   */
  async verify() {
    return verifyChain(this.ready(), { secret: this.context().secret });
  }

  /**
   * Takes the entries past `config.trail.keep` away, and leaves a
   * checkpoint carrying the hash of the last of them so what remains still
   * verifies
   *
   * @async
   * @param {object} [options={}] `now`
   * @returns {Promise<object>} `{ removed, before, checkpoint }`
   * @memberof Trail
   */
  async prune(options = {}) {
    check('henri.trail.prune', [options]);

    const { now = Date.now() } = options;

    if (!this.enabled || !this.store || !this.settings.keep) {
      return { before: null, checkpoint: null, removed: 0 };
    }

    const before = now - this.settings.keep;
    const { last, removed } = await this.store.prune(before);

    if (removed === 0) {
      return { before, checkpoint: null, removed: 0 };
    }

    const checkpoint = await appendTo(
      this.store,
      {
        action: CHECKPOINT,
        meta: { hash: last.hash, seq: Number(last.seq) },
        records: removed,
        source: 'job',
      },
      this.context()
    );

    return { before, checkpoint, removed };
  }

  /**
   * The backend, or a readable error
   *
   * @returns {object} the backend
   * @throws HENRI_TRAIL_DISABLED when nothing is being recorded
   * @memberof Trail
   */
  ready() {
    if (!this.enabled || !this.store) {
      const error = fail(
        'HENRI_TRAIL_DISABLED',
        'this application keeps no access trail, so there is nothing to read back'
      );

      error.hint =
        'Turn it on with "trail": {} in config/<env>.json; henri creates its table on the next boot';

      throw error;
    }

    return this.store;
  }
}

module.exports = Trail;
