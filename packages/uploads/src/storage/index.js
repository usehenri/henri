/**
 * Which storage an application uses.
 *
 * `"storage": "local"` is the disk below, and it is what an application that
 * says nothing gets. Every other name is a package resolved from the
 * application, the way `config.shared.adapter` resolves `@usehenri/redis`
 * and `config.rateLimit.store` resolves a module of its own: `s3` is
 * `@usehenri/s3`, and anything else is taken as a module id.
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
 * The object form is the one a backend needs, because a backend has
 * settings: `adapter` names it and everything else reaches it, exactly as
 * `config.shared` and `config.stores.<name>` already work. The string form
 * is the same thing without settings, and it still works.
 *
 * **What changed in 1.2, and what did not.** henri used to ship no client for
 * anybody's object store, on the grounds that an S3 client is a dependency,
 * a credential chain, a region, a retry policy and a bill. Two of those
 * were true and are still true, which is why the client is not here: it is
 * `@usehenri/s3`, installed by the application that wants it and by nobody
 * else. What was wrong was the conclusion -- that the framework could
 * therefore ship nothing at all -- because "an upload works until you run a
 * second process" is not a decision an application makes, it is a trap the
 * framework sets.
 */
const path = require('node:path');

const LocalStorage = require('./local');

/** The storage names henri implements itself */
const BUILTIN = { local: LocalStorage };

/**
 * The names that are a package of henri's, the way `shared.adapter` maps
 * `redis` to `@usehenri/redis`
 */
const PACKAGES = { s3: '@usehenri/s3' };

/**
 * Builds the storage the configuration names
 *
 * @param {object} henri the henri instance
 * @param {object} settings the normalized upload settings
 * @returns {object} a storage implementing `HenriStorage`
 * @throws when the module cannot be loaded, or is not a storage
 */
function createStorage(henri, settings) {
  const { root, storage: name, storageOptions: options = {} } = settings;

  if (BUILTIN[name]) {
    return new BUILTIN[name](name, { options, root }, henri);
  }

  const cwd = henri.cwd();
  const named = PACKAGES[name];
  const target =
    named || (name.startsWith('.') ? path.resolve(cwd, name) : name);
  let loaded;

  try {
    loaded = require(henri.utils.resolveFrom(target, cwd));
  } catch (error) {
    throw new Error(
      named
        ? `the '${name}' storage needs ${named}: pnpm add ${named} (${error.message})`
        : `unable to load the storage '${name}': ${error.message}`,
      { cause: error }
    );
  }

  const mod = loaded && loaded.default ? loaded.default : loaded;
  const built = build(mod, name, settings, henri);

  if (!built || typeof built.put !== 'function') {
    throw new Error(
      `the storage '${name}' does not implement HenriStorage (put, get, stat, delete, temp)`
    );
  }

  return built;
}

/**
 * The storage a module exported: a class to build, a factory to call, or an
 * object that is already one
 *
 * A class is told apart from a factory by its prototype carrying `put`,
 * which is the one method of the contract nothing else has a reason to have.
 *
 * @param {*} mod what the module exported
 * @param {string} name the storage name
 * @param {object} settings the normalized upload settings
 * @param {object} henri the henri instance
 * @returns {*} the storage
 */
function build(mod, name, settings, henri) {
  if (typeof mod !== 'function') {
    return mod;
  }

  const Storage = mod;
  const config = {
    config: settings,
    options: settings.storageOptions || {},
    root: settings.root,
  };

  return Storage.prototype && typeof Storage.prototype.put === 'function'
    ? new Storage(name, config, henri)
    : Storage(henri, { config: settings, name, options: config.options });
}

module.exports = { BUILTIN, LocalStorage, PACKAGES, createStorage };
