const TYPES = require('./types');
const {
  canonical,
  canonicalInteger,
  compare,
  isExact,
  settingsOf,
} = require('./exact');
const { isPlainObject } = require('./utils');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thrown by the model layer when attributes fail validation
 *
 * `errors` maps each field to `{ kind, message, path, value }`, the shape
 * the generated controllers read (`detail.message`).
 *
 * @class ValidationError
 * @extends {Error}
 */
class ValidationError extends Error {
  /**
   * Creates an instance of ValidationError.
   *
   * @param {string} model The model name
   * @param {object} errors Errors by field
   * @memberof ValidationError
   */
  constructor(model, errors) {
    const details = Object.keys(errors)
      .map((field) => `${field}: ${errors[field].message}`)
      .join(', ');

    super(`${model} validation failed: ${details}`);
    this.name = 'ValidationError';
    this.model = model;
    this.errors = errors;
  }

  /**
   * The messages by field (for JSON answers)
   *
   * @returns {object} `{ field: message }`
   * @memberof ValidationError
   */
  toJSON() {
    return Object.fromEntries(
      Object.entries(this.errors).map(([field, error]) => [
        field,
        error.message,
      ])
    );
  }
}

/**
 * Builds one error entry
 *
 * @param {string} kind The validator that failed
 * @param {string} message The message
 * @param {string} path The field
 * @param {*} value The rejected value
 * @returns {object} The entry
 */
const failure = (kind, message, path, value) => ({
  kind,
  message,
  path,
  value,
});

/**
 * Is the value empty (missing for `required`)?
 *
 * @param {*} value A value
 * @returns {boolean} true for undefined, null and blank strings
 */
const isBlank = (value) =>
  typeof value === 'undefined' ||
  value === null ||
  (typeof value === 'string' && value.trim() === '');

/**
 * Coerces a value to the JavaScript type of a field
 *
 * @param {object} field The normalized field
 * @param {*} value The given value
 * @returns {{ value: *, error: ?string }} The coerced value or an error
 */
const coerce = (field, value) => {
  const kind = (TYPES[field.type] || TYPES.string).js;

  if (value === null || typeof value === 'undefined') {
    return { error: null, value };
  }

  switch (kind) {
    // The two the column keeps exactly and JavaScript cannot: they are
    // decimal strings on both sides of the boundary (see ./exact.js)
    case 'decimal': {
      const answer = canonical(value, settingsOf(field));

      return answer.error
        ? { error: answer.error, value }
        : { error: null, value: answer.value };
    }
    case 'bigint': {
      const answer = canonicalInteger(value);

      return answer.error
        ? { error: answer.error, value }
        : { error: null, value: answer.value };
    }
    case 'integer': {
      const number =
        typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : value;

      return Number.isInteger(number)
        ? { error: null, value: number }
        : { error: 'must be an integer', value };
    }
    case 'number': {
      const number =
        typeof value === 'string' && value.trim() !== ''
          ? Number(value)
          : value;

      return typeof number === 'number' && Number.isFinite(number)
        ? { error: null, value: number }
        : { error: 'must be a number', value };
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return { error: null, value };
      }

      const text = String(value).toLowerCase();

      if (['true', '1', 'on', 'yes'].includes(text)) {
        return { error: null, value: true };
      }
      if (['false', '0', 'off', 'no', ''].includes(text)) {
        return { error: null, value: false };
      }

      return { error: 'must be a boolean', value };
    }
    case 'date': {
      const date = value instanceof Date ? value : new Date(value);

      return Number.isNaN(date.getTime())
        ? { error: 'must be a date', value }
        : { error: null, value: date };
    }
    case 'uuid':
      return typeof value === 'string' && UUID.test(value)
        ? { error: null, value: value.toLowerCase() }
        : { error: 'must be a uuid', value };
    case 'json':
      return { error: null, value };
    default: {
      if (typeof value === 'string') {
        return { error: null, value };
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { error: null, value: String(value) };
      }

      return { error: 'must be a string', value };
    }
  }
};

/**
 * Runs the validators of a field on a coerced value
 *
 * @param {string} name The field name
 * @param {object} field The normalized field
 * @param {*} value The coerced value
 * @param {object} attrs Every attribute (for custom validators)
 * @returns {?object} An error entry or null
 */
