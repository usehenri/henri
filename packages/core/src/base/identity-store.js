/**
 * The table the identities are written to, and the two backends that reach
 * it.
 *
 * An identity is the binding between a person's account here and their
 * account at somebody else's identity provider: the provider, the subject
 * that provider issues for them, when it was linked and what that binding
 * is allowed to imply. It owns a table of its own, the way the access
 * trail, the versions and the queue own theirs -- raw SQL through the store
 * adapter's `query()`, or a MongoDB collection, never a henri model -- and
 * the reason is sharper here than it is there.
 *
 * **An identity row is a credential.** Whoever can write one can sign in as
 * whoever it points at. A model would put that row behind the conventions
 * an application writes for its own data: `Model.create()` and
 * `Model.update()` with whatever a controller permitted, a scaffold, a
 * `resources` route, `graphql: true`, a policy someone has to remember to
 * write. Every one of those is a way for `provider` and `subject` to become
 * settable from a form, and that is precisely the takeover this feature
 * exists to refuse. The identities are also framework state the way a
 * session is: they have to exist on a store that has no models at all, and
 * no application should have to declare a model to get sign-in with a
 * provider.
 *
 * What an application does need is to *read* them -- which providers is
 * this person signed in with, and when did that happen -- and that is
 * `henri.identities.forUser()` and the privacy export. A read seam is
 * cheap; a writable model is not.
 *
 * Five statements are issued against it: `INSERT` (a link), `SELECT` (a
 * sign-in and the listings), `UPDATE` (`last_used_at`, and nothing else
 * about the binding itself), and `DELETE` (an unlink and an erasure).
 *
 * Moments are BIGINT milliseconds since the epoch, for the reason the queue
 * gives: sqlite has no date type and the other four dialects disagree about
 * the precision and the time zone of a bare `TIMESTAMP`.
 *
 * @module base/identity-store
 */

const debug = require('debug')('henri:identities');

const { fail } = require('./errors');
const { DIALECTS, describe, reasons, toNumber } = require('./trail-store');

/** A table name henri is willing to interpolate into a statement */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The columns of the identity table, in insert order */
const COLUMNS = [
  'id',
  'user_id',
  'provider',
  'subject',
  'email',
  'verified',
  'allows',
  'origin',
  'linked_at',
  'last_used_at',
];

/**
 * How wide the subject column is.
 *
 * A provider's subject is an opaque string it chose. OpenID Connect caps a
 * `sub` at 255 ASCII characters and every provider henri has been pointed
 * at is far under that; anything longer is refused rather than truncated,
 * because a truncated subject is two people holding one credential.
 */
const SUBJECT = 255;

/**
 * The column definitions of the table
 *
 * @param {object} dialect a dialect description from `trail-store.js`
 * @returns {Array<string>} the column definitions
 */
const columnsFor = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'user_id VARCHAR(190) NOT NULL',
  'provider VARCHAR(64) NOT NULL',
  `subject VARCHAR(${SUBJECT}) NOT NULL`,
  'email VARCHAR(320) NULL',
  `verified ${dialect.int} NOT NULL`,
  'allows VARCHAR(16) NOT NULL',
  'origin VARCHAR(16) NOT NULL',
  'linked_at BIGINT NOT NULL',
  'last_used_at BIGINT NULL',
  'PRIMARY KEY (id)',
];

/**
 * The indexes of the identity table, and both of them are unique.
 *
 * `(provider, subject)` is the credential: one account at a provider names
 * one account here, and the database is what says so rather than a check
 * that races. `(user_id, provider)` is the other half: one person holds at
 * most one identity per provider, so `unlink('github')` names one row and
 * an account cannot quietly grow a second way in at the same provider.
 *
 * @param {string} table the table name
 * @returns {Array<object>} `{ name, columns, unique }` entries
 */
const indexesFor = (table) => [
  {
    columns: ['provider', 'subject'],
    name: `${table}_credential`,
    unique: true,
  },
  { columns: ['user_id', 'provider'], name: `${table}_owner`, unique: true },
];

/**
 * Every statement that creates the table and its indexes, in order
 *
 * @param {string} name the dialect (sqlite, postgres, mysql, mssql)
 * @param {string} table the table name
 * @returns {Array<string>} the statements, all of them idempotent
 * @throws HENRI_IDENTITY_UNSUPPORTED_STORE on a dialect henri cannot talk to
 * @throws HENRI_CONFIG_INVALID on a table name that is not an identifier
 */
