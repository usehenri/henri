const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:drizzle:migrations');
const { quiet } = require('./utils');

const BREAKPOINT = '\n--> statement-breakpoint\n';
const MIGRATIONS_TABLE = '__drizzle_migrations';

// The prevId of a first snapshot, as drizzle-kit writes it
const ORIGIN = '00000000-0000-0000-0000-000000000000';

/**
 * The Rails part of the adapter: `db/migrations` in the application,
 * driven through drizzle-kit's programmatic API (`drizzle-kit/api`) and
 * drizzle-orm's migrator. The folder follows drizzle-kit's layout
 * (`NNNN_name.sql`, `meta/NNNN_snapshot.json`, `meta/_journal.json`) so
 * the drizzle-kit CLI can read it too.
 *
 * @class Migrations
 */
/** A statement that takes data away, whatever else it does */
const DESTRUCTIVE = /\bDROP\s+(?:TABLE|COLUMN)\b/iu;

/**
 * Does this statement drop one of the tables henri owns?
 *
 * The names are checked whole and quoted the way every dialect quotes them,
 * so a table called `henri_trail_archive` is nobody's business but the
 * application's.
 *
 * @param {string} statement A DDL statement
 * @param {Set<string>} reserved The table names henri owns
 * @returns {boolean} true when the statement would drop one of them
 */
