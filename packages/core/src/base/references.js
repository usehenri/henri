const { EXTERNAL_ID, hasExternalId, isUuid } = require('./external-id');

/**
 * The other half of the public identifier: the foreign keys, and the
 * lookups.
 *
 * `base/external-id.js` stopped a record from carrying its own primary key
 * out. It did not stop it from carrying somebody else's: a proposal that
 * belongs to a speaker still answered `speakerId: 4812`, so the sequential
 * id of the users table leaked one relation away, and `GET /proposals/4812`
 * still resolved next to the uuid, so guessing a number still worked. Both
 * are closed here.
 *
 * ## Which fields are foreign keys, and how henri knows
 *
 * henri never reads a field name. `userId` is not a foreign key because it
 * ends in `Id`; it is a foreign key when the model *said* it points at
 * another model. Each adapter answers `references()` from what its own ORM
 * was told, and nothing else:
 *
 * - **Sequelize** answers from `Model.associations`, which is what
 *   `Post.belongsTo(User, { foreignKey: 'authorId' })` in the model file's
 *   `associate(models)` built, and from `rawAttributes[field].references`
 *   when a field declared `references: { model: 'User' }` without an
 *   association.
 * - **Drizzle** answers from `Model.associations` (the `belongsTo` entries
 *   `model.js` records) and from `fields[field].references.model`.
 * - **Mongoose** answers from `schema.path(field).options.ref`, the string
 *   a `{ type: ObjectId, ref: 'User' }` path declares, and from the caster
 *   of an array of them.
 *
 * ### What henri cannot know, and therefore does not guess
 *
 * - **A column that points at a row without saying so.** `ownerId: { type:
 *   'string' }` holding `String(user._id)` is a foreign key to a human and
 *   an opaque string to henri. It is serialized as it is stored. Declaring
 *   the relation -- `references: { model: 'User' }` on SQL, `ref: 'User'`
 *   on Mongoose -- is what makes it visible, and is the only fix.
 * - **A Mongoose `refPath`.** The target model is named by a sibling field
 *   and changes per document; a field the query did not select, or a
 *   presenter dropped, would make the same key resolve against a different
 *   collection. henri leaves those alone rather than resolve them against
 *   the wrong one.
 * - **A `ref` that is a function.** Same reason, evaluated per document.
 * - **A plain object that never was a record.** A `.lean()` query, a row
 *   from `adapter.query()`, an object a controller built by hand: none of
 *   them carries the model it came from, so none of them can be looked up
 *   in the table below. `stripInternalIds()` still removes the internal ids
 *   of anything carrying an `externalId`; the foreign keys of such an
 *   object are the application's to translate.
 * - **A polymorphic pair** (`subjectType` + `subjectId`) is two undeclared
 *   columns as far as every ORM here is concerned.
 *
 * ## What a foreign key serializes as
 *
 * The `externalId` of the row it points at, and `null` when there is no
 * such row. Never the number, never a partial answer: a key that cannot be
 * resolved fails closed, because the alternative is leaving the primary key
 * in the payload, which is the bug being fixed.
 *
 * ### The cost, and how it is kept to that
 *
 * Resolving a key is a lookup, and the naive shape of that is N+1: twenty
 * five proposals with three foreign keys each would be seventy five
 * queries. This module never does that. One `publish()` call covers one
 * whole answer -- `res.render()`'s payload, `res.resource()`'s record,
 * `res.collection()`'s entire page -- and it works in three steps:
 *
 * 1. **Walk once.** Every record in the answer is visited, its foreign keys
 *    collected with the model they point at.
 * 2. **Take what is already there.** A record whose association was eager
 *    loaded (`include: ['speaker']`) already holds the speaker, with its
 *    primary key and its `externalId` side by side. The key on the parent
 *    is compared against the loaded record's primary key, and on a match
 *    its `externalId` is used. No query, and no guess: the identity is
 *    checked, not assumed, so a presenter that put a different object under
 *    `speaker` cannot make henri publish the wrong record's identifier.
 * 3. **Batch the rest.** What is left is grouped by target model and asked
 *    for in one statement per model (`externalIdsOf()`), with the distinct
 *    keys deduplicated.
 *
 * So the cost of an answer is **at most one query per target model**, not
 * one per record. Measured on the showcase against PostgreSQL
 * (`showcase/test/references.test.js`, which fails on a regression):
 *
 * - `GET /proposals?per_page=25` -- 25 records, 75 foreign keys, three
 *   models pointed at, `include: ['event', 'speaker', 'track']` -- runs
 *   **3 statements for the whole request**, the same three it ran before
 *   this module existed. Every key came back for free from step 2.
 * - the same 25 records published with nothing included run **3
 *   statements**, one per target model, against 75 for the naive shape.
 *   Six distinct speakers are one `IN`, not six queries.
 *
 * The memo lives for the length of one `publish()` call and is thrown away
 * with it. A process-wide id-to-uuid cache would be faster and would be a
 * poisoning target -- one wrong entry publishes the wrong record's
 * identifier to everyone -- and a cache keyed by primary key would be a map
 * of exactly the thing this module exists to stop handing out.
 *
 * ### Why the default is on
 *
 * `externalIds.references: false` restores the numbers. It is off by
 * default because the default is what applications get, and a default that
 * leaks is the bug. An application that turns it off is reported by `henri
 * audit` (`externalIds.references-disabled`).
 *
 * ## Whether a numeric id still resolves
 *
 * It does not. `Model.findById()` on a model that carries an `externalId`
 * resolves a uuid and nothing else; a primary key gets `null`, which the
 * controller that was already written answers as a 404. That is the strong
 * answer, and it was chosen over a permissive default because a uuid that
 * is accepted *alongside* the number it replaces buys nothing at all: an
 * attacker enumerates the numbers and never types a uuid.
 *
 * The refusal is `null`, not an error, and it is the same `null` a uuid
 * that names no row gets. Nothing in the answer distinguishes "no such row"
 * from "not that kind of identifier": a 404 that says which one it was is a
 * lookup oracle, and the whole point is that the number stops answering
 * questions.
 *
 * Server-side code that legitimately holds a primary key -- the session's
 * subject, a reload, a join it just made -- calls `findByKey()`, which is
 * the primary key and only ever the primary key. The split is deliberate:
 * `findById()` is the one that takes what arrived from outside, and it is
 * the one that got strict.
 *
 * `externalIds.lookup: 'any'` restores the old behaviour for an application
 * whose links already carry numbers, and `henri audit` reports it
 * (`externalIds.lookup-any`).
 *
 * ## An application that opted out
 *
 * `options: { externalId: false }` is still a supported thing for a model
 * to say, and nothing here changes for it:
 *
 * - its records have no `externalId`, so `stripInternalIds()` leaves their
 *   `id` alone, as before;
 * - its `findById()` is untouched -- there is no public identifier to
 *   prefer, so the primary key is the identifier and keeps resolving;
 * - a foreign key *pointing at* such a model is left as the number it is,
 *   because the row it names has no other identifier to give.
 *
 * The two gates are per model, read from the model, and an application that
 * opted out everywhere sees no behaviour change at all.
 */

