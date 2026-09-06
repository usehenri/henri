const fs = require('fs');
const os = require('os');
const path = require('path');
const spawn = require('cross-spawn');

const { CliError } = require('./errors');
const { usage } = require('./help');
const { validInstall } = require('./utils');

const COMMANDS = ['edit', 'show'];

/** What a new credentials file starts with: the secret henri needs anyway */
const TEMPLATE = () => ({
  secret: require('crypto').randomBytes(32).toString('hex'),
});

/**
 * Prefer the @usehenri/core the project depends on and fall back to the one
 * shipped with this CLI (same rule as `henri db`)
 *
 * @returns {object} core's credentials module
 */
const load = () => {
  try {
    return require(
      require.resolve('@usehenri/core/src/base/credentials', {
        paths: [process.cwd()],
      })
    );
  } catch {
    return require('@usehenri/core/src/base/credentials');
  }
};

/**
 * The environment the command works on: `--env`, then NODE_ENV (which
 * `--production` sets), then `dev` — the same name henri reads its
 * configuration file under
 *
 * @param {object} args CLI arguments
 * @returns {string} the environment
 */
const environmentOf = (args) => {
  const name = typeof args.env === 'string' && args.env ? args.env : null;

  return name || process.env.NODE_ENV || 'dev';
};

/**
 * Make sure `.gitignore` covers the key files, adding the line when it does
 * not: a key that reaches a commit is a leaked key
 *
 * @param {string} cwd the application directory
 * @param {string} pattern the line to look for
 * @returns {boolean} whether the line was added
 */
const ignore = (cwd, pattern) => {
  const file = path.join(cwd, '.gitignore');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

  if (
    current.split(/\r?\n/).some((line) => line.trim() === pattern) ||
    current.split(/\r?\n/).some((line) => line.trim() === `/${pattern}`)
  ) {
    return false;
  }

  fs.appendFileSync(
    file,
    `${current === '' || current.endsWith('\n') ? '' : '\n'}\n# Credentials keys: never commit them\n${pattern}\n`
  );

  return true;
};

/**
 * The key of an environment, creating one when the file it opens does not
 * exist yet
 *
 * @param {object} credentials core's credentials module
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @param {boolean} create may a key be generated?
 * @returns {{created: boolean, key: Buffer, source: string}} the key
 * @throws {CliError} FAILED when there is no key and none may be created
 */
const keyFor = (credentials, cwd, env, create) => {
  let found;

  try {
    found = credentials.readKey(cwd, env);
  } catch (error) {
    throw new CliError('FAILED', error.message, {
      cause: error,
      hint: 'A key is 64 hexadecimal characters, what `openssl rand -hex 32` prints',
    });
  }

  if (found) {
    return { ...found, created: false };
  }

  const file = credentials.keyFileFor(cwd, env);
  const relative = path.relative(cwd, file);

  if (!create) {
    throw new CliError(
      'FAILED',
      `No key for the ${env} credentials: ${relative} is missing`,
      {
        hint: `Set ${credentials.KEY_VARIABLE}, or put ${relative} back. Without the key the file cannot be opened, by anyone.`,
      }
    );
  }

  const key = credentials.generateKey();

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${key}\n`, { mode: 0o600 });

  const added = ignore(
    cwd,
    `${credentials.DIRECTORY}/*.key`.replace(/\\/g, '/')
  );

  console.log(`\n  Generated ${relative}`);
  console.log('  Keep a copy: it is the only way to open the file.');

  if (added) {
    console.log('  Added it to .gitignore.');
  }

  return {
    created: true,
    key: credentials.parseKey(key, relative),
    source: relative,
  };
};

/**
 * The editor of the current shell
 *
 * @returns {Array<string>} the command and its arguments
 * @throws {CliError} USAGE when neither EDITOR nor VISUAL is set
 */
const editor = () => {
  const command = process.env.EDITOR || process.env.VISUAL || '';

  if (command.trim() === '') {
    throw new CliError('USAGE', 'No editor: EDITOR and VISUAL are both unset', {
      hint: 'EDITOR="code --wait" henri credentials:edit (the editor must not return before the file is saved)',
    });
  }

  return command.trim().split(/\s+/);
};

/**
 * Opens the decrypted file in the editor and waits for it
 *
 * @param {string} file the temporary file
 * @returns {void}
 * @throws {CliError} FAILED when the editor cannot start or answers non-zero
 */
const open = (file) => {
  const [command, ...args] = editor();
  const result = spawn.sync(command, [...args, file], { stdio: 'inherit' });

  if (result.error) {
    throw new CliError('FAILED', `The editor (${command}) could not start`, {
      cause: result.error,
      hint: 'EDITOR is run as a command with the file as its last argument',
    });
  }

  if (result.status !== 0) {
    throw new CliError(
      'FAILED',
      `The editor (${command}) exited with ${result.status}: nothing was written`
    );
  }
};

/**
 * Runs `henri credentials:edit`: decrypts into a temporary file, opens the
 * editor and encrypts what comes back
 *
 * The plaintext lives in a directory of its own that `mkdtemp` creates with
 * `0700`, in a file created with `0600`, and it is removed on every exit
 * path: a clean return, a throw, and an interrupted process.
 *
 * @param {object} credentials core's credentials module
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @returns {object} what happened ({ command, env, file, keys, updated })
 * @throws {CliError} FAILED when the editor or the content is wrong
 */
const edit = (credentials, cwd, env) => {
  const file = credentials.fileFor(cwd, env);
  const exists = fs.existsSync(file);
  const { key } = keyFor(credentials, cwd, env, !exists);
  const values = exists ? read(credentials, cwd, env).values : TEMPLATE();

  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'henri-credentials-')
  );
  const plain = path.join(directory, `${env}.json`);
  const clean = () => fs.rmSync(directory, { force: true, recursive: true });
  const interrupted = () => {
    clean();
    process.exit(130);
  };

  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  process.once('exit', clean);

  let updated = false;
  let entries;

  try {
    const before = `${JSON.stringify(values, null, 2)}\n`;

    fs.writeFileSync(plain, before, { mode: 0o600 });
    open(plain);

    const after = fs.readFileSync(plain, 'utf8');

    if (after !== before) {
      let parsed = null;

      try {
        parsed = JSON.parse(after);
      } catch {
        // The parser's message quotes the file, and the file is plaintext
        throw new CliError('FAILED', 'What you saved is not valid JSON', {
          hint: `The ${env} credentials were left as they were`,
        });
      }

      if (parsed === null || typeof parsed !== 'object') {
        throw new CliError('FAILED', 'The credentials must be a JSON object', {
          hint: `The ${env} credentials were left as they were`,
        });
      }

      credentials.write(cwd, env, parsed, key);
      updated = true;
      entries = credentials.leaves(parsed).map((entry) => entry.key);
    } else {
      entries = credentials.leaves(values).map((entry) => entry.key);
    }
  } finally {
    clean();
    process.off('SIGINT', interrupted);
    process.off('SIGTERM', interrupted);
    process.off('exit', clean);
  }

  return {
    command: 'edit',
    env,
    file: path.relative(cwd, file),
    keys: entries,
    updated,
  };
};

