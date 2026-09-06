/**
 * The rotation: reading every encrypted column as the database holds it,
 * and writing it back under the key that writes today.
 *
 * A key you cannot rotate is a key you cannot lose, so this ships with the
 * feature rather than after it. It is two operations, and
 * `henri encryption:status` and `henri encryption:rotate` are the two
 * commands over them.
 *
 * ## What a rotation is, from the outside
 *
 * 1. Generate a key and put it **in front** of the old one:
 *    `{ "encryption": { "keys": ["<new>", "<old>"] } }`. Every key
 *    decrypts, the first one encrypts, so a deploy is all it takes for new
 *    writes to land under the new key and old rows to keep opening.
 * 2. `henri encryption:rotate`. It walks every row of every encrypted
 *    column, soft-deleted rows included, and rewrites whatever is not
 *    already under the primary key.
 * 3. `henri encryption:status` until nothing is left under the old id.
 * 4. Only then, drop the old key.
 *
 * Step 3 is not a formality. **A record nobody ever touches again is
 * exactly the record a rotation is about**: it will never be rewritten by
 * the application, so the only thing that moves it is this walk, and the
 * only thing that says it has moved is that count. Dropping a key while
 * rows still name it is what turns a rotation into a data loss, and it is
 * why the status counts by key id rather than answering "done".
 *
 * A backfill is the same walk: a column that held plaintext before the
 * field was marked `encrypted` is "not under the primary key" too, so
 * `henri encryption:rotate` encrypts it. With
 * `config.encryption.readPlaintext` on, that is the whole migration of an
 * existing table.
 *
 * ## Why it reads and writes underneath the model
 *
 * The walk reads the column the way the database holds it -- `raw: true`
 * on Sequelize, the driver collection on Mongoose, a plain select on
 * Drizzle -- because it has to see the envelope in order to read the key
 * id off it, and because a model read would decrypt a row whose key is
 * gone and fail on the rows this is trying to diagnose.
 *
 * It writes the same way, one column of one row at a time, so that
 * `updatedAt` does not move. A rotation is not a change to the record: a
 * table full of rows all updated at 3am because the key changed is a lie
 * told to every "recently modified" list in the application.
 *
 * ## What it never does
 *
 * It does not delete, it does not reorder, and it never writes a value it
 * did not first read back successfully: each row is decrypted, re-encrypted
 * and **verified by decrypting the new envelope** before the update runs.
 * A row it cannot read is counted and skipped, never overwritten -- the
 * one operation that could turn a missing key into a destroyed value.
 *
 * @module base/rewrap
 */

const { fail } = require('./errors');
const { kindOf, primaryOf } = require('./erasure');

/** How many rows are read at a time */
const BATCH = 500;

/**
 * The failure raised for an adapter henri cannot drive
 *
 * @param {string} model the model name
 * @returns {Error} the error
 */
function unknownAdapter(model) {
  const error = fail(
    'HENRI_PRIVACY_ADAPTER_UNSUPPORTED',
    `unable to rotate ${model}: its adapter is not one henri knows how to drive`
  );

  error.hint =
    'The rotation reads and writes underneath the model API of the three adapters henri ships: mongoose, sequelize and drizzle';

  return error;
}

/**
 * The column one field is stored in, which is only ever different from
 * the field name on the SQL adapters
 *
 * @param {*} Model an ORM model
 * @param {string} field the field name
 * @returns {string} the column
 */
function columnOf(Model, field) {
  const kind = kindOf(Model);

  if (kind === 'sequelize') {
    const attribute = Model.rawAttributes[field] || {};

    return attribute.field || field;
  }

  if (kind === 'drizzle') {
    const columns = (Model.adapter.tables[Model.key] || {}).columns || {};

    return columns[field] || field;
  }

  return field;
}

/**
 * A page of rows, as the database holds them: the primary key and one
 * column, soft-deleted rows included, no getter and no hook in the way
 *
 * @param {*} Model an ORM model
 * @param {string} field the field name
 * @param {object} page `{ limit, offset }`
 * @returns {Promise<Array<object>>} `{ key, value }` per row
 * @throws when the adapter is one henri does not know
 */
