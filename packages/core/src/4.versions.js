const { AsyncLocalStorage } = require('node:async_hooks');

const BaseModule = require('./base/module');

const debug = require('debug')('henri:versions');

const { check } = require('./base/arguments');
const { EXTERNAL_ID } = require('./base/external-id');
const { findRecords } = require('./base/erasure');
const {
  currentActor,
  currentRequestId,
  setActor,
} = require('./base/request-id');
const { storeFor } = require('./base/version-store');
const {
  BATCH,
  EVENTS,
  SOURCES,
  changesOf,
  diffOf,
  filtersOf,
  isPlainObject,
  kindOf,
  markOf,
  pack,
  refuse,
  reifyFrom,
  snapshotOf,
  toVersion,
  uuidv7,
  versionsConfig,
} = require('./base/versions');

/**
 * Model versioning: `henri.versions`, the history of the records of the
 * models that asked for one.
 *
 * The design -- what a row holds per event, what is never stored, why the
 * fold runs backwards and why this is not the access trail -- is in the
 * header of `base/versions.js`. This is the module: it owns the table,
 * writes the rows the adapters hand it, reads them back, reconstructs a
 * record and writes one back.
 *
 * **Off costs nothing, and off is the default.** No model saying
 * `versioned` means: no table created, no statement issued, no middleware
 * mounted, no boot line printed and `henri.versions.enabled` false. The
 * adapters register no hook on a model that did not ask, so there is not
 * even a branch on the write path of an application that does not use
 * this. The precedent is the call log, which `2.server.js` does not mount
 * when `config.calls` is absent.
 *
 * @class Versions
 * @extends {BaseModule}
 */
class Versions extends BaseModule {
  /**
   * Creates an instance of Versions.
   * @memberof Versions
   */
  constructor() {
    super();

    this.reloadable = true;
    // The models are what asks for this, and where the table lives
    this.needs = ['config', 'model'];
    // The actor comes off `req.user`, so the middleware sits after the one
    // passport mounts and before the router runs an action
    this.after = ['user'];
    this.before = ['router'];
    this.runlevel = 4;
    this.name = 'versions';
    this.henri = null;

    /** `config.versions`, normalized */
    this.settings = versionsConfig(null);
    /** Whether anything is being versioned */
    this.enabled = false;
    /** The backend (`base/version-store.js`), or null */
    this.store = null;
    /** The adapter it was built on, so a model reload is noticed */
    this.adapter = null;
    /** What each versioned model asked for, by model name */
    this.marks = new Map();
    /** How each field of each model is stored, built once and kept */
    this.plans = new Map();
    /** Where `acting()` keeps who is acting, one async context deep */
    this.actor = new AsyncLocalStorage();

    this._mounted = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.record = this.record.bind(this);
    this.of = this.of.bind(this);
    this.list = this.list.bind(this);
    this.count = this.count.bind(this);
    this.get = this.get.bind(this);
    this.reify = this.reify.bind(this);
    this.restore = this.restore.bind(this);
    this.acting = this.acting.bind(this);
    this.prune = this.prune.bind(this);
    this.erase = this.erase.bind(this);

    debug('constructor initialized');
  }

  /**
   * Module initialization: reads what the models asked for and, when any
   * of them did, prepares the table
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @throws HENRI_VERSION_INVALID_OPTION on a mark henri cannot carry out
   * @throws HENRI_VERSION_UNSUPPORTED_STORE when the store cannot hold them
   * @memberof Versions
   */
  async init() {
    const { config, pen } = this.henri;

    this.settings = versionsConfig(config);
    this.marks = new Map();
    this.plans = new Map();

    for (const model of (this.henri.model && this.henri.model.models) || []) {
      const mark = markOf(model);

      if (mark) {
        this.marks.set(model.globalId, mark);
      }
    }

    if (this.marks.size === 0) {
      debug('no model asked to be versioned: nothing is written');

      return this.name;
    }

    this.enabled = true;

    await this.ready();
    this.mount(this.henri.server);

    pen.info(
      'versions',
      `${this.settings.table}: ${[...this.marks.keys()].sort().join(', ')}`,
      this.settings.keep
        ? `kept ${this.keepLabel()}`
        : 'kept for as long as the application keeps them (versions.keep)'
    );

    return this.name;
  }

