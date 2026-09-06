/**
 * Model versioning: the history of one record, kept row by row.
 *
 * A model says `options: { versioned: true }` and henri writes one row per
 * change into a table of its own -- when, which record, what changed from
 * what to what, who did it and during which request. `henri.versions.of()`
 * reads it back, `reify()` reconstructs the record as it was and
 * `restore()` writes that back.
 *
 * It is opt-in per model and it is nothing at all until a model asks: no
 * table, no hook, no boot line, no branch on the write path. The switch is
 * the model rather than the configuration, because versioning is a property
 * of a record and not of an application -- `config.versions` says only
 * where the table lives and how long its rows are kept.
 *
 * ## This is not the access trail, and the difference is the whole point
 *
 * `base/trail.js` records field *names*, counts, public identifiers and
 * digests, and it **refuses a value** (`HENRI_TRAIL_VALUE_REFUSED`): a
 * record of who touched personal data must never become a second copy of
 * it. `base/calls.js` holds values, but it is a debugging instrument --
 * sampled, kept for days, and evidence of nothing.
 *
 * Versioning is the third thing and it is the opposite of the first: it
 * exists **to hold the values**. Without the old value there is no
 * `reify()`, and without `reify()` this is a worse trail. So:
 *
 * - the trail answers _who saw this record_;
 * - the call log answers _what did this request do_;
 * - the versions answer _what did this record used to say_.
 *
 * None of the three substitutes for another, and none should be turned on
 * to do another's job. The one henri would rather you reached for by
 * accident is the trail, which is why this file carries the argument and
 * why the guides carry it twice.
 *
 * ## What that costs, and what pays for it
 *
 * Holding values means inheriting the privacy machinery rather than
 * sidestepping it, and there are four rules, in this order (`kindOf`):
 *
 * 1. A field the model left out (`versioned: { only }` / `{ except }`) is
 *    not stored and not even named. So are the columns henri derives:
 *    the primary key (which never leaves the server), the public
 *    identifier (the row already names the record) and the two
 *    timestamps, which the version's own `at` already says.
 * 2. **`password` is never stored**, on any model, whatever the
 *    configuration says. It is named as changed and its values are not
 *    kept, which is what `null` means in a change.
 * 3. A field the model marked `encrypted` is stored as its **envelope**
 *    and never as its plaintext, on both sides of the change. The
 *    envelope is written by `henri.encryption.encrypt()` with the field's
 *    own context, so it opens exactly where the row's does -- but it is a
 *    re-wrap rather than a byte copy, so a deterministic field gives the
 *    same bytes and a randomised one does not.
 * 4. A name `config.filterParameters` matches, by the same substring test
 *    `base/redact.js` uses, is not stored. A token in a version table is a
 *    live token.
 *
 * And then the decision that is not a rule: **a field marked `personal`
 * IS stored.** A version table that dropped personal fields would be
 * empty on precisely the models an application versions -- who changed
 * this person's address, and to what -- which is the question the feature
 * exists to answer. henri does not pretend a version is not personal
 * data; it makes it reachable, which is the part that can be checked:
 * `henri privacy:erase` reaches these rows (`config.versions.onErase`),
 * `henri privacy:export` hands them to the person they are about, and the
 * retention sweep prunes them (`config.versions.keep`). Dropping the
 * values would have been the version that looks safer and answers
 * nothing.
 *
 * ## What a row holds, per event
 *
 * - `create`: `changes` is `{ field: [null, value] }` for every stored
 *   field the record was created with. No snapshot: on a create the `new`
 *   side of the diff *is* the whole record, and a snapshot would be the
 *   same bytes twice.
 * - `update`: `changes` is `{ field: [old, new] }` for the fields that
 *   changed, and nothing else. **A soft delete is one of these**: the row
 *   is still in the table with `deletedAt` set, so the diff describes it
 *   exactly and there is nothing a snapshot would add.
 * - `destroy`: the row leaving the database. `changes` is empty and
 *   `snapshot` is every stored field. This is the one event where the
 *   diff is not enough, and the reason is the whole rule: a diff
 *   describes a change *to something*, and after a real delete there is
 *   no something left to describe or to fold back from. Without the
 *   snapshot a destroyed record cannot be brought back, and bringing it
 *   back is half of what this feature is for.
 *
 * A change whose value is `null` rather than a two-element array means
 * "this field changed and its values are not kept" -- rules 2 and 4
 * above. It is deliberately not a masked string: a mask is a value, and a
 * `restore()` would write it into the column.
 *
 * ## Who did it
 *
 * The actor and the request id are the join, and neither is threaded
 * through the call: `base/request-id.js` already keeps the request id in
 * an `AsyncLocalStorage` for the length of a request, and the versions
 * module puts the acting user on the same store. So `record.save()` deep
 * inside a service records who is signed in without any of the code
 * between knowing that versioning exists.
 *
 * Outside a request there is no store, and a version says so rather than
 * guessing: `actor` is null and `source` is `system`. A job, a console
 * session, a seed or a task that knows better says so for the length of a
 * call with `henri.versions.acting({ actor, source }, fn)` -- an async
 * context, like `henri.encryption.tolerate()`, and not a setting.
 *
 * @module base/versions
 */

