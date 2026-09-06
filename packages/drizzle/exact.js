/**
 * The two henri types a JavaScript `number` cannot carry: `decimal` and
 * `bigint`.
 *
 * Every other type in the vocabulary has a JavaScript value that *is* the
 * value: a `string` is a string, a `date` is a Date, an `integer` under
 * 2^53 is a number. These two do not. A `numeric(19, 4)` read into a double
 * is a float again, a `bigint` past `Number.MAX_SAFE_INTEGER` loses digits,
 * and in both cases the column choice is undone by the round trip -- which
 * is the whole reason the types exist.
 *
 * ## The boundary is a string, on all three adapters
 *
 * A value of an exact type crosses into JavaScript as a **decimal string**:
 * `'19.99'`, `'-1'`, `'9223372036854775807'`. Never a `number`, never a
 * `BigInt`, never an object of henri's own. The reasons, in order:
 *
 * - `JSON.stringify` throws on a `BigInt`. henri serializes model records in
 *   `res.render`, `res.resource`, `res.collection`, the cache (which refuses
 *   what it cannot encode), the call log, the version diffs, the trail, the
 *   job payloads and GraphQL. A `BigInt` escaping into any of them is a
 *   TypeError raised deep inside express, after the controller returned --
 *   a worse silent difference than the one being removed.
 * - A decimal object needs a dependency, and it would not survive JSON
 *   either. henri ships no arithmetic: an application that wants to add two
 *   prices picks its own library, and hands henri back a string.
 * - It is the shortest path, not a conversion. node-postgres already hands
 *   back `numeric` and `int8` as strings, mysql2 hands back `DECIMAL` as a
 *   string, and `Decimal128.toString()` is exact. Turning any of those into
 *   a number is what loses the value.
 * - A string is exact, comparable for equality, JSON-safe, and identical on
 *   the three adapters -- which is what makes a model file mean one thing
 *   everywhere.
 *
 * ## What is accepted on the way in
 *
 * A string (a decimal literal, exponent form included), a `number`, and --
 * for `bigint` -- a `BigInt`. A number goes through `String(value)`, which
 * is the shortest representation that round-trips, so the literal a person
 * typed survives: `String(19.99)` is `'19.99'`. What does *not* survive is
 * arithmetic that already lost the value, and that is the point:
 * `0.1 + 0.2` arrives as `'0.30000000000000004'` and is refused by the
 * scale rather than rounded into the column. henri does not round money.
 *
 * ## What is refused
 *
 * More decimal places than the declared `scale` (after the trailing zeros,
 * which are not information), more digits before the point than
 * `precision - scale`, a `bigint` outside the signed 64-bit range, and a
 * `number` that is not a safe integer where a whole number was asked for.
 * Each one is a value the database would have quietly changed.
 *
 * This file is duplicated into each adapter (`packages/<adapter>/exact.js`)
 * the way `external-id.js` and `encrypted.js` are: an adapter depends on no
 * part of core at runtime. The copies are byte identical and
 * `src/__tests__/exact.spec.js` is what keeps them so.
 *
 * @module exact
 */

/** The henri types whose values are exact, and therefore strings */
const EXACT_TYPES = Object.freeze(['bigint', 'decimal']);

/** Total digits of a `decimal` when the field does not say */
const DEFAULT_PRECISION = 19;

/** Digits after the point when the field does not say */
const DEFAULT_SCALE = 4;

/**
 * The most digits every dialect henri writes carries: SQL Server stops at
 * 38, MySQL at 65, PostgreSQL at 1000. The smallest is the one a model may
 * ask for, so the same file works everywhere.
 */
const MAX_PRECISION = 38;

/** The bounds of a signed 64-bit integer, as the strings a message prints */
const BIGINT_MIN = '-9223372036854775808';

/** ... and the other end */
const BIGINT_MAX = '9223372036854775807';

const MIN = BigInt(BIGINT_MIN);
const MAX = BigInt(BIGINT_MAX);

