const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const debug = require('debug')('henri:uploads');

const { isKey } = require('../names');

/**
 * Storage contract, the way `HenriAdapter` is the store contract.
 *
 * The module builds one with `new Storage(name, config, henri)` and calls
 * `start()` before the first request. Everything else is called per file.
 * The local disk below is one implementation; an object store is another,
 * and the seam is deliberately narrow so that writing the second one is a
 * hundred lines rather than a fork.
 *
 * `temp()` is part of the contract on purpose. A multipart part is streamed
 * somewhere before anything has authorized keeping it, and only the storage
 * knows where that somewhere should be: on the local disk it is a directory
 * inside the root, so promoting a file is a rename on the same filesystem
 * rather than a copy; on an object store it is whatever the machine has.
 *
 * @interface HenriStorage
 * @property {string} name The storage name (`local`, or the module id)
 * @method async start() Prepares the storage; called once, before the server
 *   answers
 * @method async stop() Releases what it holds; `start()` may be called again
 * @method async temp() `{ path }`: a private file to stream a part into
 * @method async put(source, key, meta) Moves `source` in under `key`;
 *   resolves with the key that was written. `meta` is what the parser
 *   already knows -- `{ checksum, name, size, type }` -- which a backend
 *   that keeps metadata of its own wants and one that does not ignores
 * @method async get(key) A readable stream of the object
 * @method async stat(key) `{ size, modifiedAt }`, or null when there is none
 * @method async delete(key) Removes it; resolves false when there was none
 * @method url(key, options) A time-limited url handing the object to a
 *   client without this process reading it, or null when the storage has no
 *   such thing. `{ expiresIn, disposition, type }`; may be a promise
 */

/** The mode of the storage root and of the temporary directory */
const DIR_MODE = 0o700;

/** The mode of every stored object: readable by the process, nobody else */
const FILE_MODE = 0o600;

/** Where the parts being read are kept, inside the root */
const TMP = '.tmp';

/**
 * How old a part has to be before a boot sweeps it away.
 *
 * The root is shared by everything that runs against it -- two application
 * processes behind a load balancer, a suite whose test files run at the same
 * time -- and a boot cannot tell a part a dead process left behind from one
 * another process is streaming into right now. Age can: a part being written
 * is minutes old at most, so an hour is past every upload the bounds allow
 * and still short enough that nothing accumulates.
 */
const STALE = 60 * 60 * 1000;

/**
 * What is written into the storage root the first time it is created.
 *
 * The root is a directory of an application's repository by default, and an
 * upload directory that reached a commit is the sort of thing that is found
 * later rather than sooner.
 */
const GITIGNORE = `# Uploaded files: never committed, never served.\n*\n!.gitignore\n`;

/**
 * The local disk
 *
 * @class LocalStorage
 * @implements {HenriStorage}
 */
class LocalStorage {
  /**
   * Creates an instance of LocalStorage.
   *
   * @param {string} name The storage name
   * @param {object} config `{ root }`, resolved against the application
   * @param {object} henri The henri instance
   * @memberof LocalStorage
   */
  constructor(name, config = {}, henri = null) {
    this.name = name || 'local';
    this.henri = henri;
    this.root = path.resolve(
      (henri && henri.cwd && henri.cwd()) || process.cwd(),
      config.root || 'storage/uploads'
    );
    this.tmp = path.join(this.root, TMP);
    this.started = false;
  }

  /**
   * Creates the root and the temporary directory, and leaves a `.gitignore`
   * behind the first time
   *
   * @async
   * @returns {Promise<string>} the root
   * @memberof LocalStorage
   */
  async start() {
    await fsp.mkdir(this.tmp, { mode: DIR_MODE, recursive: true });
    await fsp.chmod(this.root, DIR_MODE).catch(() => {});

    const ignore = path.join(this.root, '.gitignore');

    try {
      await fsp.writeFile(ignore, GITIGNORE, { flag: 'wx' });
    } catch (error) {
      debug('%s already has a .gitignore', this.root);
    }

    await this.sweep();

    this.started = true;

    return this.root;
  }

  /**
   * Nothing to release: the disk is the disk
   *
   * @async
   * @returns {Promise<boolean>} true
   * @memberof LocalStorage
   */
  async stop() {
    this.started = false;

    return true;
  }

