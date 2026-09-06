/**
 * One file that arrived.
 *
 * It exists on disk from the moment the parser finished reading it until the
 * end of the request, and it is temporary for the whole of that time: an
 * upload is not kept because it arrived, it is kept because a controller
 * said so with `store()`. Everything else is swept when the response closes,
 * whether the request was answered, refused, timed out or abandoned
 * half-way.
 *
 * What `store()` resolves with is the record: the plain object a controller
 * writes to a model. It holds the key, the cleaned original name, the type
 * the *bytes* were recognized as, the size and a sha256 of the content --
 * everything needed to hand the file back later, and nothing that would let
 * the row alone reconstruct where on the machine it sits.
 */
const fsp = require('node:fs/promises');
const debug = require('debug')('henri:uploads');

const { extensionFor } = require('./sniff');
const { keyFor, safeName } = require('./names');

/**
 * A file the parser read and put somewhere private
 *
 * @class UploadedFile
 */
class UploadedFile {
  /**
   * Creates an instance of UploadedFile.
   *
   * @param {object} options what the parser found out
   * @param {string} options.field the form field it arrived in
   * @param {string} options.name the cleaned original name
   * @param {string} options.declaredType what the client called it
   * @param {string} options.type what the bytes say it is
   * @param {boolean} options.sniffed whether henri recognized those bytes
   * @param {number} options.size how many bytes arrived
   * @param {string} options.checksum sha256 of the content, hex
   * @param {string} options.path where it is, until the response closes
   * @param {object} options.storage the storage that will keep it
   * @param {number} [options.order=0] which part of the body it was, so that
   *   `req.files.photos[0]` is the first photo the form sent whatever order
   *   the reads happened to finish in
   * @memberof UploadedFile
   */
  constructor({
    checksum,
    declaredType,
    field,
    name,
    order = 0,
    path: temporary,
    size,
    sniffed,
    storage,
    type,
  }) {
    this.order = order;
    this.field = field;
    this.name = name;
    this.declaredType = declaredType;
    this.type = type;
    this.sniffed = sniffed;
    this.size = size;
    this.checksum = checksum;
    this.path = temporary;
    this.storage = storage;

    /** The record `store()` resolved with, once it has */
    this.stored = null;

    /** True once the temporary file is gone, however it went */
    this.released = false;
  }

  /**
   * Did the client say one thing and the bytes another?
   *
   * @returns {boolean} true when the declared type is not the real one
   * @memberof UploadedFile
   */
  get mistyped() {
    return (
      this.sniffed &&
      Boolean(this.declaredType) &&
      this.declaredType !== this.type
    );
  }

  /**
   * Keeps the file, and answers the record to write to a model
   *
   * @async
   * @param {object} [options={}] the options
   * @param {string} [options.prefix] a directory to file it under
   * @param {object} [options.storage] another storage than the default one
   * @returns {Promise<object>} `{ checksum, key, name, size, storage, type, uploadedAt }`
   * @throws when there is nothing left to store, or the storage refuses
   * @memberof UploadedFile
   */
  async store(options = {}) {
    if (this.stored) {
      return this.stored;
    }

    if (this.released) {
      throw new Error(
        `the upload "${this.name}" was already released; store() has to be called before the response closes`
      );
    }

    const storage = options.storage || this.storage;
    const key = await storage.put(
      this.path,
      keyFor({
        extension: extensionFor(this.type),
        prefix: options.prefix || null,
      })
    );

    this.released = true;
    this.stored = {
      checksum: this.checksum,
      key,
      name: this.name,
      size: this.size,
      storage: storage.name,
      type: this.type,
      uploadedAt: new Date().toISOString(),
    };

    return this.stored;
  }

  /**
   * Throws the file away now, rather than at the end of the request
   *
   * @async
   * @returns {Promise<boolean>} true when something was removed
   * @memberof UploadedFile
   */
  async discard() {
    if (this.released) {
      return false;
    }

    this.released = true;

    try {
      await fsp.unlink(this.path);

      return true;
    } catch (error) {
      debug('unable to remove %s: %s', this.path, error.message);

      return false;
    }
  }

  /**
   * What a view or a JSON answer gets: the record when it was stored, the
   * facts without the temporary path when it was not
   *
   * @returns {object} a plain object
   * @memberof UploadedFile
   */
  toJSON() {
    return (
      this.stored || {
        checksum: this.checksum,
        field: this.field,
        name: this.name,
        size: this.size,
        type: this.type,
      }
    );
  }
}

/**
 * An UploadedFile, with its name cleaned and its type decided
 *
 * @param {object} options see the constructor, plus `maxFilenameLength`
 * @returns {UploadedFile} the file
 */
const fileOf = (options) =>
  new UploadedFile(
    Object.assign({}, options, {
      name: safeName(options.name, options.maxFilenameLength),
    })
  );

module.exports = { UploadedFile, fileOf };
