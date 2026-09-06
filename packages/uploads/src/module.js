const BaseModule = require('@usehenri/core/module');

const debug = require('debug')('henri:uploads');

const { DEFAULTS, settings: settingsOf } = require('./config');
const { UploadedFile } = require('./file');
const { UrlSigner } = require('./signing');
const { coded } = require('./errors');
const { contentDisposition } = require('./names');
const { createStorage } = require('./storage');
const { downloads } = require('./download');
const { format } = require('./bytes');
const { middleware } = require('./multipart');
const {
  FORMATS,
  SOURCES,
  keyFor: variantKeyFor,
  produce,
} = require('./variants');

/**
 * A key of the shape henri generates that names no object, for asking a
 * storage whether it signs its own urls without naming anybody's file
 */
const PROBE = `${'0'.repeat(32)}.bin`;

/**
 * File uploads: the henri module this package ships.
 *
 * ---------------------------------------------------------------------------
 * The design, and why it is this one
 * ---------------------------------------------------------------------------
 *
 * **A package, not core, and not core behind a key.** An upload needs a
 * multipart parser, and a multipart parser is a dependency of every
 * application that installs the framework -- including the many that will
 * never accept a file. henri already has the shape for this: `@usehenri/jobs`
 * carries the queue, `@usehenri/graphql` carries Apollo, a store adapter is
 * resolved from the application rather than bundled, and a package says it
 * ships a module with `"henri": { "module": "./module.js" }` in its own
 * package.json. So busboy is a dependency of this package and of nothing
 * else, and an application accepts files by installing it. The one thing
 * that does live in core is the `uploads` *key* of the configuration schema,
 * validated at boot whether or not the package is there -- exactly as
 * `graphql` is, so that a typo is a boot error rather than a silence.
 *
 * **busboy.** It is what the ecosystem sits on (multer is a thin Express
 * wrapper around it, and so are most of the others), it is a streaming
 * parser with no opinion about the filesystem, and its limits are enforced
 * by the state machine as it reads rather than by a check afterwards, which
 * is the property this whole feature is built on. formidable writes files
 * itself, with its own naming and its own temporary directory, which is
 * precisely the part henri wants to own; multer would mean wrapping busboy
 * in something that then has to be un-wrapped to control where the bytes go.
 *
 * **Where it sits in the request.** Runlevel 3, `before: ['user', 'router']`.
 * It has to be before the user module, because the `_csrf` field of a
 * `multipart/form-data` form is *inside the body*, and the CSRF middleware
 * reads `req.body`: parse later and no plain HTML upload form can ever pass
 * the token check. The consequence is that the parser is the first thing an
 * unauthenticated request meets, which is why every limit is enforced before
 * a byte is read, why `paths` exists to narrow the surface further, and why
 * nothing is ever kept unless a controller says so.
 *
 * **The limits, and how they relate to `bodyLimit`.** `config.bodyLimit`
 * (1mb) is what `express.json()` and `express.urlencoded()` accept for a
 * whole body; it does not apply to `multipart/form-data`, which those
 * parsers never look at. The multipart equivalents are `maxTotalSize` for
 * the whole body (25mb), `maxFileSize` for one file (10mb), `maxFiles` (10),
 * `maxFields` (100), `maxFieldNameSize` (100 bytes) and `maxFieldSize`,
 * which defaults to `config.bodyLimit` itself so that one text field of a
 * form costs the same whichever encoding the form was posted with. Every one
 * of them reaches busboy as a limit; the total is also counted as the bytes
 * arrive, because `Content-Length` is absent from a chunked request and
 * optional in the honesty of any other.
 *
 * **The type is the bytes.** A part's `Content-Type` and its filename are
 * written by whoever is uploading. henri reads the first 4kb instead and
 * matches a signature table (`sniff.js`); what it recognizes is the type,
 * what it does not is `application/octet-stream`, and the client's claim is
 * kept as `declaredType` for the record and used for nothing. It does not
 * guess a type from an extension, ever, and it does not open archives: a
 * `.docx` is `application/zip`, which is what it is. `allow` matches the
 * type henri decided on, so `allow: ['image/png']` cannot be satisfied by
 * naming a zip `avatar.png`.
 *
 * **The name never reaches the filesystem.** The stored name is generated:
 * `<yyyy>/<mm>/<32 hex characters>.<extension from the sniffed type>`. The
 * original is cleaned and kept as metadata, for the record and for the
 * `Content-Disposition` of a download. That is one answer to a long list of
 * problems that are really one problem -- `../../etc/passwd`, `/etc/passwd`,
 * `C:\boot.ini`, a NUL byte, `CON`, `.htaccess`, `avatar.php`, four thousand
 * characters -- because none of them are consulted when a path is built.
 *
 * **Where the files go.** `storage/uploads` in the application, outside
 * `app/views/public` (which `express.static` serves) and outside `.henri`
 * (which `henri clean` removes). The directory is created `0700`, every
 * object `0600`, and a `.gitignore` is written into it the first time so
 * that uploads never reach a commit. Nothing is ever served from it: a file
 * is handed back by `henri.uploads.send()`, which streams it with
 * `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and
 * the type henri recognized -- through a controller, which is where the
 * decision about who may read it belongs. The two scriptable types henri
 * recognizes, `text/html` and `image/svg+xml`, are stored under a `.bin`
 * extension as well, so that a web server misconfigured to serve the
 * directory still has nothing there it would render.
 *
 * **The storage seam.** `HenriStorage` (documented at the top of
 * `src/storage/local.js`) is to uploads what `HenriAdapter` is to the
 * stores: `start`, `stop`, `temp`, `put`, `get`, `stat`, `delete`, `url`.
 * The local disk is one implementation and ships; an object store is
 * another, `@usehenri/s3`, which `config.uploads.storage` names and which
 * the application installs -- so a signature implementation and an HTTP
 * client are not in the install of everyone who accepts a file.
 * `temp()` is part of the contract because only the storage knows where a
 * part should land so that keeping it is cheap -- a rename on the same
 * filesystem, locally.
 *
 * **Signed urls.** `url()` used to be allowed to answer `null` forever, and
 * on the local disk it did. That is a hole rather than a design: an
 * application that wanted a link had to write a controller, a route and an
 * authorization check for every file it showed, and the framework said
 * nothing about how. `henri.uploads.url(record)` is now one call whatever
 * the backend: an object store presigns it (the provider's own signature),
 * and the local disk gets henri's own -- an HMAC over the key, the expiry,
 * the disposition, the name and the type, verified by a route this module
 * mounts (`src/signing.js`, `src/download.js`). Both are off until
 * `config.uploads.urls` says otherwise, because a signed url is a bearer
 * capability and that is a decision, not a default.
 *
 * **Variants.** A derived file is a file with a key, so the storage seam was
 * already the right shape for one: `variant(record, 'thumb')` answers a
 * record like any other, and `send()`, `url()` and `delete()` take it
 * unchanged. The key is the source's plus a digest of the variant's *terms*,
 * so the work happens once, on demand, and every caller after that reads a
 * stored object -- never in the request that uploaded, which would make
 * every upload pay for every variant nobody looked at. `sharp` is an
 * optional peer dependency the application installs: a native addon is not
 * something to acquire by accepting a PDF, and without it `variant()`
 * refuses with the install line rather than quietly answering the original.
 * The reasoning is in `src/variants.js`.
 *
 * **Nothing is kept by default.** A parsed file lives in the storage's
 * temporary area until a controller calls `store()`. Everything else is
 * removed when the response closes -- answered, refused, timed out or
 * abandoned, which is the whole list of ways a request ends -- and
 * `permitFiles()` removes what a controller did not ask for immediately
 * rather than at the end. A `SIGKILL` is the one case a request cannot clean
 * up after, so the storage sweeps its temporary area at boot.
 *
 * ---------------------------------------------------------------------------
 * What an application sees
 * ---------------------------------------------------------------------------
 *
 * ```js
 * // app/controllers/artworks.js
 * async create(req, res) {
 *   const data = req.permit('title', 'year');
 *   const { scan } = req.permitFiles('scan');
 *
 *   if (scan) {
 *     data.scan = await scan[0].store({ prefix: 'artworks' });
 *   }
 *
 *   const artwork = await Artwork.create(data);
 *
 *   return res.resource(artwork);
 * }
 * ```
 *
 * `req.files` is `{ [field]: UploadedFile[] }`, `req.file('scan')` is the
 * first one of a field, and `req.permitFiles(...)` is `req.permit(...)` for
 * files. `store()` resolves with the record to write to a model:
 * `{ checksum, key, name, size, storage, type, uploadedAt }`.
 *
 * @class UploadsModule
 * @extends {BaseModule}
 */
