/**
 * Encrypted credentials (Rails' `config/credentials/<env>.yml.enc`).
 *
 * `config/credentials/<env>.json.enc` is committed with the application and
 * holds the secrets of that environment. The key that opens it is never
 * committed: it is `HENRI_CREDENTIALS_KEY`, or `config/credentials/<env>.key`
 * on a development machine. A deployment therefore carries one secret instead
 * of twenty.
 *
 * JSON, not YAML: henri's configuration is JSON, the decrypted object is
 * merged into it key by key, and it needs no parser henri does not already
 * have.
 *
 * AES-256-GCM, from node's own crypto: the authentication tag turns a
 * modified file into a loud failure instead of plausible nonsense, and the
 * environment name is authenticated with it, so a file copied from another
 * environment does not open either. The envelope is one line:
 *
 *   henri:v1:<base64 iv>:<base64 tag>:<base64 ciphertext>
 *
 * Nothing here ever puts a decrypted value, or the value of a key, in an
 * error message.
 */
const { fail } = require('./errors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Authenticated cipher, key length in bytes and iv length in bytes */
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/** Envelope: `henri:v1:<iv>:<tag>:<ciphertext>`, all base64 */
const PREFIX = 'henri';
const VERSION = 'v1';

/** Where the files live, and the variable that carries the key */
const DIRECTORY = path.join('config', 'credentials');
const KEY_VARIABLE = 'HENRI_CREDENTIALS_KEY';

/**
 * The encrypted file of an environment
 *
 * @param {string} cwd the application directory
 * @param {string} env the environment (`production`, `dev`, ...)
 * @returns {string} its path
 */
const fileFor = (cwd, env) => path.join(cwd, DIRECTORY, `${env}.json.enc`);

/**
 * The key file of an environment (never committed)
 *
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @returns {string} its path
 */
const keyFileFor = (cwd, env) => path.join(cwd, DIRECTORY, `${env}.key`);

/**
 * A new key: 32 random bytes, as 64 hexadecimal characters
 *
 * @returns {string} the key
 */
const generateKey = () => crypto.randomBytes(KEY_LENGTH).toString('hex');

/**
 * A key as bytes
 *
 * @param {string} raw the key
 * @param {string} source where it comes from (a path or a variable name)
 * @returns {Buffer} the key
 * @throws {Error} when it is not 64 hexadecimal characters
 */
function parseKey(raw, source) {
  const text = String(raw === undefined || raw === null ? '' : raw).trim();

  if (!/^[0-9a-f]{64}$/i.test(text)) {
    throw fail(
      'HENRI_CONFIG_CREDENTIALS_KEY_MALFORMED',
      `The credentials key in ${source} is not 64 hexadecimal characters`
    );
  }

  return Buffer.from(text, 'hex');
}

/**
 * The key of an environment: `HENRI_CREDENTIALS_KEY` first, then the key file
 *
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @param {object} [environment=process.env] the environment variables
 * @returns {?{key: Buffer, source: string}} the key, or null when there is none
 * @throws {Error} when what was found is not a key
 */
function readKey(cwd, env, environment = process.env) {
  const fromEnv = environment[KEY_VARIABLE];

  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    return { key: parseKey(fromEnv, KEY_VARIABLE), source: KEY_VARIABLE };
  }

  const file = keyFileFor(cwd, env);

  if (!fs.existsSync(file)) {
    return null;
  }

  const source = path.relative(cwd, file);

  return { key: parseKey(fs.readFileSync(file, 'utf8'), source), source };
}

/**
 * Encrypt credentials
 *
 * @param {object} values the credentials
 * @param {Buffer} key the key
 * @param {string} env the environment, authenticated with the content
 * @returns {string} the envelope, one line
 */
function encrypt(values, key, env) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  cipher.setAAD(Buffer.from(`${PREFIX}:${VERSION}:${env}`, 'utf8'));

  const body = Buffer.concat([
    cipher.update(`${JSON.stringify(values, null, 2)}\n`, 'utf8'),
    cipher.final(),
  ]);

  return `${[
    PREFIX,
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join(':')}\n`;
}

