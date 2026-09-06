const { DataTypes } = require('sequelize');

/**
 * Schema type names of the henri model format and their Sequelize data type
 *
 * A model file describes its fields with these names (`{ type: 'string' }`)
 * so the same definition works on every adapter; `normalizeSchema()` turns
 * them into Sequelize attributes. The Mongoose adapter maps the same names in
 * `@usehenri/mongoose/types`.
 *
 * - string:  short text (VARCHAR(255))
 * - text:    long text
 * - number:  double precision float (Mongoose `Number`)
 * - integer: integer
 * - float:   single precision float
 * - decimal: DECIMAL(precision, scale), exact
 * - bigint:  BIGINT, a signed 64-bit integer
 * - boolean: boolean
 * - date:    date and time
 * - json:    any JSON value (Mongoose `Mixed`); TEXT on dialects without JSON
 * - uuid:    UUID string
 *
 * The two exact ones are here as the *class*, not an instance: a decimal
 * carries a precision and a scale, so `schema.js` builds `DECIMAL(p, s)`
 * from the field. It is also where they are refused on sqlite, which this
 * adapter cannot carry either type on -- see ./exact.js and ./schema.js.
 */
module.exports = {
  bigint: DataTypes.BIGINT,
  boolean: DataTypes.BOOLEAN,
  date: DataTypes.DATE,
  decimal: DataTypes.DECIMAL,
  float: DataTypes.FLOAT,
  integer: DataTypes.INTEGER,
  json: DataTypes.JSON,
  number: DataTypes.DOUBLE,
  string: DataTypes.STRING,
  text: DataTypes.TEXT,
  uuid: DataTypes.UUID,
};
