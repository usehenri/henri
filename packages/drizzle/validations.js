/**
 * What must be true of a record, declared once and meant once.
 *
 * A model file says it in a `validates` block, keyed by field, in the
 * vocabulary the request boundaries already use (`base/params-schema.js`):
 *
 * ```js
 * module.exports = {
 *   schema: {
 *     email: { type: 'string', required: true, unique: true },
 *     age: { type: 'integer' },
 *     status: { type: 'string', enum: ['draft', 'live'] },
 *   },
 *   validates: {
 *     age: { max: 120, min: 18 },
 *     email: { maxLength: 120, pattern: /^[^@\s]+@[^@\s]+$/u },
 *     status: { validate: (value, record) => value !== 'live' || record.body },
 *   },
 * };
 * ```
 *
 * ## Why this file exists at all
 *
 * The three ORMs each have validations and no two of them mean the same
 * thing. Measured, not assumed:
 *
 * - **Mongoose** runs its path validators on `save()`, `create()` and
 *   `insertMany()` and on **nothing else**. `updateOne`, `updateMany`,
 *   `findOneAndUpdate` and `findByIdAndUpdate` write straight past
 *   `required` and `enum` -- a `null` lands in a required column and a
 *   value outside the enum lands in the document -- unless the *caller*
 *   remembers `runValidators: true` on that one call.
 * - **Sequelize** validates `create`, `save`, `update` and the mass
 *   `Model.update`, skips `bulkCreate` (its `validate` defaults to
 *   `false`, so a value outside an `enum` is written), and on the dialects
 *   with a native `ENUM` column has no JavaScript check at all -- the
 *   server refuses it, as a `SequelizeDatabaseError` that
 *   `henri.model.errors()` does not recognize, so the same model file
 *   answers 422 on sqlite and 500 on PostgreSQL.
 * - **Drizzle** validates every write it exposes, including the mass ones.
 *
 * So `required` and `enum` -- two keys the models guide says mean the same
 * thing on every adapter -- did not. This module is what makes them, and
 * it is the only implementation of the rules an application declares.
 *
 * ## One vocabulary
 *
 * The keys are the ones a controller's `params` block already takes, and
 * they mean the same thing here: `required`, `enum`, `min`, `max`,
 * `minLength`, `maxLength`, `pattern`, plus `validate`, a function of the
 * value (and, when it asks for one, the record). There is no `type`: the
 * schema next door already says it, and a constraint that means nothing
 * for that type (`min` on a `string`, `maxLength` on an `integer`) fails
 * the boot rather than being ignored.
 *
 * The schema's own `required` and `enum` are read into the same rules, so
 * an application that never writes a `validates` block still gets one
 * meaning for those two on every adapter and every write path.
 *
 * ## Where this belongs, and where it does not
 *
 * `req.permit()` and a controller's `params` block check what **arrives**:
 * they are about a request, they coerce a query string, and they answer
 * 422 before an action runs. This checks what is **written**, and a record
 * is written by a job, a seed, a console and a webhook delivery as often
 * as by a request. The two compose -- neither replaces the other -- and
 * the guide says so where a person is deciding.
 *
 * ## What is refused rather than pretended
 *
 * A `validate` function that declares a second parameter is asking for the
 * record, and a mass write has none: the same predicate `base/policies.js`
 * uses for a rule that wants a record. Rather than calling it with
 * `undefined` and recording a pass, a mass write on such a model is
 * refused (`HENRI_MODEL_VALIDATION_MASS_WRITE`), which is the answer
 * `HENRI_VERSION_MASS_WRITE` already gives to the same shape of problem.
 * Every other rule reads only the value being written, so a mass write
 * checks them exactly as a single write does.
 *
 * ## Uniqueness is not here, deliberately
 *
 * `unique` stays what it is: an index, and a race. A `SELECT` before an
 * `INSERT` answers a question about a moment that has passed by the time
 * the row is written, so a check would turn a guarantee the database
 * keeps into a message henri sometimes produces. The database refuses the
 * duplicate, and `henri.model.errors()` turns that refusal into
 * `{ field: 'must be unique' }` on all three adapters, which is the same
 * shape as everything here.
 *
 * ## A copy per adapter
 *
 * This file is held four times -- here and in `@usehenri/drizzle`,
 * `@usehenri/mongoose` and `@usehenri/sequelize` -- byte for byte, the way
 * `exact.js` and `external-id.js` are, because an adapter depends on no
 * part of core at runtime. `src/__tests__/validations.spec.js` is what
 * keeps them the same file. It requires nothing but `./exact`, which is
 * held the same way, and raises its codes through a `coded()` of its own
 * for the same reason.
 */