class UploadsModule extends BaseModule {
  /**
   * Creates an instance of UploadsModule.
   *
   * @param {object} [henri=null] A henri instance
   * @memberof UploadsModule
   */
  constructor(henri = null) {
    super();

    this.reloadable = true;
    this.needs = ['config', 'server'];
    this.before = ['user', 'router'];
    this.runlevel = 3;
    this.name = 'uploads';
    this.henri = henri;

    this.enabled = false;
    this.settings = null;
    this.storage = null;
    this.signer = null;

    this._mounted = false;
    // One promise per derived key while the work runs, so a hundred
    // concurrent misses in this process derive the variant once
    this._deriving = new Map();

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.send = this.send.bind(this);
    this.url = this.url.bind(this);
    this.variant = this.variant.bind(this);
  }

  /**
   * Module initialization
   * Called after being loaded by Modules
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @throws when the storage cannot be prepared
   * @memberof UploadsModule
   */
  async init() {
    const { pen, server } = this.henri;

    this.settings = settingsOf(this.henri.config);

    // Mounted whether or not uploads are on: `req.files`, `req.file()` and
    // `req.permitFiles()` exist on every request the way `req.permit()` does,
    // and a reload that turns uploads on finds the middleware already in
    // place -- an express app cannot be given one later, only more of them.
    this.mount(server);

    if (!this.settings.enabled) {
      pen.info('uploads', 'disabled by configuration');

      return this.name;
    }

    this.storage = createStorage(this.henri, this.settings);
    this.signer = this.signerOf();

    try {
      await this.storage.start();
    } catch (error) {
      pen.error('uploads', 'unable to prepare the storage', error.message);
      throw error;
    }

    this.enabled = true;

    const { maxFiles, maxFileSize, maxTotalSize } = this.settings;

    pen.info(
      'uploads',
      `${this.storage.name} storage`,
      `${format(maxFileSize)} per file, ${format(maxTotalSize)} per request, ${
        maxFiles === false ? 'any number of' : maxFiles
      } files`
    );

    if (this.settings.allow) {
      pen.info('uploads', 'accepted types', this.settings.allow.join(', '));
    }

    if (this.settings.urls) {
      pen.info(
        'uploads',
        'signed urls',
        `${this.settings.urls.expiresIn}s, ${
          this.signs()
            ? `signed by ${this.storage.name}`
            : `verified at ${this.settings.urls.path}`
        }`
      );

      if (!this.signs() && !this.signer.usable) {
        pen.warn(
          'uploads',
          'signed urls are on, but this application has no secret',
          'henri.uploads.url() will refuse: set HENRI_SECRET'
        );
      }
    }

    if (this.settings.variants) {
      pen.info(
        'uploads',
        'variants',
        `${Object.keys(this.settings.variants).join(', ')} (derived once, on demand; needs sharp)`
      );
    }

    if (!this.settings.sniff) {
      pen.warn(
        'uploads',
        'content sniffing is off: the type of a file is whatever the client says it is'
      );
    }

    return this.name;
  }