  /**
   * Removes the parts a previous process was reading when it died.
   *
   * Every request cleans up after itself, so this only ever finds what a
   * `SIGKILL` or a power cut left behind. It runs at boot, where a stale
   * file is a leak nobody is watching rather than a bug in the request.
   *
   * Only parts older than `STALE` are removed: another process may be
   * streaming into this same directory right now, and unlinking its part
   * would fail its request with something that reads like a bug in the
   * upload rather than what it is.
   *
   * @async
   * @returns {Promise<number>} how many were removed
   * @memberof LocalStorage
   */
  async sweep() {
    let entries;

    try {
      entries = await fsp.readdir(this.tmp);
    } catch (error) {
      return 0;
    }

    const before = Date.now() - STALE;
    let removed = 0;

    for (const entry of entries) {
      if (!entry.endsWith('.part')) {
        continue;
      }

      const file = path.join(this.tmp, entry);

      try {
        if ((await fsp.stat(file)).mtimeMs > before) {
          continue;
        }

        await fsp.unlink(file);
        removed++;
      } catch (error) {
        debug('unable to remove the stale part %s: %s', entry, error.message);
      }
    }

    removed > 0 && debug('removed %d stale part(s)', removed);

    return removed;
  }

  /**
   * A private file to stream a part into
   *
   * @async
   * @returns {Promise<{path: string}>} where to write
   * @memberof LocalStorage
   */
  async temp() {
    await fsp.mkdir(this.tmp, { mode: DIR_MODE, recursive: true });

    return {
      path: path.join(
        this.tmp,
        `${crypto.randomBytes(16).toString('hex')}.part`
      ),
    };
  }

  /**
   * The absolute path of a key, refusing anything henri did not generate.
   *
   * Two locks, because one of them is a regular expression: the key must
   * have the shape `keyFor()` writes, and the path it resolves to must be
   * inside the root. A key that passes the first and fails the second does
   * not exist, which is the point of checking both.
   *
   * @param {string} key the key
   * @returns {string} the absolute path
   * @throws when the key is not one henri could have generated
   * @memberof LocalStorage
   */
  pathOf(key) {
    if (!isKey(key)) {
      throw new Error(`unsafe storage key: ${JSON.stringify(String(key))}`);
    }

    const full = path.resolve(this.root, key);

    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new Error(`storage key escapes the root: ${key}`);
    }

    return full;
  }

  /**
   * Moves a part in under its key
   *
   * @async
   * @param {string} source the temporary file
   * @param {string} key the key to store it under
   * @returns {Promise<string>} the key
   * @throws when the key is unsafe, or the file cannot be written
   * @memberof LocalStorage
   */
  async put(source, key) {
    const target = this.pathOf(key);

    await fsp.mkdir(path.dirname(target), { mode: DIR_MODE, recursive: true });

    try {
      await fsp.rename(source, target);
    } catch (error) {
      // A different filesystem (a bind mount, a tmpfs root): copy, then drop
      // the part. `COPYFILE_EXCL` keeps a key that already exists from being
      // overwritten, which a generated key never is.
      if (error.code !== 'EXDEV') {
        throw error;
      }

      await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      await fsp.unlink(source).catch(() => {});
    }

    await fsp.chmod(target, FILE_MODE).catch(() => {});

    return key;
  }

  /**
   * A readable stream of a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<fs.ReadStream>} the stream
   * @throws when the key is unsafe or there is no such object
   * @memberof LocalStorage
   */
  async get(key) {
    const target = this.pathOf(key);

    await fsp.access(target, fs.constants.R_OK);

    return fs.createReadStream(target);
  }

  /**
   * What is known about a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<?{size: number, modifiedAt: Date}>} the facts, or null
   * @memberof LocalStorage
   */
  async stat(key) {
    try {
      const stats = await fsp.stat(this.pathOf(key));

      return { modifiedAt: stats.mtime, size: stats.size };
    } catch (error) {
      return null;
    }
  }

  /**
   * Removes a stored object
   *
   * @async
   * @param {string} key the key
   * @returns {Promise<boolean>} true when something was removed
   * @memberof LocalStorage
   */
  async delete(key) {
    try {
      await fsp.unlink(this.pathOf(key));

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * The local disk has no public url, and that is the whole idea: a stored
   * file is reached through a controller that decides who may
   *
   * @returns {null} null
   * @memberof LocalStorage
   */
  url() {
    return null;
  }
}

module.exports = LocalStorage;
module.exports.DIR_MODE = DIR_MODE;
module.exports.FILE_MODE = FILE_MODE;
module.exports.GITIGNORE = GITIGNORE;
module.exports.TMP = TMP;