const { randomFillSync } = require('node:crypto');

const { isFiltered, filterParameters } = require('./redact');
const { fail } = require('./errors');
const { period } = require('./retention');

/** The version of a row's canonical form */
const VERSION = 1;

/** The table versions are written to, unless the configuration says */
const DEFAULT_TABLE = 'henri_versions';

/** What a version may say happened */
const EVENTS = ['create', 'destroy', 'update'];

/** Where a change came from */
const SOURCES = ['console', 'http', 'job', 'seed', 'system', 'task'];

/** What `versions.onErase` accepts */
const ON_ERASE = ['delete', 'follow', 'retain'];

/** The keys `options.versioned` accepts in its object form */
const MARK_KEYS = ['events', 'except', 'only'];

/**
 * Field names no version ever holds the values of, on any model, whatever
 * the configuration says. `base/redact.js` has an `ALWAYS_MASKED` for the
 * same reason: `config.filterParameters` *replaces* its defaults, so an
 * application that widens it must not be able to take this away.
 *
 * One entry, matched exactly: `password` is the column the user model
 * hashes into, and a column called that on any other model is a credential
 * too. `passwordChangedAt` is not one, which is why the match is exact
 * rather than the substring `filterParameters` uses.
 */
const NEVER = Object.freeze(['password']);

/**
 * Columns henri derives, which a version does not repeat: the primary key
 * never leaves the server (`base/references.js`), the public identifier is
 * already the row's `record`, and the two timestamps are the version's own
 * `at` said twice. `__v` is Mongoose's own and means nothing to anybody
 * else. `deletedAt` is *not* here: a soft delete is a change somebody
 * made, and it is recorded as the update it is.
 */
const DERIVED = Object.freeze([
  '__v',
  '_id',
  'createdAt',
  'externalId',
  'id',
  'updatedAt',
]);

/** How a `Date` is written down, the way `base/cache.js` writes one */
const DATE_TAG = '$date';

/** How deep a stored value is walked */
const MAX_DEPTH = 8;

/** How many rows one prune takes away at a time */
const BATCH = 1000;

const bytes = new Uint8Array(16);
let stamp = 0;
let counter = 0;

/**
 * The identifier of a version, which is also its order.
 *
 * A UUID version 7 (RFC 9562): 48 bits of milliseconds, a 12 bit counter
 * and then randomness, so it sorts by the moment it was made. That is what
 * lets `base/version-store.js` walk the history of a record with
 * `id >= ?` and no sequence column -- and, unlike the access trail, with
 * no unique index two writers have to fight over, because versions are a
 * list and not a chain.
 *
 * The adapters each carry the same generator for `externalId`, and none of
 * them is reachable from here: core does not depend on an adapter. Thirty
 * lines is cheaper than the dependency that would fix that.
 *
 * @returns {string} the uuid, lowercase, with its dashes
 */
