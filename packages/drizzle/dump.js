const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:drizzle:dump');
const { BREAKPOINT } = require('./migrations');
const { backtick, quoted } = require('./dialects');
const { coded } = require('./utils');

/**
 * `db/schema.sql`: the shape of the database as one file, the way Rails'
 * `db/schema.rb` is. What a new developer loads instead of replaying every
 * migration, and what a reviewer reads to see what the database actually
 * looks like.
 *
 * ## It is read from the database
 *
 * The other candidate was the migration chain: the last
 * `meta/NNNN_snapshot.json` describes the same schema, drizzle-kit turns it
 * into DDL for free, and it needs no server. It was rejected because a dump
 * built that way agrees with the chain by construction. It is a second copy
 * of files already in the repository, it can never be the thing that catches
 * an `ALTER` somebody ran by hand or a `henri db:push` that was never turned
 * into a migration, and those are the two reasons to read a dump at all.
 * What makes `db/schema.sql` worth reviewing is that it says what the
 * database is, not what the folder says it should be.
 *
 * The cost is real and is not hidden: `henri db:schema:dump` needs a
 * database it can reach, so it runs where one is -- a developer's machine, a
 * CI job with a service container -- and never from a checkout alone.
 *
 * ## It is stable
 *
 * Two runs against the same schema produce the same bytes, or the file is
 * useless in a diff. Tables are ordered by name, types, indexes and foreign
 * keys by the statements themselves, and columns by the position the
 * database keeps them in -- which is the order a `SELECT *` answers in, and
 * the one thing here that alphabetical order would misreport. Nothing
 * carries a timestamp, a row count or a sequence value, which is why MySQL
 * is read through information_schema and not through `SHOW CREATE TABLE`:
 * that one prints the table's `AUTO_INCREMENT` counter, and a dump that
 * moved every time a row was inserted would be worthless.
 *
 * ## It says where it is
 *
 * The header names the migration the database was at, so the dump and
 * `henri db:status` cannot disagree, and `henri db:schema:load` records
 * exactly the migrations up to that one as applied -- leaving anything newer
 * pending, for `henri db:migrate`.
 *
 * ## What it describes
 *
 * Tables, columns with their types, defaults and nullability, primary keys,
 * unique and check constraints, indexes, foreign keys, and the enum types
 * and plain sequences of PostgreSQL. Not: views, triggers, stored routines,
 * grants, partitions, extensions, or the data. A database using more than
 * the first list is not fully described by its dump, and the guide says so.
 * The tables henri owns without a model (`henri_jobs`, `henri_trail`, the
 * migrations table) are left out too: they are not the application's schema,
 * and the code that owns them creates them.
 *
 * @class Dump
 */

/** The first line of every dump */
const HEADER = '-- henri schema dump';

/**
 * Quotes a string as a SQL literal
 *
 * @param {*} value The value
 * @returns {string} The literal
 */
const literal = (value) => `'${String(value).replace(/'/gu, "''")}'`;

/** Column types whose MySQL default is written as it comes back */
const NUMERIC =
  /^(?:tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|year)\b/iu;

/**
 * Groups rows by one of their columns, keeping the order they arrived in
 *
 * @param {Array<object>} rows The rows
 * @param {string} key The column to group on
 * @returns {Map<*, Array<object>>} The groups
 */
const groupBy = (rows, key) => {
  const groups = new Map();

  for (const row of rows) {
    if (!groups.has(row[key])) {
      groups.set(row[key], []);
    }

    groups.get(row[key]).push(row);
  }

  return groups;
};

/**
 * Reads a PostgreSQL schema back
 *
 * The catalogue answers most of this itself: `format_type` writes a column
 * type the way a `CREATE TABLE` takes it, `pg_get_constraintdef` and
 * `pg_get_indexdef` write whole definitions. What is left is putting them in
 * an order that never changes.
 *
 * @param {Function} query Runs a statement and answers its rows
 * @returns {Promise<object>} The description
 */
