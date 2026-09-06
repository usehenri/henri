/**
 * Schema type names of the henri model format and their column type on each
 * dialect
 *
 * A model file describes its fields with these names (`{ type: 'string' }`)
 * so the same definition works on every adapter; `schema.js` turns them into
 * Drizzle column builders. The Sequelize and Mongoose adapters map the same
 * names in their own `types.js`.
 *
 * Values are read by the model layer too: `js` is the JavaScript type a
 * value is coerced to before validation.
 *
 * `decimal` and `bigint` are the two whose `js` is neither a number nor a
 * Date: they cross into JavaScript as exact decimal **strings**, because a
 * double undoes the column. `./exact.js` is where that is argued, and
 * sqlite -- which has neither an exact decimal nor a 64-bit integer a
 * driver hands back whole -- keeps the digits in a `text` column and casts
 * for a comparison. See `./dialects.js`.
 */
module.exports = {
  bigint: {
    js: 'bigint',
    mysql: 'bigint',
    postgres: 'bigint',
    sqlite: 'text (the digits)',
  },
  boolean: {
    js: 'boolean',
    mysql: 'boolean',
    postgres: 'boolean',
    sqlite: 'integer (0/1)',
  },
  date: {
    js: 'date',
    mysql: 'datetime(3)',
    postgres: 'timestamp with time zone',
    sqlite: 'integer (ms since epoch)',
  },
  decimal: {
    js: 'decimal',
    mysql: 'decimal(precision, scale)',
    postgres: 'numeric(precision, scale)',
    sqlite: 'text (the digits)',
  },
  float: {
    js: 'number',
    mysql: 'float',
    postgres: 'real',
    sqlite: 'real',
  },
  integer: {
    js: 'integer',
    mysql: 'int',
    postgres: 'integer',
    sqlite: 'integer',
  },
  json: {
    js: 'json',
    mysql: 'json',
    postgres: 'jsonb',
    sqlite: 'text (JSON)',
  },
  number: {
    js: 'number',
    mysql: 'double',
    postgres: 'double precision',
    sqlite: 'real',
  },
  string: {
    js: 'string',
    mysql: 'varchar(255)',
    postgres: 'varchar(255)',
    sqlite: 'text',
  },
  text: {
    js: 'string',
    mysql: 'text',
    postgres: 'text',
    sqlite: 'text',
  },
  uuid: {
    js: 'uuid',
    mysql: 'varchar(36)',
    postgres: 'uuid',
    sqlite: 'text',
  },
};