  /**
   * How long a row stays, in words
   *
   * @returns {string} the period
   * @memberof Versions
   */
  keepLabel() {
    const days = this.settings.keep / 86400000;

    return days >= 1 ? `${Math.round(days)} day(s)` : `${this.settings.keep}ms`;
  }

  /**
   * Mounts the middleware that says who is acting, once and only when
   * something is versioned. It reads `req.user` and puts it on the store
   * `base/request-id.js` already opened for the request, so nothing
   * between a controller and a model call has to carry it.
   *
   * @param {object} server the server module
   * @returns {boolean} whether it was mounted by this call
   * @memberof Versions
   */
  mount(server) {
    if (this._mounted || !server || !server.app) {
      return false;
    }

    server.app.use((req, res, next) => {
      const user = req.user || null;

      setActor(
        user
          ? { actor: user[EXTERNAL_ID] || null, source: 'http' }
          : { actor: null, source: 'http' }
      );

      next();
    });

    this._mounted = true;

    return true;
  }

  /**
   * Rebuilds the module after a reload
   *
   * @async
   * @returns {Promise<string>} the name of the module
   * @memberof Versions
   */
  async reload() {
    this.enabled = false;
    this.store = null;
    this.adapter = null;

    return this.init();
  }

  /**
   * Does this model keep versions?
   *
   * @param {string} name the model name
   * @returns {boolean} true when it asked for them
   * @memberof Versions
   */
  watches(name) {
    return this.marks.has(name);
  }

  /**
   * How each field of one model is stored, computed once.
   *
   * `base/versions.js` owns the rules; this is where the answers are kept
   * so a write path does not measure `filterParameters` against every
   * column of every row.
   *
   * @param {string} name the model name
   * @returns {object} `{ kind, encrypt }`
   * @memberof Versions
   */
  planOf(name) {
    if (this.plans.has(name)) {
      return this.plans.get(name);
    }

    const mark = this.marks.get(name) || null;
    const filters = filtersOf(this.henri.config);
    const encryption = this.henri.encryption || null;
    const encrypted = new Set();

    for (const [key, entry] of (encryption && encryption.fields) || []) {
      if (entry.model === name) {
        encrypted.add(entry.field);
      }

      debug('%s is encrypted', key);
    }

    const kinds = new Map();
    const plan = {
      /**
       * The envelope of one value, written the way the row's own is
       *
       * @param {string} field the field name
       * @param {*} value the plaintext
       * @returns {*} the envelope
       */
      encrypt: (field, value) => {
        const entry = encryption && encryption.fields.get(`${name}.${field}`);

        if (!entry || !encryption.keyring.enabled) {
          return undefined;
        }

        return encryption.encrypt(value, {
          context: `${name}.${field}`,
          deterministic: entry.deterministic === true,
        });
      },

      /**
       * How one field is stored
       *
       * @param {string} field the field name
       * @returns {string} what `kindOf()` answered
       */
      kind: (field) => {
        if (!kinds.has(field)) {
          kinds.set(field, kindOf(field, { encrypted, filters, mark }));
        }

        return kinds.get(field);
      },
    };

    this.plans.set(name, plan);

    return plan;
  }

  /**
   * Who is acting, and where the change came from.
   *
   * `acting()` wins, then the request the change is being made inside,
   * then nothing: outside a request henri does not guess. A job, a console
   * session or a seed that knows better says so.
   *
   * @returns {{actor: ?string, requestId: ?string, source: string}} the who
   * @memberof Versions
   */
  who() {
    const said = this.actor.getStore() || currentActor();
    const requestId = currentRequestId();

    return {
      actor: (said && said.actor) || null,
      requestId,
      source: (said && said.source) || (requestId ? 'http' : 'system'),
    };
  }

