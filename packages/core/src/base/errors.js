/**
 * Error codes: the stable name of a failure.
 *
 * Every failure henri raises on its own behalf carries a code -- a name that
 * does not change between versions, that a person can search for and that an
 * agent can look up: `HENRI_MODEL_UNKNOWN_TYPE`, `HENRI_BOOT_CIRCULAR_DEPENDENCY`.
 * The shape is `HENRI_<AREA>_<REASON>`: the prefix makes it unique enough to
 * search the web with, the area says which part of the framework raised it,
 * and the reason reads without a lookup, the way node's own `ERR_*` codes do.
 *
 * The catalogue is `error-codes.json` at the root of this package: one entry per
 * code with what it means, what usually causes it and how to fix it. It is
 * data, so a website build can read it and so nothing has to be scraped out
 * of the source. `src/__tests__/error-codes.spec.js` keeps the two honest:
 * every code raised in the source has an entry, every entry is raised
 * somewhere, and no two entries mean the same thing.
 *
 * A code reaches a person through `pen` (the boot log), through the JSON
 * error body of the API (`base/boom.js`, `base/http.js`), through
 * `henri <command> --json` and through the MCP server, which all put it in
 * the `code` of the envelope they already answer with.
 *
 * `url()` is the seam for turning a code into a page that explains it. It is
 * unset by default and it holds no domain name: an application that wants
 * the links sets `errors.url` to a template holding `{code}`.
 *
 * @module base/errors
 */

const catalogue = require('../../error-codes.json');

/** The areas a code may belong to, in the order of the catalogue */
const AREAS = catalogue.areas.map((entry) => entry.area);

/** The entries, by code */
const CODES = Object.fromEntries(
  catalogue.codes.map((entry) => [entry.code, entry])
);

/** What a code looks like: HENRI_<AREA>_<REASON>, in that shape only */
const PATTERN = new RegExp(
  `^HENRI_(?:${AREAS.map((area) => area.toUpperCase()).join(
    '|'
  )})_[A-Z0-9]+(?:_[A-Z0-9]+)*$`,
  'u'
);

/** The exit status a coded failure leaves the command line with */
const DEFAULT_EXIT = 1;

/**
 * Is this one of henri's error codes?
 *
 * @param {*} value anything
 * @returns {boolean} true when the catalogue holds it
 */
const isCode = (value) =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(CODES, value);

/**
 * The catalogue entry of a code
 *
 * @param {string} code the code
 * @returns {?object} the entry ({ area, code, what, causes, fix, exit }), or
 *   null when the catalogue does not hold it
 */
const entry = (code) => (isCode(code) ? CODES[code] : null);

/**
 * The exit status a code leaves the command line with
 *
 * @param {string} code the code
 * @returns {number} the status (1 unless the catalogue says otherwise)
 */
const exitOf = (code) => {
  const found = entry(code);

  return (found && found.exit) || DEFAULT_EXIT;
};

/**
 * The first code of an error, walking the `cause` chain
 *
 * A boot failure reaches the command line wrapped, so the error that knows
 * what went wrong is often a cause away. A cycle in the chain stops the walk.
 *
 * @param {*} error what was thrown
 * @returns {?string} the code, or null when nothing in the chain carries one
 */
const coded = (error) => {
  const seen = new Set();
  let current = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);

    if (isCode(current.code)) {
      return current.code;
    }

    if (isCode(current.henriCode)) {
      return current.henriCode;
    }

    current = current.cause;
  }

  return null;
};

/**
 * Put a code on an error
 *
 * The one way a failure gets its code: nothing subclasses Error for this.
 * An error that already carries a henri code keeps it -- the innermost
 * failure is the one that knows what happened -- and so does one carrying a
 * code of its own (`ENOENT`, `MODULE_NOT_FOUND`), which is written to
 * `henriCode` instead so nothing that reads `error.code` is surprised.
 *
 * @param {*} error the error (anything else is returned untouched)
 * @param {string} code one of the catalogue's codes
 * @returns {*} the same error
 * @throws {Error} when the code is not in the catalogue
 */
function stamp(error, code) {
  if (!isCode(code)) {
    throw new Error(
      `${code} is not a henri error code: add it to packages/core/error-codes.json`
    );
  }

  if (!error || typeof error !== 'object') {
    return error;
  }

  if (isCode(error.code) || isCode(error.henriCode)) {
    return error;
  }

  if (typeof error.code === 'string') {
    error.henriCode = code;

    return error;
  }

  error.code = code;

  return error;
}

/**
 * Put a code on an error unless something in its `cause` chain already names
 * a more precise one
 *
 * What a wrapper uses: `henri.init()` rejects with an error whose cause is
 * the module's own, and the module knows better than the wrapper what
 * happened.
 *
 * @param {*} error the error
 * @param {string} code the code to fall back on
 * @returns {*} the same error
 */
function fallback(error, code) {
  return coded(error) ? error : stamp(error, code);
}

/**
 * An Error carrying a code
 *
 * @param {string} code one of the catalogue's codes
 * @param {string} message what went wrong
 * @param {object} [options={}] `cause`, and anything else Error takes
 * @returns {Error} the error to throw
 */
function fail(code, message, options = {}) {
  return stamp(new Error(message, options), code);
}

/**
 * Where a code is explained, when somebody publishes it
 *
 * The seam, and the whole of it: henri ships no address. `errors.url` is a
 * template holding `{code}` (`https://example.com/e/{code}`), unset by
 * default, so publishing the catalogue later is a configuration change
 * rather than a rewrite.
 *
 * @param {string} code the code
 * @param {*} [template=null] the template, or a henri instance to read it from
 * @returns {?string} the url, or null when nothing is configured
 */
function url(code, template = null) {
  if (!isCode(code)) {
    return null;
  }

  const shape =
    typeof template === 'string' ? template : templateOf(template) || null;

  if (typeof shape !== 'string' || !shape.includes('{code}')) {
    return null;
  }

  return shape.split('{code}').join(code);
}

/**
 * The template an instance is configured with
 *
 * @param {*} inst a henri instance, or anything else
 * @returns {?string} the template, or null
 */
function templateOf(inst) {
  const instance = inst || global.henri;
  const config = instance && instance.config;

  if (!config || typeof config.get !== 'function') {
    return null;
  }

  const value = config.get('errors.url', true);

  return typeof value === 'string' ? value : null;
}

module.exports = {
  AREAS,
  CODES,
  PATTERN,
  catalogue,
  coded,
  entry,
  exitOf,
  fail,
  fallback,
  isCode,
  stamp,
  url,
};