const install = (name, table) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw fail(
      'HENRI_IDENTITY_UNSUPPORTED_STORE',
      `the identities cannot be kept in a ${name} store`
    );
  }

  if (!SAFE_NAME.test(table)) {
    throw fail(
      'HENRI_CONFIG_INVALID',
      `user.identities.table: invalid table name "${table}": letters, digits and underscores only`
    );
  }

  const quoted = dialect.quote(table);
  const definitions = [...columnsFor(dialect)];
  const indexes = indexesFor(table);
  const statements = [];

  if (dialect.inlineIndexes) {
    for (const index of indexes) {
      definitions.push(
        `${index.unique ? 'UNIQUE KEY' : 'KEY'} ${dialect.quote(index.name)} (${index.columns.join(', ')})`
      );
    }
  }

  const create = [
    'CREATE TABLE',
    dialect.ifNotExists,
    `${quoted} (\n  ${definitions.join(',\n  ')}\n)`,
  ]
    .filter(Boolean)
    .join(' ');

  statements.push(
    dialect.guardTable ? dialect.guardTable(table, create) : create
  );

  if (dialect.inlineIndexes) {
    return statements;
  }

  for (const index of indexes) {
    const statement = [
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX`,
      dialect.guardIndex ? '' : dialect.ifNotExists,
      `${dialect.quote(index.name)} ON ${quoted} (${index.columns.join(', ')})`,
    ]
      .filter(Boolean)
      .join(' ');

    statements.push(
      dialect.guardIndex
        ? dialect.guardIndex(table, index.name, statement)
        : statement
    );
  }

  return statements;
};

/** Errors that mean the object was created by another process first */
const ALREADY_THERE =
  /already exists|duplicate key|duplicate table|there is already an object named/iu;

/** Errors that mean a unique index refused the row */
const DUPLICATE =
  /unique|duplicate|Validation error|SQLITE_CONSTRAINT|ER_DUP_ENTRY|23505|E11000/iu;

/**
 * A row as the rest of henri reads it, whichever backend answered
 *
 * @param {?object} row a database row
 * @returns {?object} the identity, or null
 */
const rowToIdentity = (row) => {
  if (!row) {
    return null;
  }

  return {
    allows: String(row.allows || 'signin'),
    email: row.email === null || row.email === '' ? null : String(row.email),
    id: String(row.id),
    lastUsedAt: toNumber(row.last_used_at),
    linkedAt: toNumber(row.linked_at),
    origin: String(row.origin || 'session'),
    provider: String(row.provider),
    subject: String(row.subject),
    userId: String(row.user_id),
    verified: Number(row.verified) === 1,
  };
};

/**
 * The SQL backend
 *
 * @class SqlIdentities
 */
class SqlIdentities {
  /**
   * Creates an instance of SqlIdentities.
   *
   * @param {object} adapter a henri store adapter with `query()`
   * @param {object} options `dialect`, `dollars`, `table`
   * @memberof SqlIdentities
   */
  constructor(adapter, { dialect, dollars = false, table }) {
    this.adapter = adapter;
    this.dialect = dialect;
    this.dollars = dollars;
    this.table = table;
    this.kind = 'sql';
  }

  /**
   * The statement with the placeholders this driver expects
   *
   * @param {string} sql a statement written with `?`
   * @returns {string} the statement
   * @memberof SqlIdentities
   */
  prepare(sql) {
    if (!this.dollars) {
      return sql;
    }

    let index = 0;

    return sql.replace(/\?/gu, () => {
      index += 1;

      return `$${index}`;
    });
  }

  /**
   * Runs a statement that returns no rows
   *
   * @param {string} sql the statement
   * @param {Array} [params=[]] the parameters
   * @returns {Promise<void>} resolves when done
   * @memberof SqlIdentities
   */
  async run(sql, params = []) {
    debug('run %s', sql);

    await this.adapter.query(this.prepare(sql), params);
  }

  /**
   * Runs a query and answers with its rows
   *
   * @param {string} sql the query
   * @param {Array} [params=[]] the parameters
   * @returns {Promise<Array<object>>} the rows
   * @memberof SqlIdentities
   */
  async select(sql, params = []) {
    const rows = await this.adapter.query(this.prepare(sql), params, {
      type: 'SELECT',
    });

    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Creates the table and its indexes; idempotent
   *
   * @returns {Promise<Array<string>>} the statements that ran
   * @memberof SqlIdentities
   */
  async install() {
    const statements = install(this.dialect, this.table);

    for (const statement of statements) {
      try {
        await this.run(statement);
      } catch (error) {
        if (!ALREADY_THERE.test(reasons(error))) {
          throw error;
        }

        debug('another process created it first: %s', error.message);
      }
    }

    return statements;
  }

  /**
   * The identity a provider's subject names
   *
   * @param {string} provider the provider name
   * @param {string} subject the subject the provider issued
   * @returns {Promise<?object>} the identity, or null
   * @memberof SqlIdentities
   */
  async find(provider, subject) {
    const [row] = await this.select(
      `SELECT * FROM ${this.table} WHERE provider = ? AND subject = ?`,
      [provider, subject]
    );

    return rowToIdentity(row);
  }

  /**
   * Every identity of one person, oldest first
   *
   * @param {string} userId the identifier the identities were written with
   * @returns {Promise<Array<object>>} the identities
   * @memberof SqlIdentities
   */
  async forUser(userId) {
    const rows = await this.select(
      `SELECT * FROM ${this.table} WHERE user_id = ? ORDER BY linked_at ASC`,
      [userId]
    );

    return rows.map(rowToIdentity);
  }

  /**
   * Writes one identity.
   *
   * Answers `null` when a unique index refused it, which is what makes the
   * database rather than a check the thing that decides: two callbacks
   * racing for one subject end with one row and one refusal, never two
   * accounts holding one credential.
   *
   * @param {object} row a row, in database shape
   * @returns {Promise<?object>} the identity, or null when it was refused
   * @memberof SqlIdentities
   */
  async add(row) {
    const values = COLUMNS.map((column) =>
      typeof row[column] === 'undefined' ? null : row[column]
    );

    try {
      await this.run(
        `INSERT INTO ${this.table} (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(
          () => '?'
        ).join(', ')})`,
        values
      );
    } catch (error) {
      if (DUPLICATE.test(reasons(error))) {
        return null;
      }

      throw error;
    }

    return rowToIdentity(row);
  }

  /**
   * Stamps the moment an identity was last signed in with
   *
   * @param {string} id the identity id
   * @param {number} at epoch milliseconds
   * @returns {Promise<boolean>} true
   * @memberof SqlIdentities
   */
  async touch(id, at) {
    await this.run(`UPDATE ${this.table} SET last_used_at = ? WHERE id = ?`, [
      at,
      id,
    ]);

    return true;
  }

  /**
   * Removes one identity of one person
   *
   * @param {string} userId the person
   * @param {string} provider the provider
   * @returns {Promise<boolean>} whether a row went
   * @memberof SqlIdentities
   */
  async remove(userId, provider) {
    const found = await this.select(
      `SELECT id FROM ${this.table} WHERE user_id = ? AND provider = ?`,
      [userId, provider]
    );

    if (found.length === 0) {
      return false;
    }

    await this.run(
      `DELETE FROM ${this.table} WHERE user_id = ? AND provider = ?`,
      [userId, provider]
    );

    return true;
  }

  /**
   * Removes every identity of one person, for an erasure
   *
   * @param {string} userId the person
   * @returns {Promise<number>} how many went
   * @memberof SqlIdentities
   */
  async forget(userId) {
    const rows = await this.select(
      `SELECT id FROM ${this.table} WHERE user_id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return 0;
    }

    await this.run(`DELETE FROM ${this.table} WHERE user_id = ?`, [userId]);

    return rows.length;
  }

  /**
   * How many identities one person holds
   *
   * @param {string} userId the person
   * @returns {Promise<number>} the count
   * @memberof SqlIdentities
   */
  async count(userId) {
    const [row] = await this.select(
      `SELECT COUNT(*) AS total FROM ${this.table} WHERE user_id = ?`,
      [userId]
    );

    return toNumber(row && (row.total ?? row.TOTAL)) || 0;
  }
}

