const { coded } = require('../errors');

/**
 * The table `@usehenri/webhooks` owns, and the DDL of every SQL dialect
 * henri can talk to.
 *
 * Endpoints are henri's data, not the application's: a url, a set of
 * events, signing secrets and whether the thing is still enabled. They are
 * never a henri model, for the reason the queue is not one either -- an
 * application would then have to carry a migration for a table it does not
 * own, and a store with no models at all would have no endpoints. So this
 * is one table reached through the adapter's `query()`, or one MongoDB
 * collection, exactly like `henri_jobs`.
 *
 * There is no deliveries table, and that is deliberate: a delivery is a job
 * in `henri_jobs`, so what succeeded, what is waiting, what is dead and why
 * is already answered by `henri jobs:list`, `henri jobs:dead` and
 * `henri jobs:show`. A second table would be a second, worse copy of it.
 *
 * Every moment is a BIGINT of milliseconds since the epoch, as in the
 * queue: sqlite has no date type and the other three disagree on the
 * precision and the time zone of a bare `TIMESTAMP`.
 */

/** Table names an application may give */
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const DIALECTS = {
  mssql: {
    /**
     * Wraps a statement so it only runs when the index is missing
     *
     * @param {string} table The table name
     * @param {string} index The index name
     * @param {string} statement The CREATE INDEX statement
     * @returns {string} The guarded statement
     */
    guardIndex: (table, index, statement) =>
      `IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = '${index}' AND object_id = OBJECT_ID('${table}')) ${statement}`,

    /**
     * Wraps a CREATE TABLE so it only runs when the table is missing
     *
     * @param {string} table The table name
     * @param {string} statement The CREATE TABLE statement
     * @returns {string} The guarded statement
     */
    guardTable: (table, statement) =>
      `IF OBJECT_ID('${table}', 'U') IS NULL ${statement}`,

    ifNotExists: '',
    inlineIndexes: false,
    quote: (identifier) => `[${identifier}]`,
    text: 'NVARCHAR(MAX)',
    url: 'NVARCHAR(2048)',
  },
  mysql: {
    ifNotExists: 'IF NOT EXISTS',
    // MySQL has no CREATE INDEX IF NOT EXISTS: the indexes are declared in
    // the CREATE TABLE, which is guarded
    inlineIndexes: true,
    quote: (identifier) => `\`${identifier}\``,
    text: 'MEDIUMTEXT',
    url: 'VARCHAR(2048)',
  },
  postgres: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
    url: 'VARCHAR(2048)',
  },
  sqlite: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
    url: 'VARCHAR(2048)',
  },
};

/** The columns of the endpoints table, in order */
const COLUMNS = [
  'id',
  'owner',
  'url',
  'events',
  'secrets',
  'headers',
  'description',
  'disabled_at',
  'disabled_reason',
  'created_at',
  'updated_at',
];

/**
 * The column definitions of the endpoints table
 *
 * @param {object} dialect A dialect description
 * @returns {Array<string>} The definitions
 */
const columns = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'owner VARCHAR(190) NULL',
  `url ${dialect.url} NOT NULL`,
  `events ${dialect.text} NOT NULL`,
  `secrets ${dialect.text} NOT NULL`,
  `headers ${dialect.text} NULL`,
  'description VARCHAR(190) NULL',
  'disabled_at BIGINT NULL',
  'disabled_reason VARCHAR(190) NULL',
  'created_at BIGINT NOT NULL',
  'updated_at BIGINT NOT NULL',
  'PRIMARY KEY (id)',
];

/**
 * The indexes of the endpoints table
 *
 * One index, on what a lookup filters by: the tenant an event belongs to
 * and whether the endpoint still takes deliveries. Which events an endpoint
 * subscribes to is a JSON list, matched in this process, because no two of
 * these four dialects agree on how to ask that question.
 *
 * @param {string} table The table name
 * @returns {Array<object>} `{ name, columns }` entries
 */
const indexes = (table) => [
  { columns: ['owner', 'disabled_at'], name: `${table}_owner` },
];

/**
 * Every statement `henri webhooks:install` runs, in order
 *
 * All of them are idempotent: running the install twice, or against a
 * database another process already prepared, changes nothing.
 *
 * @param {string} name The dialect (sqlite, postgres, mysql, mssql)
 * @param {object} tables `{ endpoints }` table names
 * @returns {Array<string>} The statements
 * @throws {Error} When the dialect or the table name is unknown
 */
const install = (name, tables) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw coded(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      `@usehenri/webhooks: unsupported SQL dialect "${name}"`
    );
  }

  if (!SAFE_NAME.test(tables.endpoints)) {
    throw coded(
      'HENRI_CONFIG_INVALID',
      `@usehenri/webhooks: invalid table name "${tables.endpoints}": letters, digits and underscores only`
    );
  }

  const table = tables.endpoints;
  const quoted = dialect.quote(table);
  const definitions = [...columns(dialect)];
  const statements = [];

  if (dialect.inlineIndexes) {
    for (const index of indexes(table)) {
      definitions.push(
        `KEY ${dialect.quote(index.name)} (${index.columns.join(', ')})`
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

  for (const index of indexes(table)) {
    const statement = [
      'CREATE INDEX',
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

/**
 * The statement that drops the table
 *
 * @param {string} name The dialect
 * @param {object} tables `{ endpoints }` table names
 * @returns {Array<string>} The statements
 * @throws {Error} When the dialect is unknown
 */
const uninstall = (name, tables) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw coded(
      'HENRI_WEBHOOK_UNSUPPORTED_STORE',
      `@usehenri/webhooks: unsupported SQL dialect "${name}"`
    );
  }

  return [`DROP TABLE IF EXISTS ${dialect.quote(tables.endpoints)}`];
};

module.exports = { COLUMNS, DIALECTS, columns, indexes, install, uninstall };