  /**
   * Mounts the parser, once: a reload changes what it reads, never where it
   * sits in the chain (an express app has no way to remove a middleware, and
   * the position is the whole point -- before sessions and CSRF)
   *
   * @param {object} server the server module
   * @returns {boolean} whether it was mounted by this call
   * @memberof UploadsModule
   */
  mount(server) {
    if (this._mounted || !server || !server.app) {
      return false;
    }

    server.app.use(middleware(this));
    // After the parser, because the parser's position is what cannot move.
    // Both are mounted whether or not anything is on: what a reload changes
    // is what they do, never whether they are there
    server.app.use(downloads(this));

    this._mounted = true;

    return true;
  }

  /**
   * The signer of henri's own urls, built from `config.secret`
   *
   * @returns {UrlSigner} the signer
   * @memberof UploadsModule
   */
  signerOf() {
    const urls = this.settings.urls || {};

    return new UrlSigner({
      cdn: urls.cdn,
      expiresIn: urls.expiresIn,
      path: urls.path,
      secret: this.henri.config.get('secret'),
    });
  }

  /**
   * Does the storage sign its own urls?
   *
   * Asked rather than declared: the contract's `url()` answers null when
   * there is no such thing, so the answer is what it answers. The probe is a
   * key of the shape henri generates that names no object, because both
   * backends refuse anything else before they look at whether it is there.
   *
   * @returns {boolean} true when the storage has urls of its own
   * @memberof UploadsModule
   */
  signs() {
    if (!this.storage || typeof this.storage.url !== 'function') {
      return false;
    }

    try {
      return typeof this.storage.url(PROBE, { expiresIn: 60 }) === 'string';
    } catch (error) {
      debug('%s signs no url: %s', this.storage.name, error.message);

      return false;
    }
  }

