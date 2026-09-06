/**
 * `@usehenri/s3`: the object store an application names when one machine is
 * not enough.
 *
 * ---------------------------------------------------------------------------
 * Why this is a package of its own
 * ---------------------------------------------------------------------------
 *
 * `@usehenri/redis` is the precedent, and the shape is the same one:
 * `config.shared` names `redis`, core resolves `@usehenri/redis` from the
 * application, and an application that counts in this process installs
 * nothing. Here `config.uploads.storage` names `s3`, `@usehenri/uploads`
 * resolves `@usehenri/s3` from the application, and an application that keeps
 * its files on the disk installs nothing.
 *
 * The alternative was a backend inside `@usehenri/uploads`, and it is worse
 * for a reason that has nothing to do with taste: everyone who accepts a
 * file installs that package, and most of them keep their files on one
 * machine. A signature implementation, an HTTP client, a retry policy and a
 * presigner would then be dead weight in every one of those installs, and
 * every fix to any of them would be a release of the package that parses
 * multipart bodies. The seam already existed for exactly this; using it is
 * the point.
 *
 * ---------------------------------------------------------------------------
 * One backend, four providers
 * ---------------------------------------------------------------------------
 *
 * S3, R2, Spaces, MinIO and GCS's interoperability mode all speak the same
 * API, and what tells them apart is an endpoint and a region -- not four
 * backends:
 *
 * ```json
 * {
 *   "uploads": {
 *     "storage": {
 *       "adapter": "s3",
 *       "bucket": "henri-uploads",
 *       "region": "auto",
 *       "endpoint": "https://<account>.r2.cloudflarestorage.com"
 *     }
 *   }
 * }
 * ```
 *
 * The credentials are read from `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY` unless the block names them, because a key in a
 * configuration file is a key in a repository.
 *
 * ---------------------------------------------------------------------------
 * What is kept from the local disk, and why
 * ---------------------------------------------------------------------------
 *
 * Every safety property of `@usehenri/uploads` is a property of the *key* and
 * of the *parser*, not of the filesystem, so all of them survive the move:
 *
 * - the key is generated and the storage refuses any other shape -- `isKey()`
 *   is asked here before a request is built, exactly as `pathOf()` asks it
 *   before a path is;
 * - the type comes from the bytes, which happened before this ever saw the
 *   file, and it is what the object's `Content-Type` is set to (so a
 *   presigned url hands back the type henri decided on, not one a client
 *   claimed);
 * - the original name is metadata, and it stays metadata -- it goes in
 *   `x-amz-meta-name`, never in the key;
 * - nothing is kept unless a controller called `store()`, because a part is
 *   streamed to a local temporary file first and only promoted then.
 *
 * `temp()` is a local directory, which is what the contract exists for: a
 * part has to land somewhere before anything has authorized keeping it, and
 * that somewhere cannot be the object store -- an upload that was refused
 * would already have been paid for and would still have to be deleted. So
 * the temporary area is `LocalStorage`, reused rather than reimplemented,
 * which brings its `0700`/`0600` modes, its `.gitignore` and its sweep of
 * what a killed process left behind.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const debug = require('debug')('henri:s3');

const { LocalStorage, isKey } = require('@usehenri/uploads');

const { S3Client } = require('./client');
const { coded } = require('./errors');

/** How long a presigned url lasts when nobody said */
const EXPIRES_IN = 300;

/**
 * The credentials, from the block or from the environment.
 *
 * The environment first in the documentation and second in the code: an
 * application that wrote them down means it, and the reason to read the
 * environment is that most applications should not write them down at all.
 *
 * @param {object} options the storage block
 * @param {object} [env=process.env] the environment
 * @returns {object} the block, with credentials
 */
const withEnvironment = (options, env = process.env) =>
  Object.assign({}, options, {
    accessKeyId: options.accessKeyId || env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: options.secretAccessKey || env.AWS_SECRET_ACCESS_KEY || '',
    sessionToken: options.sessionToken || env.AWS_SESSION_TOKEN || null,
  });

/**
 * The sha256 of a local file, which is what `x-amz-content-sha256` is
 *
 * @param {string} file the path
 * @returns {Promise<string>} the digest, hex
 */
async function digest(file) {
  const hash = crypto.createHash('sha256');

  for await (const chunk of fs.createReadStream(file)) {
    hash.update(chunk);
  }

  return hash.digest('hex');
}

/**
 * An object store, over the S3 API
 *
 * @class S3Storage
 * @implements {HenriStorage}
 */
class S3Storage {
  /**
   * Creates an instance of S3Storage.
   *
   * @param {string} name The storage name
   * @param {object} [config={}] `{ options, root }` from `createStorage()`
   * @param {object} [henri=null] The henri instance
   * @memberof S3Storage
   */
  constructor(name, config = {}, henri = null) {
    const options = config.options || config || {};

    this.name = name || 's3';
    this.henri = henri;
    this.options = options;
    this.client = new S3Client(withEnvironment(options));
    this.expiresIn =
      Number(options.expiresIn) > 0 ? Number(options.expiresIn) : EXPIRES_IN;

    // The temporary area is local, and it is the local storage: same modes,
    // same .gitignore, same sweep of the parts a killed process left behind
    this.local = new LocalStorage(
      this.name,
      { root: options.tmp || config.root || 'storage/uploads' },
      henri
    );
    this.started = false;
  }

