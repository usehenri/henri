/**
 * The signed urls henri makes itself, for a storage that has none of its own.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 * ---------------------------------------------------------------------------
 *
 * An object store signs its own urls (`@usehenri/s3` presigns with SigV4),
 * and that is always the better answer: the bytes never touch the
 * application. The local disk cannot do that -- there is nobody else to hand
 * the file to -- so `LocalStorage#url()` used to answer `null`, and an
 * application that wanted a link had to write a controller, an
 * authorization check and a route for every file it showed.
 *
 * `null` is not an answer, it is a hole. So henri signs the url itself: the
 * same call, the same expiry, the same `{ expiresIn, disposition, filename,
 * type }`, and a route that verifies the signature and streams the file.
 * What changes between the two backends is who checks the signature, not
 * what an application writes.
 *
 * ---------------------------------------------------------------------------
 * What the signature covers, and what that buys
 * ---------------------------------------------------------------------------
 *
 * One HMAC-SHA256 over a canonical string of six fields, under a key derived
 * from `config.secret` (HKDF-SHA256, one label of its own, the way
 * `@usehenri/webhooks` derives its sealing key):
 *
 * ```
 * henri.uploads.url.v1
 * <key>
 * <expires, epoch seconds>
 * <attachment|inline>
 * <download name>
 * <media type>
 * ```
 *
 * - **It cannot be edited to name another object.** The key is the third
 *   line of the string and the path of the url; changing one without the
 *   other is a signature of a different string, and producing the right one
 *   needs the key, which never leaves the server. The storage refuses
 *   anything that is not shaped like a generated key on top of that, so even
 *   a forgery would have to name a real one.
 * - **It cannot be replayed after it expires.** `expires` is inside the
 *   signed string, so widening the window invalidates the signature, and the
 *   verifier compares it with its own clock -- not with anything the client
 *   sent. What a signed url *is*, before it expires, is a bearer capability:
 *   whoever holds the link holds the file. That is the whole idea, it is
 *   what a presigned S3 url is too, and the expiry is the bound. The guide
 *   says so in those words.
 * - **It cannot be turned into a page.** The disposition, the download name
 *   and the media type are signed as well, so a link to a download cannot be
 *   edited into `inline` `text/html` on the application's own origin. The
 *   two scriptable types henri recognizes are refused `inline` at signing
 *   time, which is the same rule that stores them under `.bin`.
 *
 * The host is deliberately **not** in the signature, which is what lets
 * `uploads.urls.cdn` put a cache in front of the route: a CDN that forwards
 * the path and the query forwards everything the signature is of. A
 * provider-signed url is the opposite -- SigV4 covers the host -- which is
 * why the two have different keys, and why the guide says which is which.
 *
 * Nothing is stored: there is no table of urls, no revocation list and no
 * way to invalidate one link. Rotating `config.secret` invalidates all of
 * them at once, and shortening `expiresIn` bounds the next ones.
 */
const crypto = require('node:crypto');

const { isKey, safeName } = require('./names');

/** The label the url key is derived under */
const LABEL = 'henri.uploads.url.v1';

/** The first line of every canonical string, so a v2 is a different string */
const VERSION = 'henri.uploads.url.v1';

/** The bytes of the derived key */
const KEY_BYTES = 32;

/** How long a signed url lasts when nobody said (seconds) */
const EXPIRES_IN = 300;

/** The longest window one may be given, matching what S3 honours (seconds) */
const MAX_EXPIRES = 7 * 24 * 60 * 60;

/** Where the route that verifies these is mounted, unless it is moved */
const PATH = '/_uploads';

/** What a disposition may be */
const DISPOSITIONS = new Set(['attachment', 'inline']);

/**
 * The types that are never served `inline`.
 *
 * The same two `sniff.js` stores under a `.bin` extension, for the same
 * reason: they are text formats that carry script, and rendering one on the
 * application's own origin is the whole attack. A signed url may still hand
 * one back -- as a download, which is what an `attachment` is.
 */
const SCRIPTABLE = new Set(['image/svg+xml', 'text/html']);

/**
 * The key henri signs urls with
 *
 * @param {?string} secret `config.secret`
 * @returns {?Buffer} the key, or null without a secret
 */
const keyOf = (secret) =>
  secret
    ? Buffer.from(
        crypto.hkdfSync(
          'sha256',
          String(secret),
          'henri.uploads',
          LABEL,
          KEY_BYTES
        )
      )
    : null;

/**
 * The string a signature is of.
 *
 * Every field is on a line of its own and none of them may hold a newline
 * (the key cannot, a disposition is one of two words, and the name and the
 * type are cleaned), so no two different sets of fields build the same
 * string.
 *
 * @param {object} claims `{ key, expires, disposition, filename, type }`
 * @returns {string} the canonical string
 */
const canonical = ({ disposition, expires, filename, key, type }) =>
  [VERSION, key, String(expires), disposition, filename || '', type || ''].join(
    '\n'
  );

/**
 * The signature of a set of claims
 *
 * @param {Buffer} key the derived key
 * @param {object} claims what is being signed
 * @returns {string} the signature, base64url
 */