  /**
   * Runs something with the actor and the source it names.
   *
   * An async context rather than a setting, so two jobs running at the
   * same time in one process never claim each other's actor.
   *
   * @param {object} who `actor` (an external id or a record) and `source`
   * @param {function} work what to run
   * @returns {*} whatever the work answered
   * @throws HENRI_ARGUMENT_INVALID on a source henri does not know
   * @memberof Versions
   */
  acting(who, work) {
    check('henri.versions.acting', [who, work]);

    const { actor = null, source = 'system' } = who || {};

    if (!SOURCES.includes(source)) {
      throw refuse(
        'HENRI_ARGUMENT_INVALID',
        `henri.versions.acting(who) has no source named '${source}'`,
        `It is one of ${SOURCES.join(', ')}`
      );
    }

    const external =
      actor && typeof actor === 'object' ? actor[EXTERNAL_ID] || null : actor;

    return this.actor.run(
      { actor: typeof external === 'string' ? external : null, source },
      work
    );
  }

  /**
   * Writes one version.
   *
   * A no-op on a model nothing asked to version, so an adapter can call it
   * without asking first. A failure is **not** swallowed: a history with a
   * hole in it reads as evidence and is not, and the change and its
   * version belong to the same call -- inside `store.transaction()` they
   * are one write or neither.
   *
   * @async
   * @param {object} event `model`, `record`, `event`, `before`, `after`,
   *   `meta`
   * @returns {Promise<?object>} the version, or null when nothing was kept
   * @memberof Versions
   */
  async record(event) {
    if (!this.enabled) {
      return null;
    }

    const { after = null, before = null, meta = null, model } = event || {};
    const mark = this.marks.get(model);

    if (!mark || !EVENTS.includes(event.event)) {
      return null;
    }

    if (!mark.events.includes(event.event)) {
      return null;
    }

    const record = event.record;

    if (typeof record !== 'string' || record === '') {
      // A model with `externalId: false` has no public identifier, so
      // there is no name for the row this would be about. Saying nothing
      // is worse than saying so, and the boot is where it is said
      throw refuse(
        'HENRI_VERSION_NO_IDENTIFIER',
        `${model} is versioned and this record has no external id, so a version could not name it`,
        'Versioning names a record by its externalId (base/references.js), so a versioned model cannot also say options: { externalId: false }'
      );
    }

    const plan = this.planOf(model);
    const at = Date.now();
    const who = this.who();
    const changes =
      event.event === 'destroy'
        ? diffOf(before || {}, after || before || {}, plan)
        : diffOf(before || {}, after || {}, plan);
    const snapshot =
      event.event === 'destroy' ? snapshotOf(before || {}, plan) : null;

    // An update that changed nothing is not a version of anything: a save
    // that writes no column would otherwise leave one row per call
    if (event.event === 'update' && Object.keys(changes).length === 0) {
      return null;
    }

    const row = {
      actor: who.actor,
      at,
      changes: JSON.stringify(changes),
      erased_at: null,
      event: event.event,
      id: uuidv7(),
      meta: isPlainObject(meta) ? JSON.stringify(meta) : null,
      model,
      record,
      request_id: who.requestId,
      snapshot: snapshot ? JSON.stringify(snapshot) : null,
      source: who.source,
    };

    await (await this.ready()).append(row);

    return toVersion(row);
  }

  /**
   * The versions of one record, newest first
   *
   * @async
   * @param {*} record a record, or `{ model, record }`
   * @param {object} [filter={}] the rest of the filter
   * @returns {Promise<Array<object>>} the versions
   * @memberof Versions
   */
  async of(record, filter = {}) {
    check('henri.versions.of', [record, filter]);

    const named = this.identify(record);

    return this.list({ ...filter, ...named });
  }