/** What `config.externalIds` defaults to when the application says nothing */
const DEFAULTS = { lookup: 'external', references: true };

/**
 * The `externalIds` settings of an application, with the defaults filled in
 *
 * @param {Henri} henri the henri instance
 * @returns {{lookup: string, references: boolean}} the settings
 */
function settings(henri) {
  const config = henri && henri.config;
  let raw = null;

  // `config.get()` throws on a key the application never wrote, and the
  // defaults are what an application that wrote nothing gets
  if (config && typeof config.get === 'function') {
    try {
      raw =
        typeof config.has !== 'function' || config.has('externalIds')
          ? config.get('externalIds')
          : null;
    } catch {
      raw = null;
    }
  }

  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULTS };
  }

  return {
    lookup: raw.lookup === 'any' ? 'any' : DEFAULTS.lookup,
    references: raw.references !== false,
  };
}

/**
 * The primary key of a serialized or live record, as it is written down
 *
 * @param {*} record anything
 * @returns {?string} the key as a string, or null
 */
function keyOf(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const id =
    typeof record.id !== 'undefined' && record.id !== null
      ? record.id
      : record._id;

  return id === null || typeof id === 'undefined' ? null : String(id);
}

/**
 * Is this value a live model instance rather than a plain object?
 *
 * Only the map built at boot answers: a `constructor` henri did not
 * register is not a model, whatever it is called.
 *
 * @param {Map} classes the constructor map (`Map<class, globalId>`)
 * @param {*} value anything
 * @returns {?string} the global id of the model, or null
 */
function modelOf(classes, value) {
  if (!classes || !value || typeof value !== 'object') {
    return null;
  }

  const found = classes.get(value.constructor);

  return typeof found === 'string' ? found : null;
}

/**
 * Builds the table this module reads: every model of every store, the
 * foreign keys it declared and whether it carries a public identifier.
 *
 * An adapter that does not answer `references()` (an older one, a test
 * double) contributes nothing and its records keep the shape they had.
 *
 * @param {object} [stores={}] `henri.model.stores`
 * @returns {{classes: Map, models: object}} the constructor map and the
 *   `{ globalId: { externalId, references, store } }` table
 */
