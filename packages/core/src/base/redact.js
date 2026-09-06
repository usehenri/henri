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
 *
 * ## What no configuration can unmask
 *
 * `ALWAYS_MASKED` is the `ALWAYS_MASKED` of `0.config.js`, one level down:
 * the same names, matched the same way, but here they cover *anything*
 * printed rather than only a configuration report. It exists because
 * `config.filterParameters` **replaces** the default list, so an
 * application that adds `apiKey` to it, or sets it to `false`, would
 * otherwise take the protection away by widening it.
 *
 * The one entry is `encryption`, and it is there for `config.encryption.keys`
 * (`1.encryption.js`): the key that opens every encrypted column, which
 * henri already refuses to print through its own paths and which an
 * application hands straight to `pen` the moment it logs its own
 * configuration. A substring is the right shape -- it masks the whole
 * `encryption` object, keys and all, rather than one name inside it -- and
 * the cost is that a field called `encryptionStatus` is masked too. That is
 * the same collateral `password` already takes on `passwordChangedAt`, and
 * the two failures are not comparable: a masked status word costs a
 * debugging round trip, a printed key costs the database.
 *
 * There is deliberately no setting that empties this list. A name is not
 * maskable when it carries no name of its own -- `pen.info(config.get(
 * 'encryption'))` hands over a bare `{ keys }` -- which is why
 * `henri.encryption` never returns key material and the guide tells an
 * application to log a key id instead.
 */
const DEFAULT_FILTER = Object.freeze([
  'password',
  'token',
  'secret',
  'authorization',
]);

/** Substrings masked whatever `config.filterParameters` says */
const ALWAYS_MASKED = Object.freeze(['encryption']);

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
 * `ALWAYS_MASKED` is checked before the filters and not taken from them, so
 * that every caller gets it whatever it passed -- the configured list, the
 * defaults, or the empty list `filterParameters: false` returns.
 *
 * @param {string} key a key
 * @param {Array<string>} filters the filters (substring match)
 * @param {Set<string>} [keys=NO_KEYS] the personal field names (exact match)
 * @returns {boolean} filtered or not
 */
function isFiltered(key, filters, keys = NO_KEYS) {
  const lower = String(key).toLowerCase();

  if (ALWAYS_MASKED.some((filter) => lower.includes(filter))) {
    return true;
  }

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

/**
 * The masking of a url for an instance, as one function
 *
 * `redactor()` for the other half of a log line. A url reaches `pen` from
 * several places -- the error handler, the request timeout -- and every one
 * of them wants the *application's* filters and personal field names rather
 * than the defaults, which is what calling `redactUrl()` with one argument
 * quietly settles for.
 *
 * @param {*} [inst] a henri instance (`global.henri` when there is none)
 * @returns {function} `(url) => url`, redacted
 */
function urlRedactor(inst) {
  const instance = inst || global.henri;
  const filters = filterParameters(instance && instance.config);
  const keys =
    (instance && instance.privacy && instance.privacy.keys) || undefined;

  return (url) => redactUrl(url, filters, keys || NO_KEYS);
}

module.exports = {
  ALWAYS_MASKED,
  DEFAULT_FILTER,
  MASK,
  filterParameters,
  isFiltered,
  redact,
  redactUrl,
  redactor,
  urlRedactor,
};