  /**
   * The model and the external id of whatever was handed over
   *
   * @param {*} record a record, or `{ model, record }`
   * @returns {{model: string, record: string}} how to name it
   * @throws HENRI_ARGUMENT_INVALID when it names no record
   * @memberof Versions
   */
  identify(record) {
    if (isPlainObject(record) && typeof record.model === 'string') {
      return { model: record.model, record: String(record.record || '') };
    }

    const model =
      record &&
      record.constructor &&
      (record.constructor.modelName || record.constructor.globalId);
    const external = record && record[EXTERNAL_ID];

    if (typeof model !== 'string' || typeof external !== 'string') {
      throw refuse(
        'HENRI_ARGUMENT_INVALID',
        'henri.versions.of(record) takes a record, or { model, record }',
        'A record carries the model it belongs to and its externalId; { model: "Memo", record: "<uuid>" } says both by hand'
      );
    }

    return { model, record: external };
  }

  /**
   * The versions matching a filter, newest first
   *
   * @async
   * @param {object} [filter={}] `model`, `record`, `actor`, `event`,
   *   `requestId`, `source`, `since`, `until`, `limit`, `offset`
   * @returns {Promise<Array<object>>} the versions
   * @memberof Versions
   */
  async list(filter = {}) {
    check('henri.versions.list', [filter]);

    const rows = await (await this.ready()).list(this.filter(filter));

    return rows.map(toVersion);
  }

  /**
   * How many versions match a filter
   *
   * @async
   * @param {object} [filter={}] the filter
   * @returns {Promise<number>} the count
   * @memberof Versions
   */
  async count(filter = {}) {
    check('henri.versions.count', [filter]);

    return (await this.ready()).count(this.filter(filter));
  }

  /**
   * One version, by id
   *
   * @async
   * @param {string} id the version id
   * @returns {Promise<?object>} the version, or null
   * @memberof Versions
   */
  async get(id) {
    check('henri.versions.get', [id]);

    return toVersion(await (await this.ready()).get(id));
  }

  /**
   * A filter with its moments turned into milliseconds
   *
   * @param {object} filter the filter
   * @returns {object} the filter the store reads
   * @memberof Versions
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
   * The version something names, read back
   *
   * @async
   * @param {*} version a version, or a version id
   * @returns {Promise<object>} the version
   * @throws HENRI_VERSION_UNKNOWN when there is no such version
   * @memberof Versions
   */
  async resolve(version) {
    const found =
      isPlainObject(version) && version.id && version.model
        ? version
        : await this.get(typeof version === 'string' ? version : '');

    if (!found) {
      throw refuse(
        'HENRI_VERSION_UNKNOWN',
        `there is no version with the id ${typeof version === 'string' ? version : '(none given)'}`,
        'henri versions <Model> <record> lists the versions of one record with their ids'
      );
    }

    return found;
  }

  /**
   * The record as it was immediately after one version was written.
   *
   * A **read**: it touches no record and writes nothing. It folds
   * backwards from the live record -- or from the destroy's snapshot when
   * the record is gone -- undoing every version newer than this one, for
   * the reason `reifyFrom()` gives.
   *
   * @async
   * @param {*} version a version, or a version id
   * @returns {Promise<object>} `{ attributes, complete, missing, version }`
   * @throws HENRI_VERSION_UNKNOWN when there is no such version
   * @memberof Versions
   */
  async reify(version) {
    check('henri.versions.reify', [version]);

    const target = await this.resolve(version);
    const rows = await (
      await this.ready()
    ).newerThan(target.model, target.record, target.id);
    const live = await this.liveRecord(target.model, target.record);
    const reified = reifyFrom({
      base: live ? this.plainOf(live) : null,
      newer: rows.map(toVersion),
      target,
    });
    const opened = this.open(target.model, reified);

    return { ...opened, existed: Boolean(live), version: target };
  }