function build(stores = {}) {
  const classes = new Map();
  const models = {};

  for (const name of Object.keys(stores || {})) {
    const store = stores[name];

    if (!store) {
      continue;
    }

    if (typeof store.getModels === 'function') {
      const registered = store.getModels() || {};

      for (const globalId of Object.keys(registered)) {
        if (registered[globalId]) {
          classes.set(registered[globalId], globalId);
        }
      }
    }

    if (typeof store.references !== 'function') {
      continue;
    }

    let described = {};

    try {
      described = store.references() || {};
    } catch {
      // An adapter that cannot describe itself is an adapter whose records
      // keep their foreign keys; it is never a failed boot
    }

    for (const globalId of Object.keys(described)) {
      const entry = described[globalId] || {};

      models[globalId] = {
        externalId: entry.externalId !== false,
        references: entry.references || {},
        store: name,
      };
    }
  }

  return { classes, models };
}

/**
 * Reads a child of a node, preferring the live model instance over its
 * serialized copy so the walk keeps knowing what each record is.
 *
 * `toJSON()` flattens an eager-loaded association into a plain object,
 * which loses the model it came from; the instance still on the parent does
 * not. Anything that is not a registered model is taken from the serialized
 * copy, which is what applies the schema's hidden fields and virtuals.
 *
 * @param {object} context the walk context
 * @param {*} node the live node (a model instance, or the plain object)
 * @param {object} plain its serialized form
 * @param {string} key the field
 * @returns {*} the value to walk
 */
function childOf(context, node, plain, key) {
  if (node === plain) {
    return plain[key];
  }

  const live = node[key];

  if (modelOf(context.classes, live)) {
    return live;
  }

  if (
    Array.isArray(live) &&
    live.length > 0 &&
    modelOf(context.classes, live[0])
  ) {
    return live;
  }

  return plain[key];
}

/**
 * Replaces the foreign keys of one record: what is already loaded is taken
 * from the loaded record, the rest is queued for the batch.
 *
 * @param {object} context the walk context
 * @param {string} name the global id of the model this record belongs to
 * @param {*} node the live record (a model instance, or the plain object)
 * @param {object} plain its serialized form
 * @param {object} copy the copy being built
 * @returns {void}
 */
function reference(context, name, node, plain, copy) {
  const entry = context.models[name];

  if (!entry) {
    return;
  }

  for (const field of Object.keys(entry.references)) {
    if (!Object.prototype.hasOwnProperty.call(copy, field)) {
      continue;
    }

    const { as, target } = entry.references[field];
    const known = context.models[target];

    // A target that carries no public identifier has no other name to give:
    // its primary key is its identifier, and it stays
    if (!known || known.externalId === false) {
      continue;
    }

    const many = Array.isArray(copy[field]);
    const values = many ? copy[field] : [copy[field]];
    const resolved = values.map((value, at) => {
      if (value === null || typeof value === 'undefined' || isUuid(value)) {
        return value;
      }

      const key = String(value);
      // The live instance, not its serialization: the adapter's own
      // `toJSON()` already removed the primary key the check below needs
      const loaded = as ? node[as] || plain[as] : null;

      // The eager-loaded record, but only when it is the row this key
      // names: the identity is checked, never assumed, so a presenter that
      // put a different object under `as` cannot make henri publish the
      // wrong record's identifier
      if (
        loaded &&
        typeof loaded === 'object' &&
        !Array.isArray(loaded) &&
        keyOf(loaded) === key &&
        hasExternalId(loaded)
      ) {
        return loaded[EXTERNAL_ID];
      }

      context.pending.push({
        copy,
        field,
        index: many ? at : null,
        key,
        target,
      });

      // Fails closed: an answer that never comes back leaves null, not the
      // primary key this whole module exists to withhold
      return null;
    });

    copy[field] = many ? resolved : resolved[0];
  }
}

/**
 * The walk: one copy of the value, without the internal ids, with the
 * foreign keys replaced by what is known and the rest queued.
 *
 * @param {object} context the walk context
 * @param {*} value anything
 * @param {?string} [name=null] the model of this node, when the caller knows
 * @returns {*} the copy
 */