/**
 * The MongoDB backend. The documents carry the SQL column names, so both
 * backends hand the service the same rows.
 *
 * @class MongoIdentities
 */
class MongoIdentities {
  /**
   * Creates an instance of MongoIdentities.
   *
   * @param {object} adapter a henri mongoose (or disk) adapter
   * @param {string} table the collection name
   * @memberof MongoIdentities
   */
  constructor(adapter, table) {
    this.adapter = adapter;
    this.dialect = 'mongodb';
    this.table = table;
    this.kind = 'mongo';
  }

  /**
   * The collection
   *
   * @returns {object} a MongoDB collection
   * @throws HENRI_IDENTITY_UNSUPPORTED_STORE when the store is not connected
   * @memberof MongoIdentities
   */
  collection() {
    const connection =
      this.adapter.mongoose && this.adapter.mongoose.connection;

    if (!connection || connection.readyState !== 1 || !connection.db) {
      throw fail(
        'HENRI_IDENTITY_UNSUPPORTED_STORE',
        `the identities cannot be read: the ${this.adapter.name} store is not connected`
      );
    }

    return connection.db.collection(this.table);
  }

  /**
   * Creates the indexes; idempotent
   *
   * @returns {Promise<Array<string>>} what was created
   * @memberof MongoIdentities
   */
  async install() {
    const collection = this.collection();

    await collection.createIndex({ provider: 1, subject: 1 }, { unique: true });
    await collection.createIndex({ provider: 1, user_id: 1 }, { unique: true });

    return [`${this.table}.credential`, `${this.table}.owner`];
  }

