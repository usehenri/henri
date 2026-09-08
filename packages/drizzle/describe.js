const debug = require('debug')('henri:drizzle:describe');

/**
 * What the database holds, in the database's own words.
 *
 * The compiled schema of `index.js` says what henri *asked* for. This asks
 * the server what is there: the real column names and the types the dialect
 * chose, whether a column is nullable, what its default is, which columns
 * carry the primary key, every index that exists (including the ones
 * nobody declared) and the tables no model claims.
 *
 * That is a different question from the migration state `henri db:status`
 * answers on a drizzle store, and neither is computed from the other: a
 * database can be up to date on its migrations and hold a column somebody
 * added by hand, and a pending migration says nothing about what the
 * columns look like right now.
 *
 * Every statement here is a `SELECT` against the catalogue -- sqlite's
 * `pragma_*` table-valued functions, `information_schema` on mysql, the
 * `pg_*` catalogue on postgres -- run through `adapter.query()`, which is
 * the same normalized path `henri db:status` and the runtime query
 * endpoint use. Nothing is written.
 */

/**
 * Reads a value out of a row whatever case the server answered in
 *
 * @param {object} row A row
 * @param {string} key The lower case key
 * @returns {*} The value
 */
const at = (row, key) =>
  typeof row[key] === 'undefined' ? row[key.toUpperCase()] : row[key];

/**
 * A truthy database flag: the servers answer 1, '1', true, 'YES' and 't'
 *
 * @param {*} value What the row held
 * @returns {boolean} Whether it says yes
 */
const yes = (value) =>
  value === true ||
  value === 1 ||
  value === '1' ||
  value === 'YES' ||
  value === 'yes' ||
  value === 't';

/**
 * The values of a mysql `enum('a','b')` column type
 *
 * @param {string} type The COLUMN_TYPE
 * @returns {?Array<string>} The values, or null when it is not an enum
 */
const mysqlEnum = (type) => {
  const match = /^enum\((.*)\)$/iu.exec(String(type));

  if (!match) {
    return null;
  }

  return (match[1].match(/'(?:[^']|'')*'/gu) || []).map((value) =>
    value.slice(1, -1).replace(/''/gu, "'")
  );
};

/**
 * A postgres type, with the size the column was declared with
 *
 * @param {object} row One information_schema.columns row
 * @returns {string} The type
 */
const postgresType = (row) => {
  const type = String(at(row, 'typ'));
  const length = at(row, 'len');
  const precision = at(row, 'prec');
  const scale = at(row, 'scale');

  if (length !== null && typeof length !== 'undefined') {
    return `${type}(${length})`;
  }

  // Only when the model asked for one: every integer has a precision it
  // never declared, and printing it would read as a difference
  if (
    type === 'numeric' &&
    precision !== null &&
    typeof precision !== 'undefined'
  ) {
    return `${type}(${precision},${scale || 0})`;
  }

  return type;
};

/**
 * Groups rows by the table they belong to
 *
 * @param {Array<object>} rows The rows
 * @param {function} shape What one row becomes
 * @returns {object} Lists by table name
 */
const byTable = (rows, shape) => {
  const grouped = {};

  for (const row of rows) {
    const table = String(at(row, 'tbl'));

    grouped[table] = grouped[table] || [];
    shape(row, grouped[table]);
  }

  return grouped;
};

/**
 * Folds the one-row-per-index-column answers into one entry per index
 *
 * @param {Array<object>} list The entries built so far
 * @param {object} index `{ name, primary, unique }`
 * @param {string} column The column of this row
 * @returns {void}
 */
const push = (list, index, column) => {
  const found = list.find((entry) => entry.name === index.name);

  if (found) {
    found.columns.push(column);

    return;
  }

  list.push({ columns: [column], ...index });
};