  /**
   * The envelopes of a reconstruction, opened.
   *
   * A version stores an encrypted field as its envelope and never as its
   * plaintext, which is the rule; what a reader of `reify()` wants is the
   * value the row would have answered, so the envelopes are opened on the
   * way out. One that will not open -- a key that is gone -- is not a
   * value, so it joins `missing` and the reconstruction stops being exact.
   *
   * @param {string} model the model name
   * @param {object} reified what `reifyFrom()` answered
   * @returns {object} the same, with the envelopes opened
   * @memberof Versions
   */
  open(model, reified) {
    const { encryption } = this.henri;
    const plan = this.planOf(model);
    const attributes = { ...reified.attributes };
    const missing = new Set(reified.missing);
    let complete = reified.complete;

    for (const field of Object.keys(attributes)) {
      if (plan.kind(field) !== 'envelope' || attributes[field] === null) {
        continue;
      }

      try {
        attributes[field] = encryption.read(attributes[field], {
          context: `${model}.${field}`,
          deterministic:
            (encryption.fields.get(`${model}.${field}`) || {}).deterministic ===
            true,
        });
      } catch {
        delete attributes[field];
        missing.add(field);
        complete = false;
      }
    }

    return { attributes, complete, missing: [...missing].sort() };
  }

  /**
   * Writes a reified record back.
   *
   * A **write**, and that is the whole difference: `reify()` shows what it
   * could reconstruct and lets a reader see the gaps, so it answers what
   * it has. A restore fills a column, so a gap would silently change the
   * record to something it never was -- it refuses unless the caller says
   * `force`.
   *
   * A record that still exists is updated; one that was destroyed is
   * created again under the same external id. Either way the restore is a
   * change like any other and is itself recorded as a version.
   *
   * @async
   * @param {*} version a version, or a version id
   * @param {object} [options={}] `force` writes an inexact reconstruction
   * @returns {Promise<object>} `{ record, created, missing, version }`
   * @throws HENRI_VERSION_INCOMPLETE when the reconstruction is not exact
   * @memberof Versions
   */
  async restore(version, options = {}) {
    check('henri.versions.restore', [version, options]);

    const reified = await this.reify(version);
    const { attributes, missing, version: target } = reified;

    if (!reified.complete && options.force !== true) {
      throw refuse(
        'HENRI_VERSION_INCOMPLETE',
        `${target.model} ${target.record} cannot be restored exactly from version ${target.id}: ${
          missing.length > 0
            ? `no values are kept for ${missing.join(', ')}`
            : 'there is nothing complete to fold from'
        }`,
        'Read it with henri.versions.reify() and write what you want by hand, or pass { force: true } to write everything that was kept and leave the rest as it is'
      );
    }

    const Model = this.modelOf(target.model);
    const existing = await this.liveRecord(target.model, target.record);
    const values = { ...attributes };

    for (const field of missing) {
      delete values[field];
    }

    if (existing) {
      const updated = await existing.update(values, { unsafe: true });

      return { created: false, missing, record: updated, version: target };
    }

    // The public identifier goes back with it: every url, every link and
    // every foreign key that named this record still names it
    const created = await Model.create(
      { ...values, [EXTERNAL_ID]: target.record },
      { unsafe: true }
    );

    return { created: true, missing, record: created, version: target };
  }

  /**
   * The ORM model of a name
   *
   * @param {string} name the model name
   * @returns {*} the ORM model
   * @throws HENRI_VERSION_UNKNOWN when nothing is loaded under that name
   * @memberof Versions
   */
  modelOf(name) {
    const found =
      this.henri.privacy && this.henri.privacy.modelOf(name, { quiet: true });

    if (!found) {
      throw refuse(
        'HENRI_VERSION_UNKNOWN',
        `the model ${name} is not loaded, so its versions name nothing that can be read or written`,
        'A version outlives the model file that made it: keep the model, or take its versions away'
      );
    }

    return found;
  }

  /**
   * The record a version is about, if it is still there
   *
   * @async
   * @param {string} model the model name
   * @param {string} record the external id
   * @returns {Promise<*>} the record, or null
   * @memberof Versions
   */
  async liveRecord(model, record) {
    // The erasure's own walk: it is the one place that reads a record out
    // of any of the three adapters, and it looks past a soft delete --
    // which is what a restore of a soft deleted record needs
    const [found] = await findRecords(this.modelOf(model), {
      [EXTERNAL_ID]: record,
    });

    return found || null;
  }

