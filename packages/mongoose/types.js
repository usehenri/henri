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
 * - boolean: Boolean
 * - date:    Date
 * - json:    Mixed
 * - uuid:    String (portable with the SQL adapters)
 */
module.exports = {
  boolean: Boolean,
  date: Date,
  float: Number,
  integer: Number,
  json: Schema.Types.Mixed,
  number: Number,
  string: String,
  text: String,
  uuid: String,
};