  /**
   * Re-reads the configuration and the storage
   *
   * @async
   * @returns {Promise<string>} The name of the module
   * @memberof UploadsModule
   */
  async reload() {
    const previous = this.storage;

    this.settings = settingsOf(this.henri.config);
    this.signer = this.signerOf();
    this.mount(this.henri.server);

    if (!this.settings.enabled) {
      this.enabled = false;
      previous && (await previous.stop());
      this.storage = null;

      return this.name;
    }

    this.storage = createStorage(this.henri, this.settings);
    await this.storage.start();
    this.enabled = true;

    if (previous && previous !== this.storage) {
      await previous.stop();
    }

    return this.name;
  }

  /**
   * Hands a stored file back to a client.
   *
   * A download, not a page: `Content-Disposition: attachment` and
   * `X-Content-Type-Options: nosniff`, so nothing an application stored is
   * ever rendered on its own origin. `{ disposition: 'inline' }` is there for
   * the types an application knows it can trust -- an image it generated, a
   * PDF it wrote -- and is never the default.
   *
   * @async
   * @param {Express.Response} res the response
   * @param {object} record what `store()` returned, as read back from a model
   * @param {object} [options={}] `{ disposition, maxAge }`
   * @returns {Promise<Express.Response>} the response
   * @throws when the record names no key
   * @memberof UploadsModule
   */
  async send(res, record, options = {}) {
    const { disposition = 'attachment', maxAge = 0 } = options;
    const file = typeof record === 'string' ? { key: record } : record || {};

    if (!file.key) {
      throw new Error('henri.uploads.send() needs the record store() returned');
    }

    const stream = await this.ready().get(file.key);

    res.set('Content-Type', file.type || 'application/octet-stream');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set(
      'Content-Disposition',
      contentDisposition(file.name || 'file', disposition)
    );
    res.set(
      'Cache-Control',
      maxAge > 0 ? `private, max-age=${Math.floor(maxAge / 1000)}` : 'private'
    );

    if (typeof file.size === 'number') {
      res.set('Content-Length', String(file.size));
    }

    // The headers go out before the first chunk, so the response is
    // committed by the time this resolves: a controller that returns what
    // `send()` gives it has answered, and the action wrapper knows it
    typeof res.flushHeaders === 'function' && res.flushHeaders();

    await new Promise((resolve) => {
      stream.on('error', (error) => {
        debug('unable to stream %s: %s', file.key, error.message);
        res.destroy();
        resolve();
      });
      res.on('close', resolve);
      res.on('finish', resolve);
      stream.pipe(res);
    });

    return res;
  }

  /**
   * A time-limited url that hands a stored file to a client.
   *
   * One call, two implementations, the same semantics. On an object store it
   * is the provider's own signature, which covers the method, the host, the
   * key and every query parameter -- the expiry among them -- and the store
   * refuses it once the window has passed; the bytes never reach this
   * process. On the local disk it is henri's own (`src/signing.js`), covering
   * the key, the expiry, the disposition, the download name and the type,
   * verified by the route this module mounts.
   *
   * Neither can be edited to name another object and neither survives its
   * expiry. What both **are**, until then, is a bearer capability: whoever
   * holds the link holds the file, and no session is consulted. That is the
   * point of a signed url and the reason they are off unless
   * `config.uploads.urls` turns them on -- a file that must be checked per
   * viewer is handed back by a controller and `send()` instead.
   *
   * @async
   * @param {(object|string)} record what `store()` returned, or its key
   * @param {object} [options={}] `{ expiresIn, disposition, filename, type }`
   * @returns {Promise<string>} the url
   * @throws when signed urls are off, unsignable, or the argument is not a record
   * @memberof UploadsModule
   */
  async url(record, options = {}) {
    const file = typeof record === 'string' ? { key: record } : record || {};
    const storage = this.ready();

    if (!file.key) {
      throw new Error('henri.uploads.url() needs the record store() returned');
    }

    if (!this.settings.urls) {
      throw coded(
        'HENRI_UPLOAD_URLS_DISABLED',
        'this application hands out no signed urls: add { "uploads": { "urls": { "expiresIn": 300 } } } to the configuration, or hand the file back from a controller with henri.uploads.send()',
        { key: file.key }
      );
    }

    const asked = {
      disposition: options.disposition || 'attachment',
      expiresIn:
        options.expiresIn === undefined || options.expiresIn === null
          ? this.settings.urls.expiresIn
          : options.expiresIn,
      filename: options.filename || file.name || null,
      now: options.now,
      type: options.type || file.type || null,
    };
    const own =
      typeof storage.url === 'function'
        ? await storage.url(file.key, asked)
        : null;

    if (typeof own === 'string') {
      return own;
    }

    if (!this.signer.usable) {
      throw coded(
        'HENRI_UPLOAD_URLS_DISABLED',
        `${storage.name} signs no url of its own, and this application has no secret for henri to sign one with: set HENRI_SECRET`,
        { key: file.key }
      );
    }

    return this.signer.sign(file.key, asked);
  }