  /**
   * Checks the configuration, prepares the temporary area and says whether
   * the bucket answers.
   *
   * A configuration that cannot be right fails the boot; a bucket that did
   * not answer is a warning, the way a store that did not connect is. The
   * first is a mistake in the application, the second is the network, and
   * only one of them is fixed by refusing to start.
   *
   * @async
   * @returns {Promise<string>} the bucket
   * @throws when the configuration is unusable
   * @memberof S3Storage
   */
  async start() {
    this.client.check();
    await this.local.start();

    const failure = await this.ping();

    if (failure && this.henri && this.henri.pen) {
      this.henri.pen.warn(
        'uploads',
        `${this.client.bucket} did not answer`,
        failure.message
      );
    }

    this.started = true;

    return this.client.bucket;
  }

  /**
   * Asks the bucket whether it is there
   *
   * @async
   * @returns {Promise<?Error>} what went wrong, or null
   * @memberof S3Storage
   */
  async ping() {
    try {
      // `HEAD` on the bucket itself, which is the one request that answers
      // all three questions at once: the endpoint resolves, the credentials
      // sign something the store accepts, and the bucket is there
      const found = await this.client.stat('');

      return found
        ? null
        : coded(
            'HENRI_UPLOAD_STORAGE_MISCONFIGURED',
            `there is no bucket named ${this.client.bucket} at ${this.client.host}, or these credentials cannot see it`
          );
    } catch (error) {
      debug('the bucket did not answer: %s', error.message);

      return error;
    }
  }

  /**
   * Releases the temporary area
   *
   * @async
   * @returns {Promise<boolean>} true
   * @memberof S3Storage
   */
  async stop() {
    this.started = false;

    return this.local.stop();
  }

  /**
   * A private local file to stream a part into
   *
   * @async
   * @returns {Promise<{path: string}>} where to write
   * @memberof S3Storage
   */
  async temp() {
    return this.local.temp();
  }

  /**
   * The key, or a readable refusal.
   *
   * The same two words the local disk says, for the same reason: a key henri
   * did not generate is a key an application built out of something a client
   * sent, and there is no version of that worth making a request for.
   *
   * @param {string} key the key
   * @returns {string} the key
   * @throws when the key is not one henri could have generated
   * @memberof S3Storage
   */
  keyOf(key) {
    if (!isKey(key)) {
      throw coded(
        'HENRI_UPLOAD_STORAGE_FAILED',
        `unsafe storage key: ${JSON.stringify(String(key))}`
      );
    }

    return key;
  }

  /**
   * Uploads a part under its key and removes the part
   *
   * @async
   * @param {string} source the temporary file
   * @param {string} key the key to store it under
   * @param {object} [meta={}] `{ checksum, name, size, type }`, what the
   *   parser already knows about the file
   * @returns {Promise<string>} the key
   * @throws when the key is unsafe or the store refused
   * @memberof S3Storage
   */
  async put(source, key, meta = {}) {
    this.keyOf(key);

    const { size } = await fsp.stat(source);
    // The parser hashed the bytes on their way to the disk, and that digest
    // is exactly what `x-amz-content-sha256` wants: the file is read twice
    // only when it was handed over without one
    const checksum = /^[0-9a-f]{64}$/u.test(String(meta.checksum))
      ? meta.checksum
      : await digest(source);

    await this.client.put(key, {
      checksum,
      file: source,
      length: size,
      name: meta.name || null,
      type: meta.type || null,
    });

    await fsp.unlink(source).catch(() => {});

    return key;
  }

  /**
   * A readable stream of a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<stream.Readable>} the stream
   * @throws when the key is unsafe or there is no such object
   * @memberof S3Storage
   */
  async get(key) {
    return this.client.get(this.keyOf(key));
  }

  /**
   * What is known about a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<?{size: number, modifiedAt: Date}>} the facts, or null
   * @memberof S3Storage
   */
  async stat(key) {
    try {
      return await this.client.stat(this.keyOf(key));
    } catch (error) {
      debug('unable to stat %s: %s', key, error.message);

      return null;
    }
  }

  /**
   * Removes a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<boolean>} true when something was removed
   * @memberof S3Storage
   */
  async delete(key) {
    try {
      return await this.client.delete(this.keyOf(key));
    } catch (error) {
      debug('unable to delete %s: %s', key, error.message);

      return false;
    }
  }

  /**
   * A time-limited url that hands the object to the client directly.
   *
   * The provider's own signature, not henri's: it covers the method, the
   * host, the key and every query parameter -- the expiry among them -- so a
   * url cannot be edited to name another object or to last longer, and the
   * store refuses it once `X-Amz-Expires` seconds have passed since
   * `X-Amz-Date`.
   *
   * `disposition` and `type` are signed too, as `response-content-*`
   * overrides, which is what keeps a link to an uploaded file a download
   * rather than a page.
   *
   * @param {string} key the key
   * @param {object} [options={}] `{ expiresIn, disposition, type, now }`
   * @returns {string} the url
   * @throws when the key is unsafe or the window is one S3 refuses
   * @memberof S3Storage
   */
  url(key, options = {}) {
    this.keyOf(key);

    const query = {};

    if (options.disposition) {
      query['response-content-disposition'] = options.disposition;
    }

    if (options.type) {
      query['response-content-type'] = options.type;
    }

    return this.client.url(key, {
      expiresIn: options.expiresIn || this.expiresIn,
      now: options.now,
      query,
    });
  }
}

module.exports = S3Storage;
module.exports.EXPIRES_IN = EXPIRES_IN;
module.exports.S3Storage = S3Storage;
module.exports.digest = digest;
module.exports.withEnvironment = withEnvironment;