async function readPage(Model, field, { limit, offset }) {
  const kind = kindOf(Model);
  const primary = primaryOf(Model);

  if (kind === 'sequelize') {
    const rows = await Model.unscoped().findAll({
      attributes: [primary, field],
      limit,
      offset,
      order: [[primary, 'ASC']],
      paranoid: false,
      // Bypasses the attribute getters: what is wanted here is the
      // envelope, not what it decrypts to
      raw: true,
    });

    return rows.map((row) => ({ key: row[primary], value: row[field] }));
  }

  if (kind === 'mongoose') {
    // The driver collection, so no middleware of this adapter's runs:
    // neither the soft delete filter nor the decryption
    const rows = await Model.collection
      .find({}, { projection: { [field]: 1 } })
      .sort({ _id: 1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return rows.map((row) => ({ key: row._id, value: row[field] }));
  }

  if (kind === 'drizzle') {
    const { table } = Model;
    const rows = await Model.db()
      .select({ key: table[primary], value: table[field] })
      .from(table)
      .orderBy(table[primary])
      .limit(limit)
      .offset(offset);

    return rows.map((row) => ({ key: row.key, value: row.value }));
  }

  throw unknownAdapter(Model.name || Model.modelName || 'a model');
}

/**
 * Writes one column of one row, without touching anything else
 *
 * @param {*} Model an ORM model
 * @param {string} field the field name
 * @param {*} key the primary key of the row
 * @param {string} value the envelope to write
 * @returns {Promise<void>} resolves when written
 * @throws when the adapter is one henri does not know
 */
async function writeValue(Model, field, key, value) {
  const kind = kindOf(Model);
  const primary = primaryOf(Model);

  if (kind === 'sequelize') {
    // The query interface rather than Model.update(): no hook, no
    // validation, no `updatedAt`
    await Model.sequelize
      .getQueryInterface()
      .bulkUpdate(
        Model.getTableName(),
        { [columnOf(Model, field)]: value },
        { [columnOf(Model, primary)]: key }
      );

    return;
  }

  if (kind === 'mongoose') {
    await Model.collection.updateOne(
      { [primary]: key },
      { $set: { [field]: value } }
    );

    return;
  }

  if (kind === 'drizzle') {
    // `setWhere()` writes without a hook, a validation or a timestamp,
    // and the condition is built through the model so that core needs no
    // dependency on drizzle-orm of its own. `withDeleted()` because a
    // soft-deleted row holds the same ciphertext as a live one
    await Model.setWhere(
      Model.withDeleted()
        .where({ [primary]: key })
        .whereSQL(),
      { [field]: value }
    );

    return;
  }

  throw unknownAdapter(Model.name || Model.modelName || 'a model');
}

/**
 * Every row of one column, a page at a time, ordered by primary key.
 *
 * The paging is by offset over a stable order, and the walk stops on the
 * first short page rather than on a count taken before it started: a row
 * inserted while it runs is written by the application under the primary
 * key anyway, so missing it changes nothing.
 *
 * @async
 * @generator
 * @param {*} Model an ORM model
 * @param {string} field the field name
 * @yields {Array<object>} one page of `{ key, value }`
 */
async function* pages(Model, field) {
  let offset = 0;

  for (;;) {
    const page = await readPage(Model, field, { limit: BATCH, offset });

    if (page.length === 0) {
      return;
    }

    yield page;

    offset += page.length;

    if (page.length < BATCH) {
      return;
    }
  }
}

/**
 * What one stored value is, without opening it
 *
 * @param {object} encryption `henri.encryption`
 * @param {*} value the stored value
 * @returns {string} a key id, `null` (nothing stored), `plaintext` or
 *   `malformed`
 */
function stateOf(encryption, value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return 'null';
  }

  if (!encryption.isEnvelope(value)) {
    return 'plaintext';
  }

  return encryption.keyIdIn(value) || 'malformed';
}

/**
 * What the encrypted columns of an application hold, counted by key id.
 *
 * The question it answers is "may I drop the old key yet", and it answers
 * it without opening a single value: the key id is in the clear in every
 * envelope, so this needs no key at all and says nothing about the
 * contents.
 *
 * @async
 * @param {object} context `{ encryption, fields, modelOf }`
 * @returns {Promise<object>} `{ fields, keys, ok, plaintext, primary, total }`
 */
async function statusOf({ encryption, fields, modelOf }) {
  const primary = encryption.primary;
  const report = {
    fields: [],
    keys: encryption.keys,
    ok: true,
    plaintext: 0,
    primary,
    stale: 0,
    total: 0,
  };

  for (const mark of fields) {
    const Model = modelOf(mark.model);
    const counts = {};
    let seen = 0;

    for await (const page of pages(Model, mark.field)) {
      for (const row of page) {
        const state = stateOf(encryption, row.value);

        counts[state] = (counts[state] || 0) + 1;
        seen += 1;
      }
    }

    const plaintext = counts.plaintext || 0;
    const current = counts[primary] || 0;
    const stale = seen - current - plaintext - (counts.null || 0);

    report.fields.push({
      counts,
      current,
      deterministic: mark.deterministic,
      field: mark.field,
      model: mark.model,
      plaintext,
      rows: seen,
      stale,
    });

    report.plaintext += plaintext;
    report.stale += stale;
    report.total += seen;
  }

  report.ok = report.plaintext === 0 && report.stale === 0;

  return report;
}

/**
 * Rewrites every value that is not already under the primary key.
 *
 * Each row is read as stored, decrypted (or taken as plaintext, during a
 * backfill), encrypted under the primary key and read back before the
 * write. A row that will not open is counted and left exactly as it is:
 * the one thing this must never do is turn a key that is missing into a
 * value that is gone.
 *
 * @async
 * @param {object} context `{ encryption, fields, modelOf }`
 * @param {object} [options={}] `dryRun`, `model`, `field`
 * @returns {Promise<object>} `{ fields, failures, rotated, scanned }`
 */
async function rotateOf({ encryption, fields, modelOf }, options = {}) {
  const primary = encryption.primary;

  if (!primary) {
    const error = fail(
      'HENRI_ENCRYPTION_NO_KEY',
      'there is no encryption key to rotate to'
    );

    error.hint =
      'Put the key in the credentials of this environment: `henri credentials:edit`, then { "encryption": { "keys": ["..."] } }';

    throw error;
  }

  const report = {
    dryRun: options.dryRun === true,
    failures: [],
    fields: [],
    rotated: 0,
    scanned: 0,
  };
  const wanted = fields.filter(
    (mark) =>
      (!options.model || mark.model === options.model) &&
      (!options.field || mark.field === options.field)
  );

  for (const mark of wanted) {
    const Model = modelOf(mark.model);
    const context = {
      context: `${mark.model}.${mark.field}`,
      deterministic: mark.deterministic,
    };
    const entry = {
      field: mark.field,
      model: mark.model,
      rotated: 0,
      scanned: 0,
      skipped: 0,
    };

    for await (const page of pages(Model, mark.field)) {
      for (const row of page) {
        const state = stateOf(encryption, row.value);

        entry.scanned += 1;

        if (state === 'null' || state === primary) {
          continue;
        }

        try {
          const plain = encryption.decrypt(row.value, context);
          const envelope = encryption.encrypt(plain, context);

          // Never write something that does not read back: a rotation
          // that corrupts a column is worse than one that did not run
          if (encryption.decrypt(envelope, context) !== plain) {
            throw fail(
              'HENRI_ENCRYPTION_UNREADABLE',
              `${context.context} did not read back after being re-encrypted`
            );
          }

          if (!report.dryRun) {
            await writeValue(Model, mark.field, row.key, envelope);
          }

          entry.rotated += 1;
        } catch (error) {
          entry.skipped += 1;
          report.failures.push({
            code: error.code || error.henriCode || null,
            field: mark.field,
            keyId: encryption.keyIdIn(row.value),
            model: mark.model,
            reason: error.message,
            record: String(row.key),
          });
        }
      }
    }

    report.fields.push(entry);
    report.rotated += entry.rotated;
    report.scanned += entry.scanned;
  }

  return report;
}

module.exports = {
  BATCH,
  columnOf,
  pages,
  readPage,
  rotateOf,
  stateOf,
  statusOf,
  writeValue,
};