  /**
   * A record as a plain object, hidden columns and all: a fold undoes what
   * was written, and a column the serializer drops is still a column a
   * version changed
   *
   * @param {*} record the record
   * @returns {object} the attributes
   * @memberof Versions
   */
  plainOf(record) {
    if (typeof record.toObject === 'function') {
      return record.toObject({ hidden: true });
    }

    if (typeof record.get === 'function') {
      return { ...record.get() };
    }

    return { ...record };
  }

  /**
   * Takes the versions past `config.versions.keep` away.
   *
   * The retention sweep calls this, the way it prunes the trail and the
   * call log: a version holds old values, so it is subject to the same
   * retention as everything else that does.
   *
   * @async
   * @param {object} [options={}] `now` and `batch`
   * @returns {Promise<object>} `{ before, removed }`
   * @memberof Versions
   */
  async prune(options = {}) {
    check('henri.versions.prune', [options]);

    const { now = Date.now(), batch = BATCH } = options;

    if (!this.enabled || !this.settings.keep) {
      return { before: null, removed: 0 };
    }

    const store = await this.ready();
    const before = now - this.settings.keep;
    let removed = 0;

    for (;;) {
      const taken = await store.prune(before, batch);

      removed += taken;

      if (taken < batch) {
        break;
      }
    }

    return { before, removed };
  }

  /**
   * What an erasure does to the versions of the records it touched.
   *
   * `config.versions.onErase`:
   *
   * - `follow` (the default): a version follows the record it describes.
   *   The records that were deleted take their versions with them --
   *   nothing they describe exists any more. The records that survive
   *   (anonymized, orphaned) keep their history and have the *values* of
   *   the erased fields taken out of it, which is the only answer that
   *   leaves a proposal's edit history intact and its author's old name
   *   gone.
   * - `delete`: every version of every record the erasure touched goes.
   * - `retain`: they are left alone, and the receipt says so. This is the
   *   one for a history a regulator requires; an omission that is written
   *   down is a decision, an omission that is silent is a leak.
   *
   * And in every case the person stops being an *actor*: a version they
   * wrote on somebody else's record keeps the change and forgets who made
   * it, because the external id of a deleted account names nothing and the
   * external id of an anonymized one is no longer an identity.
   *
   * @async
   * @param {Array<object>} steps the plan of `base/erasure.js`
   * @param {object} [options={}] `actor` (the person's external id) and
   *   `dryRun`
   * @returns {Promise<object>} what was done, for the receipt
   * @memberof Versions
   */
  async erase(steps = [], options = {}) {
    if (!this.enabled) {
      return null;
    }

    const store = await this.ready();
    const strategy = this.settings.onErase;
    const done = { forgotten: 0, models: [], removed: 0, rewritten: 0 };

    if (strategy === 'retain') {
      return { ...done, strategy };
    }

    for (const step of steps) {
      if (!this.watches(step.model) || step.action === 'retain') {
        continue;
      }

      const records = (step.ids || [])
        .map((entry) => (entry && entry.externalId) || null)
        .filter((entry) => typeof entry === 'string');

      if (records.length === 0) {
        continue;
      }

      const rows = await store.forRecords(step.model, records);

      if (rows.length === 0) {
        continue;
      }

      const removing = strategy === 'delete' || step.action === 'delete';

      if (options.dryRun) {
        done[removing ? 'removed' : 'rewritten'] += rows.length;
        done.models.push({
          action: removing ? 'delete' : 'anonymize',
          count: rows.length,
          model: step.model,
        });
        continue;
      }

      if (removing) {
        await store.remove(rows.map((row) => row.id));
        done.removed += rows.length;
      } else {
        done.rewritten += await this.forget(
          store,
          rows,
          Object.keys(step.values)
        );
      }

      done.models.push({
        action: removing ? 'delete' : 'anonymize',
        count: rows.length,
        model: step.model,
      });
    }

    if (options.actor && !options.dryRun) {
      await store.forgetActor(options.actor);
      done.forgotten = 1;
    }

    return { ...done, strategy };
  }