const drops = (statement, reserved) => {
  const match =
    /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[["`]?([A-Za-z0-9_]+)/iu.exec(
      statement
    );

  return Boolean(match) && reserved.has(match[1]);
};

class Migrations {
  /**
   * Creates an instance of Migrations.
   *
   * @param {object} adapter The Drizzle adapter
   * @memberof Migrations
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * The migrations folder (`config.migrationsFolder` or `db/migrations`)
   *
   * @readonly
   * @returns {string} An absolute path
   * @memberof Migrations
   */
  get folder() {
    const { config, henri } = this.adapter;
    const cwd =
      henri && typeof henri.cwd === 'function' ? henri.cwd() : process.cwd();

    return path.resolve(cwd, config.migrationsFolder || 'db/migrations');
  }

  /**
   * The programmatic API of drizzle-kit (loaded on demand, it is heavy)
   *
   * @returns {object} drizzle-kit/api
   * @memberof Migrations
   */
  kit() {
    return this.adapter.kit || require('drizzle-kit/api');
  }

  /**
   * A snapshot of the compiled schema
   *
   * @param {object} [imports] Tables and enums by key (the adapter schema)
   * @param {string} [prevId] The id of the previous snapshot
   * @returns {Promise<object>} The snapshot
   * @memberof Migrations
   */
  async snapshot(imports, prevId) {
    const { dialect } = this.adapter;
    const tables = imports || this.adapter.schemaExports();

    return this.kit()[dialect.kit.snapshot](tables, prevId);
  }

  /**
   * The SQL statements turning one snapshot into another
   *
   * @param {object} prev The previous snapshot
   * @param {object} cur The current snapshot
   * @returns {Promise<Array<string>>} SQL statements
   * @memberof Migrations
   */
  async diff(prev, cur) {
    const { dialect } = this.adapter;

    return this.kit()[dialect.kit.migration](prev, cur);
  }

  /**
   * The DDL creating some tables from scratch
   *
   * @param {object} imports Tables and enums by key
   * @returns {Promise<Array<string>>} SQL statements
   * @memberof Migrations
   */
  async ddl(imports) {
    const prev = await this.snapshot({});
    const cur = await this.snapshot(imports, prev.id);

    return this.diff(prev, cur);
  }

  /**
   * Reads the journal (`meta/_journal.json`), or an empty one
   *
   * @returns {object} The journal
   * @memberof Migrations
   */
  journal() {
    const file = path.join(this.folder, 'meta', '_journal.json');

    if (!fs.existsSync(file)) {
      return {
        dialect: this.adapter.dialect.kit.dialect,
        entries: [],
        version: '7',
      };
    }

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  /**
   * The last snapshot of the folder, or an empty one
   *
   * @param {object} journal The journal
   * @returns {Promise<object>} The snapshot
   * @memberof Migrations
   */
  async lastSnapshot(journal) {
    const last = journal.entries[journal.entries.length - 1];

    if (!last) {
      return { ...(await this.snapshot({})), id: ORIGIN };
    }

    const file = path.join(
      this.folder,
      'meta',
      `${String(last.idx).padStart(4, '0')}_snapshot.json`
    );

    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  /**
   * Writes a migration for the difference between the last snapshot and
   * the current schema (`henri db:generate`)
   *
   * @param {object} [options={}] `name` of the migration
   * @returns {Promise<{ file: ?string, statements: Array<string> }>} The
   *   file written (null when the schema did not change) and its statements
   * @memberof Migrations
   */
  async generate({ name } = {}) {
    const { adapter } = this;
    const journal = this.journal();
    const prev = await this.lastSnapshot(journal);
    const cur = await this.snapshot(undefined, prev.id);
    const statements = await this.diff(prev, cur);

    if (statements.length === 0) {
      return { file: null, statements, tag: null };
    }

    const idx = journal.entries.length;
    const prefix = String(idx).padStart(4, '0');
    const slug = String(name || 'schema')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const tag = `${prefix}_${slug || 'schema'}`;
    const meta = path.join(this.folder, 'meta');
    const file = path.join(this.folder, `${tag}.sql`);

    fs.mkdirSync(meta, { recursive: true });
    fs.writeFileSync(file, statements.join(BREAKPOINT));
    fs.writeFileSync(
      path.join(meta, `${prefix}_snapshot.json`),
      JSON.stringify(cur, null, 2)
    );
    journal.entries.push({
      breakpoints: true,
      idx,
      tag,
      version: cur.version,
      when: Date.now(),
    });
    fs.writeFileSync(
      path.join(meta, '_journal.json'),
      JSON.stringify(journal, null, 2)
    );
    debug('wrote %s (%d statements)', file, statements.length);

    // A development database was pushed to this schema already: record the
    // migration so db:status and db:migrate agree with it
    let recorded = [];

    if (adapter.db && (await this.plan()).statements.length === 0) {
      recorded = await this.markApplied();
    }

    return { file, recorded, statements, tag };
  }

  /**
   * The applied and pending migrations (`henri db:status`)
   *
   * @returns {Promise<{ applied: Array<string>, pending: Array<string>, folder: string }>} The status
   * @memberof Migrations
   */
  async status() {
    const journal = this.journal();
    const last = await this.lastApplied();
    const applied = [];
    const pending = [];

    for (const entry of journal.entries) {
      if (last !== null && entry.when <= last) {
        applied.push(entry.tag);
      } else {
        pending.push(entry.tag);
      }
    }

    return { applied, folder: this.folder, pending };
  }

  /**
   * The `created_at` of the last migration applied (drizzle's migrator
   * applies every migration newer than it), null when none ran
   *
   * @returns {Promise<?number>} A timestamp or null
   * @memberof Migrations
   */
  async lastApplied() {
    const rows = await this.applied();

    return rows.length > 0 ? Math.max(...rows) : null;
  }

  /**
   * The `created_at` of every migration recorded in the database
   *
   * @returns {Promise<Array<number>>} Timestamps (empty without the table)
   * @memberof Migrations
   */
  async applied() {
    const { adapter } = this;
    const { ref } = adapter.dialect.migrations;

    try {
      const rows = await adapter.query(`SELECT created_at FROM ${ref}`);

      return rows.map((row) => Number(row.created_at));
    } catch (error) {
      debug('no migrations table yet: %s', error.message);

      return [];
    }
  }

  /**
   * Records the journal entries as applied without running them: after a
   * push the database already matches the schema they lead to
   *
   * @returns {Promise<Array<string>>} The tags recorded
   * @memberof Migrations
   */
  async markApplied() {
    const { adapter } = this;
    const journal = this.journal();

    if (journal.entries.length === 0) {
      return [];
    }

    const { dialect } = adapter;
    const db = adapter.rawDatabase();

    for (const statement of dialect.migrations.create) {
      await dialect.exec(db, statement);
    }

    const known = await this.applied();
    const recorded = [];

    for (const entry of journal.entries) {
      if (known.includes(entry.when)) {
        continue;
      }

      const file = path.join(this.folder, `${entry.tag}.sql`);
      const hash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(file, 'utf8'))
        .digest('hex');

      await adapter.query(
        `INSERT INTO ${dialect.migrations.ref} (hash, created_at) VALUES (${dialect.placeholder(
          1
        )}, ${dialect.placeholder(2)})`,
        [hash, entry.when]
      );
      recorded.push(entry.tag);
    }

    return recorded;
  }

  /**
   * Applies the pending migrations (`henri db:migrate`)
   *
   * @returns {Promise<{ applied: Array<string>, pending: Array<string> }>} What ran
   * @memberof Migrations
   */
  async migrate() {
    const { adapter } = this;
    const before = await this.status();

    if (before.pending.length === 0) {
      return { applied: [], pending: [] };
    }

    const { migrate } = require(adapter.dialect.migrator);

    await migrate(adapter.rawDatabase(), { migrationsFolder: this.folder });

    const after = await this.status();

    return { applied: before.pending, pending: after.pending };
  }

  /**
   * Makes the database match the schema (`henri db:push`, and the
   * development boot)
   *
   * drizzle-kit asks interactively whether tables were renamed when some
   * are added and others removed at the same time; without a terminal this
   * is refused so a boot never hangs. Statements losing data are only
   * applied with `force`.
   *
   * @param {object} [options={}] `force` applies destructive statements,
   *   `interactive` lets drizzle-kit prompt on renames
   * @returns {Promise<{ applied: boolean, statements: Array<string>, warnings: Array<string>, hasDataLoss: boolean, drifted: Array<string> }>} What happened
   * @memberof Migrations
   */
  async push({ force = false, interactive = false } = {}) {
    const { adapter } = this;
    const plan = await this.plan({ interactive });
    const result = {
      applied: false,
      drifted: plan.drifted || [],
      hasDataLoss: plan.hasDataLoss,
      statements: plan.statements,
      warnings: plan.warnings,
    };

    if (plan.hasDataLoss && !force && plan.statements.length > 0) {
      return result;
    }

    const db = adapter.rawDatabase();

    for (const statement of plan.statements) {
      debug('push: %s', statement);
      await adapter.dialect.exec(db, statement);
    }

    result.applied = true;
    result.recorded = await this.markApplied();

    return result;
  }

  /**
   * The statements a push would run (nothing is written)
   *
   * @param {object} [options={}] `interactive` lets drizzle-kit prompt on
   *   renames
   * @returns {Promise<{ statements: Array<string>, warnings: Array<string>, hasDataLoss: boolean }>} The plan
   * @throws {Error} When tables were added and removed without a terminal
   * @memberof Migrations
   */
  async plan({ interactive = false } = {}) {
    const { adapter } = this;
    const reserved = adapter.reservedTables();
    const existing = (await adapter.listTables()).filter(
      (table) => !reserved.has(table)
    );
    const wanted = adapter.tableNames();
    const added = wanted.filter((table) => !existing.includes(table));
    const removed = existing.filter(
      (table) => !wanted.includes(table) && table !== MIGRATIONS_TABLE
    );
    const canPrompt =
      interactive && process.stdin.isTTY && process.stdout.isTTY;

    if (added.length > 0 && removed.length > 0 && !canPrompt) {
      throw new Error(
        `push: tables were added (${added.join(', ')}) and removed (${removed.join(
          ', '
        )}) at the same time; drizzle-kit must know whether they were renamed. Run "henri db:push" in a terminal, or "henri db:generate" and edit the migration`
      );
    }

    const kit = this.kit();
    const imports = adapter.schemaExports();
    const db = adapter.rawDatabase();
    const args =
      adapter.dialect.name === 'mysql'
        ? [imports, db, adapter.databaseName()]
        : [imports, db];
    const plan = await quiet(() => kit[adapter.dialect.kit.push](...args));
    // A table henri owns is not drizzle's to drop. The queue and the access
    // trail create their own through raw SQL (they have to work on a store
    // that has no models at all), so drizzle-kit sees them as tables the
    // schema no longer wants -- and a push that obeyed it would take an
    // application's job history or its audit trail with it
    const proposed = plan.statementsToExecute || [];
    const statements = proposed.filter(
      (statement) => !drops(statement, reserved)
    );
    const result = {
      // The data loss drizzle-kit reported is the data loss of the
      // statements it proposed. Dropping one of henri's tables is exactly
      // that, so once such a drop is filtered out the question has to be
      // asked again of what is left -- otherwise every boot of an
      // application with a queue would refuse to push anything
      hasDataLoss:
        statements.length === proposed.length
          ? Boolean(plan.hasDataLoss)
          : statements.some((statement) => DESTRUCTIVE.test(statement)),
      statements,
      warnings: plan.warnings || [],
    };

    return adapter.dialect.name === 'mysql'
      ? this.completeMySQLPlan(result, { added, existing, imports })
      : result;
  }

  /**
   * Completes a mysql push plan
   *
   * drizzle-kit answers the data loss of a mysql push but not the DDL it
   * would run: `statementsToExecute` only ever holds the tables it suggests
   * truncating, where postgres and sqlite hold the whole migration. Those
   * truncates are dropped (a boot never empties a table), the tables that
   * do not exist yet are created from the schema, and a table whose columns
   * no longer match is reported instead of being altered silently.
   *
   * @param {object} plan The plan of drizzle-kit
   * @param {object} context `added` tables, `existing` tables, `imports`
   * @returns {Promise<object>} The completed plan
   * @memberof Migrations
   */
  async completeMySQLPlan(plan, { added, existing, imports }) {
    const { adapter } = this;
    const keys = Object.keys(adapter.tables);
    const missing = keys.filter((key) =>
      added.includes(adapter.tableNameOfKey(key))
    );
    const statements = [];

    if (missing.length > 0) {
      statements.push(
        ...(await this.ddl(
          Object.fromEntries(missing.map((key) => [key, imports[key]]))
        ))
      );
    }

    const drifted = await this.driftedTables(
      keys.filter((key) => existing.includes(adapter.tableNameOfKey(key)))
    );
    const warnings = [...plan.warnings];

    if (drifted.length > 0) {
      warnings.push(
        `${drifted.join(', ')}: the columns of the database and of the schema differ; drizzle-kit does not alter mysql tables on a push, run "henri db:generate" then "henri db:migrate"`
      );
    }

    return { ...plan, drifted, statements, warnings };
  }

  /**
   * The tables whose columns differ from the compiled schema (mysql)
   *
   * @param {Array<string>} keys The schema keys of the tables to compare
   * @returns {Promise<Array<string>>} The table names that drifted
   * @memberof Migrations
   */
  async driftedTables(keys) {
    const { adapter } = this;

    if (keys.length === 0) {
      return [];
    }

    const rows = await adapter.query(
      'SELECT table_name AS table_name, column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE()'
    );
    const columns = {};

    for (const row of rows) {
      const table = row.table_name || row.TABLE_NAME;

      columns[table] = columns[table] || new Set();
      columns[table].add(row.column_name || row.COLUMN_NAME);
    }

    return keys
      .map((key) => adapter.tableNameOfKey(key))
      .filter((table, index) => {
        const wanted = Object.values(adapter.tables[keys[index]].columns);
        const present = columns[table] || new Set();

        return (
          wanted.length !== present.size ||
          wanted.some((column) => !present.has(column))
        );
      });
  }

  /**
   * Creates the tables of some schema entries when they are missing
   * (production boots without `migrate` still need the sessions table)
   *
   * @param {object} imports Tables by key
   * @returns {Promise<boolean>} true when something was created
   * @memberof Migrations
   */
  async ensure(imports) {
    const { adapter } = this;
    const existing = await adapter.listTables();
    const missing = Object.keys(imports).filter(
      (key) => !existing.includes(adapter.tableNameOfKey(key))
    );

    if (missing.length === 0) {
      return false;
    }

    const statements = await this.ddl(
      Object.fromEntries(missing.map((key) => [key, imports[key]]))
    );

    for (const statement of statements) {
      await adapter.dialect.exec(adapter.rawDatabase(), statement);
    }

    return true;
  }
}

module.exports = { BREAKPOINT, MIGRATIONS_TABLE, Migrations };