const postgres = async (query) => {
  const columns = await query(
    `SELECT c.relname AS table_name, a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attnotnull AS not_null, a.attidentity AS identity,
            pg_get_expr(d.adbin, d.adrelid) AS column_default
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY c.relname, a.attnum`
  );
  const constraints = await query(
    `SELECT c.relname AS table_name, con.conname AS name, con.contype AS kind,
            pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND con.contype IN ('p', 'u', 'f', 'c')
     ORDER BY c.relname, con.conname`
  );
  const indexes = await query(
    `SELECT c.relname AS table_name, pg_get_indexdef(x.indexrelid) AS definition
     FROM pg_index x
     JOIN pg_class c ON c.oid = x.indrelid
     JOIN pg_class i ON i.oid = x.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid
       )
     ORDER BY c.relname, i.relname`
  );
  const labels = await query(
    `SELECT t.typname AS name, e.enumlabel AS value
     FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
     ORDER BY t.typname, e.enumsortorder`
  );
  // An identity column brings its own sequence; a `serial` one refers to a
  // sequence of its own, which the dump has to create first
  const sequences = await query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'S'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'i'
       )
     ORDER BY c.relname`
  );
  const generated = {
    a: ' GENERATED ALWAYS AS IDENTITY',
    d: ' GENERATED BY DEFAULT AS IDENTITY',
  };
  const inline = new Set(['c', 'p', 'u']);
  const tables = [];

  for (const [name, rows] of groupBy(columns, 'table_name')) {
    const body = rows.map((row) => {
      const identity = generated[row.identity] || '';
      const value =
        !identity && row.column_default !== null
          ? ` DEFAULT ${row.column_default}`
          : '';

      return `${quoted(row.column_name)} ${row.data_type}${identity}${value}${
        row.not_null ? ' NOT NULL' : ''
      }`;
    });

    for (const row of constraints) {
      if (row.table_name === name && inline.has(row.kind)) {
        body.push(`CONSTRAINT ${quoted(row.name)} ${row.definition}`);
      }
    }

    tables.push({ body, name });
  }

  return {
    foreignKeys: constraints
      .filter((row) => row.kind === 'f')
      .map((row) => ({
        statement: `ALTER TABLE ${quoted(row.table_name)} ADD CONSTRAINT ${quoted(
          row.name
        )} ${row.definition};`,
        table: row.table_name,
      })),
    indexes: indexes.map((row) => ({
      statement: `${row.definition};`,
      table: row.table_name,
    })),
    tables,
    types: [
      ...sequences.map((row) => `CREATE SEQUENCE ${quoted(row.name)};`),
      ...[...groupBy(labels, 'name')].map(
        ([name, rows]) =>
          `CREATE TYPE ${quoted(name)} AS ENUM (${rows
            .map((row) => literal(row.value))
            .join(', ')});`
      ),
    ],
  };
};

/**
 * Reads a MySQL schema back
 *
 * @param {Function} query Runs a statement and answers its rows
 * @returns {Promise<object>} The description
 */
const mysql = async (query) => {
  const columns = await query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS data_type, IS_NULLABLE AS nullable,
            COLUMN_DEFAULT AS column_default, EXTRA AS extra
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );
  const keys = await query(
    `SELECT t.TABLE_NAME AS table_name, t.CONSTRAINT_NAME AS name,
            t.CONSTRAINT_TYPE AS kind, k.COLUMN_NAME AS column_name,
            k.REFERENCED_TABLE_NAME AS ref_table,
            k.REFERENCED_COLUMN_NAME AS ref_column,
            r.DELETE_RULE AS on_delete, r.UPDATE_RULE AS on_update
     FROM information_schema.TABLE_CONSTRAINTS t
     JOIN information_schema.KEY_COLUMN_USAGE k
       ON k.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA
      AND k.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      AND k.TABLE_NAME = t.TABLE_NAME
     LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = t.CONSTRAINT_SCHEMA
      AND r.CONSTRAINT_NAME = t.CONSTRAINT_NAME
      AND r.TABLE_NAME = t.TABLE_NAME
     WHERE t.TABLE_SCHEMA = DATABASE()
       AND t.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE', 'FOREIGN KEY')
     ORDER BY t.TABLE_NAME, t.CONSTRAINT_NAME, k.ORDINAL_POSITION`
  );
  const stats = await query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS name,
            NON_UNIQUE AS non_unique, COLUMN_NAME AS column_name
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
  );
  // Every key is backed by an index of the same name, and MySQL makes one
  // for a foreign key on its own: dumping those would write them twice
  const named = new Set(keys.map((row) => `${row.table_name}.${row.name}`));
  const foreignKeys = [];
  const tables = [];

  for (const [name, rows] of groupBy(columns, 'table_name')) {
    const body = rows.map((row) => {
      const extra = String(row.extra || '');
      const auto = extra.includes('auto_increment');
      const raw =
        extra.includes('DEFAULT_GENERATED') || NUMERIC.test(row.data_type);
      const value =
        row.column_default === null
          ? ''
          : ` DEFAULT ${raw ? row.column_default : literal(row.column_default)}`;

      return `${backtick(row.column_name)} ${row.data_type}${
        row.nullable === 'NO' ? ' NOT NULL' : ''
      }${value}${auto ? ' AUTO_INCREMENT' : ''}`;
    });

    for (const [key, group] of groupBy(
      keys.filter((row) => row.table_name === name),
      'name'
    )) {
      const on = group.map((row) => backtick(row.column_name)).join(', ');
      const [first] = group;

      if (first.kind === 'PRIMARY KEY') {
        body.push(`PRIMARY KEY (${on})`);
      } else if (first.kind === 'UNIQUE') {
        body.push(`CONSTRAINT ${backtick(key)} UNIQUE (${on})`);
      } else {
        foreignKeys.push({
          statement: `ALTER TABLE ${backtick(name)} ADD CONSTRAINT ${backtick(
            key
          )} FOREIGN KEY (${on}) REFERENCES ${backtick(
            first.ref_table
          )} (${group
            .map((row) => backtick(row.ref_column))
            .join(', ')}) ON DELETE ${first.on_delete} ON UPDATE ${
            first.on_update
          };`,
          table: name,
        });
      }
    }

    tables.push({ body, name });
  }

  return {
    foreignKeys,
    indexes: [...groupBy(stats, 'table_name')].flatMap(([table, rows]) =>
      [...groupBy(rows, 'name')]
        .filter(([name]) => !named.has(`${table}.${name}`))
        .map(([name, group]) => ({
          statement: `CREATE ${
            Number(group[0].non_unique) === 0 ? 'UNIQUE ' : ''
          }INDEX ${backtick(name)} ON ${backtick(table)} (${group
            .map((row) => backtick(row.column_name))
            .join(', ')});`,
          table,
        }))
    ),
    tables,
    types: [],
  };
};

/**
 * Reads a SQLite schema back
 *
 * `sqlite_master` keeps the text of the `CREATE INDEX` that made each index,
 * which is exact. The tables are rebuilt from the pragmas instead, because
 * their stored text is whatever wrote them, and two databases with the same
 * schema would not have the same one. SQLite adds a foreign key by
 * rebuilding the table, so they are written inside the `CREATE TABLE` rather
 * than after it.
 *
 * @param {Function} query Runs a statement and answers its rows
 * @returns {Promise<object>} The description
 */
const sqlite = async (query) => {
  const rows = await query(
    `SELECT name, sql FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name`
  );
  const created = await query(
    `SELECT name, tbl_name, sql FROM sqlite_master
     WHERE type = 'index' AND sql IS NOT NULL
     ORDER BY name`
  );
  const tables = [];

  for (const table of rows) {
    const columns = await query(`PRAGMA table_info(${backtick(table.name)})`);
    const indexes = await query(`PRAGMA index_list(${backtick(table.name)})`);
    const references = await query(
      `PRAGMA foreign_key_list(${backtick(table.name)})`
    );
    const keyed = columns
      .filter((row) => Number(row.pk) > 0)
      .sort((one, two) => Number(one.pk) - Number(two.pk));
    const auto = /AUTOINCREMENT/iu.test(String(table.sql || ''));
    const rowid =
      keyed.length === 1 && /^integer$/iu.test(String(keyed[0].type || ''));
    const body = columns.map((row) => {
      const key =
        rowid && Number(row.pk) === 1
          ? ` PRIMARY KEY${auto ? ' AUTOINCREMENT' : ''}`
          : '';
      const value =
        row.dflt_value === null || typeof row.dflt_value === 'undefined'
          ? ''
          : ` DEFAULT ${row.dflt_value}`;

      return `${backtick(row.name)} ${row.type}${key}${
        Number(row.notnull) === 1 ? ' NOT NULL' : ''
      }${value}`;
    });

    if (keyed.length > 0 && !rowid) {
      body.push(
        `PRIMARY KEY (${keyed.map((row) => backtick(row.name)).join(', ')})`
      );
    }

    for (const index of indexes.filter((row) => row.origin === 'u')) {
      const on = await query(`PRAGMA index_info(${backtick(index.name)})`);

      body.push(`UNIQUE (${on.map((row) => backtick(row.name)).join(', ')})`);
    }

    for (const [key, group] of groupBy(references, 'id')) {
      const ordered = group.sort(
        (one, two) => Number(one.seq) - Number(two.seq)
      );

      debug('foreign key %s of %s', key, table.name);
      body.push(
        `FOREIGN KEY (${ordered
          .map((row) => backtick(row.from))
          .join(', ')}) REFERENCES ${backtick(ordered[0].table)} (${ordered
          .map((row) => backtick(row.to))
          .join(', ')}) ON DELETE ${ordered[0].on_delete} ON UPDATE ${
          ordered[0].on_update
        }`
      );
    }

    tables.push({ body, name: table.name });
  }

  return {
    foreignKeys: [],
    indexes: created.map((row) => ({
      statement: `${row.sql};`,
      table: row.tbl_name,
    })),
    tables,
    types: [],
  };
};

const READERS = { mysql, postgres, sqlite };

/**
 * The statements of a dump: what is left once the comments are taken out
 *
 * @param {string} text A dump
 * @returns {Array<string>} The statements
 */
const statementsOf = (text) =>
  text
    .split(BREAKPOINT)
    .map((chunk) =>
      chunk
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter((chunk) => chunk.length > 0);

class Dump {
  /**
   * Creates an instance of Dump.
   *
   * @param {object} adapter The Drizzle adapter
   * @memberof Dump
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * The dump file (`config.schemaFile`, or `db/schema.sql`)
   *
   * @readonly
   * @returns {string} An absolute path
   * @memberof Dump
   */
  get file() {
    const { config, henri } = this.adapter;
    const cwd =
      henri && typeof henri.cwd === 'function' ? henri.cwd() : process.cwd();

    return path.resolve(cwd, config.schemaFile || 'db/schema.sql');
  }

  /**
   * Reads the database back
   *
   * @returns {Promise<object>} The description
   * @memberof Dump
   */
  async read() {
    const { adapter } = this;

    return READERS[adapter.dialect.name]((text, params) =>
      adapter.query(text, params)
    );
  }

  /**
   * The tables of the database that are not the application's schema: the
   * queue, the access trail, the webhook endpoints, and drizzle's own record
   * of what it applied. Their owners create them.
   *
   * @param {string} name A table name
   * @returns {boolean} true when the dump leaves it out
   * @memberof Dump
   */
  skips(name) {
    return (
      this.adapter.reservedTables().has(name) || name.startsWith('__drizzle')
    );
  }

  /**
   * The dump of the database, as text
   *
   * @returns {Promise<{ at: ?string, tables: Array<string>, text: string }>}
   *   The migration the database is at, what was described, and the file
   * @memberof Dump
   */
  async render() {
    const { adapter } = this;
    const { applied } = await adapter.migrations.status();
    const at = applied.length > 0 ? applied[applied.length - 1] : null;
    const description = await this.read();
    const quote = adapter.dialect.quote;
    const tables = description.tables
      .filter((table) => !this.skips(table.name))
      .sort((one, two) => one.name.localeCompare(two.name));
    const kept = (entry) => !this.skips(entry.table);
    const statements = [
      ...description.types.sort(),
      ...tables.map(
        (table) =>
          `CREATE TABLE ${quote(table.name)} (\n${table.body
            .map((line) => `\t${line}`)
            .join(',\n')}\n);`
      ),
      ...description.indexes
        .filter(kept)
        .map((entry) => entry.statement)
        .sort(),
      ...description.foreignKeys
        .filter(kept)
        .map((entry) => entry.statement)
        .sort(),
    ];

    return {
      at,
      tables: tables.map((table) => table.name),
      text: `${this.header(at)}${BREAKPOINT}${statements.join(BREAKPOINT)}\n`,
    };
  }

  /**
   * The comment every dump opens with
   *
   * @param {?string} at The migration the database is at
   * @returns {string} The header
   * @memberof Dump
   */
  header(at) {
    return [
      HEADER,
      '--',
      '-- The shape of the database, not its data. Written by',
      '-- "henri db:schema:dump" and read by "henri db:schema:load"; it is',
      '-- generated, so change the schema with a migration and dump again.',
      '--',
      `-- dialect: ${this.adapter.dialect.name}`,
      `-- migration: ${at || 'none'}`,
    ].join('\n');
  }

  /**
   * Writes the dump (`henri db:schema:dump`)
   *
   * @returns {Promise<{ at: ?string, file: string, statements: number, tables: Array<string> }>}
   *   What was written
   * @memberof Dump
   */
  async write() {
    const { at, tables, text } = await this.render();
    const { file } = this;

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    debug('wrote %s', file);

    return { at, file, statements: statementsOf(text).length, tables };
  }

  /**
   * The migration a dump says it was taken at
   *
   * @param {string} text The dump
   * @returns {?string} The tag, or null
   * @memberof Dump
   */
  static at(text) {
    const match = /^--\s*migration:\s*(\S+)\s*$/mu.exec(text);

    return match && match[1] !== 'none' ? match[1] : null;
  }

  /**
   * Loads the dump into the database (`henri db:schema:load`)
   *
   * It refuses a database that already holds tables rather than emptying it:
   * `henri db:reset` is the command that does that, and a load quietly
   * taking an application's tables with it would be a worse version of it.
   *
   * @param {object} [options={}] `force` loads into a database that already
   *   has tables
   * @returns {Promise<object>} What ran and what was recorded
   * @throws {Error} HENRI_MIGRATION_DUMP_UNKNOWN when there is no dump, or
   *   it names a migration this folder does not have;
   *   HENRI_MIGRATION_DATABASE_NOT_EMPTY when something is there already
   * @memberof Dump
   */
  async load({ force = false } = {}) {
    const { adapter, file } = this;

    if (!fs.existsSync(file)) {
      throw coded(
        'HENRI_MIGRATION_DUMP_UNKNOWN',
        `drizzle: no schema dump at ${file}; write one with "henri db:schema:dump" where a database is reachable`
      );
    }

    const text = fs.readFileSync(file, 'utf8');
    const at = Dump.at(text);
    const journal = adapter.migrations.journal();

    if (at && !journal.entries.some((entry) => entry.tag === at)) {
      throw coded(
        'HENRI_MIGRATION_DUMP_UNKNOWN',
        `drizzle: ${path.basename(file)} was taken at ${at}, which is not a migration of ${adapter.migrations.folder}`
      );
    }

    const existing = (await adapter.listTables()).filter(
      (table) => !this.skips(table)
    );

    if (existing.length > 0 && !force) {
      throw coded(
        'HENRI_MIGRATION_DATABASE_NOT_EMPTY',
        `drizzle: store ${adapter.name} already holds ${existing.length} table(s) (${existing
          .slice(0, 5)
          .join(', ')}); a schema load starts from an empty database`
      );
    }

    const db = adapter.rawDatabase();
    const statements = statementsOf(text);

    for (const statement of statements) {
      debug('load: %s', statement);
      await adapter.dialect.exec(db, statement);
    }

    return {
      at,
      file,
      recorded: await adapter.migrations.markApplied({ through: at }),
      statements: statements.length,
    };
  }
}

module.exports = { Dump, HEADER, statementsOf };
