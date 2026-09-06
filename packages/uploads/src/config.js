/**
 * `config.uploads`, normalized.
 *
 * Every limit here is enforced by the parser as it reads, which is the only
 * kind of limit worth writing: a check that runs once the file is on disk
 * has already let the disk fill. `false` is accepted on the four that bound
 * a request, because an application that means "no limit" should have to
 * write it -- and `henri audit` reports it when it does.
 *
 * `maxFieldSize` defaults to `config.bodyLimit` rather than to a number of
 * its own. The two bound the same thing from two directions: `bodyLimit`
 * is what `express.json()` and `express.urlencoded()` accept for a whole
 * body, and a multipart body is bounded by `maxTotalSize` instead, with
 * `maxFieldSize` bounding one of its non-file parts. Giving the part the
 * same ceiling as a whole urlencoded body keeps `"name"` costing the same
 * whichever encoding a form was posted with.
 */
const { bytes } = require('./bytes');
const { EXPIRES_IN, MAX_EXPIRES, PATH } = require('./signing');
const { variantsOf } = require('./variants');

/** The defaults, and the table the documentation prints */
const DEFAULTS = {
  allow: null,
  maxFieldNameSize: 100,
  maxFieldSize: null,
  maxFields: 100,
  maxFileSize: '10mb',
  maxFilenameLength: 255,
  maxFiles: 10,
  maxTotalSize: '25mb',
  paths: null,
  root: 'storage/uploads',
  sniff: true,
  storage: 'local',
  urls: false,
  variants: null,
};

/** The methods a body is read from; anything else never carries an upload */
const METHODS = new Set(['PATCH', 'POST', 'PUT']);

/**
 * The storage an application named, split into the backend and its settings.
 *
 * Two forms, the way `config.stores.<name>` and `config.shared` already
 * work: a string is a backend with nothing to configure (`"local"`,
 * `"./lib/storage"`), and an object is a backend with settings, whose
 * `adapter` names it and whose other keys are the backend's own. henri
 * reads none of the latter -- a bucket, a region and an endpoint are
 * `@usehenri/s3`'s business, not the framework's.
 *
 * @param {*} value what the configuration holds under `storage`
 * @returns {{name: string, options: object}} the backend and its settings
 */
const storageOf = (value) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    return { name: value.trim(), options: {} };
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const { adapter, ...options } = value;

    return {
      name:
        typeof adapter === 'string' && adapter.trim()
          ? adapter.trim()
          : DEFAULTS.storage,
      options,
    };
  }

  return { name: DEFAULTS.storage, options: {} };
};

/**
 * A whole number above zero, `false`, or the fallback
 *
 * @param {*} value the value
 * @param {(number|false)} fallback what an unreadable value becomes
 * @returns {(number|false)} the count
 */
const count = (value, fallback) => {
  if (value === false) {
    return false;
  }

  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : fallback;
};

/**
 * A plain object, or an empty one
 *
 * @param {*} value the value
 * @returns {object} a plain object
 */
const objectOf = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * The list of media types an application accepts, or null for every type
 *
 * @param {*} value what the configuration holds
 * @returns {?Array<string>} the list, or null
 */
const allowList = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }

  const entries = value
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim().toLowerCase());

  return entries.length > 0 ? entries : null;
};

/**
 * The path prefixes multipart is parsed under, or null for every path
 *
 * @param {*} value what the configuration holds
 * @returns {?Array<string>} the prefixes, or null
 */
const pathList = (value) => {
  const entries = (Array.isArray(value) ? value : [value])
    .filter((entry) => typeof entry === 'string' && entry.startsWith('/'))
    .map((entry) => (entry.length > 1 ? entry.replace(/\/+$/u, '') : entry));

  return entries.length > 0 ? entries : null;
};

/**
 * Signed urls: off, or the settings of the ones this application hands out.
 *
 * Off is the default, and it is fail-closed rather than shy. A signed url
 * is a bearer capability -- whoever holds the link holds the file, until it
 * expires -- and on the local disk it also mounts a route that serves bytes
 * without asking the application anything. Neither is a thing to acquire by
 * installing a package; both are one line of configuration.
 *
 * @param {*} value what the configuration holds under `urls`
 * @returns {(false|object)} the settings, or false
 */
const urlsOf = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const seconds = Number(value.expiresIn);
  const declared = typeof value.path === 'string' && value.path.startsWith('/');

  return {
    cdn: typeof value.cdn === 'string' ? value.cdn.replace(/\/+$/u, '') : '',
    expiresIn:
      Number.isInteger(seconds) && seconds > 0 && seconds <= MAX_EXPIRES
        ? seconds
        : EXPIRES_IN,
    path: declared ? value.path.replace(/\/+$/u, '') || PATH : PATH,
  };
};

/**
 * The settings of the uploads module
 *
 * @param {object} config henri's config module (anything with get/has)
 * @returns {object} the settings, or `{ enabled: false }` when the
 *   application wrote `"uploads": false`
 */
function settings(config) {
  const has = (key) =>
    Boolean(config) && typeof config.has === 'function' && config.has(key);
  const get = (key, fallback) => (has(key) ? config.get(key) : fallback);
  const declared = get('uploads', {});

  if (declared === false) {
    return { enabled: false };
  }

  const uploads = objectOf(declared);
  const bodyLimit = bytes(get('bodyLimit', '1mb'), 1024 * 1024);
  const storage = storageOf(uploads.storage);

  return {
    allow: allowList(uploads.allow),
    enabled: true,
    maxFieldNameSize: count(
      uploads.maxFieldNameSize,
      DEFAULTS.maxFieldNameSize
    ),
    maxFieldSize: bytes(uploads.maxFieldSize, bodyLimit),
    maxFields: count(uploads.maxFields, DEFAULTS.maxFields),
    maxFileSize: bytes(uploads.maxFileSize, bytes(DEFAULTS.maxFileSize)),
    maxFilenameLength: count(
      uploads.maxFilenameLength,
      DEFAULTS.maxFilenameLength
    ),
    maxFiles: count(uploads.maxFiles, DEFAULTS.maxFiles),
    maxTotalSize: bytes(uploads.maxTotalSize, bytes(DEFAULTS.maxTotalSize)),
    paths: pathList(uploads.paths),
    root: typeof uploads.root === 'string' ? uploads.root : DEFAULTS.root,
    sniff: uploads.sniff !== false,
    storage: storage.name,
    storageOptions: storage.options,
    urls: urlsOf(uploads.urls),
    variants: variantsOf(uploads.variants),
  };
}

/**
 * Does this request take a body a multipart parser should read?
 *
 * @param {Express.Request} req the request
 * @param {?Array<string>} paths the configured prefixes, or null
 * @returns {boolean} true when the parser runs for it
 */
function covers(req, paths) {
  if (!METHODS.has(req.method)) {
    return false;
  }

  if (!Array.isArray(paths)) {
    return true;
  }

  const url = (req.path || req.url || '/').split('?')[0];

  return paths.some(
    (prefix) => url === prefix || url.startsWith(`${prefix}/`) || prefix === '/'
  );
}

module.exports = {
  DEFAULTS,
  METHODS,
  allowList,
  count,
  covers,
  settings,
  storageOf,
  urlsOf,
};