const { compare, isExact } = require('./exact');

/** The failure a model declaration henri cannot carry out gets */
const INVALID = 'HENRI_MODEL_VALIDATION_INVALID';

/** The failure a mass write on a record-aware validator gets */
const MASS_WRITE = 'HENRI_MODEL_VALIDATION_MASS_WRITE';

/** The failure a write no hook of the ORM reaches gets */
const UNCHECKED = 'HENRI_MODEL_VALIDATION_UNCHECKED_WRITE';

/** The henri schema types, so a constraint can be bound to one */
const TYPES = [
  'bigint',
  'boolean',
  'date',
  'decimal',
  'float',
  'integer',
  'json',
  'number',
  'string',
  'text',
  'uuid',
];

/**
 * The types each constraint applies to. `required`, `enum` and `validate`
 * apply to every type, so they are not in here (see KEYS).
 */
const APPLIES = {
  max: ['bigint', 'decimal', 'float', 'integer', 'number'],
  maxLength: ['string', 'text'],
  min: ['bigint', 'decimal', 'float', 'integer', 'number'],
  minLength: ['string', 'text'],
  pattern: ['string', 'text'],
};

/** The keys every field takes, whatever its type */
const ANY = ['enum', 'required', 'validate'];

/** Every key a `validates` entry may hold */
const KEYS = [...ANY, ...Object.keys(APPLIES)].sort();

/**
 * An error carrying a henri code, without depending on core
 *
 * @param {string} code the henri error code
 * @param {string} message what is wrong
 * @returns {Error} the error to throw
 */
const coded = (code, message) => Object.assign(new Error(message), { code });

/**
 * Is the value a plain object?
 *
 * @param {*} value any value
 * @returns {boolean} true for a plain object
 */
const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

/**
 * Is the value missing, for `required`?
 *
 * Rails' `presence`, and what Mongoose and Drizzle already answer: a
 * string of nothing but spaces is a field a person left empty, not a
 * value. Sequelize's `allowNull` alone would have written it.
 *
 * @param {*} value the value
 * @returns {boolean} true when there is nothing there
 */
const isBlank = (value) =>
  typeof value === 'undefined' ||
  value === null ||
  (typeof value === 'string' && value.trim() === '');

/**
 * `a string`, `an integer`: the article a message needs
 *
 * @param {string} type the type
 * @returns {string} the type with its article
 */
const article = (type) => (/^[aeiou]/u.test(type) ? `an ${type}` : `a ${type}`);

/**
 * The henri type a field declares, when it declares one henri knows
 *
 * A model file may write a type this file has no opinion about -- a
 * Mongoose `ObjectId`, a Sequelize `DataTypes.STRING(50)`, a nested
 * document -- and a constraint that measures a number or a length has
 * nothing to measure there. Those fields still take `required`, `enum`
 * and `validate`, which need no type at all.
 *
 * @param {*} definition the field definition from the model file
 * @returns {?string} the henri type name, or null
 */
const typeOf = (definition) => {
  const type = isPlainObject(definition) ? definition.type : definition;

  if (typeof type !== 'string') {
    return null;
  }

  const name = type.toLowerCase();

  return TYPES.includes(name) ? name : null;
};

/**
 * Refuses a declaration, naming the model and the field
 *
 * @param {string} model the model's global id
 * @param {string} field the field name
 * @param {string} what what is wrong with it
 * @returns {void} never returns
 * @throws {Error} always, HENRI_MODEL_VALIDATION_INVALID
 */
const refuse = (model, field, what) => {
  throw coded(INVALID, `${model} declares \`validates.${field}\` with ${what}`);
};

/**
 * Checks and freezes one field's rule
 *
 * @param {string} model the model's global id
 * @param {string} field the field name
 * @param {object} written what the model file wrote
 * @param {?string} type the henri type of the field, when it has one
 * @returns {object} the compiled rule
 * @throws {Error} HENRI_MODEL_VALIDATION_INVALID on anything unusable
 */