/**
 * Decrypt credentials
 *
 * @param {string} content the envelope
 * @param {Buffer} key the key
 * @param {string} env the environment it was written for
 * @param {string} [label='the credentials'] what to call the file
 * @returns {object} the credentials
 * @throws {Error} when the envelope, the key or the content is wrong
 */
function decrypt(content, key, env, label = 'the credentials') {
  const parts = String(content).trim().split(':');

  if (parts.length !== 5 || parts[0] !== PREFIX || parts[1] !== VERSION) {
    throw fail(
      'HENRI_CONFIG_CREDENTIALS_INVALID',
      `${label} is not a henri credentials file`
    );
  }

  const [, , iv, tag, body] = parts;
  let plain;

  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64')
    );

    decipher.setAAD(Buffer.from(`${PREFIX}:${VERSION}:${env}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    plain = Buffer.concat([
      decipher.update(Buffer.from(body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // The cipher fails the same way for a wrong key and for a modified
    // file, and its message says nothing useful: neither is echoed
    throw fail(
      'HENRI_CONFIG_CREDENTIALS_KEY_INVALID',
      `${label} could not be decrypted: wrong key, or the file was modified`
    );
  }

  try {
    const values = JSON.parse(plain);

    if (values === null || typeof values !== 'object') {
      throw new Error('not an object');
    }

    return values;
  } catch {
    // The parser quotes what it choked on, and that is a decrypted secret
    throw fail(
      'HENRI_CONFIG_CREDENTIALS_INVALID',
      `${label} does not hold a JSON object`
    );
  }
}

/**
 * The leaves of an object, as `{ key, value }` pairs on dotted paths
 *
 * An array, a date or any other value that is not a plain object is a leaf:
 * it replaces what the configuration file has at that path rather than being
 * merged into it.
 *
 * @param {object} values the credentials
 * @param {string} [prefix=''] the path of `values` (internal)
 * @returns {Array<{key: string, value: any}>} the pairs
 */
function leaves(values, prefix = '') {
  const found = [];

  for (const [name, value] of Object.entries(values)) {
    const key = prefix === '' ? name : `${prefix}.${name}`;
    const plain =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype;

    if (plain && Object.keys(value).length > 0) {
      found.push(...leaves(value, key));
      continue;
    }

    found.push({ key, value });
  }

  return found;
}

/**
 * The credentials of an environment, when the application has some
 *
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @param {object} [environment=process.env] the environment variables
 * @returns {?{entries: Array, file: string, source: string, values: object}}
 *   the credentials, or null when the application has no file
 * @throws {Error} when the file cannot be read, opened or parsed
 */
function read(cwd, env, environment = process.env) {
  const file = fileFor(cwd, env);

  if (!fs.existsSync(file)) {
    return null;
  }

  const label = path.relative(cwd, file);
  const found = readKey(cwd, env, environment);

  if (!found) {
    throw fail(
      'HENRI_CONFIG_CREDENTIALS_KEY_MISSING',
      `${label} needs a key: set ${KEY_VARIABLE}, or put it back in ${path.relative(cwd, keyFileFor(cwd, env))}`
    );
  }

  const values = decrypt(fs.readFileSync(file, 'utf8'), found.key, env, label);

  return { entries: leaves(values), file, source: found.source, values };
}

/**
 * Write the credentials of an environment, creating the directory
 *
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @param {object} values the credentials
 * @param {Buffer} key the key
 * @returns {string} the path of the file
 */
function write(cwd, env, values, key) {
  const file = fileFor(cwd, env);

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encrypt(values, key, env), { mode: 0o600 });

  return file;
}

module.exports = {
  DIRECTORY,
  KEY_VARIABLE,
  decrypt,
  encrypt,
  fileFor,
  generateKey,
  keyFileFor,
  leaves,
  parseKey,
  read,
  readKey,
  write,
};
