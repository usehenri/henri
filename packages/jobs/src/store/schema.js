/**
 * The tables `@usehenri/jobs` owns, and the DDL of every SQL dialect henri
 * can talk to.
 *
 * The queue never goes through a henri model: it owns two tables of its own
 * so it cannot collide with the application's schema, and so a store that
 * has no models at all (a fresh application) still has a queue.
 *
 * Every moment is stored as a BIGINT of milliseconds since the epoch rather
 * than a timestamp column: sqlite has no date type, MySQL, PostgreSQL and
 * MSSQL disagree on the precision and on the time zone of a bare
 * `TIMESTAMP`, and the claim compares `run_at` to the runner's clock -- a
 * comparison that has to mean the same thing on every dialect. Numbers read
 * back as strings on some drivers (BIGINT over the pg protocol), so every
 * read coerces.
 */

/** Names an application may give the tables */
const { coded } = require('../errors');

const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
    int: 'INT',
    // MSSQL is the one dialect that treats NULLs as equal in a unique index
    partialUnique: true,
    quote: (identifier) => `[${identifier}]`,
    text: 'NVARCHAR(MAX)',
  },
  mysql: {
    ifNotExists: 'IF NOT EXISTS',
    // MySQL has no CREATE INDEX IF NOT EXISTS: the indexes are declared in
    // the CREATE TABLE, which is guarded
    inlineIndexes: true,
    int: 'INT',
    partialUnique: false,
    quote: (identifier) => `\`${identifier}\``,
    // TEXT stops at 65535 bytes and the arguments alone may reach 65536
    text: 'MEDIUMTEXT',
  },
  postgres: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    int: 'INTEGER',
    partialUnique: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
  sqlite: {
    ifNotExists: 'IF NOT EXISTS',
    inlineIndexes: false,
    int: 'INTEGER',
    partialUnique: false,
    quote: (identifier) => `"${identifier}"`,
    text: 'TEXT',
  },
};

/**
 * The columns of the jobs table, in order
 *
 * @param {object} dialect A dialect description
 * @returns {Array<string>} The column definitions
 */
const jobColumns = (dialect) => [
  'id VARCHAR(36) NOT NULL',
  'queue VARCHAR(120) NOT NULL',
  'name VARCHAR(120) NOT NULL',
  `args ${dialect.text} NOT NULL`,
  'state VARCHAR(16) NOT NULL',
  `priority ${dialect.int} NOT NULL`,
  `attempts ${dialect.int} NOT NULL`,
  `max_attempts ${dialect.int} NOT NULL`,
  `timeout_ms ${dialect.int} NULL`,
  'run_at BIGINT NOT NULL',
  'created_at BIGINT NOT NULL',
  'updated_at BIGINT NOT NULL',
  'started_at BIGINT NULL',
  'finished_at BIGINT NULL',
  `duration_ms ${dialect.int} NULL`,
  'claimed_by VARCHAR(120) NULL',
  'claimed_at BIGINT NULL',
  'heartbeat_at BIGINT NULL',
  'claim_token VARCHAR(36) NULL',
  `error_message ${dialect.text} NULL`,
  `error_stack ${dialect.text} NULL`,
  `history ${dialect.text} NULL`,
  'unique_key VARCHAR(190) NULL',
  'PRIMARY KEY (id)',
];

/**
 * The columns of the schedules table, in order
 *
 * @param {object} dialect A dialect description
 * @returns {Array<string>} The column definitions
 */
const scheduleColumns = (dialect) => [
  'name VARCHAR(190) NOT NULL',
  'job VARCHAR(120) NOT NULL',
  'spec VARCHAR(190) NOT NULL',
  'next_run_at BIGINT NOT NULL',
  'last_run_at BIGINT NULL',
  'token VARCHAR(36) NULL',
  'created_at BIGINT NOT NULL',
  'updated_at BIGINT NOT NULL',
  'PRIMARY KEY (name)',
];

/**
 * The indexes of the jobs table
 *
 * @param {string} table The table name
 * @returns {Array<object>} `{ name, columns, unique }` entries
 */
const jobIndexes = (table) => [
  {
    columns: ['state', 'queue', 'priority', 'run_at'],
    name: `${table}_claim`,
    unique: false,
  },
  { columns: ['claim_token'], name: `${table}_token`, unique: false },
  {
    columns: ['state', 'finished_at'],
    name: `${table}_finished`,
    unique: false,
  },
  { columns: ['unique_key'], name: `${table}_unique`, unique: true },
];

/**
 * The statements that create a table and its indexes, in order
 *
 * @param {object} dialect A dialect description
 * @param {string} table The table name
 * @param {Array<string>} columns The column definitions
 * @param {Array<object>} indexes The indexes
 * @returns {Array<string>} The statements to run, in order
 */
const statementsFor = (dialect, table, columns, indexes) => {
  const quoted = dialect.quote(table);
  const definitions = [...columns];
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
    const filter =
      index.unique && dialect.partialUnique
        ? ` WHERE ${index.columns[0]} IS NOT NULL`
        : '';
    const statement = [
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX`,
      dialect.guardIndex ? '' : dialect.ifNotExists,
      `${dialect.quote(index.name)} ON ${quoted} (${index.columns.join(', ')})${filter}`,
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
 * Every statement `henri jobs:install` runs, in order
 *
 * All of them are idempotent: running the install twice, or against a
 * database another runner already prepared, changes nothing.
 *
 * @param {string} name The dialect (sqlite, postgres, mysql, mssql)
 * @param {object} tables `{ jobs, schedules }` table names
 * @returns {Array<string>} The statements
 * @throws {Error} When the dialect or a table name is unknown
 */
const install = (name, tables) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw coded(
      'HENRI_JOB_UNSUPPORTED_STORE',
      `@usehenri/jobs: unsupported SQL dialect "${name}"`
    );
  }

  for (const table of Object.values(tables)) {
    if (!SAFE_NAME.test(table)) {
      throw coded(
        'HENRI_CONFIG_INVALID',
        `@usehenri/jobs: invalid table name "${table}": letters, digits and underscores only`
      );
    }
  }

  return [
    ...statementsFor(
      dialect,
      tables.jobs,
      jobColumns(dialect),
      jobIndexes(tables.jobs)
    ),
    ...statementsFor(dialect, tables.schedules, scheduleColumns(dialect), []),
  ];
};

/**
 * The statements that drop the tables, newest first
 *
 * @param {string} name The dialect
 * @param {object} tables `{ jobs, schedules }` table names
 * @returns {Array<string>} The statements
 * @throws {Error} When the dialect is unknown
 */
const uninstall = (name, tables) => {
  const dialect = DIALECTS[name];

  if (!dialect) {
    throw coded(
      'HENRI_JOB_UNSUPPORTED_STORE',
      `@usehenri/jobs: unsupported SQL dialect "${name}"`
    );
  }

  return [tables.schedules, tables.jobs].map(
    (table) => `DROP TABLE IF EXISTS ${dialect.quote(table)}`
  );
};

module.exports = { DIALECTS, install, uninstall };