/** A decimal literal and nothing else: no `0x10`, no `Infinity`, no `1n` */
const LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/** A whole number, written out */
const WHOLE = /^[+-]?\d+$/u;

/** A literal in exponent form, split into its parts */
const EXPONENT = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/u;

/** A literal written out, split into its parts */
const PLAIN = /^([+-]?)(\d*)(?:\.(\d*))?$/u;

/**
 * Is this one of the exact types?
 *
 * @param {*} type a type name
 * @returns {boolean} true for `decimal` and `bigint`
 */
const isExact = (type) => EXACT_TYPES.includes(type);

/**
 * The same literal without its exponent, so everything below is string work
 *
 * @param {string} text a decimal literal
 * @returns {string} the literal written out
 */
function expand(text) {
  const match = EXPONENT.exec(text);

  if (!match) {
    return text;
  }

  const [, sign, whole, fraction = '', exponent] = match;
  const digits = `${whole}${fraction}`;
  const point = whole.length + Number(exponent);

  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }

  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }

  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * A value as a decimal literal written out, or null when it is not a number
 *
 * @param {*} value a string, a number or a BigInt
 * @returns {?string} the literal, or null
 */
function literalOf(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? expand(String(value)) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  return LITERAL.test(text) ? expand(text) : null;
}

/**
 * A literal split into a sign, the digits before the point and the ones
 * after it
 *
 * @param {string} literal a literal written out
 * @returns {?object} `{ negative, whole, fraction }`, or null
 */
function split(literal) {
  const match = PLAIN.exec(literal);

  if (!match) {
    return null;
  }

  const [, sign, whole, fraction = ''] = match;

  if (whole === '' && fraction === '') {
    return null;
  }

  return {
    fraction,
    negative: sign === '-',
    whole: whole === '' ? '0' : whole,
  };
}

/**
 * The `precision` and `scale` of a decimal field, defaulted
 *
 * @param {object} [field] the normalized field
 * @returns {{precision: number, scale: number}} what the column carries
 */
const settingsOf = (field) => ({
  precision: Number.isInteger(field && field.precision)
    ? field.precision
    : DEFAULT_PRECISION,
  scale: Number.isInteger(field && field.scale) ? field.scale : DEFAULT_SCALE,
});

/**
 * What is wrong with the `precision` and `scale` a field declares, if
 * anything. An adapter raises its own coded error with the sentence.
 *
 * @param {string} type the henri type of the field
 * @param {object} [field] the field definition
 * @returns {?string} what is wrong, or null
 */
function checkSettings(type, field) {
  const given = field || {};
  const declared = ['precision', 'scale'].filter((key) => key in given);

  if (type !== 'decimal') {
    return declared.length > 0
      ? `takes no '${declared[0]}': only a decimal has one`
      : null;
  }

  for (const key of declared) {
    if (!Number.isInteger(given[key]) || given[key] < 0) {
      return `has a '${key}' that is not a whole number`;
    }
  }

  const { precision, scale } = settingsOf(given);

  if (precision < 1 || precision > MAX_PRECISION) {
    return `has a 'precision' of ${precision}: it is between 1 and ${MAX_PRECISION}, the most every dialect henri writes carries`;
  }

  if (scale > precision) {
    return `has a 'scale' of ${scale}, which is more than its precision of ${precision}`;
  }

  return null;
}

/**
 * A decimal value as the exact string the column holds, at its scale
 *
 * @param {*} value what the application passed
 * @param {object} settings `{ precision, scale }`
 * @returns {{value: string}|{error: string}} the value, or what is wrong
 */
