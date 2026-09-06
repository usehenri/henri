const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('henri:drizzle:migrations');
const { coded, quiet } = require('./utils');

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
 * ## Rolling back
 *
 * drizzle-kit generates forward-only SQL: there is no `down` in a
 * migration, and three ways to get one. A hand-written `down.sql` puts the
 * work on the person least able to check it -- the inverse of a diff a tool
 * computed -- and rots silently, because nothing ever runs it until the
 * day it matters. Writing a `down.sql` at `db:generate` time is the same
 * inverse, frozen: the folder invites hand-edits (drizzle-kit's own answer
 * to a rename is "edit the generated SQL"), and a frozen inverse of an
 * edited migration is wrong in the one direction nobody checks. Refusing
 * outright and shipping only the dump is honest but throws away the case
 * that actually happens, which is undoing the migration you applied a
 * minute ago on a database with nothing in it yet.
 *
 * So the inverse is **computed at rollback time**, from the two snapshots
 * the folder already holds (`meta/NNNN_snapshot.json`), by handing them to
 * drizzle-kit backwards: `diff(after, before)` where `db:generate` asked
 * for `diff(before, after)`. Nothing new is stored, nothing can go stale,
 * and what runs is the inverse of the schema `db:status` believes in.
 *
 * Three things it refuses, because a rollback that quietly does something
 * else is worse than no rollback at all:
 *
 * - **A migration that removed a table or a column.** Its inverse would
 *   recreate them empty, and an empty column is not the column that was
 *   dropped. There is no flag for this: undoing a destructive migration is
 *   a restore from a backup, and henri will not pretend otherwise
 *   (`HENRI_MIGRATION_IRREVERSIBLE`).
 * - **A migration whose `.sql` changed since it was applied.** The database
 *   records the sha256 of the file it ran; when the file on disk hashes to
 *   something else, henri does not know what ran and will not guess
 *   (`HENRI_MIGRATION_EDITED`).
 * - **A rollback that would drop rows that exist.** Not "a statement that
 *   matches DROP" -- the tables and columns the inverse removes are
 *   counted first, and a rollback that takes nothing away runs without
 *   ceremony. One that takes 412 rows away says so and needs `--force`,
 *   the precedent `henri db:push` set (`HENRI_MIGRATION_DESTRUCTIVE`).
 *
 * The `.sql` and the snapshot stay on disk: rolling back moves the
 * database, not the folder, so `db:status` reports the migration pending
 * again and `db:migrate` applies it again.
 *
 * @class Migrations
 */
/** A statement that takes data away, whatever else it does */
const DESTRUCTIVE = /\bDROP\s+(?:TABLE|COLUMN)\b/iu;

/**
 * Is this table one of henri's?
 *
 * The names are checked whole and quoted the way every dialect quotes them,
 * so a table called `henri_trail_archive` is nobody's business but the
 * application's. The prefixes are the one exception and there is one of
 * them: the partitions of a partitioned call log, whose names carry the day
 * they cover and are therefore not a list anybody can write down
 * (`Drizzle#reservedPrefixes`).
 *
 * @param {string} table A table name
 * @param {Set<string>} reserved The table names henri owns
 * @param {Array<string>} prefixes The prefixes henri owns
 * @returns {boolean} true when a push must leave it alone
 */
const isReserved = (table, reserved, prefixes) =>
  reserved.has(table) || prefixes.some((prefix) => table.startsWith(prefix));

/**
 * Does this statement drop one of the tables henri owns?
 *
 * @param {string} statement A DDL statement
 * @param {Set<string>} reserved The table names henri owns
 * @param {Array<string>} prefixes The prefixes henri owns
 * @returns {boolean} true when the statement would drop one of them
 */
