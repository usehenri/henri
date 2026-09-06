/**
 * Which storage an application uses.
 *
 * `"storage": "local"` is the disk below. Anything else is a module id,
 * resolved from the application the way `config.rateLimit.store` and
 * `config.api.idempotency.store` are (`base/api.js` in core does the same
 * thing for the same reason): a package henri does not ship, installed by
 * the application that wants it, exporting either a storage or a
 * `(henri, { name, config }) => storage` factory.
 *
 * henri ships the local disk and no client for anybody's object store. An
 * S3 client is a dependency, a credential chain, a region, a retry policy
 * and a bill, and none of that belongs in a framework that would then own
 * its upgrades.
 */
const path = require('node:path');

const LocalStorage = require('./local');

/** The storage names henri implements itself */
const BUILTIN = { local: LocalStorage };

/**
 * Builds the storage the configuration names
 *
 * @param {object} henri the henri instance
 * @param {object} settings the normalized upload settings
 * @returns {object} a storage implementing `HenriStorage`
 * @throws when the module cannot be loaded, or is not a storage
 */
function createStorage(henri, settings) {
  const { root, storage: name } = settings;

  if (BUILTIN[name]) {
    return new BUILTIN[name](name, { root }, henri);
  }

  const cwd = henri.cwd();
  const target = name.startsWith('.') ? path.resolve(cwd, name) : name;
  let loaded;

  try {
    loaded = require(henri.utils.resolveFrom(target, cwd));
  } catch (error) {
    throw new Error(`unable to load the storage '${name}': ${error.message}`, {
      cause: error,
    });
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

  return Storage.prototype && typeof Storage.prototype.put === 'function'
    ? new Storage(name, { config: settings, root: settings.root }, henri)
    : Storage(henri, { config: settings, name });
}

module.exports = { BUILTIN, LocalStorage, createStorage };
