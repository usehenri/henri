/**
 * The access trail: who read or changed personal data, appended and not
 * mutable.
 *
 * An erasure writes a receipt into a directory. That is proof for the one
 * operation that produced it, and it is nowhere near enough: the question an
 * application eventually has to answer is not "did you erase me" but "who
 * saw this record", and the honest answer to that has to have been written
 * down before the question was asked.
 *
 * ## What is worth recording
 *
 * Not every read of every row. That is a second database nobody sized, and
 * it would be the first thing turned off. The trail records exactly two
 * things, and the guide says so in its first paragraph so nobody mistakes it
 * for a packet capture:
 *
 * 1. **The operations henri performs itself on personal data.** The export,
 *    the erasure (dry runs included), every retention rule that sweeps, and
 *    the approvals. Core owns every one of those call sites, so this half is
 *    complete by construction: there is no way to run `henri privacy:erase`
 *    without an entry, and an entry that says `refused` is written too.
 * 2. **Reads of records holding personal data**, when
 *    `config.trail.reads` asks for them: one entry per answer henri
 *    serializes through `res.resource()`, `res.collection()` and
 *    `res.render()`. Those are the three places henri turns records into a
 *    payload, so within the boundary "what henri sent" this is also
 *    complete.
 *
 * Everything else is the application's, and it says so: `henri.trail.record()`
 * appends an entry of its own (`app.<something>`). A controller that reads
 * with a model call and answers with `res.json()` is outside the boundary
 * and the guide does not pretend otherwise -- a trail that quietly misses
 * events is worse than no trail, because it reads as evidence.
 *
 * ## Where it goes, and how it stays append-only
 *
 * A table henri owns (`henri_trail`), reached through the store adapter's
 * `query()` or the MongoDB collection, never through a model
 * (`base/trail-store.js` says why). henri issues `INSERT` and `SELECT`
 * against it and nothing else; the one `DELETE` is `prune()`.
 *
 * A database will happily let anyone update a row, so "append-only" cannot
 * be a promise the application layer makes. What it can do is make an edit
 * *visible*:
 *
 * - Every entry carries a `seq`, one more than the last, under a **unique
 *   index**. Two processes appending at the same moment do not fork the
 *   chain: one insert wins, the other is refused by the index, reads the new
 *   head and chains onto it.
 * - Every entry carries `hash = HMAC-SHA256(secret, prev + canonical(entry))`,
 *   where `prev` is the hash of the entry before it. Changing a field of an
 *   old row, or removing a row, breaks every hash after it, and
 *   `henri.trail.verify()` reports the first `seq` where the chain parts
 *   company. The key is `config.secret`, so re-chaining the tail is not
 *   something a stolen database connection can do.
 * - `henri trail:verify` is the command; the guide's operational advice is
 *   to grant the application `INSERT, SELECT` on this table and nothing
 *   else, because the strongest form of "cannot be edited" is still the one
 *   the database enforces.
 *
 * `prune()` is the exception and it is a deliberate one: a trail of who
 * touched personal data is itself personal data, so it has its own
 * retention (`config.trail.keep`). It removes the oldest entries and then
 * appends a `trail.pruned` checkpoint carrying the hash of the last entry it
 * removed, so what remains still verifies from a known link rather than
 * from nothing.
 *
 * ## What it must never hold
 *
 * No values. Ever. An entry holds field *names*, counts, public identifiers
 * (`externalId`, which is already what leaves the server) and digests --
 * never a name, an address, a phone number or the contents of anything. The
 * `meta` of an entry goes through `guard()`, which refuses a key that is a
 * personal field name or a `filterParameters` match, refuses anything that
 * is not a short scalar, and refuses a string that looks like an email
 * address. The failure is `HENRI_TRAIL_VALUE_REFUSED` and it is loud: the
 * worst possible outcome for this feature is a second copy of the data it
 * exists to protect.
 *
 * The person an entry is about is identified the way an erasure receipt
 * identifies them -- their `externalId` when they have one, and an HMAC of
 * their identity keyed with `config.secret`. Whoever has to answer "was this
 * person erased" recomputes the digest from the address they were asked
 * about; the trail alone gives nobody an address back.
 *
 * ## How it is read back
 *
 * `henri.trail.list(filter)` and `henri.trail.count(filter)` (by action,
 * model, actor, person and time), `henri.trail.about(who)` for everything
 * recorded about one person, and `henri.trail.verify()` for the chain.
 * `henri trail`, `henri trail:about <who>` and `henri trail:verify` are the
 * same three from the command line.
 *
 * @module base/trail
 */