const ruleOf = (model, field, written, type) => {
  if (!isPlainObject(written)) {
    refuse(
      model,
      field,
      `${written === null ? 'null' : typeof written}: a rule is an object of ${KEYS.join(', ')}`
    );
  }

  const compiled = { type };

  for (const [key, value] of Object.entries(written)) {
    if (!KEYS.includes(key)) {
      refuse(
        model,
        field,
        `the unknown key "${key}": a rule takes ${KEYS.join(', ')}`
      );
    }

    if (APPLIES[key] && !APPLIES[key].includes(type)) {
      refuse(
        model,
        field,
        type === null
          ? `"${key}", which needs a type henri knows: the field declares one henri has no bounds for, so it takes ${ANY.join(', ')} only`
          : `"${key}", which ${article(type)} does not take: ${key} is for ${APPLIES[key].join(', ')}`
      );
    }

    compiled[key] = value;
  }

  for (const key of ['max', 'maxLength', 'min', 'minLength']) {
    if (!(key in compiled)) {
      continue;
    }

    // The bound of an exact field may be written out, the way its values
    // are, so a limit past what a double carries can be declared at all
    const exact =
      isExact(type) && (key === 'max' || key === 'min')
        ? typeof compiled[key] === 'string'
        : false;

    if (!exact && typeof compiled[key] !== 'number') {
      refuse(model, field, `a "${key}" that is not a number`);
    }
  }

  if ('pattern' in compiled && !(compiled.pattern instanceof RegExp)) {
    refuse(model, field, 'a "pattern" that is not a regular expression');
  }

  if ('required' in compiled && typeof compiled.required !== 'boolean') {
    refuse(model, field, 'a "required" that is not true or false');
  }

  if ('enum' in compiled) {
    if (!Array.isArray(compiled.enum) || compiled.enum.length === 0) {
      refuse(model, field, 'an "enum" that is not a list of values');
    }
  }

  if ('validate' in compiled && typeof compiled.validate !== 'function') {
    refuse(
      model,
      field,
      'a "validate" that is not a function: write `(value, record) => true` or a message'
    );
  }

  return Object.freeze(compiled);
};

/**
 * Everything a model says must be true of its records.
 *
 * The `validates` block, plus the `required` and `enum` the schema
 * already declares -- those two are checked here on every adapter and
 * every write path, which is the whole point of the file.
 *
 * @param {object} model the model file (`globalId`, `schema`, `validates`)
 * @returns {?object} the rules by field, or null when there are none
 * @throws {Error} HENRI_MODEL_VALIDATION_INVALID on a declaration henri
 *   cannot carry out
 */
const validationsOf = (model = {}) => {
  const name = model.globalId || model.identity || 'the model';
  const schema = isPlainObject(model.schema) ? model.schema : {};
  const written = model.validates;

  if (typeof written !== 'undefined' && !isPlainObject(written)) {
    throw coded(
      INVALID,
      `${name} declares \`validates\` as ${
        written === null ? 'null' : typeof written
      }: it is an object keyed by field`
    );
  }

  const rules = {};

  for (const field of Object.keys(schema)) {
    const definition = schema[field];
    const type = typeOf(definition);
    const lifted = {};

    if (isPlainObject(definition)) {
      // `allowNull: false` is the Sequelize spelling of `required`, and
      // the mongoose adapter accepts it too, so it is the same rule here
      if (definition.required === true || definition.allowNull === false) {
        lifted.required = true;
      }

      if (Array.isArray(definition.enum)) {
        lifted.enum = definition.enum;
      }
    }

    const declared = (written && written[field]) || null;

    if (!declared && Object.keys(lifted).length === 0) {
      continue;
    }

    rules[field] = ruleOf(
      name,
      field,
      // A rule that is not an object at all is handed over as it is, so
      // the refusal says what it was rather than spreading it into one
      isPlainObject(declared) ? { ...lifted, ...declared } : declared || lifted,
      type
    );
  }

  for (const field of Object.keys(written || {})) {
    if (!rules[field]) {
      throw coded(
        INVALID,
        `${name} declares \`validates.${field}\`, which its schema has no field for: ${
          Object.keys(schema).join(', ') || 'the schema is empty'
        }`
      );
    }
  }

  return Object.keys(rules).length > 0 ? Object.freeze(rules) : null;
};

/**
 * Does any rule want the record, rather than only the value?
 *
 * The predicate is the arity of the function, the way `base/policies.js`
 * reads a rule that declares a record parameter. It is what a mass write
 * is measured against -- and it is measured against the fields that write
 * actually names, so a soft delete stamping `deletedAt` on a thousand rows
 * is not refused by a rule about somebody's email address.
 *
 * @param {?object} rules the compiled rules
 * @param {object} [values] the values being written, when there are some
 * @returns {Array<string>} the fields whose rule asks for the record
 */
const wantsRecord = (rules, values) => {
  if (!rules) {
    return [];
  }

  const named = isPlainObject(values)
    ? Object.keys(values)
    : Object.keys(rules);

  return named.filter(
    (field) =>
      rules[field] &&
      typeof rules[field].validate === 'function' &&
      rules[field].validate.length >= 2
  );
};

/**
 * The bounds of a rule, once there is a value to measure
 *
 * @param {object} rule the compiled rule
 * @param {*} value the value being written
 * @returns {?string} what is wrong with it, or null
 */