  /**
   * The identity a provider's subject names
   *
   * @param {string} provider the provider name
   * @param {string} subject the subject the provider issued
   * @returns {Promise<?object>} the identity, or null
   * @memberof MongoIdentities
   */
  async find(provider, subject) {
    return rowToIdentity(
      await this.collection().findOne({ provider, subject })
    );
  }

  /**
   * Every identity of one person, oldest first
   *
   * @param {string} userId the identifier the identities were written with
   * @returns {Promise<Array<object>>} the identities
   * @memberof MongoIdentities
   */
  async forUser(userId) {
    const rows = await this.collection()
      .find({ user_id: userId }, { sort: { linked_at: 1 } })
      .toArray();

    return rows.map(rowToIdentity);
  }

  /**
   * Writes one identity
   *
   * @param {object} row a row
   * @returns {Promise<?object>} the identity, or null when it was refused
   * @memberof MongoIdentities
   */
  async add(row) {
    try {
      await this.collection().insertOne({ ...row, _id: row.id });
    } catch (error) {
      if (DUPLICATE.test(reasons(error))) {
        return null;
      }

      throw error;
    }

    return rowToIdentity(row);
  }

  /**
   * Stamps the moment an identity was last signed in with
   *
   * @param {string} id the identity id
   * @param {number} at epoch milliseconds
   * @returns {Promise<boolean>} true
   * @memberof MongoIdentities
   */
  async touch(id, at) {
    await this.collection().updateOne(
      { _id: id },
      { $set: { last_used_at: at } }
    );

    return true;
  }

  /**
   * Removes one identity of one person
   *
   * @param {string} userId the person
   * @param {string} provider the provider
   * @returns {Promise<boolean>} whether a row went
   * @memberof MongoIdentities
   */
  async remove(userId, provider) {
    const result = await this.collection().deleteOne({
      provider,
      user_id: userId,
    });

    return ((result && result.deletedCount) || 0) > 0;
  }

  /**
   * Removes every identity of one person, for an erasure
   *
   * @param {string} userId the person
   * @returns {Promise<number>} how many went
   * @memberof MongoIdentities
   */
  async forget(userId) {
    const result = await this.collection().deleteMany({ user_id: userId });

    return (result && result.deletedCount) || 0;
  }

  /**
   * How many identities one person holds
   *
   * @param {string} userId the person
   * @returns {Promise<number>} the count
   * @memberof MongoIdentities
   */
  count(userId) {
    return this.collection().countDocuments({ user_id: userId });
  }
}

/**
 * The backend of a store adapter
 *
 * @param {object} adapter a henri store adapter
 * @param {string} table the table (or collection) name
 * @returns {object} the backend
 * @throws HENRI_IDENTITY_UNSUPPORTED_STORE when the adapter cannot hold one
 */
const storeFor = (adapter, table) => {
  if (!adapter) {
    throw fail(
      'HENRI_IDENTITY_UNSUPPORTED_STORE',
      'the identities have no store to be written to'
    );
  }

  if (adapter.mongoose) {
    return new MongoIdentities(adapter, table);
  }

  const described = typeof adapter.query === 'function' && describe(adapter);

  if (!described || !DIALECTS[described.dialect]) {
    throw fail(
      'HENRI_IDENTITY_UNSUPPORTED_STORE',
      `the identities cannot be kept in the ${adapter.adapterName || 'unknown'} store: it has neither query() nor a MongoDB connection henri can use`
    );
  }

  return new SqlIdentities(adapter, { ...described, table });
};

module.exports = {
  COLUMNS,
  MongoIdentities,
  SUBJECT,
  SqlIdentities,
  install,
  rowToIdentity,
  storeFor,
};