const { createHmac, randomUUID } = require('node:crypto');

const { fail } = require('./errors');
const { isPlainObject } = require('./privacy');
const { period } = require('./retention');

/** The version of an entry's canonical form: it is what the hash covers */
const VERSION = 1;

/** The table the trail is written to, unless the configuration says */
const DEFAULT_TABLE = 'henri_trail';

/** How long an entry is kept, unless the configuration says */
const DEFAULT_KEEP = '1y';

/** What `trail.reads` accepts */
const READS = ['all', 'personal'];

/** How many identifiers one entry carries */
const IDS = 50;

/** How long a `meta` value may be */
const VALUE = 200;

/**
 * How many times an append re-reads the head before it gives up.
 *
 * The chain is a serial structure: N writers appending at the same moment
 * take up to N attempts between them, because each of them re-reads the
 * head after the unique index refuses it. Generous rather than clever, and
 * `HENRI_TRAIL_UNWRITABLE` says so when it is not enough.
 */
const ATTEMPTS = 32;

/** Anything shaped like an address: refused in a `meta` value */
const ADDRESS = /[^\s@]+@[^\s@]+\.[^\s@]+/u;

/** The name of the entry a prune leaves behind */
const CHECKPOINT = 'trail.pruned';

/**
 * The actions core records itself. An application's own are prefixed
 * `app.`, so reading a trail says at a glance which half an entry came
 * from.
 */
const ACTIONS = [
  CHECKPOINT,
  'privacy.erase',
  'privacy.export',
  'record.read',
  'retention.sweep',
];

/**
 * A coded failure carrying what to do about it
 *
 * @param {string} code one of the catalogue's codes
 * @param {string} message what went wrong
 * @param {string} hint what to do about it
 * @returns {Error} the error to throw
 */
function refuse(code, message, hint) {
  const error = fail(code, message);

  error.hint = hint;

  return error;
}

/**
 * The `trail` configuration, normalized
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {object} `{ enabled, keep, reads, store, table }`
 */
function trailConfig(config) {
  const has = config && typeof config.has === 'function' && config.has('trail');
  const raw = has ? config.get('trail') : false;

  if (raw === false || raw === null || typeof raw === 'undefined') {
    return {
      enabled: false,
      keep: null,
      reads: false,
      store: 'default',
      table: DEFAULT_TABLE,
    };
  }

  const settings = isPlainObject(raw) ? raw : {};

  return {
    enabled: true,
    keep:
      settings.keep === false ? null : period(settings.keep || DEFAULT_KEEP),
    reads: READS.includes(settings.reads) ? settings.reads : false,
    store: settings.store || 'default',
    table:
      typeof settings.table === 'string' && settings.table !== ''
        ? settings.table
        : DEFAULT_TABLE,
  };
}

/**
 * An HMAC of a value, keyed with the application's secret: proof of what it
 * was without a copy of it
 *
 * @param {*} value what to digest
 * @param {string} [secret] `config.secret`
 * @returns {?string} the digest, hex, or null for nothing
 */
function digestOf(value, secret = '') {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  return createHmac('sha256', String(secret || ''))
    .update(String(value))
    .digest('hex');
}