function uuidv7() {
  const now = Date.now();

  randomFillSync(bytes);

  if (now > stamp) {
    stamp = now;
    counter = ((bytes[6] << 8) | bytes[7]) & 0x7ff;
  } else if (counter >= 0xfff) {
    stamp += 1;
    counter = 0;
  } else {
    counter += 1;
  }

  bytes[0] = Math.floor(stamp / 0x10000000000) & 0xff;
  bytes[1] = Math.floor(stamp / 0x100000000) & 0xff;
  bytes[2] = Math.floor(stamp / 0x1000000) & 0xff;
  bytes[3] = Math.floor(stamp / 0x10000) & 0xff;
  bytes[4] = Math.floor(stamp / 0x100) & 0xff;
  bytes[5] = stamp & 0xff;
  bytes[6] = 0x70 | (counter >> 8);
  bytes[7] = counter & 0xff;
  bytes[8] = 0x80 | (bytes[8] & 0x3f);

  const hex = Buffer.from(bytes).toString('hex');

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A coded failure carrying what to do about it
 *
 * @param {string} code one of the catalogue's codes
 * @param {string} message what went wrong
 * @param {string} [hint] what to do about it
 * @returns {Error} the error to throw
 */
function refuse(code, message, hint) {
  const error = fail(code, message);

  if (hint) {
    error.hint = hint;
  }

  return error;
}

/**
 * Is the value a plain object?
 *
 * @param {*} value anything
 * @returns {boolean} true for plain objects
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * `config.versions`, normalized.
 *
 * There is no `enabled` here: what turns versioning on is a model saying
 * `versioned`, and this only says where the rows go and how long they stay.
 *
 * @param {object} [config] henri's config module (or anything with get/has)
 * @returns {object} `{ keep, onErase, store, table }`
 */
function versionsConfig(config) {
  const raw =
    config && typeof config.has === 'function' && config.has('versions')
      ? config.get('versions')
      : null;
  const settings = isPlainObject(raw) ? raw : {};

  return {
    keep: settings.keep === false ? null : period(settings.keep) || null,
    onErase: ON_ERASE.includes(settings.onErase) ? settings.onErase : 'follow',
    store: typeof settings.store === 'string' ? settings.store : 'default',
    table: typeof settings.table === 'string' ? settings.table : DEFAULT_TABLE,
  };
}

/**
 * What a model file asked for, or null when it asked for nothing.
 *
 * `true` is every event and every field. The object form narrows it, and
 * anything henri cannot carry out fails the boot rather than versioning
 * something other than what was written down.
 *
 * @param {object} model a model file (`{ globalId, options, schema }`)
 * @returns {?object} `{ events, except, only }` or null
 * @throws HENRI_VERSION_INVALID_OPTION on a mark henri does not understand
 */
function markOf(model) {
  const options = (model && model.options) || {};
  const declared = options.versioned;
  const name = (model && model.globalId) || 'a model';

  if (
    declared === false ||
    declared === null ||
    typeof declared === 'undefined'
  ) {
    return null;
  }

  if (declared === true) {
    return { events: [...EVENTS], except: [], only: null };
  }

  if (!isPlainObject(declared)) {
    throw refuse(
      'HENRI_VERSION_INVALID_OPTION',
      `${name}: 'versioned' must be true or an object of { events, only, except }`,
      "true keeps every field on every event; { only: ['title'] } keeps those fields, { except: ['seenAt'] } keeps the rest"
    );
  }

  const unknown = Object.keys(declared).filter(
    (key) => !MARK_KEYS.includes(key)
  );

  if (unknown.length > 0) {
    throw refuse(
      'HENRI_VERSION_INVALID_OPTION',
      `${name}: 'versioned' has no option named ${unknown.sort().join(', ')}`,
      `It takes ${MARK_KEYS.join(', ')} and nothing else`
    );
  }

  if (declared.only && declared.except) {
    throw refuse(
      'HENRI_VERSION_INVALID_OPTION',
      `${name}: 'versioned' takes 'only' or 'except', not both`,
      'One says which fields are kept and the other says which are not; together they cannot both be the answer'
    );
  }

  const names = (key) => {
    const value = declared[key];

    if (typeof value === 'undefined' || value === null) {
      return null;
    }

    if (
      !Array.isArray(value) ||
      value.some((field) => typeof field !== 'string' || field === '')
    ) {
      throw refuse(
        'HENRI_VERSION_INVALID_OPTION',
        `${name}: 'versioned.${key}' must be a list of field names`,
        `It is the names of the columns of ${name}, as strings`
      );
    }

    return [...value];
  };

  const events = declared.events;

  if (typeof events !== 'undefined' && events !== null) {
    if (
      !Array.isArray(events) ||
      events.length === 0 ||
      events.some((event) => !EVENTS.includes(event))
    ) {
      throw refuse(
        'HENRI_VERSION_INVALID_OPTION',
        `${name}: 'versioned.events' must be a non-empty list of ${EVENTS.join(', ')}`,
        "A model that only wants the edits says { events: ['update'] }"
      );
    }
  }

  return {
    events: Array.isArray(events) ? [...new Set(events)].sort() : [...EVENTS],
    except: names('except') || [],
    only: names('only'),
  };
}

/**
 * How one field of one model is stored.
 *
 * The four rules of the header, in order. `skip` is not stored and not
 * named; `never` and `filtered` are named as changed and hold no values;
 * `envelope` is written through the keyring; `value` is written as it is.
 *
 * @param {string} field the field name
 * @param {object} context `mark`, `filters` and `encrypted` (a Set of the
 *   fields of this model that are encrypted)
 * @returns {string} `skip`, `never`, `envelope`, `filtered` or `value`
 */
function kindOf(field, { mark, filters = [], encrypted = null } = {}) {
  if (DERIVED.includes(field)) {
    return 'skip';
  }

  if (mark && mark.only && !mark.only.includes(field)) {
    return 'skip';
  }

  if (mark && mark.except.includes(field)) {
    return 'skip';
  }

  if (NEVER.includes(field)) {
    return 'never';
  }

  if (encrypted && encrypted.has(field)) {
    return 'envelope';
  }

  // Deliberately without the personal field names `redactor()` adds: a
  // personal value is what a version is for, and what reaches it instead
  // is the erasure and the retention sweep (see the header)
  return isFiltered(field, filters) ? 'filtered' : 'value';
}

/**
 * A value ready for `JSON.stringify`, with every `Date` tagged the way
 * `base/cache.js` tags one.
 *
 * Anything else -- a Buffer, a function, a model instance, a cycle -- is
 * `undefined`, which the caller reads as "not storable" and writes down as
 * a change with no values. A write is never failed over what a column
 * happens to hold: a version that cannot be taken is worth less than the
 * change it was about.
 *
 * @param {*} value what the column holds
 * @param {number} [depth=0] how deep the walk is
 * @param {Set} [seen=new Set()] the objects on the way here
 * @returns {*} the JSON-ready value, or undefined
 */
function pack(value, depth = 0, seen = new Set()) {
  if (value === null) {
    return null;
  }

  const type = typeof value;

  if (type === 'string' || type === 'boolean') {
    return value;
  }

  if (type === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (type !== 'object' || depth >= MAX_DEPTH) {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? undefined
      : { [DATE_TAG]: value.toISOString() };
  }

  if (seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => {
      const packed = pack(item, depth + 1, seen);

      return typeof packed === 'undefined' ? null : packed;
    });
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const done = {};

  for (const key of Object.keys(value)) {
    const packed = pack(value[key], depth + 1, seen);

    if (typeof packed !== 'undefined') {
      done[key] = packed;
    }
  }

  return done;
}

/**
 * A packed value, read back: the tags become `Date` again
 *
 * @param {*} value what `JSON.parse` answered
 * @returns {*} the value
 */
function unpack(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(unpack);
  }

  const keys = Object.keys(value);

  if (keys.length === 1 && keys[0] === DATE_TAG) {
    const date = new Date(value[DATE_TAG]);

    return Number.isNaN(date.getTime()) ? value : date;
  }

  const done = {};

  for (const key of keys) {
    done[key] = unpack(value[key]);
  }

  return done;
}

/**
 * Are two column values the same, as far as a diff is concerned?
 *
 * @param {*} left one value
 * @param {*} right the other
 * @returns {boolean} true when nothing changed
 */
function same(left, right) {
  if (left === right) {
    return true;
  }

  if (left instanceof Date && right instanceof Date) {
    return left.getTime() === right.getTime();
  }

  if (
    (left === null || typeof left === 'undefined') &&
    (right === null || typeof right === 'undefined')
  ) {
    return true;
  }

  if (
    left &&
    right &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !(left instanceof Date) &&
    !(right instanceof Date)
  ) {
    return JSON.stringify(pack(left)) === JSON.stringify(pack(right));
  }

  return false;
}

/**
 * One side of a change, as it is stored.
 *
 * @param {*} value the value
 * @param {string} kind what `kindOf()` answered
 * @param {object} context `encrypt` (a function of the field and the value)
 * @param {string} field the field name
 * @returns {*} the stored value, or undefined when it cannot be stored
 */
function sideOf(value, kind, context, field) {
  if (kind === 'never' || kind === 'filtered') {
    return undefined;
  }

  // A column a record did not have yet is `null` and not "not storable":
  // the whole of a create is a diff from nothing, so `undefined` here has
  // to be a value or every create would be a version of nothing
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  if (kind === 'envelope') {
    const wrapped = context.encrypt ? context.encrypt(field, value) : undefined;

    return typeof wrapped === 'string' ? wrapped : undefined;
  }

  return pack(value);
}

/**
 * The changes between two states of a record.
 *
 * A field whose values are not kept is present with `null` rather than
 * absent, so a reader can tell "nothing changed here" from "something did
 * and henri is not holding it".
 *
 * @param {object} before the record as it was (`{}` on a create)
 * @param {object} after the record as it is (`{}` on a hard delete)
 * @param {object} context `kind` (a function of the field name) and
 *   `encrypt`
 * @returns {object} `{ field: [old, new] }`, or `{ field: null }`
 */
function diffOf(before, after, context) {
  const changes = {};
  const fields = [
    ...new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
  ].sort();

  for (const field of fields) {
    const kind = context.kind(field);

    if (kind === 'skip') {
      continue;
    }

    const was = (before || {})[field];
    const is = (after || {})[field];

    if (same(was, is)) {
      continue;
    }

    const from = sideOf(was, kind, context, field);
    const to = sideOf(is, kind, context, field);

    changes[field] =
      typeof from === 'undefined' || typeof to === 'undefined'
        ? null
        : [from, to];
  }

  return changes;
}

/**
 * Every stored field of a record, as a snapshot writes them down
 *
 * @param {object} record the record, as a plain object
 * @param {object} context `kind` and `encrypt`
 * @returns {object} the values, keyed by field
 */
function snapshotOf(record, context) {
  const values = {};

  for (const field of Object.keys(record || {}).sort()) {
    const kind = context.kind(field);

    if (kind === 'skip') {
      continue;
    }

    const stored = sideOf(record[field], kind, context, field);

    values[field] = typeof stored === 'undefined' ? null : stored;
  }

  return values;
}

/**
 * A stored change map, read back
 *
 * @param {*} raw the column, as JSON or already parsed
 * @returns {object} `{ field: [old, new] | null }`
 */
function changesOf(raw) {
  const parsed = typeof raw === 'string' ? safelyParse(raw) : raw;

  if (!isPlainObject(parsed)) {
    return {};
  }

  const changes = {};

  for (const field of Object.keys(parsed)) {
    const change = parsed[field];

    changes[field] =
      Array.isArray(change) && change.length === 2
        ? [unpack(change[0]), unpack(change[1])]
        : null;
  }

  return changes;
}

/**
 * JSON that may not be
 *
 * @param {string} text the column
 * @returns {*} what it held, or null
 */
function safelyParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * A stored row, as `henri.versions` hands it out
 *
 * @param {object} row a row of the table
 * @returns {object} the version
 */
function toVersion(row) {
  if (!row) {
    return null;
  }

  const snapshot =
    typeof row.snapshot === 'string' ? safelyParse(row.snapshot) : row.snapshot;

  return {
    actor: row.actor || null,
    at: new Date(Number(row.at)),
    changes: changesOf(row.changes),
    erasedAt: row.erased_at ? new Date(Number(row.erased_at)) : null,
    event: row.event,
    id: row.id,
    meta:
      (typeof row.meta === 'string' ? safelyParse(row.meta) : row.meta) || null,
    model: row.model,
    record: row.record,
    requestId: row.request_id || null,
    snapshot: isPlainObject(snapshot) ? unpack(snapshot) : null,
    source: row.source,
  };
}

/**
 * The record as it was immediately after one version was written.
 *
 * It folds **backwards**, from the state that is certainly complete
 * towards the one being asked about, undoing the `new` side of every
 * version newer than the target. Forwards -- from the create, applying
 * each change -- would look simpler and be wrong the first time a version
 * was pruned or a model was versioned after its rows already existed: the
 * fold would silently answer a record that never was, with no way to tell.
 *
 * There are three bases, in this order:
 *
 * 1. the **live record**, when it is still there. Complete by
 *    construction, and the versions between it and the target are what is
 *    undone.
 * 2. the **snapshot of the destroy**, when the record is gone. It is the
 *    state the delete found, which is the answer itself: nothing is
 *    undone from it.
 * 3. neither, which is a record that was destroyed by something that
 *    wrote no snapshot, or one whose versions were pruned. Then the
 *    answer is what the target's own change says and nothing else, and it
 *    says `complete: false` rather than looking like a record.
 *
 * @param {object} options `base`, `newer` (the versions from the target
 *   on, newest first) and `target` (the version asked about)
 * @returns {{attributes: object, complete: boolean, missing: Array<string>}}
 *   the record, whether the reconstruction is exact, and the fields whose
 *   values were not kept
 */
function reifyFrom({ base = null, newer = [], target }) {
  const missing = new Set();
  const fromSnapshot =
    !base && target.event === 'destroy' && target.snapshot
      ? target.snapshot
      : null;
  const attributes = { ...(base || fromSnapshot || {}) };
  let complete = Boolean(base || fromSnapshot);

  if (base) {
    // Newest first, and never the target's own change: a version says what
    // it made the record into, so undoing it would answer the state before
    // rather than after
    for (const version of newer) {
      if (version.id === target.id) {
        continue;
      }

      for (const field of Object.keys(version.changes)) {
        const change = version.changes[field];

        if (change === null) {
          missing.add(field);
          complete = false;
          continue;
        }

        attributes[field] = change[0];
      }
    }
  } else if (!fromSnapshot) {
    for (const field of Object.keys(target.changes)) {
      const change = target.changes[field];

      if (change !== null) {
        attributes[field] = change[1];
      }
    }
  }

  for (const field of Object.keys(target.changes)) {
    if (target.changes[field] === null) {
      missing.add(field);
      complete = false;
    }
  }

  return { attributes, complete, missing: [...missing].sort() };
}

/**
 * The filters a version's field names are measured against
 *
 * @param {object} [config] henri's config module
 * @returns {Array<string>} the filters
 */
function filtersOf(config) {
  return filterParameters(config);
}

module.exports = {
  BATCH,
  DATE_TAG,
  DEFAULT_TABLE,
  DERIVED,
  EVENTS,
  MARK_KEYS,
  NEVER,
  ON_ERASE,
  SOURCES,
  VERSION,
  changesOf,
  diffOf,
  filtersOf,
  isPlainObject,
  kindOf,
  markOf,
  pack,
  refuse,
  reifyFrom,
  safelyParse,
  same,
  sideOf,
  snapshotOf,
  toVersion,
  unpack,
  uuidv7,
  versionsConfig,
};
