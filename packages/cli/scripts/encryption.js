const { CliError } = require('./errors');
const { usage } = require('./help');
const { validInstall } = require('./utils');

/**
 * `henri encryption`: the fields a model encrypts, the keys that open them
 * and the rotation that moves them.
 *
 * - `henri encryption` prints the map: which fields of which models are
 *   encrypted, randomised or deterministic, and which key ids the
 *   application holds. It is how the mark is checked, the way
 *   `henri routes` is how the routes are checked. No key material is ever
 *   printed, by this or anything else.
 * - `henri encryption:status` counts what the columns hold, by key id.
 *   This is the command a rotation is finished by: an old key may be
 *   dropped when nothing names it any more, and not a deploy before.
 * - `henri encryption:rotate` rewrites every value that is not under the
 *   key that writes today, soft-deleted rows included. `--dry-run` says
 *   what it would do.
 *
 * All three boot to runlevel 4, like `henri privacy` and `henri db:seed`:
 * no port is bound and no route is registered. The work itself is
 * `henri.encryption` (`core/src/1.encryption.js` and
 * `core/src/base/rewrap.js`), so an application can run the same walk from
 * a job.
 *
 * A backfill is a rotation: a column that held plaintext before the field
 * was marked `encrypted` is "not under the primary key" too. Turn
 * `config.encryption.readPlaintext` on for the length of the migration, run
 * the rotation, then take it out again.
 */

const COMMANDS = ['map', 'rotate', 'status'];

/**
 * Prefer the @usehenri/core the project depends on and fall back to the
 * one shipped with this CLI (same rule as `henri privacy`)
 *
 * @returns {string} resolved path of the Henri class
 */
const resolveHenri = () => {
  try {
    return require.resolve('@usehenri/core/src/henri', {
      paths: [process.cwd()],
    });
  } catch {
    return require.resolve('@usehenri/core/src/henri');
  }
};

/**
 * Boots the models and nothing above them, then stops again
 *
 * @param {function} work `(henri) => result`
 * @returns {Promise<*>} What the work resolved with
 */
const withHenri = async (work) => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel: 4 });

  await henri.init();

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The map of what is encrypted and which keys are held
 *
 * @returns {Promise<object>} The result
 */
const map = async () => {
  const described = await withHenri((henri) => henri.encryption.describe());

  return { command: 'map', ok: true, ...described };
};

/**
 * What the encrypted columns hold, by key id
 *
 * @returns {Promise<object>} The result
 */
const status = async () => {
  const report = await withHenri((henri) => henri.encryption.status());

  return { command: 'status', ...report };
};

/**
 * Rewrites everything that is not under the key that writes today
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const rotate = async (args) => {
  const options = {
    dryRun: args['dry-run'] === true,
    field: typeof args.field === 'string' ? args.field : null,
    model: typeof args.model === 'string' ? args.model : null,
  };
  const report = await withHenri((henri) => henri.encryption.rotate(options));

  return { command: 'rotate', ok: report.failures.length === 0, ...report };
};

/**
 * Prints the map
 *
 * @param {object} result What map() answered
 * @returns {void}
 */
const printMap = (result) => {
  console.log('');

  if (result.fields.length === 0) {
    console.log('  No model marks a field encrypted.');
    console.log('');
    console.log('  A field says it in the schema, next to its type:');
    console.log("    ssn: { encrypted: true, type: 'string' }");
    console.log('');
    console.log('  https://usehenri.io/guides/encryption/');
    console.log('');

    return;
  }

  console.log('  Encrypted at rest');
  console.log('');

  for (const field of result.fields) {
    console.log(
      `    ${`${field.model}.${field.field}`.padEnd(32)} ${
        field.deterministic
          ? 'deterministic (queryable by equality, leaks which rows match)'
          : 'randomised (not queryable, not indexable)'
      }`
    );
  }

  console.log('');
  console.log('  Keys');
  console.log('');

  for (const key of result.keys) {
    console.log(
      `    ${key.id}  ${key.primary ? 'writes and reads' : 'reads only'}  (from ${key.source})`
    );
  }

  if (result.readPlaintext) {
    console.log('');
    console.log(
      '  readPlaintext is on: a column declared encrypted may answer with'
    );
    console.log(
      '  whatever it holds. Run `henri encryption:rotate`, then take it out.'
    );
  }

  console.log('');
  console.log('  https://usehenri.io/guides/encryption/');
  console.log('');
};