/**
 * The `meta` of an entry, checked field by field.
 *
 * A trail of who read personal data must not become a copy of it, so this
 * refuses rather than truncates: a caller that wanted to record a value has
 * to be told, not quietly obeyed halfway.
 *
 * @param {*} meta what the caller wants recorded
 * @param {object} [context={}] the context
 * @param {Set<string>} [context.keys] the personal field names
 * @param {Array<string>} [context.filters] `config.filterParameters`
 * @returns {?object} the meta, or null when there is none
 * @throws HENRI_TRAIL_VALUE_REFUSED when it would hold something personal
 */
function guard(meta, { keys = new Set(), filters = [] } = {}) {
  if (meta === null || typeof meta === 'undefined') {
    return null;
  }

  if (!isPlainObject(meta)) {
    throw refuse(
      'HENRI_TRAIL_VALUE_REFUSED',
      'the meta of a trail entry is a flat object of short scalars',
      'Record names and counts, never values: { rule: "drafts", count: 12 }'
    );
  }

  const kept = {};

  for (const key of Object.keys(meta).sort()) {
    const value = meta[key];
    const lower = key.toLowerCase();

    if (keys.has(key)) {
      throw refuse(
        'HENRI_TRAIL_VALUE_REFUSED',
        `the trail refuses to record "${key}": it is a field the models marked personal`,
        'The trail holds field names, counts and public identifiers, never the values behind them'
      );
    }

    if (
      filters.some((filter) => lower.includes(String(filter).toLowerCase()))
    ) {
      throw refuse(
        'HENRI_TRAIL_VALUE_REFUSED',
        `the trail refuses to record "${key}": config.filterParameters masks it everywhere else`,
        'Something masked in every log line does not belong in an append-only table either'
      );
    }

    if (value === null || typeof value === 'undefined') {
      kept[key] = null;
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      kept[key] = value;
      continue;
    }

    if (typeof value !== 'string') {
      throw refuse(
        'HENRI_TRAIL_VALUE_REFUSED',
        `the trail refuses to record "${key}": a ${typeof value} is not a name or a count`,
        'Record strings, numbers, booleans and nulls; anything richer is a record, and records do not go in here'
      );
    }

    if (value.length > VALUE) {
      throw refuse(
        'HENRI_TRAIL_VALUE_REFUSED',
        `the trail refuses to record "${key}": ${value.length} characters is content, not a label`,
        `A meta value is at most ${VALUE} characters`
      );
    }

    if (ADDRESS.test(value)) {
      throw refuse(
        'HENRI_TRAIL_VALUE_REFUSED',
        `the trail refuses to record "${key}": it holds something shaped like an email address`,
        'Name the person with their external id, or let henri digest them: trail.record({ subject })'
      );
    }

    kept[key] = value;
  }

  return kept;
}

/**
 * The canonical form of an entry: what the hash is computed over.
 *
 * A fixed order of fixed fields, so the same entry hashes the same way on
 * every dialect, whatever order the columns came back in.
 *
 * @param {object} row a row, in database shape
 * @returns {string} the canonical string
 */
function canonicalOf(row) {
  return JSON.stringify([
    VERSION,
    Number(row.seq),
    Number(row.at),
    row.action || null,
    row.outcome || null,
    row.source || null,
    row.model || null,
    Number(row.records) || 0,
    row.fields || null,
    row.ids || null,
    row.actor || null,
    row.actor_digest || null,
    row.subject || null,
    row.subject_digest || null,
    row.request_id || null,
    row.route || null,
    row.meta || null,
  ]);
}

/**
 * The hash of an entry, chained onto the one before it
 *
 * @param {?string} prev the hash of the previous entry
 * @param {object} row a row, in database shape
 * @param {string} [secret] `config.secret`
 * @returns {string} the hash, hex
 */
function hashOf(prev, row, secret = '') {
  return createHmac('sha256', String(secret || ''))
    .update(`${prev || ''}\n${canonicalOf(row)}`)
    .digest('hex');
}

