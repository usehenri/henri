/**
 * Names.
 *
 * There are two of them and they never meet. The **stored name** is the one
 * the filesystem sees; henri generates it and nothing a client sends takes
 * part in it. The **original name** is metadata: it is cleaned, kept in the
 * record and used for the `Content-Disposition` of a download, and it never
 * reaches a path.
 *
 * That split is the whole answer to a long list of problems that are really
 * one problem -- `../../etc/passwd`, `/etc/passwd`, `C:\boot.ini`,
 * `a\0.png`, `.htaccess`, `CON`, `avatar.php`, a name 4000 characters long,
 * a name that is only dots. None of them can matter, because none of them
 * are consulted when a path is built. They are cleaned anyway, because the
 * original name is shown to people and handed to browsers, and because a
 * value that is only safe when nobody misuses it is not safe.
 */
const crypto = require('node:crypto');

/** How long a cleaned original name may be, when nothing else is configured */
const MAX_NAME = 255;

/** What a name that cleaned down to nothing is called */
const FALLBACK = 'file';

/** Characters that never survive: separators, controls, quotes, wildcards */
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f/\\:*?"<>|]/gu;

/**
 * The device names Windows refuses to have a file called, whatever the
 * extension. Reserved before the first dot, so `CON.txt` is one too.
 */
const RESERVED =
  /^(?:con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])$/iu;

/** What a generated key looks like, and the only shape a storage accepts */
const KEY = /^(?:[0-9a-z][0-9a-z-]{0,63}\/)*[0-9a-f]{32}\.[0-9a-z]{1,8}$/u;

/**
 * The original name, cleaned: safe to store, to print and to hand a browser
 *
 * @param {*} original what the client called the file
 * @param {number} [max=MAX_NAME] how many characters to keep
 * @returns {string} a name, never empty and never a path
 */
function safeName(original, max = MAX_NAME) {
  if (typeof original !== 'string') {
    return FALLBACK;
  }

  // Both separators, because a Windows client sends a Windows path
  const base = original.split(/[/\\]/u).pop() || '';
  const cleaned = base
    .replace(UNSAFE, '')
    .replace(/^[\s.]+/u, '')
    .replace(/[\s.]+$/u, '')
    .trim();

  if (cleaned.length === 0) {
    return FALLBACK;
  }

  const stem = cleaned.split('.')[0];
  const named = RESERVED.test(stem) ? `_${cleaned}` : cleaned;

  return named.length > max ? truncate(named, max) : named;
}

/**
 * A name shortened to `max` characters, keeping its extension
 *
 * @param {string} name the name
 * @param {number} max how many characters to keep
 * @returns {string} the shortened name
 */
function truncate(name, max) {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';

  return `${name.slice(0, Math.max(1, max - extension.length))}${extension}`;
}

/**
 * The name a stored object is given.
 *
 * `<yyyy>/<mm>/<32 hex characters>.<extension>`: the date so a directory
 * never grows without end and a retention rule has something to read, 128
 * bits of randomness so a key is never guessed from another one, and an
 * extension that comes from the type the *bytes* were recognized as -- never
 * from the name the client sent.
 *
 * @param {object} options the options
 * @param {string} options.extension the extension, without its dot
 * @param {?string} [options.prefix] a directory to put it under
 * @param {Date} [options.now] the moment, for the dated directories
 * @returns {string} the key
 */
function keyFor({ extension, now = new Date(), prefix = null }) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const random = crypto.randomBytes(16).toString('hex');
  const safe = safePrefix(prefix);
  const directory = safe ? `${safe}/${year}/${month}` : `${year}/${month}`;

  return `${directory}/${random}.${extension}`;
}

/**
 * A prefix an application asked for, reduced to what a key may hold
 *
 * @param {*} prefix what the application passed to `store()`
 * @returns {?string} the prefix, or null when there is nothing usable left
 */
function safePrefix(prefix) {
  if (typeof prefix !== 'string') {
    return null;
  }

  const segments = prefix
    .toLowerCase()
    .split('/')
    .map((segment) => segment.replace(/[^0-9a-z-]/gu, ''))
    .filter((segment) => segment.length > 0 && segment.length <= 64);

  return segments.length > 0 ? segments.slice(0, 4).join('/') : null;
}

/**
 * Is this a key henri generated? (a storage refuses anything else)
 *
 * @param {*} key the key
 * @returns {boolean} true when it is safe to build a path from
 */
const isKey = (key) =>
  typeof key === 'string' &&
  key.length <= 512 &&
  !key.includes('..') &&
  KEY.test(key);

/**
 * The two forms of a filename a `Content-Disposition` header needs: the
 * ASCII one every client understands, and the percent-encoded UTF-8 one
 * (RFC 5987) for the rest of the alphabet
 *
 * @param {string} name a name from `safeName()`
 * @param {string} [disposition='attachment'] `attachment` or `inline`
 * @returns {string} the header value
 */
function contentDisposition(name, disposition = 'attachment') {
  const safe = safeName(name);
  const ascii = safe.replace(/[^\u0020-\u007e]/gu, '_').replace(/["\\]/gu, '_');
  const encoded = encodeURIComponent(safe);

  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = {
  FALLBACK,
  KEY,
  MAX_NAME,
  RESERVED,
  contentDisposition,
  isKey,
  keyFor,
  safeName,
  safePrefix,
};