  /**
   * Empties the values of the named fields, in place, in the rows given
   *
   * @async
   * @param {object} store the backend
   * @param {Array<object>} rows the rows
   * @param {Array<string>} fields the fields to forget
   * @returns {Promise<number>} how many rows were written
   * @memberof Versions
   */
  async forget(store, rows, fields) {
    if (fields.length === 0) {
      return 0;
    }

    const wanted = new Set(fields);
    let written = 0;

    for (const row of rows) {
      const changes = changesOf(row.changes);
      const snapshot =
        (typeof row.snapshot === 'string'
          ? JSON.parse(row.snapshot || 'null')
          : row.snapshot) || null;
      let touched = false;

      for (const field of Object.keys(changes)) {
        if (wanted.has(field) && changes[field] !== null) {
          changes[field] = null;
          touched = true;
        }
      }

      if (snapshot) {
        for (const field of Object.keys(snapshot)) {
          if (wanted.has(field) && snapshot[field] !== null) {
            snapshot[field] = null;
            touched = true;
          }
        }
      }

      if (!touched && row.erased_at) {
        continue;
      }

      await store.rewrite({
        changes: JSON.stringify(
          Object.fromEntries(
            Object.keys(changes).map((field) => [
              field,
              changes[field] === null ? null : this.repack(changes[field]),
            ])
          )
        ),
        erased_at: Date.now(),
        id: row.id,
        snapshot: snapshot ? JSON.stringify(snapshot) : null,
      });

      written += 1;
    }

    return written;
  }

  /**
   * A change read back, written down again the way it was stored
   *
   * @param {Array} change `[old, new]`
   * @returns {Array} the same, packed
   * @memberof Versions
   */
  repack(change) {
    return [pack(change[0]), pack(change[1])];
  }

  /**
   * Everything the versions hold about one person's records, for
   * `henri privacy:export`: the history of a record is part of what is
   * held about whoever it is about
   *
   * @async
   * @param {Array<object>} steps the plan of `base/erasure.js`
   * @returns {Promise<object>} the versions, by model
   * @memberof Versions
   */
  async exportOf(steps = []) {
    if (!this.enabled) {
      return null;
    }

    const store = await this.ready();
    const found = {};

    for (const step of steps) {
      if (!this.watches(step.model)) {
        continue;
      }

      const records = (step.ids || [])
        .map((entry) => (entry && entry.externalId) || null)
        .filter((entry) => typeof entry === 'string');

      if (records.length === 0) {
        continue;
      }

      const rows = await store.forRecords(step.model, records);

      if (rows.length > 0) {
        found[step.model] = rows
          .map(toVersion)
          .sort((left, right) => (left.id < right.id ? -1 : 1));
      }
    }

    return Object.keys(found).length > 0 ? found : null;
  }

  /**
   * The backend, or a readable error.
   *
   * It is resolved rather than held, because `henri.model.reload()` builds
   * new stores and a backend bound to the old one would write into a
   * database nothing reads any more. The comparison is one property read
   * per call and the table is created once per adapter.
   *
   * @async
   * @returns {Promise<object>} the backend
   * @throws HENRI_VERSION_DISABLED when nothing is versioned
   * @throws HENRI_VERSION_UNSUPPORTED_STORE when the store cannot hold them
   * @memberof Versions
   */
  async ready() {
    if (!this.enabled) {
      throw refuse(
        'HENRI_VERSION_DISABLED',
        'no model of this application keeps versions, so there is nothing to read back',
        'Add options: { versioned: true } to a model; henri creates its table on the next boot'
      );
    }

    const stores = (this.henri.model && this.henri.model.stores) || {};
    const adapter = stores[this.settings.store];

    if (!adapter) {
      throw refuse(
        'HENRI_VERSION_UNSUPPORTED_STORE',
        `config.versions.store names "${this.settings.store}", which is not one of this application's stores`,
        'Point it at one of the names of the stores block, or leave it out for the default store'
      );
    }

    if (adapter !== this.adapter || !this.store) {
      this.adapter = adapter;
      this.store = storeFor(adapter, this.settings.table);

      await this.store.install();
    }

    return this.store;
  }
}

module.exports = Versions;