const bounds = (rule, value) => {
  const { max, maxLength, min, minLength, pattern } = rule;

  // An exact value is a string of digits, so `<` would compare it letter
  // by letter and answer that 9.99 is more than 10 (see ./exact.js)
  if (isExact(rule.type) && typeof value === 'string') {
    if (typeof min !== 'undefined' && compare(value, min) < 0) {
      return `must be at least ${min}`;
    }

    if (typeof max !== 'undefined' && compare(value, max) > 0) {
      return `must be at most ${max}`;
    }

    return null;
  }

  if (typeof value === 'number') {
    if (typeof min === 'number' && value < min) {
      return `must be at least ${min}`;
    }

    if (typeof max === 'number' && value > max) {
      return `must be at most ${max}`;
    }
  }

  if (typeof value === 'string') {
    if (typeof minLength === 'number' && value.length < minLength) {
      return `must be at least ${minLength} characters`;
    }

    if (typeof maxLength === 'number' && value.length > maxLength) {
      return `must be at most ${maxLength} characters`;
    }

    if (pattern && !pattern.test(value)) {
      return 'is not in the expected format';
    }
  }

  return null;
};

/**
 * One value through one rule
 *
 * @param {object} rule the compiled rule
 * @param {*} value the value being written
 * @param {*} record the record, for a validator that asked for one
 * @returns {?string} the message, or null when the value is fine
 */
const problem = (rule, value, record) => {
  if (isBlank(value)) {
    return rule.required ? 'is required' : null;
  }

  const wrong = bounds(rule, value);

  if (wrong) {
    return wrong;
  }

  if (rule.enum && !rule.enum.includes(value)) {
    return `must be one of ${rule.enum.join(', ')}`;
  }

  if (typeof rule.validate !== 'function') {
    return null;
  }

  let answer;

  try {
    answer = rule.validate(value, record);
  } catch (error) {
    return (error && error.message) || 'is invalid';
  }

  if (typeof answer === 'string') {
    return answer;
  }

  return answer === false ? 'is invalid' : null;
};

/**
 * Everything wrong with the values being written
 *
 * @param {?object} rules the compiled rules
 * @param {object} values the attributes being written
 * @param {object} [options={}] options
 * @param {boolean} [options.partial=false] an update: a field the write
 *   does not name is left alone rather than treated as absent
 * @param {*} [options.record] the record, for a validator that asked
 * @returns {?object} `{ field: message }`, or null when nothing is wrong
 */
const problemsOf = (rules, values, { partial = false, record } = {}) => {
  if (!rules) {
    return null;
  }

  const given = isPlainObject(values) ? values : {};
  const errors = {};

  for (const field of Object.keys(rules)) {
    const has = Object.prototype.hasOwnProperty.call(given, field);

    if (!has && partial) {
      continue;
    }

    const wrong = problem(rules[field], given[field], record);

    if (wrong) {
      errors[field] = wrong;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
};

/**
 * The refusal a mass write gets on a model whose validator wants a record
 *
 * @param {string} model the model's global id
 * @param {string} what the call that was made (`update`, `updateMany`)
 * @param {string} instead the single-record call to loop over
 * @returns {Error} the error to throw
 */
const massWrite = (model, what, instead, fields = []) =>
  coded(
    MASS_WRITE,
    `${model}.${what}() writes many rows at once, and ${
      fields.length > 0 ? fields.join(', ') : 'a field'
    } of ${model} is validated by a rule that asks for the record. ` +
      `A mass write has no records to give it, so henri refuses rather than recording a pass it never made. ` +
      `Loop instead: for (const record of await ${model}.find(where)) await record.${instead}`
  );

/**
 * The refusal a write the ORM runs no hook for gets
 *
 * Sequelize's `increment`/`decrement` and Mongoose's `bulkWrite` reach the
 * database without any middleware at all, so a rule declared on a field
 * they write would be a promise henri does not keep. Neither call exists
 * on all three adapters, so neither is part of what a `validates` block
 * means; a model that declares one and calls the other is told so.
 *
 * @param {string} model the model's global id
 * @param {string} what the call that was made
 * @param {string} instead what to do instead
 * @returns {Error} the error to throw
 */
const uncheckedWrite = (model, what, instead) =>
  coded(
    UNCHECKED,
    `${model}.${what}() writes without running any of the ORM's hooks, so henri cannot check what it writes, and ${model} declares validations for it. ${instead}`
  );

module.exports = {
  ANY,
  APPLIES,
  INVALID,
  KEYS,
  MASS_WRITE,
  TYPES,
  UNCHECKED,
  coded,
  isBlank,
  massWrite,
  problemsOf,
  uncheckedWrite,
  validationsOf,
  wantsRecord,
};
