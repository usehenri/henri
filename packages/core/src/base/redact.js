/**
 * Parameter filtering (Rails' `config.filter_parameters`).
 *
 * Keys whose name contains one of the filters (case-insensitive substring
 * match, like Rails) are replaced by `[FILTERED]` before anything is
 * logged. `config.filterParameters` replaces the default list.
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

/**
 * Should a key be filtered?
 *
 * @param {string} key a key
 * @param {Array<string>} filters the filters
 * @returns {boolean} filtered or not
 */
function isFiltered(key, filters) {
  const lower = String(key).toLowerCase();

  return filters.some((filter) => lower.includes(String(filter).toLowerCase()));
}

/**
 * A copy of a value with the filtered keys masked
 *
 * @param {*} value anything (objects and arrays are walked)
 * @param {Array<string>} [filters=DEFAULT_FILTER] the filters
 * @param {number} [depth=0] current depth (internal)
 * @returns {*} the redacted copy (primitives are returned as is)
 */
function redact(value, filters = DEFAULT_FILTER, depth = 0) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return '[Object]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, filters, depth + 1));
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
    return redact(value.toJSON(), filters, depth + 1);
  }

  const result = {};

  for (const key of Object.keys(value)) {
    result[key] = isFiltered(key, filters)
      ? MASK
      : redact(value[key], filters, depth + 1);
  }

  return result;
}

/**
 * A url with the values of the filtered query parameters masked
 *
 * @param {string} url a url or a path (`/login?token=abc`)
 * @param {Array<string>} [filters=DEFAULT_FILTER] the filters
 * @returns {string} the url, masked
 */
function redactUrl(url, filters = DEFAULT_FILTER) {
  const text = String(url);
  const index = text.indexOf('?');

  if (index < 0) {
    return text;
  }

  const params = new URLSearchParams(text.slice(index + 1));
  let changed = false;

  for (const key of Array.from(params.keys())) {
    if (isFiltered(key, filters)) {
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
};
