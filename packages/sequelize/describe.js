const debug = require('debug')('henri:sequelize:describe');

/**
 * What the database holds, in the database's own words.
 *
 * `drift.js` next door answers a different question -- what the database
 * and the models *disagree* about -- and it is the one `henri db:status`
 * prints. This one asks the database what is there and says which model
 * each table belongs to, whether the two agree or not.
 *
 * The distinction matters because everything else henri can tell an agent
 * about a schema is read off the model files: the physical table name, the
 * column a `field` renamed, the type the dialect chose for a `string`, the
 * indexes that really exist and the tables nothing declares are only in the
 * database. `describeTable()` and `showIndex()` are where they come from,
 * and nothing here writes.
 */

/**
 * The table name of a model, as a string
 *
 * @param {object} model A Sequelize model
 * @returns {string} The table name
 */
const tableOf = (model) => {
  const name = model.getTableName();

  return typeof name === 'string' ? name : name.tableName;
};

/**
 * A table name however `showAllTables()` spelled it: the dialects answer a
 * string, and some of them an object carrying the schema
 *
 * @param {*} entry One entry of showAllTables()
 * @returns {string} The table name
 */
const named = (entry) =>
  entry && typeof entry === 'object' ? entry.tableName : String(entry);

/**
 * The model attribute each column belongs to
 *
 * A column is not always the attribute: `field` renames it, and it is the
 * rename that makes a schema worth reading from the database rather than
 * from the model file.
 *
 * @param {object} model A Sequelize model
 * @returns {object} Attribute names by column name
 */
const attributesOf = (model) => {
  const attributes = {};

  for (const [name, attribute] of Object.entries(model.tableAttributes)) {
    attributes[attribute.field || name] = name;
  }

  return attributes;
};

/**
 * The values of a mysql `ENUM('a','b')` column type
 *
 * The dialects answer an enum in two ways: PostgreSQL keeps it in a type of
 * its own and `describeTable()` hands the values back in `special`, while
 * mysql spells them inside the type. `values` means the same thing on both
 * here, so that a reader never has to parse a type string on one dialect
 * and read a field on the other. sqlite and SQL Server have no such column
 * -- an `enum` is TEXT or NVARCHAR there, held by an `isIn` validator
 * (./schema.js) -- so `values` is null on those two, which is what the
 * database holds and the whole point of asking it.
 *
 * @param {string} type The type describeTable() answered
 * @returns {?Array<string>} The values, or null when it is not an enum
 */
const enumValues = (type) => {
  const match = /^ENUM\((.*)\)$/iu.exec(String(type).trim());

  if (!match) {
    return null;
  }

  return (match[1].match(/'(?:[^']|'')*'/gu) || []).map((value) =>
    value.slice(1, -1).replace(/''/gu, "'")
  );
};

/**
 * The columns of one table, as `describeTable()` answered
 *
 * @param {object} columns What describeTable() answered
 * @param {object} attributes Attribute names by column name
 * @returns {Array<object>} The columns
 */
const columnsOf = (columns, attributes) =>
  Object.keys(columns).map((name) => {
    const column = columns[name];
    const type = String(column.type);
    const special = Array.isArray(column.special)
      ? column.special.map(String)
      : null;
    const values = special && special.length > 0 ? special : enumValues(type);

    return {
      attribute: attributes[name] || null,
      default:
        typeof column.defaultValue === 'undefined' ? null : column.defaultValue,
      name,
      nullable: Boolean(column.allowNull),
      primaryKey: column.primaryKey === true,
      // PostgreSQL names the type and not the kind: a column whose values
      // are known is an enum, whatever the catalogue called the type
      type: values && type === 'USER-DEFINED' ? 'ENUM' : type,
      values,
    };
  });

/**
 * The indexes of one table, as `showIndex()` answered
 *
 * Every index is reported, not only the ones a model declares: one added by
 * hand is part of what the database holds, and it is exactly the kind of
 * thing nothing else in henri can say.
 *
 * @param {object} queryInterface The Sequelize query interface
 * @param {*} tableName The table
 * @returns {Promise<Array<object>>} The indexes
 */
const indexesOf = async (queryInterface, tableName) => {
  let indexes;

  try {
    indexes = await queryInterface.showIndex(tableName);
  } catch (error) {
    debug('cannot read the indexes of %o: %s', tableName, error.message);

    return [];
  }

  return indexes.map((index) => ({
    columns: (index.fields || []).map((field) =>
      typeof field === 'string' ? field : field.attribute || field.name || ''
    ),
    name: index.name,
    primary: index.primary === true,
    unique: index.unique === true,
  }));
};

/**
 * Reads a database back and says what is in it
 *
 * @param {object} adapter The Sequelize adapter
 * @returns {Promise<object>} The schema
 */
const describe = async (adapter) => {
  const sequelize = adapter.ensureConnector();
  const queryInterface = sequelize.getQueryInterface();
  const dialect = sequelize.getDialect();
  const tables = [];
  const claimed = new Set();
  let present;

  try {
    present = (await queryInterface.showAllTables()).map(named);
  } catch (error) {
    debug('cannot list the tables: %s', error.message);
    present = null;
  }

  for (const globalId of Object.keys(adapter.models)) {
    const model = adapter.models[globalId];
    const tableName = model.getTableName();
    const table = tableOf(model);

    claimed.add(table);

    const exists = present
      ? present.includes(table)
      : await queryInterface.tableExists(tableName);

    if (!exists) {
      tables.push({
        columns: [],
        exists: false,
        indexes: [],
        model: globalId,
        table,
      });

      continue;
    }

    tables.push({
      columns: columnsOf(
        await queryInterface.describeTable(tableName),
        attributesOf(model)
      ),
      exists: true,
      indexes: await indexesOf(queryInterface, tableName),
      model: globalId,
      table,
    });
  }

  return {
    adapter: adapter.adapterName,
    dialect,
    // The database is the source, and it holds every row to this shape
    enforced: true,
    kind: 'sql',
    read: 'database',
    store: adapter.name,
    tables: tables.sort((left, right) => left.table.localeCompare(right.table)),
    // Named, never described: a table nothing declares belongs to something
    // else -- henri's own queue, trail or sessions, or a person -- and
    // `DESCRIBE <table>` through the query endpoint is how to look inside
    unclaimed: (present || [])
      .filter((table) => !claimed.has(table))
      .sort((left, right) => left.localeCompare(right)),
  };
};

module.exports = { describe };