/**
 * The credentials of an environment, or a usage error when there are none
 *
 * @param {object} credentials core's credentials module
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @returns {object} what `credentials.read()` answered
 * @throws {CliError} USAGE when the file is missing, FAILED when it will not open
 */
const read = (credentials, cwd, env) => {
  try {
    const found = credentials.read(cwd, env);

    if (!found) {
      throw new CliError(
        'USAGE',
        `No credentials for ${env}: ${path.relative(cwd, credentials.fileFor(cwd, env))} does not exist`,
        { hint: `henri credentials:edit --env ${env} creates it` }
      );
    }

    return found;
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    throw new CliError('FAILED', error.message, { cause: error });
  }
};

/**
 * Runs `henri credentials:show`
 *
 * @param {object} credentials core's credentials module
 * @param {string} cwd the application directory
 * @param {string} env the environment
 * @returns {object} the result, with the values (never printed by --json)
 */
const show = (credentials, cwd, env) => {
  const found = read(credentials, cwd, env);

  return {
    command: 'show',
    env,
    file: path.relative(cwd, found.file),
    keys: found.entries.map((entry) => entry.key),
    values: found.values,
  };
};

/**
 * Runs `henri credentials <edit|show>` (`henri credentials:<command>` too)
 *
 * `--json` prints the key paths, never a value: the decrypted content only
 * ever reaches stdout, from `credentials:show` without `--json`.
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE without a command
 */
const main = async (args) => {
  const [command] = args._;

  if (!command || !COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('credentials'));
    }

    throw new CliError(
      'USAGE',
      command
        ? `Unknown credentials command "${command}"`
        : 'Missing credentials command',
      { hint: `Available commands: ${COMMANDS.join(', ')}` }
    );
  }

  validInstall({ fatal: true });

  const credentials = load();
  const cwd = process.cwd();
  const env = environmentOf(args);
  const result =
    command === 'edit'
      ? edit(credentials, cwd, env)
      : show(credentials, cwd, env);

  if (args.json) {
    const { values, ...safe } = result;

    console.log(JSON.stringify(safe, null, 2));

    return;
  }

  if (command === 'show') {
    console.log(JSON.stringify(result.values, null, 2));

    return;
  }

  console.log('');
  console.log(
    result.updated
      ? `  Encrypted ${result.file} (${result.keys.length} key(s))`
      : `  ${result.file} is unchanged`
  );
  console.log('');
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.edit = edit;
module.exports.environmentOf = environmentOf;
module.exports.ignore = ignore;
module.exports.show = show;
