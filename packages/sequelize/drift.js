const debug = require('debug')('henri:sequelize:drift');

/**
 * What the database and the models disagree about.
 *
 * The Sequelize adapters have no migrations: `sequelize.sync()` creates the
 * tables that are missing and leaves every table that already exists alone.
 * That is enough in development and it is nothing at all in production,
 * where a model gains a column and the table it belongs to never hears
 * about it.
 *
 * This is the other half: henri reads the database back (`describeTable()`,
 * `showIndex()`), compares it with the models it loaded, and says what
 * differs. `henri db:status` prints it, `henri db:status --sql` prints the
 * DDL that would close it, and a production boot warns about it instead of
 * running DDL of its own.
 *
 * Nothing here writes to the database.
 */

// A database says a type in its own words: PostgreSQL answers CHARACTER
// VARYING(255) where the model renders VARCHAR(255), MySQL answers INT for
// INTEGER. Both sides pass through here before they are compared, so a
// column henri wrote itself never reads as drifted.
const ALIASES = new Map([
  ['BOOL', 'BOOLEAN'],
  ['CHARACTER', 'CHAR'],
  ['CHARACTER VARYING', 'VARCHAR'],
  ['DECIMAL', 'NUMERIC'],
  ['INT', 'INTEGER'],
  ['INT2', 'SMALLINT'],
  ['INT4', 'INTEGER'],
  ['INT8', 'BIGINT'],
  ['TIMESTAMPTZ', 'TIMESTAMP WITH TIME ZONE'],
]);

// The floating point types, where a dialect keeps fewer of them than the
// model can name. PostgreSQL has no single precision FLOAT: a FLOAT column
// is DOUBLE PRECISION, so henri's `float` and `number` are one column there
// and comparing the two names would report a difference that is not one.
// MySQL keeps them apart but answers DOUBLE for both REAL and DOUBLE
// PRECISION. Verified against PostgreSQL 17, MySQL 8 and sqlite; MSSQL is
// the dialect no suite reaches, and its entry is Microsoft's documented
// synonym rather than something henri has watched.
const DIALECT_ALIASES = {
  mariadb: new Map([
    ['DOUBLE PRECISION', 'DOUBLE'],
    ['REAL', 'DOUBLE'],
  ]),
  mssql: new Map([['DOUBLE PRECISION', 'FLOAT']]),
  mysql: new Map([
    ['DOUBLE PRECISION', 'DOUBLE'],
    ['REAL', 'DOUBLE'],
  ]),
  postgres: new Map([
    ['DOUBLE', 'DOUBLE PRECISION'],
    ['FLOAT', 'DOUBLE PRECISION'],
    ['FLOAT4', 'REAL'],
    ['FLOAT8', 'DOUBLE PRECISION'],
  ]),
};

// The dialects whose ALTER TABLE henri will write for a human to run.
// sqlite has no ALTER COLUMN at all (a change means rebuilding the table),
// and Sequelize's generator emits MySQL's `ALTER TABLE ... CHANGE` for it,
// which sqlite would refuse: better to say so than to hand out SQL that
// does not run.
const ALTERS_COLUMNS = new Set(['mariadb', 'mssql', 'mysql', 'postgres']);

/**
 * The base name and the arguments of a SQL type
 *
 * @param {*} value A type, as the database or the model spells it
 * @param {string} [dialect] The dialect, for the types it spells its own way
 * @returns {{base: string, args: string, text: string}} The comparable form
 */
const parseType = (value, dialect) => {
  const text = String(typeof value === 'undefined' ? '' : value)
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
    // MySQL renders a uuid as `CHAR(36) BINARY`; it reads back as CHAR(36)
    .replace(/ BINARY$/, '')
    .replace(/ UNSIGNED$/, '');
  const match = text.match(/^([A-Z][A-Z ]*?)\s*(\(.*\))?$/);

  if (!match) {
    return { args: '', base: text, text };
  }

  const dialects = DIALECT_ALIASES[dialect] || new Map();
  const named = ALIASES.get(match[1]) || match[1];
  const base = dialects.get(named) || named;
  const args = match[2] || '';

  return { args, base, text: `${base}${args}` };
};

/**
 * The comparable form of a SQL type
 *
 * @param {*} value A type, as the database or the model spells it
 * @param {string} [dialect] The dialect, for the types it spells its own way
 * @returns {string} The comparable form
 */
const normalizeType = (value, dialect) => parseType(value, dialect).text;

/**
 * Do a model's type and a database's column say the same thing?
 *
 * A model that names no precision takes whatever the database chose: MySQL
 * stores a `DECIMAL` as `DECIMAL(10,0)` and PostgreSQL a `VARCHAR` as
 * `CHARACTER VARYING`, and neither is a change anybody made. A model that
 * does name one is compared on it.
 *
 * @param {string} wanted The type the model wants
 * @param {*} actual The type describeTable() answered
 * @param {string} dialect The dialect
 * @returns {boolean} true when they agree
 */