/**
 * A list of identifiers as one column, capped
 *
 * @param {Array} ids the identifiers
 * @returns {?string} the JSON, or null
 */
function listOf(ids) {
  const kept = (Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id !== '')
    .slice(0, IDS);

  return kept.length > 0 ? JSON.stringify(kept) : null;
}

/**
 * A stored column back as a list
 *
 * @param {*} value what the column holds
 * @returns {Array} the list, empty when there was nothing
 */
function parseList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string' || value === '') {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

/**
 * A stored column back as an object
 *
 * @param {*} value what the column holds
 * @returns {?object} the object, or null
 */
function parseMeta(value) {
  if (isPlainObject(value)) {
    return value;
  }

  if (typeof value !== 'string' || value === '') {
    return null;
  }

  try {
    const parsed = JSON.parse(value);

    return isPlainObject(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

/**
 * A row, as the API hands it out
 *
 * @param {?object} row a row of the trail
 * @returns {?object} the entry
 */
function toEntry(row) {
  if (!row) {
    return null;
  }

  return {
    action: row.action,
    actor: row.actor || null,
    actorDigest: row.actor_digest || null,
    at: new Date(Number(row.at)).toISOString(),
    fields: parseList(row.fields),
    hash: row.hash,
    id: row.id,
    ids: parseList(row.ids),
    meta: parseMeta(row.meta),
    model: row.model || null,
    outcome: row.outcome,
    prev: row.prev || null,
    records: Number(row.records) || 0,
    requestId: row.request_id || null,
    route: row.route || null,
    seq: Number(row.seq),
    source: row.source,
    subject: row.subject || null,
    subjectDigest: row.subject_digest || null,
  };
}

/**
 * The row of an event, without its sequence, its chain or its hash
 *
 * @param {object} event what the caller wants recorded
 * @param {object} context `keys`, `filters`, `secret`
 * @returns {object} the row, in database shape
 * @throws HENRI_TRAIL_VALUE_REFUSED when the meta holds something personal
 * @throws HENRI_TRAIL_INVALID_EVENT when the event names no action
 */
function rowOf(event, context = {}) {
  const action = String((event && event.action) || '').trim();

  if (action === '' || action.length > 64) {
    throw refuse(
      'HENRI_TRAIL_INVALID_EVENT',
      'a trail entry needs an action: what happened, in one dotted name',
      "henri.trail.record({ action: 'app.exported', model: 'Proposal' })"
    );
  }

  const { secret = '' } = context;
  const subject = event.subject || null;
  const meta = guard(event.meta, context);

  return {
    action,
    actor: typeof event.actor === 'string' ? event.actor.slice(0, 64) : null,
    actor_digest: event.actorDigest || digestOf(event.actorOf, secret),
    at: Number(event.at) || Date.now(),
    fields: listOf(event.fields),
    id: randomUUID(),
    ids: listOf(event.ids),
    meta: meta && Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    model: event.model ? String(event.model).slice(0, 120) : null,
    outcome: ['failed', 'ok', 'refused'].includes(event.outcome)
      ? event.outcome
      : 'ok',
    records: Number.isFinite(event.records) ? Math.max(event.records, 0) : 0,
    request_id: event.requestId ? String(event.requestId).slice(0, 64) : null,
    route: event.route ? String(event.route).slice(0, 190) : null,
    source: ['app', 'cli', 'http', 'job'].includes(event.source)
      ? event.source
      : 'app',
    subject: typeof subject === 'string' ? subject.slice(0, 64) : null,
    subject_digest: event.subjectDigest || digestOf(event.subjectOf, secret),
  };
}

/**
 * Appends one entry, chained onto the head of the trail.
 *
 * The head is read, the entry is numbered and hashed onto it, and the insert
 * either wins the unique index on `seq` or is refused -- in which case
 * another process got there first, the head is read again and the entry
 * chains onto whatever won. That is the whole concurrency story: one chain,
 * no locks, no gaps.
 *
 * @param {object} store a trail backend (`base/trail-store.js`)
 * @param {object} event what to record
 * @param {object} [context={}] `keys`, `filters`, `secret`
 * @returns {Promise<object>} the entry that was written
 * @throws HENRI_TRAIL_UNWRITABLE when the head keeps moving under it
 */
async function appendTo(store, event, context = {}) {
  const base = rowOf(event, context);

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const head = await store.last();
    const row = {
      ...base,
      prev: head ? head.hash : null,
      seq: head ? Number(head.seq) + 1 : 1,
    };

    row.hash = hashOf(row.prev, row, context.secret);

    if (await store.append(row)) {
      return toEntry(row);
    }

    // Another writer won this sequence number. Stepping aside for a moment
    // is what keeps a crowd of writers from taking turns losing
    if (attempt > 2) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.floor(Math.random() * 5) + 1)
      );
    }
  }

  throw refuse(
    'HENRI_TRAIL_UNWRITABLE',
    `the trail entry "${base.action}" could not be appended after ${ATTEMPTS} attempts`,
    'Something is writing to the trail table faster than henri can chain onto it, or its unique index on seq is missing'
  );
}