const drops = (statement, reserved, prefixes) => {
  const match =
    /^\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?[["`]?([A-Za-z0-9_]+)/iu.exec(
      statement
    );

  return Boolean(match) && isReserved(match[1], reserved, prefixes);
};

/**
 * What one schema loses on the way from `before` to `after`: the tables of
 * `before` that `after` has no key for, and the columns of the tables both
 * of them have.
 *
 * The keys are drizzle-kit's own (`public.tasks` on postgres, `tasks`
 * everywhere else) and never leave this function; the names that come out
 * are the table and column names of the database.
 *
 * @param {object} before A drizzle-kit snapshot
 * @param {object} after Another one
 * @returns {{ columns: Array<{ column: string, table: string }>, tables: Array<string> }}
 *   What `before` has and `after` does not, sorted
 */
const removals = (before, after) => {
  const next = after.tables || {};
  const columns = [];
  const tables = [];

  for (const [key, table] of Object.entries(before.tables || {})) {
    if (!next[key]) {
      tables.push(table.name);
      continue;
    }

    const kept = next[key].columns || {};

    for (const column of Object.keys(table.columns || {})) {
      if (!kept[column]) {
        columns.push({ column, table: table.name });
      }
    }
  }

  return {
    columns: columns.sort(
      (one, two) =>
        one.table.localeCompare(two.table) ||
        one.column.localeCompare(two.column)
    ),
    tables: tables.sort(),
  };
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
   * The snapshot a journal index left the schema at
   *
   * @param {number} idx A journal index; below zero is the empty schema
   *   every folder starts from
   * @returns {Promise<object>} The snapshot
   * @throws {Error} HENRI_MIGRATION_SNAPSHOT_MISSING when the file is gone
   * @memberof Migrations
   */
  async snapshotAt(idx) {
    if (idx < 0) {
      return { ...(await this.snapshot({})), id: ORIGIN };
    }

    const name = `${String(idx).padStart(4, '0')}_snapshot.json`;
    const file = path.join(this.folder, 'meta', name);

    if (!fs.existsSync(file)) {
      throw coded(
        'HENRI_MIGRATION_SNAPSHOT_MISSING',
        `drizzle: ${path.join('meta', name)} is missing from ${this.folder}`,
        'The snapshots next to the migrations belong in version control: restore meta/ from it'
      );
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

    return this.snapshotAt(last ? last.idx : -1);
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
    // migration so db:status and db:migrate agree with it. `drifted` is the
    // mysql half of the same question -- a push there creates the tables
    // that are missing and reports the ones whose columns no longer match
    // instead of altering them, so a plan with no statements is not on its
    // own the database agreeing with the schema
    let recorded = [];

    if (adapter.db) {
      const plan = await this.plan();

      if (plan.statements.length === 0 && (plan.drifted || []).length === 0) {
        recorded = await this.markApplied();
      }
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
   * Every migration recorded in the database, with the sha256 of the file
   * that ran. drizzle's own migrator hashes the whole `.sql`, and so does
   * `markApplied()`, so the two agree and a rollback can tell whether the
   * file on disk is still the one that was applied.
   *
   * @returns {Promise<Array<{ hash: string, when: number }>>} The rows
   *   (empty when the table is not there yet)
   * @memberof Migrations
   */
  async appliedRows() {
    const { adapter } = this;
    const { ref } = adapter.dialect.migrations;

    try {
      const rows = await adapter.query(`SELECT hash, created_at FROM ${ref}`);

      return rows.map((row) => ({
        hash: String(row.hash),
        when: Number(row.created_at),
      }));
    } catch (error) {
      debug('no migrations table yet: %s', error.message);

      return [];
    }
  }

  /**
   * The `created_at` of every migration recorded in the database
   *
   * @returns {Promise<Array<number>>} Timestamps (empty without the table)
   * @memberof Migrations
   */
  async applied() {
    return (await this.appliedRows()).map((row) => row.when);
  }

  /**
   * The sha256 drizzle's migrator records for a migration file
   *
   * @param {string} tag The migration tag
   * @returns {string} The digest of the file, as it is stored
   * @memberof Migrations
   */
  digestOf(tag) {
    return crypto
      .createHash('sha256')
      .update(fs.readFileSync(path.join(this.folder, `${tag}.sql`), 'utf8'))
      .digest('hex');
  }

  /**
   * Records journal entries as applied without running them: after a push
   * the database already matches the schema they lead to, and after
   * `db:schema:load` it matches the schema the dump was taken at.
   *
   * @param {object} [options={}] `through` stops at that tag (inclusive),
   *   which is how a dump taken at 0002 leaves 0003 pending
   * @returns {Promise<Array<string>>} The tags recorded
   * @memberof Migrations
   */
  async markApplied({ through = null } = {}) {
    const { adapter } = this;
    const journal = this.journal();
    const wanted =
      through === null
        ? journal.entries
        : journal.entries.slice(
            0,
            journal.entries.findIndex((entry) => entry.tag === through) + 1
          );

    if (wanted.length === 0) {
      return [];
    }

    const { dialect } = adapter;
    const db = adapter.rawDatabase();

    for (const statement of dialect.migrations.create) {
      await dialect.exec(db, statement);
    }

    const known = await this.applied();
    const recorded = [];

    for (const entry of wanted) {
      if (known.includes(entry.when)) {
        continue;
      }

      await adapter.query(
        `INSERT INTO ${dialect.migrations.ref} (hash, created_at) VALUES (${dialect.placeholder(
          1
        )}, ${dialect.placeholder(2)})`,
        [this.digestOf(entry.tag), entry.when]
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
   * The journal entries the database says are applied, oldest first
   *
   * @param {object} journal The journal
   * @param {Array<{ hash: string, when: number }>} rows What the database
   *   recorded
   * @returns {Array<object>} The entries
   * @memberof Migrations
   */
  appliedEntries(journal, rows) {
    const last =
      rows.length > 0 ? Math.max(...rows.map((row) => row.when)) : null;

    return last === null
      ? []
      : journal.entries.filter((entry) => entry.when <= last);
  }

  /**
   * What rolling back the last migrations would do, without doing it
   *
   * The inverse of a migration is the diff of its two snapshots, read
   * backwards; the rows it would take away are counted in the database, so
   * that a rollback which loses nothing is not gated on a flag. Everything
   * is planned before anything runs: `n` steps refuse together or apply
   * together.
   *
   * @param {object} [options={}] `steps`, how many to undo (newest first)
   * @returns {Promise<Array<object>>} One entry per migration, newest
   *   first: `tag`, `when`, `statements` and the `removes` they act on
   * @throws {Error} HENRI_MIGRATION_NOT_APPLIED, HENRI_MIGRATION_EDITED,
   *   HENRI_MIGRATION_IRREVERSIBLE
   * @memberof Migrations
   */
  async rollbackPlan({ steps = 1 } = {}) {
    const journal = this.journal();
    const rows = await this.appliedRows();
    const entries = this.appliedEntries(journal, rows);
    const count = Math.max(1, Math.trunc(steps) || 1);

    if (entries.length < count) {
      throw coded(
        'HENRI_MIGRATION_NOT_APPLIED',
        entries.length === 0
          ? `drizzle: store ${this.adapter.name} has no applied migration to roll back`
          : `drizzle: store ${this.adapter.name} has ${entries.length} applied migration(s), ${count} were asked for`,
        'Run "henri db:status" for what is applied and what is pending'
      );
    }

    const plan = [];

    for (const entry of entries.slice(-count).reverse()) {
      plan.push(await this.step(journal, rows, entry));
    }

    return plan;
  }

  /**
   * One step of a rollback plan
   *
   * @param {object} journal The journal
   * @param {Array<object>} rows What the database recorded
   * @param {object} entry The journal entry to undo
   * @returns {Promise<object>} The step
   * @throws {Error} HENRI_MIGRATION_EDITED, HENRI_MIGRATION_IRREVERSIBLE
   * @memberof Migrations
   */
  async step(journal, rows, entry) {
    const position = journal.entries.indexOf(entry);
    const recorded = rows.find((row) => row.when === entry.when);

    if (recorded && recorded.hash !== this.digestOf(entry.tag)) {
      throw coded(
        'HENRI_MIGRATION_EDITED',
        `drizzle: ${entry.tag}.sql is not the file the database applied`,
        'Put the file back the way it was, or roll the change forward with a new migration'
      );
    }

    const after = await this.snapshotAt(entry.idx);
    const before = await this.snapshotAt(
      position > 0 ? journal.entries[position - 1].idx : -1
    );
    const lost = removals(before, after);

    if (lost.tables.length > 0 || lost.columns.length > 0) {
      const named = [
        ...lost.tables,
        ...lost.columns.map(({ column, table }) => `${table}.${column}`),
      ].join(', ');

      throw coded(
        'HENRI_MIGRATION_IRREVERSIBLE',
        `drizzle: ${entry.tag} removed ${named}; rolling it back would put them back empty`,
        'There is no --force for this: undoing a destructive migration is a restore from a backup'
      );
    }

    return {
      removes: await this.countRemovals(removals(after, before)),
      statements: await this.diff(after, before),
      tag: entry.tag,
      when: entry.when,
    };
  }

  /**
   * How many rows the tables and columns a rollback removes hold today
   *
   * A table henri cannot count is not an empty one: it is reported with a
   * null count, which reads as data loss everywhere the count is asked
   * about.
   *
   * @param {object} gone What removals() answered
   * @returns {Promise<Array<object>>} `kind`, `table`, `column` and `rows`
   * @memberof Migrations
   */
  async countRemovals(gone) {
    const { adapter } = this;
    const { quote } = adapter.dialect;
    const out = [];

    for (const table of gone.tables) {
      out.push({
        column: null,
        kind: 'table',
        rows: await this.count(
          `SELECT COUNT(*) AS henri_rows FROM ${quote(table)}`
        ),
        table,
      });
    }

    for (const { column, table } of gone.columns) {
      out.push({
        column,
        kind: 'column',
        rows: await this.count(
          `SELECT COUNT(*) AS henri_rows FROM ${quote(table)} WHERE ${quote(column)} IS NOT NULL`
        ),
        table,
      });
    }

    return out;
  }

  /**
   * Runs a COUNT(*), or answers null when the database cannot
   *
   * @param {string} statement The query
   * @returns {Promise<?number>} The count, or null
   * @memberof Migrations
   */
  async count(statement) {
    try {
      const rows = await this.adapter.query(statement);
      const [row] = Array.isArray(rows) ? rows : [];

      return row ? Number(Object.values(row)[0]) : null;
    } catch (error) {
      debug('could not count: %s', error.message);

      return null;
    }
  }

  /**
   * Undoes the last migrations (`henri db:rollback`)
   *
   * @param {object} [options={}] `steps` (default 1) and `force`, which is
   *   what a rollback taking rows away needs
   * @returns {Promise<{ applied: boolean, plan: Array<object>, rolledBack: Array<string> }>}
   *   What happened; `applied: false` is the refusal, with nothing run
   * @memberof Migrations
   */
  async rollback({ force = false, steps = 1 } = {}) {
    const { adapter } = this;
    const plan = await this.rollbackPlan({ steps });
    const loses = plan.some((step) =>
      step.removes.some((entry) => entry.rows === null || entry.rows > 0)
    );

    if (loses && !force) {
      return { applied: false, plan, rolledBack: [] };
    }

    const db = adapter.rawDatabase();
    const { ref } = adapter.dialect.migrations;
    const rolledBack = [];

    // One migration at a time, and its row is deleted only once its
    // statements ran: mysql commits every DDL statement on its own, so
    // there is no transaction to hide a half-finished rollback in. What a
    // failure leaves behind is what really happened
    for (const step of plan) {
      for (const statement of step.statements) {
        debug('rollback: %s', statement);
        await adapter.dialect.exec(db, statement);
      }

      await adapter.query(
        `DELETE FROM ${ref} WHERE created_at = ${adapter.dialect.placeholder(1)}`,
        [step.when]
      );
      rolledBack.push(step.tag);
    }

    return { applied: true, plan, rolledBack };
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
    const prefixes =
      typeof adapter.reservedPrefixes === 'function'
        ? adapter.reservedPrefixes()
        : [];
    const existing = (await adapter.listTables()).filter(
      (table) => !isReserved(table, reserved, prefixes)
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
      (statement) => !drops(statement, reserved, prefixes)
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

module.exports = { BREAKPOINT, MIGRATIONS_TABLE, Migrations, removals };