const sameType = (wanted, actual, dialect) => {
  const model = parseType(wanted, dialect);
  const column = parseType(actual, dialect);

  return model.args === ''
    ? model.base === column.base
    : model.text === column.text;
};

/**
 * The type a model attribute wants, in the words of this dialect
 *
 * @param {object} sequelize The Sequelize instance
 * @param {object} attribute A model attribute
 * @returns {?string} The SQL type, or null when it cannot be rendered
 */
const typeOf = (sequelize, attribute) => {
  try {
    const type = sequelize.normalizeDataType(attribute.type);

    return typeof type === 'string' ? type : type.toSql();
  } catch (error) {
    debug('cannot render %o: %s', attribute.type, error.message);

    return null;
  }
};

/**
 * The values of an enum attribute, or null when it is not one
 *
 * @param {object} attribute A model attribute
 * @returns {?Array<string>} The values
 */
const enumValues = (attribute) => {
  const type = attribute && attribute.type;

  if (!type || typeof type !== 'object') {
    return null;
  }

  const values = type.values || (type.options && type.options.values);

  return Array.isArray(values) ? values.map(String) : null;
};

/**
 * Compares two lists of enum values, order included
 *
 * @param {Array<string>} left One list
 * @param {Array<string>} right The other
 * @returns {boolean} true when they hold the same values
 */
const sameValues = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

/**
 * One difference, in a line a person can act on
 *
 * @param {object} difference One entry of a drift report
 * @returns {string} The description
 */
const describeDifference = (difference) => {
  const { column, index, kind, reason, table } = difference;

  if (kind === 'table-missing') {
    return `${table}: the table is missing`;
  }

  if (kind === 'column-missing') {
    return `${table}.${column}: the column is missing`;
  }

  if (kind === 'column-unexpected') {
    return `${table}.${column}: the column is in the database and in no model`;
  }

  if (kind === 'column-changed') {
    return `${table}.${column}: the database has ${reason}`;
  }

  return `${table}: the index ${index} is missing`;
};

/**
 * Reads a database back and compares it with the models
 *
 * @class Drift
 */
class Drift {
  /**
   * Creates an instance of Drift.
   *
   * @param {object} adapter The Sequelize adapter
   * @memberof Drift
   */
  constructor(adapter) {
    this.adapter = adapter;
  }

  /**
   * The dialect the store speaks
   *
   * @returns {string} postgres, mysql, mssql, mariadb or sqlite
   * @memberof Drift
   */
  dialectName() {
    return this.adapter.ensureConnector().getDialect();
  }

  /**
   * Everything the database and the models disagree about
   *
   * A difference carries the `kind` of disagreement, the `table` and the
   * `model` it is about, the `column` or `index` when there is one, and the
   * `statement` that would close it -- null when this dialect cannot say it
   * in one statement, and always null for a column the models no longer
   * declare: henri never writes a DROP for anyone.
   *
   * @returns {Promise<{clean: boolean, dialect: string, store: string,
   *   differences: Array<object>, statements: Array<string>,
   *   unsupported: Array<string>}>} The report
   * @memberof Drift
   */
  async report() {
    const { adapter } = this;
    const sequelize = adapter.ensureConnector();
    const dialect = this.dialectName();
    const differences = [];
    const unsupported = [];

    for (const name of Object.keys(adapter.models)) {
      await this.compare(adapter.models[name], {
        dialect,
        differences,
        sequelize,
        unsupported,
      });
    }

    const statements = differences
      .map((difference) => difference.statement)
      .filter(Boolean);
    // Every difference carries its own line, so a reader of the JSON (and
    // the command line, which cannot require this package) never has to
    // know what a `kind` means
    const described = differences.map((difference) => ({
      ...difference,
      description: describeDifference(difference),
    }));

    return {
      clean: differences.length === 0,
      dialect,
      differences: described,
      statements,
      store: adapter.name,
      unsupported,
    };
  }

  /**
   * Compares one model with its table
   *
   * @param {object} model A Sequelize model
   * @param {object} context dialect, differences, sequelize and unsupported
   * @returns {Promise<void>} Resolves when the model has been compared
   * @memberof Drift
   */
  async compare(model, context) {
    const { differences, sequelize } = context;
    const queryInterface = sequelize.getQueryInterface();
    const { queryGenerator } = queryInterface;
    const tableName = model.getTableName();
    const table =
      typeof tableName === 'string' ? tableName : tableName.tableName;

    if (!(await queryInterface.tableExists(tableName))) {
      differences.push({
        column: null,
        index: null,
        kind: 'table-missing',
        model: model.name,
        statement: queryGenerator.createTableQuery(
          tableName,
          queryGenerator.attributesToSQL(model.tableAttributes, model),
          {}
        ),
        table,
      });

      return;
    }

    const columns = await queryInterface.describeTable(tableName);

    this.compareColumns(model, { ...context, columns, table, tableName });
    await this.compareIndexes(model, { ...context, table, tableName });
  }