/** How each dialect is asked what it holds */
const INTROSPECTION = {
  mysql: {
    columns: async (query) =>
      byTable(
        await query(
          `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS typ,
                  IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt, COLUMN_KEY AS ky
             FROM information_schema.columns
            WHERE table_schema = DATABASE()
            ORDER BY TABLE_NAME, ORDINAL_POSITION`
        ),
        (row, list) => {
          const values = mysqlEnum(at(row, 'typ'));

          list.push({
            default: at(row, 'dflt'),
            name: String(at(row, 'col')),
            nullable: yes(at(row, 'nullable')),
            primaryKey: at(row, 'ky') === 'PRI',
            type: String(at(row, 'typ')),
            values: values && values.length > 0 ? values : null,
          });
        }
      ),
    indexes: async (query) =>
      byTable(
        await query(
          `SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, NON_UNIQUE AS non_unique,
                  COLUMN_NAME AS col
             FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND COLUMN_NAME IS NOT NULL
            ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`
        ),
        (row, list) =>
          push(
            list,
            {
              name: String(at(row, 'idx')),
              primary: at(row, 'idx') === 'PRIMARY',
              unique: !yes(at(row, 'non_unique')),
            },
            String(at(row, 'col'))
          )
      ),
  },

  postgres: {
    columns: async (query) => {
      const labels = {};

      for (const row of await query(
        `SELECT t.typname AS typ, e.enumlabel AS val
           FROM pg_type t
           JOIN pg_enum e ON e.enumtypid = t.oid
           JOIN pg_namespace n ON n.oid = t.typnamespace
          WHERE n.nspname = 'public'
          ORDER BY t.typname, e.enumsortorder`
      )) {
        const name = String(at(row, 'typ'));

        labels[name] = labels[name] || [];
        labels[name].push(String(at(row, 'val')));
      }

      return byTable(
        await query(
          `SELECT c.table_name AS tbl, c.column_name AS col, c.is_nullable AS nullable,
                  c.column_default AS dflt, c.udt_name AS udt,
                  CASE WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name ELSE c.data_type END AS typ,
                  c.character_maximum_length AS len,
                  c.numeric_precision AS prec, c.numeric_scale AS scale
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
             WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
             ORDER BY c.table_name, c.ordinal_position`
        ),
        (row, list) => {
          const values = labels[String(at(row, 'udt'))] || null;

          list.push({
            default: at(row, 'dflt'),
            name: String(at(row, 'col')),
            nullable: yes(at(row, 'nullable')),
            // Answered by the index catalogue below, which is where
            // postgres keeps the primary key
            primaryKey: false,
            type: postgresType(row),
            values,
          });
        }
      );
    },
    indexes: async (query) =>
      byTable(
        await query(
          `SELECT t.relname AS tbl, i.relname AS idx, ix.indisunique AS uniq,
                  ix.indisprimary AS pk, a.attname AS col
             FROM pg_index ix
             JOIN pg_class t ON t.oid = ix.indrelid
             JOIN pg_class i ON i.oid = ix.indexrelid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            WHERE t.relkind = 'r' AND n.nspname = 'public'
            ORDER BY t.relname, i.relname, k.ord`
        ),
        (row, list) =>
          push(
            list,
            {
              name: String(at(row, 'idx')),
              primary: yes(at(row, 'pk')),
              unique: yes(at(row, 'uniq')),
            },
            String(at(row, 'col'))
          )
      ),
  },

  sqlite: {
    columns: async (query) =>
      byTable(
        await query(
          `SELECT m.name AS tbl, p.name AS col, p.type AS typ,
                  p."notnull" AS nn, p.dflt_value AS dflt, p.pk AS pk
             FROM sqlite_master m
             JOIN pragma_table_info(m.name) p
            WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
            ORDER BY m.name, p.cid`
        ),
        (row, list) =>
          list.push({
            default: at(row, 'dflt'),
            name: String(at(row, 'col')),
            nullable: !yes(at(row, 'nn')),
            primaryKey: Number(at(row, 'pk')) > 0,
            type: String(at(row, 'typ')),
            // An enum is stored as text here: nothing to read back
            values: null,
          })
      ),
    indexes: async (query) =>
      byTable(
        await query(
          `SELECT m.name AS tbl, il.name AS idx, il."unique" AS uniq,
                  il.origin AS origin, ii.name AS col
             FROM sqlite_master m
             JOIN pragma_index_list(m.name) il
             JOIN pragma_index_info(il.name) ii
            WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%'
            ORDER BY m.name, il.seq, ii.seqno`
        ),
        (row, list) =>
          push(
            list,
            {
              name: String(at(row, 'idx')),
              primary: at(row, 'origin') === 'pk',
              unique: yes(at(row, 'uniq')),
            },
            String(at(row, 'col'))
          )
      ),
  },
};

/**
 * Reads a database back and says what is in it
 *
 * @param {object} adapter The Drizzle adapter
 * @returns {Promise<object>} The schema
 */
const describe = async (adapter) => {
  const dialect = adapter.dialect.name;
  const introspection = INTROSPECTION[dialect];
  const present = await adapter.listTables();
  const query = (text) => adapter.query(text);
  let columns = {};
  let indexes = {};

  if (introspection) {
    columns = await introspection.columns(query);
    indexes = await introspection.indexes(query);
  } else {
    debug('no introspection for %s', dialect);
  }

  const claimed = new Set();
  const tables = [];

  for (const key of Object.keys(adapter.models)) {
    const table = adapter.tableNameOfKey(key);
    const fields = adapter.tables[key].columns || {};
    // The compiled table says which model field a column is; the database
    // does not, and a rename is exactly what makes this worth reading from
    // both sides
    const attributes = Object.fromEntries(
      Object.entries(fields).map(([field, column]) => [column, field])
    );

    // The primary key is in the index catalogue on postgres and nowhere in
    // information_schema.columns, so the two answers are joined here rather
    // than a third statement being run for it
    const keys = new Set(
      (indexes[table] || [])
        .filter((index) => index.primary)
        .flatMap((index) => index.columns)
    );

    claimed.add(table);
    tables.push({
      columns: (columns[table] || []).map((column) => ({
        attribute: attributes[column.name] || null,
        ...column,
        primaryKey: column.primaryKey || keys.has(column.name),
      })),
      exists: present.includes(table),
      indexes: indexes[table] || [],
      model: key,
      table,
    });
  }

  return {
    adapter: adapter.adapterName,
    dialect,
    enforced: true,
    kind: 'sql',
    note: introspection
      ? null
      : `${dialect} cannot be read back: the tables are named, their columns are not`,
    read: 'database',
    store: adapter.name,
    tables: tables.sort((left, right) => left.table.localeCompare(right.table)),
    // Named, never described: a table nothing declares belongs to something
    // else -- henri's own queue, trail, sessions or migration journal, or a
    // person -- and `DESCRIBE <table>` through the query endpoint is how to
    // look inside one
    unclaimed: present
      .filter((table) => !claimed.has(table))
      .sort((left, right) => left.localeCompare(right)),
  };
};

module.exports = { describe };