/**
 * Prints the status
 *
 * @param {object} result What status() answered
 * @returns {void}
 */
const printStatus = (result) => {
  console.log('');

  if (result.fields.length === 0) {
    console.log('  No model marks a field encrypted.');
    console.log('');

    return;
  }

  console.log(`  Writing under ${result.primary}`);
  console.log('');
  console.log(
    `    ${'field'.padEnd(32)} ${'rows'.padStart(8)} ${'current'.padStart(8)} ${'older'.padStart(8)} ${'clear'.padStart(8)}`
  );

  for (const field of result.fields) {
    console.log(
      `    ${`${field.model}.${field.field}`.padEnd(32)} ${String(
        field.rows
      ).padStart(8)} ${String(field.current).padStart(8)} ${String(
        field.stale
      ).padStart(8)} ${String(field.plaintext).padStart(8)}`
    );
  }

  console.log('');

  if (result.ok) {
    console.log(
      `  Everything is under ${result.primary}. Any other key may be dropped from`
    );
    console.log('  config.encryption.keys, and readPlaintext with it.');
  } else {
    console.log(
      `  ${result.stale} value(s) under an older key and ${result.plaintext} still in the clear.`
    );
    console.log(
      '  Run `henri encryption:rotate`. Do not drop a key that still has rows:'
    );
    console.log('  a row nobody writes again is only moved by the rotation.');
  }

  console.log('');
};

/**
 * Prints what a rotation did, or would do
 *
 * @param {object} result What rotate() answered
 * @returns {void}
 */
const printRotate = (result) => {
  console.log('');
  console.log(result.dryRun ? '  This rotation would:' : '  Rotated:');
  console.log('');

  for (const field of result.fields) {
    console.log(
      `    ${`${field.model}.${field.field}`.padEnd(32)} ${String(
        field.rotated
      ).padStart(8)} of ${String(field.scanned).padStart(8)}${
        field.skipped > 0 ? `  (${field.skipped} could not be read)` : ''
      }`
    );
  }

  console.log('');

  if (result.failures.length > 0) {
    console.log(
      `  ${result.failures.length} value(s) were left exactly as they are:`
    );
    console.log('');

    for (const failure of result.failures.slice(0, 20)) {
      console.log(
        `    ${failure.model}.${failure.field} ${failure.record}  ${failure.code}${
          failure.keyId ? ` (key ${failure.keyId})` : ''
        }`
      );
    }

    if (result.failures.length > 20) {
      console.log(`    ... and ${result.failures.length - 20} more`);
    }

    console.log('');
    console.log(
      '  Nothing was overwritten. A value that will not open is a key that is'
    );
    console.log(
      '  missing or a row that was changed, and both want a person, not a retry.'
    );
    console.log('');
  }

  if (result.dryRun) {
    console.log('  Nothing was written: --dry-run');
    console.log('');
  }
};

/**
 * Runs `henri encryption [map|status|rotate]` (`henri encryption:<command>`
 * too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [command = 'map'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('encryption'));
    }

    throw new CliError('USAGE', `Unknown encryption command "${command}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}`,
    });
  }

  validInstall({ fatal: true });

  const log = console.log;

  // With --json stdout is the result only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  let result;

  try {
    if (command === 'status') {
      result = await status();
    } else if (command === 'rotate') {
      result = await rotate(args);
    } else {
      result = await map();
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'status') {
    printStatus(result);
  } else if (result.command === 'rotate') {
    printRotate(result);
  } else {
    printMap(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind.
  //
  // A rotation that could not read a value exits 1, because something has
  // to be looked at. A status never does: "not finished yet" is what it
  // was asked, and a report that fails the shell is a report nobody runs
  // in a pipeline.
  process.exit(result.command === 'rotate' && result.ok === false ? 1 : 0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.map = map;
module.exports.rotate = rotate;
module.exports.status = status;
