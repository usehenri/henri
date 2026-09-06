const { Schema } = require('mongoose');

/**
 * Schema type names of the henri model format and their Mongoose type
 *
 * A model file describes its fields with these names (`{ type: 'string' }`)
 * so the same definition works on every adapter; `normalizeSchema()` turns
 * them into Mongoose types. The SQL adapters map the same names in
 * `@usehenri/sequelize/types`. Anything else Mongoose accepts (constructors,
 * `'ObjectId'`, nested documents, arrays) is passed through untouched.
 *
 * - string:  String
 * - text:    String
 * - number:  Number
 * - integer: Number
 * - float:   Number
 * - decimal: Decimal128 (exact; a string in JavaScript, see ./exact.js)
 * - bigint:  BigInt, stored as a BSON 64-bit integer (a string in
 *   JavaScript too, for the same reason)
 * - boolean: Boolean
 * - date:    Date
 * - json:    Mixed
 * - uuid:    String (portable with the SQL adapters)
 *
 * The two exact ones are the only names whose JavaScript value is not what
 * Mongoose hands back: a `Decimal128` and a `BigInt` are turned into the
 * decimal string every adapter answers with, by the hooks of
 * `./exact-paths.js`.
 */
module.exports = {
  bigint: Schema.Types.BigInt,
  boolean: Boolean,
  date: Date,
  decimal: Schema.Types.Decimal128,
  float: Number,
  integer: Number,
  json: Schema.Types.Mixed,
  number: Number,
  string: String,
  text: String,
  uuid: String,
};