/**
 * Walks the chain and says where, if anywhere, it parts company.
 *
 * A break is either a hash that does not follow from the entry before it (a
 * row was edited) or a gap in the sequence (a row was removed). The one
 * legitimate discontinuity is the start of the trail after a prune, which is
 * why a checkpoint carries the hash of the last entry it took away.
 *
 * @param {object} store a trail backend
 * @param {object} [options={}] `secret`, `batch`
 * @returns {Promise<object>} `{ ok, entries, from, to, broken }`
 */
async function verifyChain(store, { secret = '', batch = 500 } = {}) {
  let after = 0;
  let previous = null;
  let entries = 0;
  let from = null;
  let to = null;

  for (;;) {
    const rows = await store.since(after, batch);

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const seq = Number(row.seq);
      const expected = hashOf(row.prev || null, row, secret);

      if (from === null) {
        from = seq;
      }

      // The first entry seen may follow rows a prune took away: its `prev`
      // is then the checkpoint's, which is a link henri wrote and kept
      if (previous !== null && (row.prev || null) !== previous.hash) {
        return broken(seq, entries, from, 'chain', previous.seq);
      }

      if (previous !== null && seq !== previous.seq + 1) {
        return broken(seq, entries, from, 'sequence', previous.seq);
      }

      if (expected !== row.hash) {
        return broken(seq, entries, from, 'hash', previous && previous.seq);
      }

      previous = { hash: row.hash, seq };
      entries += 1;
      to = seq;
      after = seq;
    }
  }

  return { broken: null, entries, from, ok: true, to };
}

/**
 * The answer of a verification that failed
 *
 * @param {number} seq where it failed
 * @param {number} entries how many were verified before it
 * @param {?number} from the first sequence number seen
 * @param {string} reason `chain`, `sequence` or `hash`
 * @param {?number} after the last good sequence number
 * @returns {object} the answer
 */
function broken(seq, entries, from, reason, after) {
  return {
    broken: { after: after === null ? null : after, reason, seq },
    entries,
    from,
    ok: false,
    to: after === null ? null : after,
  };
}

module.exports = {
  ACTIONS,
  ADDRESS,
  ATTEMPTS,
  CHECKPOINT,
  DEFAULT_KEEP,
  DEFAULT_TABLE,
  IDS,
  READS,
  VALUE,
  VERSION,
  appendTo,
  canonicalOf,
  digestOf,
  guard,
  hashOf,
  listOf,
  parseList,
  parseMeta,
  rowOf,
  toEntry,
  trailConfig,
  verifyChain,
};