  /**
   * A derived file: the record of one declared variant of a stored image.
   *
   * The work happens here, once, and only when somebody asks: the derived
   * key is a digest of the variant's own terms, so an object that is
   * already there is one `stat()` away and a hundred concurrent callers in
   * one process derive it once. The result is a record with a key like any
   * other, so `send()`, `url()` and `delete()` take it unchanged.
   *
   * What it needs is `sharp`, an optional peer dependency the application
   * installs; without it this refuses with `HENRI_UPLOAD_NO_IMAGE_LIBRARY`
   * and the install line, rather than quietly answering the original.
   *
   * @async
   * @param {(object|string)} record what `store()` returned, or its key
   * @param {string} name a variant declared in `config.uploads.variants`
   * @returns {Promise<object>} `{ key, name, of, size, storage, type, uploadedAt }`
   * @throws when the variant is unknown, the source cannot be one, or the
   *   application has no image library
   * @memberof UploadsModule
   */
  async variant(record, name) {
    const file = typeof record === 'string' ? { key: record } : record || {};
    const storage = this.ready();
    const declared = this.settings.variants || {};
    const spec = declared[name];

    if (!file.key) {
      throw new Error(
        'henri.uploads.variant() needs the record store() returned'
      );
    }

    if (!spec) {
      throw coded(
        'HENRI_UPLOAD_VARIANT_UNKNOWN',
        `there is no variant called ${JSON.stringify(String(name))}${
          Object.keys(declared).length > 0
            ? `; this application declares ${Object.keys(declared).join(', ')}`
            : ': declare one under uploads.variants'
        }`,
        { key: file.key, variant: name }
      );
    }

    if (!SOURCES.has(file.type)) {
      throw coded(
        'HENRI_UPLOAD_VARIANT_UNSUPPORTED',
        `${file.type || 'this file'} is not an image a variant can be derived from${
          file.type === 'image/svg+xml'
            ? ': an SVG is text that carries script, and rendering one means parsing it'
            : ''
        }`,
        { key: file.key, type: file.type || null, variant: name }
      );
    }

    const key = variantKeyFor(file.key, spec);
    const found = await storage.stat(key);

    if (found) {
      return {
        key,
        name: file.name || null,
        of: file.key,
        size: found.size,
        storage: storage.name,
        type: FORMATS[spec.format],
        uploadedAt: new Date(found.modifiedAt).toISOString(),
      };
    }

    if (this._deriving.has(key)) {
      return this._deriving.get(key);
    }

    const work = produce({
      henri: this.henri,
      key,
      maxFileSize: this.settings.maxFileSize,
      record: file,
      spec,
      storage,
    }).finally(() => this._deriving.delete(key));

    this._deriving.set(key, work);

    return work;
  }

  /**
   * A readable stream of a stored file
   *
   * @async
   * @param {(object|string)} record the record, or its key
   * @returns {Promise<stream.Readable>} the stream
   * @memberof UploadsModule
   */
  async get(record) {
    return this.ready().get(typeof record === 'string' ? record : record.key);
  }

  /**
   * Removes a stored file
   *
   * @async
   * @param {(object|string)} record the record, or its key
   * @returns {Promise<boolean>} true when something was removed
   * @memberof UploadsModule
   */
  async delete(record) {
    return this.ready().delete(
      typeof record === 'string' ? record : record.key
    );
  }

  /**
   * The storage, or a readable error
   *
   * @returns {object} the storage
   * @throws when uploads are turned off
   * @memberof UploadsModule
   */
  ready() {
    if (this.enabled && this.storage) {
      return this.storage;
    }

    throw this.henri.pen.fatal(
      'uploads',
      `
      this application asked for an uploaded file, but uploads are off.
      Remove "uploads": false from the configuration`
    );
  }

  /**
   * Stops the module: releases the storage
   *
   * @async
   * @returns {Promise<(string|boolean)>} the module name, or false
   * @memberof UploadsModule
   */
  async stop() {
    if (!this.storage) {
      return false;
    }

    await this.storage.stop();
    this.enabled = false;
    this.signer = null;

    return this.name;
  }
}

module.exports = UploadsModule;
module.exports.DEFAULTS = DEFAULTS;
module.exports.UploadedFile = UploadedFile;