function canonical(value, settings) {
  const { precision, scale } = settings;
  const literal = literalOf(value);
  const parts = literal === null ? null : split(literal);

  if (!parts) {
    return { error: 'must be a decimal number' };
  }

  const fraction = parts.fraction.replace(/0+$/u, '');

  if (fraction.length > scale) {
    return {
      error:
        scale === 0
          ? 'must be a whole number'
          : `must have at most ${scale} decimal place${
              scale === 1 ? '' : 's'
            }, and rounding is the application's to do`,
    };
  }

  const whole = parts.whole.replace(/^0+(?=\d)/u, '');
  const digits = precision - scale;

  if (whole !== '0' && whole.length > digits) {
    return {
      error: `must have at most ${digits} digit${
        digits === 1 ? '' : 's'
      } before the decimal point`,
    };
  }

  const padded = fraction.padEnd(scale, '0');
  const body = scale > 0 ? `${whole}.${padded}` : whole;
  const zero = whole === '0' && !/[1-9]/u.test(padded);

  return { value: `${parts.negative && !zero ? '-' : ''}${body}` };
}

/**
 * A bigint value as the exact string the column holds
 *
 * @param {*} value what the application passed
 * @returns {{value: string}|{error: string}} the value, or what is wrong
 */
function canonicalInteger(value) {
  if (typeof value === 'bigint') {
    return bounded(value);
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { error: 'must be a whole number' };
    }

    return Number.isSafeInteger(value)
      ? bounded(BigInt(value))
      : {
          error:
            'is past what a javascript number carries exactly: pass it as a string',
        };
  }

  if (typeof value !== 'string' || !WHOLE.test(value.trim())) {
    return { error: 'must be a whole number' };
  }

  return bounded(BigInt(value.trim()));
}

/**
 * The value, when it fits a signed 64-bit column
 *
 * @param {bigint} value the value
 * @returns {{value: string}|{error: string}} the value, or what is wrong
 */
function bounded(value) {
  return value < MIN || value > MAX
    ? { error: `must be between ${BIGINT_MIN} and ${BIGINT_MAX}` }
    : { value: value.toString() };
}

/**
 * Two exact numbers compared without going through a double
 *
 * @param {*} left one value
 * @param {*} right the other
 * @returns {?number} -1, 0 or 1, and null when either is not a number
 */
function compare(left, right) {
  const one = literalOf(left);
  const two = literalOf(right);
  const first = one === null ? null : split(one);
  const second = two === null ? null : split(two);

  if (!first || !second) {
    return null;
  }

  // A zero has no sign to compare, so `-0` and `0` are the same value
  const below = first.negative && !isZero(first);
  const under = second.negative && !isZero(second);

  if (below !== under) {
    return below ? -1 : 1;
  }

  const size = magnitude(first, second);

  return below ? -size : size;
}

/**
 * Is this value zero, whatever it was written as?
 *
 * @param {object} parts a split literal
 * @returns {boolean} true for every spelling of zero
 */
const isZero = (parts) =>
  !/[1-9]/u.test(parts.whole) && !/[1-9]/u.test(parts.fraction);

/**
 * The two magnitudes compared, sign left out
 *
 * @param {object} first a split literal
 * @param {object} second another
 * @returns {number} -1, 0 or 1
 */
function magnitude(first, second) {
  const left = first.whole.replace(/^0+(?=\d)/u, '');
  const right = second.whole.replace(/^0+(?=\d)/u, '');

  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }

  if (left !== right) {
    return left < right ? -1 : 1;
  }

  const size = Math.max(first.fraction.length, second.fraction.length);
  const one = first.fraction.padEnd(size, '0');
  const two = second.fraction.padEnd(size, '0');

  if (one === two) {
    return 0;
  }

  return one < two ? -1 : 1;
}

/**
 * The double a dialect without an exact type has to compare through
 *
 * @param {*} value an exact value
 * @returns {number} the nearest double
 */
const toNumber = (value) => Number(literalOf(value) ?? NaN);

module.exports = {
  BIGINT_MAX,
  BIGINT_MIN,
  DEFAULT_PRECISION,
  DEFAULT_SCALE,
  EXACT_TYPES,
  MAX_PRECISION,
  canonical,
  canonicalInteger,
  checkSettings,
  compare,
  isExact,
  literalOf,
  settingsOf,
  toNumber,
};