function walk(context, value, name = null) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }

  if (context.seen.has(value)) {
    return context.seen.get(value);
  }

  if (Array.isArray(value)) {
    const copy = [];

    context.seen.set(value, copy);
    value.forEach((entry) => copy.push(walk(context, entry)));

    return copy;
  }

  // The caller's word first, then the map of registered constructors: a
  // controller that says which model a plain object holds (`base/answers.js`)
  // is the only way an object that never was a record can have its foreign
  // keys published, and it is the reason `types` exists
  const model =
    name ||
    (context.types ? context.types.get(value) : null) ||
    modelOf(context.classes, value);
  const plain = typeof value.toJSON === 'function' ? value.toJSON() : value;

  // A registered model is a record whatever its prototype is; anything else
  // that is not a plain object (an ObjectId, a Map, a class of the
  // application's own) is left as its own serialization
  if (!plain || typeof plain !== 'object' || (!isPlain(plain) && !model)) {
    context.seen.set(value, plain);

    return plain;
  }

  const copy = {};

  context.seen.set(value, copy);

  for (const key of Object.keys(plain)) {
    const entry = walk(context, childOf(context, value, plain, key));

    // `copy.__proto__ = x` would run the setter of Object.prototype and
    // replace the copy's prototype instead of adding a field. A JSON column
    // is one place an attacker can put that key, so it is defined rather
    // than assigned -- the value is kept, and it stays a field
    if (key === '__proto__') {
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: entry,
        writable: true,
      });
      continue;
    }

    copy[key] = entry;
  }

  if (model && context.references) {
    reference(context, model, value, plain, copy);
  }

  if (hasExternalId(copy)) {
    delete copy.id;
    delete copy._id;
  }

  return copy;
}

/**
 * Is the value a plain object (a record, not a Date or a class instance)?
 *
 * @param {*} value anything
 * @returns {boolean} true for plain objects
 */
function isPlain(value) {
  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * Asks the stores for the public identifiers the walk could not find, one
 * statement per target model.
 *
 * @param {Henri} henri the henri instance
 * @param {object} context the walk context
 * @returns {Promise<void>} when every pending key has an answer
 */
async function settle(henri, context) {
  const wanted = new Map();

  for (const { key, target } of context.pending) {
    if (!wanted.has(target)) {
      wanted.set(target, new Set());
    }

    wanted.get(target).add(key);
  }

  const found = new Map();

  await Promise.all(
    [...wanted.entries()].map(async ([target, keys]) => {
      const entry = context.models[target];
      const store =
        entry && henri.model && henri.model.stores
          ? henri.model.stores[entry.store]
          : null;

      if (!store || typeof store.externalIdsOf !== 'function') {
        return;
      }

      try {
        found.set(
          target,
          (await store.externalIdsOf(target, [...keys])) || new Map()
        );
      } catch (error) {
        // A lookup that failed leaves null in the payload, which is the
        // safe half of the answer; it is never a failed request
        henri.pen &&
          henri.pen.warn &&
          henri.pen.warn(
            'model',
            `unable to resolve the public identifiers of ${target}: ${error.message}`
          );
      }
    })
  );

  for (const { copy, field, index, key, target } of context.pending) {
    const answers = found.get(target);
    const external = answers ? answers.get(key) : null;

    // No answer means no such row, and null is what stays: the payload
    // never falls back to the primary key
    if (typeof external !== 'string' || external === '') {
      continue;
    }

    if (index === null) {
      copy[field] = external;
    } else if (Array.isArray(copy[field])) {
      copy[field][index] = external;
    }
  }
}

/**
 * The walk, without the lookups: the copy, and what is still missing.
 *
 * The two halves are separate because one of them is free and the other is
 * a query. An answer whose foreign keys were all eager loaded -- or that
 * holds no record at all, which is most of what a controller hands
 * `res.json()` -- comes back complete from here, and the caller answers
 * without an asynchronous hop it does not need (see base/answers.js).
 *
 * @param {Henri} henri the henri instance
 * @param {*} value a record, a list of records, or anything else
 * @param {object} [options={}] options
 * @param {?WeakMap} [options.types=null] the model of a node the caller
 *   knows and henri cannot see: a plain object carries no model, so this is
 *   what lets a declared answer publish one
 * @returns {{context: object, copy: *, pending: Array}} the copy, the
 *   context to hand `settle()` and the keys it would resolve
 */
function prepare(henri, value, { types = null } = {}) {
  const table = (henri && henri.model && henri.model.referenceTable) || {
    classes: new Map(),
    models: {},
  };
  const context = {
    classes: table.classes,
    models: table.models,
    pending: [],
    references: settings(henri).references,
    seen: new WeakMap(),
    types,
  };
  const copy = walk(context, value);

  return { context, copy, pending: context.pending };
}

/**
 * The last gate on the way out: a copy of the value with no internal id and
 * no foreign key that names a row by its primary key.
 *
 * Everything an application hands `res.render()`, `res.resource()` or
 * `res.collection()` goes through here, once per answer.
 *
 * @param {Henri} henri the henri instance
 * @param {*} value a record, a list of records, or anything else
 * @param {object} [options={}] options (see `prepare`)
 * @returns {Promise<*>} the value, published
 */
async function publish(henri, value, options = {}) {
  const { context, copy, pending } = prepare(henri, value, options);

  if (pending.length > 0) {
    await settle(henri, context);
  }

  return copy;
}

module.exports = {
  DEFAULTS,
  build,
  keyOf,
  prepare,
  publish,
  settings,
  settle,
};