const signature = (key, claims) =>
  crypto
    .createHmac('sha256', key)
    .update(canonical(claims), 'utf8')
    .digest('base64url');

/**
 * A media type, or null: anything that is not one is not signed as one
 *
 * @param {*} value what was asked for
 * @returns {?string} the type
 */
const typeOf = (value) =>
  typeof value === 'string' && /^[\w.+-]+\/[\w.+-]+$/u.test(value)
    ? value.toLowerCase()
    : null;

/**
 * Signs urls, and verifies the ones it signed
 *
 * @class UrlSigner
 */
class UrlSigner {
  /**
   * Creates an instance of UrlSigner.
   *
   * @param {object} [options={}] `{ secret, expiresIn, path, cdn }`
   * @memberof UrlSigner
   */
  constructor(options = {}) {
    this.key = keyOf(options.secret);
    this.expiresIn = options.expiresIn || EXPIRES_IN;
    this.path = options.path || PATH;
    this.cdn = options.cdn ? String(options.cdn).replace(/\/+$/u, '') : '';
  }

  /**
   * Whether this signer can sign anything at all
   *
   * @returns {boolean} true when there is a key
   * @memberof UrlSigner
   */
  get usable() {
    return Boolean(this.key);
  }

  /**
   * A signed url for one object
   *
   * @param {string} key the storage key
   * @param {object} [options={}] `{ expiresIn, disposition, filename, type, now }`
   * @returns {string} the url
   * @throws {RangeError} on a window nothing would honour
   * @throws {Error} on a key henri did not generate, or an inline script
   * @memberof UrlSigner
   */
  sign(key, options = {}) {
    if (!isKey(key)) {
      throw new Error(`unsafe storage key: ${JSON.stringify(String(key))}`);
    }

    // `undefined` means "whatever the configuration says"; every other value
    // is a window somebody asked for, `0` included, and `0` is a mistake
    const asked =
      options.expiresIn === undefined || options.expiresIn === null
        ? this.expiresIn
        : options.expiresIn;
    const seconds = Math.floor(Number(asked));

    if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_EXPIRES) {
      throw new RangeError(
        `a signed url lasts between 1 and ${MAX_EXPIRES} seconds, not ${asked}`
      );
    }

    const disposition = DISPOSITIONS.has(options.disposition)
      ? options.disposition
      : 'attachment';
    const type = typeOf(options.type);

    if (disposition === 'inline' && SCRIPTABLE.has(type)) {
      throw new Error(
        `${type} is never served inline: it would run on this application's own origin`
      );
    }

    const now = options.now ? options.now.getTime() : Date.now();
    const claims = {
      disposition,
      expires: Math.floor(now / 1000) + seconds,
      filename: options.filename ? safeName(options.filename) : '',
      key,
      type,
    };
    const query = new URLSearchParams({
      disposition,
      expires: String(claims.expires),
    });

    claims.filename && query.set('name', claims.filename);
    type && query.set('type', type);
    query.set('signature', signature(this.key, claims));

    return `${this.cdn}${this.path}/${key}?${query.toString()}`;
  }

  /**
   * What a url that verifies says, or why it does not.
   *
   * The signature is checked **before** the expiry on purpose: an expired
   * link is then only ever reported to somebody holding a link henri really
   * signed, and everything else is one answer. The expiry is in the url in
   * plain sight, so saying "this has expired" tells a legitimate visitor
   * something useful and an attacker nothing.
   *
   * @param {string} key the storage key, from the path
   * @param {URLSearchParams} query the query of the url
   * @param {Date} [now=new Date()] the moment
   * @returns {{ok: boolean, reason: ?string, claims: ?object}} the verdict
   * @memberof UrlSigner
   */
  verify(key, query, now = new Date()) {
    const given = query.get('signature') || '';
    const expires = Number(query.get('expires'));

    if (!this.key || !isKey(key) || !Number.isInteger(expires)) {
      return { claims: null, ok: false, reason: 'invalid' };
    }

    const claims = {
      disposition: query.get('disposition') || '',
      expires,
      filename: query.get('name') || '',
      key,
      type: query.get('type') || null,
    };
    const wanted = Buffer.from(signature(this.key, claims), 'utf8');
    const received = Buffer.from(given, 'utf8');

    if (
      wanted.length !== received.length ||
      !crypto.timingSafeEqual(wanted, received)
    ) {
      return { claims: null, ok: false, reason: 'invalid' };
    }

    if (!DISPOSITIONS.has(claims.disposition)) {
      return { claims: null, ok: false, reason: 'invalid' };
    }

    return now.getTime() / 1000 > expires
      ? { claims, ok: false, reason: 'expired' }
      : { claims, ok: true, reason: null };
  }
}

module.exports = {
  DISPOSITIONS,
  EXPIRES_IN,
  LABEL,
  MAX_EXPIRES,
  PATH,
  SCRIPTABLE,
  UrlSigner,
  canonical,
  keyOf,
  typeOf,
};
