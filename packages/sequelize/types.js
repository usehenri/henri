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
 * - boolean: boolean
 * - date:    date and time
 * - json:    any JSON value (Mongoose `Mixed`); TEXT on dialects without JSON
 * - uuid:    UUID string
 */
module.exports = {
  boolean: DataTypes.BOOLEAN,
  date: DataTypes.DATE,
  float: DataTypes.FLOAT,
  integer: DataTypes.INTEGER,
  json: DataTypes.JSON,
  number: DataTypes.DOUBLE,
  string: DataTypes.STRING,
  text: DataTypes.TEXT,
  uuid: DataTypes.UUID,
};