  /**
   * Compares the columns of one table with the attributes of its model
   *
   * @param {object} model A Sequelize model
   * @param {object} context columns, dialect, differences, sequelize,
   *   table, tableName and unsupported
   * @returns {void}
   * @memberof Drift
   */
  compareColumns(model, context) {
    const { columns, differences, sequelize, table, tableName } = context;
    const { queryGenerator } = sequelize.getQueryInterface();
    const wanted = model.tableAttributes;
    const fields = new Set();

    for (const name of Object.keys(wanted)) {
      const attribute = wanted[name];
      const field = attribute.field || name;

      fields.add(field);

      if (!columns[field]) {
        differences.push({
          column: field,
          index: null,
          kind: 'column-missing',
          model: model.name,
          statement: queryGenerator.addColumnQuery(tableName, field, attribute),
          table,
        });

        continue;
      }

      // Sequelize's own `sync({ alter: true })` leaves a primary key alone,
      // and so do we: the serial and identity defaults a database reports
      // never look like what a model declares
      if (!attribute.primaryKey && !columns[field].primaryKey) {
        this.compareColumn(attribute, columns[field], {
          ...context,
          field,
          model,
        });
      }
    }

    for (const field of Object.keys(columns)) {
      if (fields.has(field)) {
        continue;
      }

      differences.push({
        column: field,
        index: null,
        kind: 'column-unexpected',
        model: model.name,
        // No DROP COLUMN is ever written: the column may still hold the
        // only copy of something, and only a person can know that
        statement: null,
        table,
      });
    }
  }

  /**
   * Compares one column with the attribute it belongs to
   *
   * @param {object} attribute The model attribute
   * @param {object} column What describeTable() answered
   * @param {object} context dialect, differences, field, model, sequelize,
   *   table, tableName and unsupported
   * @returns {void}
   * @memberof Drift
   */
  compareColumn(attribute, column, context) {
    const {
      dialect,
      differences,
      field,
      model,
      sequelize,
      table,
      tableName,
      unsupported,
    } = context;
    const reasons = [];
    const values = enumValues(attribute);
    // PostgreSQL keeps an enum in a type of its own: describeTable() answers
    // USER-DEFINED and hands back the values, so they are what to compare
    const special = Array.isArray(column.special) ? column.special : null;
    const wanted = typeOf(sequelize, attribute);
    const nullable = attribute.allowNull !== false;

    if (values && special && special.length > 0) {
      if (!sameValues(values, special.map(String))) {
        reasons.push(
          `values ${special.join(', ')} instead of ${values.join(', ')}`
        );
      }
    } else if (wanted && !sameType(wanted, column.type, dialect)) {
      reasons.push(`${column.type} instead of ${wanted}`);
    }

    if (Boolean(column.allowNull) !== nullable) {
      reasons.push(column.allowNull ? 'nullable' : 'not null');
    }

    if (reasons.length === 0) {
      return;
    }

    const statement = ALTERS_COLUMNS.has(dialect)
      ? sequelize
          .getQueryInterface()
          .queryGenerator.changeColumnQuery(
            tableName,
            sequelize
              .getQueryInterface()
              .queryGenerator.attributesToSQL({ [field]: attribute })
          )
      : null;

    if (!statement) {
      unsupported.push(
        `${table}.${field}: ${dialect} has no ALTER COLUMN; the table has to be rebuilt`
      );
    }

    differences.push({
      column: field,
      index: null,
      kind: 'column-changed',
      model: model.name,
      reason: reasons.join(', '),
      statement,
      table,
    });
  }

  /**
   * Compares the indexes of one table with the ones its model declares
   *
   * Only the indexes henri would create are looked for: an index somebody
   * added by hand is theirs, and henri says nothing about it.
   *
   * @param {object} model A Sequelize model
   * @param {object} context differences, sequelize, table and tableName
   * @returns {Promise<void>} Resolves when the indexes have been compared
   * @memberof Drift
   */
  async compareIndexes(model, context) {
    const { differences, sequelize, table, tableName } = context;
    const queryInterface = sequelize.getQueryInterface();
    const existing = await queryInterface.showIndex(tableName);
    const names = new Set(existing.map((index) => index.name));

    for (const index of model._indexes || []) {
      if (names.has(index.name)) {
        continue;
      }

      differences.push({
        column: null,
        index: index.name,
        kind: 'index-missing',
        model: model.name,
        statement: queryInterface.queryGenerator.addIndexQuery(
          tableName,
          index
        ),
        table,
      });
    }
  }
}

module.exports = { Drift, describeDifference, normalizeType, sameType };
