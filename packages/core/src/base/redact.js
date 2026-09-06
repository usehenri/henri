/**
 * Parameter filtering (Rails' `config.filter_parameters`).
 *
 * Keys whose name contains one of the filters (case-insensitive substring
 * match, like Rails) are replaced by `[FILTERED]` before anything is
 * logged. `config.filterParameters` replaces the default list.
 *
 * The fields the models marked `personal` are masked too, and they are
 * matched *exactly* rather than as substrings: `password` may filter
 * `passwordConfirmation` because whoever wrote it meant a family of names,
 * but a `name` column marked personal has no business filtering `filename`
 * or `modelName`. `henri.privacy.keys` holds them (see `base/privacy.js`).
 */
const DEFAULT_FILTER = Object.freeze([
  'password',
  'token',
  'secret',
  'authorization',
]);
const MASK = '[FILTERED]';
const MAX_DEPTH = 8;

/**
 * The filters from the configuration (defaults when unset)
 *
 * @param {object} [config] henri's config module (or anything with get/has)
 * @returns {Array<string>} the filters
 */
function filterParameters(config) {
  if (
    config &&
    typeof config.has === 'function' &&
    config.has('filterParameters')
  ) {
    const raw = config.get('filterParameters');

    if (raw === false) {
      return [];
    }

    if (Array.isArray(raw)) {
      return raw.filter((key) => typeof key === 'string' && key.length > 0);
    }
  }

  return DEFAULT_FILTER.slice();
}

/** The names nothing marked, so the exact match has nothing to do */
const NO_KEYS = new Set();

/**
 * Should a key be filtered?
 *
 * @param {string} key a key
 * @param {Array<string>} filters the filters (substring match)
 * @param {Set<string>} [keys=NO_KEYS] the personal field names (exact match)
 * @returns {boolean} filtered or not
 */
function isFiltered(key, filters, keys = NO_KEYS) {
  const lower = String(key).toLowerCase();

  if (keys && keys.size > 0 && keys.has(String(key))) {
    return true;
  }

  return filters.some((filter) => lower.includes(String(filter).toLowerCase()));
}

/**
 * A copy of a value with the filtered keys masked
 *
 * @param {*} value anything (objects and arrays are walked)
 * @param {Array<string>} [filters=DEFAULT_FILTER] the filters
 * @param {object} [options={}] `keys` (exact matches) and `depth` (internal)
 * @returns {*} the redacted copy (primitives are returned as is)
 */
function redact(value, filters = DEFAULT_FILTER, options = {}) {
  const { keys = NO_KEYS, depth = 0 } = options;
  const deeper = { depth: depth + 1, keys };

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[Object]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, filters, deeper));
  }

  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Error ||
    Buffer.isBuffer(value)
  ) {
    return value;
  }

  if (typeof value.toJSON === 'function') {
    return redact(value.toJSON(), filters, deeper);
  }

  const result = {};

  for (const key of Object.keys(value)) {
    result[key] = isFiltered(key, filters, keys)
      ? MASK
      : redact(value[key], filters, deeper);
  }

  return result;
}

/**
 * The masking of an instance, as one function
 *
 * `config.filterParameters` as substrings plus the personal field names
 * exactly, which is what everything henri prints or hands out has to go
 * through. `pen` and the error reporter (`base/reporting.js`) both take
 * their masking from here, so "the structured line is masked the way the
 * pretty one is" is a fact of the code rather than two implementations that
 * agree today.
 *
 * @param {*} [inst] a henri instance (`global.henri` when there is none)
 * @returns {function} `(value) => value`, redacted
 */
function redactor(inst) {
  const instance = inst || global.henri;
  const filters = filterParameters(instance && instance.config);
  const keys =
    (instance && instance.privacy && instance.privacy.keys) || undefined;

  return (value) => redact(value, filters, { keys });
}

/**
 * A url with the values of the filtered query parameters masked
 *
 * @param {string} url a url or a path (`/login?token=abc`)
 * @param {Array<string>} [filters=DEFAULT_FILTER] the filters
 * @param {Set<string>} [keys=NO_KEYS] the personal field names (exact match)
 * @returns {string} the url, masked
 */
function redactUrl(url, filters = DEFAULT_FILTER, keys = NO_KEYS) {
  const text = String(url);
  const index = text.indexOf('?');

  if (index < 0) {
    return text;
  }

  const params = new URLSearchParams(text.slice(index + 1));
  let changed = false;

  for (const key of Array.from(params.keys())) {
    if (isFiltered(key, filters, keys)) {
      params.set(key, MASK);
      changed = true;
    }
  }

  return changed ? `${text.slice(0, index)}?${params.toString()}` : text;
}

module.exports = {
  DEFAULT_FILTER,
  MASK,
  filterParameters,
  isFiltered,
  redact,
  redactUrl,
  redactor,
};
