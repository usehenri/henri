const BaseModule = require('@usehenri/core/module');

const debug = require('debug')('henri:uploads');

const { DEFAULTS, settings: settingsOf } = require('./config');
const { format } = require('./bytes');
const { contentDisposition } = require('./names');
const { createStorage } = require('./storage');
const { middleware } = require('./multipart');
const { UploadedFile } = require('./file');

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
 * another, named by module id in `config.uploads.storage` and resolved from
 * the application the way a rate limit store is. henri ships no S3 client.
 * `temp()` is part of the contract because only the storage knows where a
 * part should land so that keeping it is cheap -- a rename on the same
 * filesystem, locally.
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

    this._mounted = false;

    this.init = this.init.bind(this);
    this.reload = this.reload.bind(this);
    this.stop = this.stop.bind(this);
    this.send = this.send.bind(this);
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

    this._mounted = true;

    return true;
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

    return this.name;
  }
}

module.exports = UploadsModule;
module.exports.DEFAULTS = DEFAULTS;
module.exports.UploadedFile = UploadedFile;
