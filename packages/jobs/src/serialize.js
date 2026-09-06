const { JobArgumentError } = require('./errors');

/**
 * Arguments travel through the database as JSON, so they have to survive a
 * round trip through `JSON.stringify`. `JSON.stringify` drops functions and
 * `undefined` silently and turns a `Date` into a string without saying so,
 * which is exactly the kind of thing that is discovered in production three
 * weeks later: this module refuses what cannot be stored, naming the path.
 */

/** How big the serialized arguments of one job may get */
const MAX_BYTES = 512 * 1024;

/**
 * A readable path for an error message (`args.user.id`)
 *
 * @param {Array<string>} parts The path segments
 * @returns {string} The path
 */
const label = (parts) =>
  parts.length === 0 ? 'args' : `args.${parts.join('.')}`;

/**
 * Walks a value and throws on anything JSON cannot carry
 *
 * @param {*} value The value to check
 * @param {Array<string>} path Where it sits in the arguments
 * @param {Set} seen The objects already visited on this branch
 * @returns {void}
 * @throws {JobArgumentError} When the value cannot be stored
 */
const walk = (value, path, seen) => {
  const type = typeof value;

  if (value === null || type === 'string' || type === 'boolean') {
    return;
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new JobArgumentError(
        `${label(path)} is ${String(value)}, which JSON stores as null`,
        { path: label(path) }
      );
    }

    return;
  }

  if (type === 'undefined') {
    throw new JobArgumentError(
      `${label(path)} is undefined, which JSON drops silently: use null`,
      { path: label(path) }
    );
  }

  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new JobArgumentError(
      `${label(path)} is a ${type}, which cannot be stored: pass a plain value`,
      { path: label(path) }
    );
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new JobArgumentError(`${label(path)} is an invalid Date`, {
        path: label(path),
      });
    }

    return;
  }

  if (seen.has(value)) {
    throw new JobArgumentError(
      `${label(path)} is a circular reference, which cannot be stored`,
      { path: label(path) }
    );
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, [...path, index], seen));
    seen.delete(value);

    return;
  }

  const prototype = Object.getPrototypeOf(value);

  if (prototype !== Object.prototype && prototype !== null) {
    // A model instance, a Map, a Buffer: JSON keeps a shape nobody expects
    const kind = value.constructor ? value.constructor.name : 'object';

    throw new JobArgumentError(
      `${label(path)} is a ${kind} instance, which cannot be stored: pass its id or a plain object`,
      { path: label(path) }
    );
  }

  for (const key of Object.keys(value)) {
    walk(value[key], [...path, key], seen);
  }

  seen.delete(value);
};

/**
 * Turns the arguments of a job into the JSON stored in the queue
 *
 * Strings, finite numbers, booleans, null, plain objects, arrays and `Date`
 * (stored as its ISO string) are accepted. Anything else -- `undefined`, a
 * function, a symbol, a bigint, NaN, a circular reference, an instance of a
 * class (a model, a Buffer, a Map) -- is refused with the path that holds it.
 *
 * @param {*} [args] The arguments given to perform()
 * @param {object} [options={}] Options
 * @param {number} [options.maxBytes=524288] The size limit of the JSON
 * @returns {string} The JSON to store
 * @throws {JobArgumentError} When the arguments cannot be stored
 */
const serialize = (args, options = {}) => {
  const maxBytes = options.maxBytes || MAX_BYTES;
  const value = typeof args === 'undefined' ? null : args;

  walk(value, [], new Set());

  const json = JSON.stringify(value);
  const size = Buffer.byteLength(json, 'utf8');

  if (size > maxBytes) {
    throw new JobArgumentError(
      `arguments are ${size} bytes, over the ${maxBytes} bytes limit: store the payload and pass its id`,
      { path: 'args' }
    );
  }

  return json;
};

/**
 * Reads back what serialize() stored
 *
 * Nothing readable answers null, which is what a listing wants. A runner
 * asks for `strict`: performing a job with `null` arguments because the
 * column truncated them would be worse than failing the attempt.
 *
 * @param {?string} json The stored JSON
 * @param {object} [options={}] `strict` throws on unreadable JSON
 * @returns {*} The arguments (null when there were none)
 * @throws {JobArgumentError} With `strict`, when the JSON cannot be read
 */
const deserialize = (json, options = {}) => {
  if (json === null || typeof json === 'undefined' || json === '') {
    return null;
  }

  if (typeof json !== 'string') {
    return json;
  }

  try {
    return JSON.parse(json);
  } catch (error) {
    if (options.strict) {
      throw new JobArgumentError(
        `the stored arguments are not readable JSON (${json.length} bytes): they were written by an older version, or the column truncated them`,
        { cause: error, path: 'args' }
      );
    }

    return null;
  }
};

module.exports = { MAX_BYTES, deserialize, serialize };