const check = (name, field, value, attrs) => {
  if (Array.isArray(field.enum) && !field.enum.includes(value)) {
    return failure(
      'enum',
      `must be one of ${field.enum.join(', ')}`,
      name,
      value
    );
  }

  // An exact value is a string, so its bounds are compared digit by digit
  // rather than through the double the type exists to avoid
  if (isExact(field.type)) {
    if ('min' in field && compare(value, field.min) < 0) {
      return failure('min', `must be at least ${field.min}`, name, value);
    }
    if ('max' in field && compare(value, field.max) > 0) {
      return failure('max', `must be at most ${field.max}`, name, value);
    }

    return custom(name, field, value, attrs);
  }

  if (typeof value === 'number') {
    if (typeof field.min === 'number' && value < field.min) {
      return failure('min', `must be at least ${field.min}`, name, value);
    }
    if (typeof field.max === 'number' && value > field.max) {
      return failure('max', `must be at most ${field.max}`, name, value);
    }
  }

  if (typeof value === 'string') {
    if (typeof field.minLength === 'number' && value.length < field.minLength) {
      return failure(
        'minLength',
        `must be at least ${field.minLength} characters`,
        name,
        value
      );
    }
    if (typeof field.maxLength === 'number' && value.length > field.maxLength) {
      return failure(
        'maxLength',
        `must be at most ${field.maxLength} characters`,
        name,
        value
      );
    }
    if (field.match) {
      const [pattern, message] = Array.isArray(field.match)
        ? field.match
        : [field.match, 'is invalid'];

      if (!pattern.test(value)) {
        return failure('match', message, name, value);
      }
    }
  }

  return custom(name, field, value, attrs);
};

/**
 * Runs the `validate` function of a field, when it has one
 *
 * @param {string} name The field name
 * @param {object} field The normalized field
 * @param {*} value The coerced value
 * @param {object} attrs Every attribute
 * @returns {?object} An error entry or null
 */
function custom(name, field, value, attrs) {
  if (typeof field.validate !== 'function') {
    return null;
  }

  let result;

  try {
    result = field.validate(value, attrs);
  } catch (error) {
    result = error.message || 'is invalid';
  }

  if (result === false) {
    return failure('validate', 'is invalid', name, value);
  }

  return typeof result === 'string'
    ? failure('validate', result, name, value)
    : null;
}

/**
 * Validates and coerces attributes against normalized fields
 *
 * On a create (`partial: false`) missing fields get their default and
 * `required` fields must be present; on an update only the given fields are
 * checked. Unknown attributes are dropped (Mongoose strict mode).
 *
 * @param {string} model The model name (for the error)
 * @param {object} fields Normalized fields by name
 * @param {object} attrs The given attributes
 * @param {object} [options={}] Options
 * @param {boolean} [options.partial=false] An update: only check what is given
 * @param {Array<string>} [options.skip=[]] Fields never mass-assigned
 * @returns {object} The coerced values (only known fields)
 * @throws {ValidationError} When a field is invalid
 */
const validate = (
  model,
  fields,
  attrs,
  { partial = false, skip = [] } = {}
) => {
  const values = {};
  const errors = {};
  const input = isPlainObject(attrs) ? attrs : {};

  for (const name of Object.keys(fields)) {
    if (skip.includes(name)) {
      continue;
    }

    const field = fields[name];
    const given = Object.prototype.hasOwnProperty.call(input, name);
    let value = input[name];

    if (!given && partial) {
      continue;
    }

    if (isBlank(value) && !partial && typeof field.default !== 'undefined') {
      if (field.default === Date.now) {
        value = new Date();
      } else if (typeof field.default === 'function') {
        value = field.default();
      } else if (field.default !== null && typeof field.default === 'object') {
        value = structuredClone(field.default);
      } else {
        value = field.default;
      }
    }

    if (isBlank(value)) {
      if (field.required && (given || !partial)) {
        errors[name] = failure('required', 'is required', name, value);
      } else if (given) {
        values[name] = null;
      }

      continue;
    }

    const coerced = coerce(field, value);

    if (coerced.error) {
      errors[name] = failure(field.type, coerced.error, name, value);

      continue;
    }

    value = coerced.value;

    if (typeof value === 'string') {
      if (field.trim) {
        value = value.trim();
      }
      if (field.lowercase) {
        value = value.toLowerCase();
      }
    }

    const error = check(name, field, value, input);

    if (error) {
      errors[name] = error;

      continue;
    }

    values[name] = value;
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(model, errors);
  }

  return values;
};

module.exports = { ValidationError, coerce, failure, isBlank, validate };
