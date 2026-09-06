const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri trail`: the append-only record of who read or changed personal
 * data, read back.
 *
 * - `henri trail` prints the latest entries, filtered by `--action`,
 *   `--model`, `--actor`, `--since` and `--until`.
 * - `henri trail:about <who>` prints everything recorded about one person,
 *   which is how "prove the erasure happened" is answered from an email
 *   address alone -- the address itself is not in the table, its digest is.
 * - `henri trail:verify` walks the hash chain and says whether a row was
 *   edited or removed, and where.
 *
 * All three boot to runlevel 4: no port is bound and no route is
 * registered. The work is `henri.trail` (`core/src/4.trail.js`).
 */

const COMMANDS = ['about', 'list', 'verify'];

/** How many entries a listing prints unless `--limit` says */
const LIMIT = 25;

/**
 * Runs one operation against a booted application and stops it again
 *
 * @param {function} work `(henri) => result`
 * @returns {Promise<*>} What the work resolved with
 */
const withHenri = async (work) => {
  const henri = await boot({ runlevel: 4 });

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The filter the command line asked for
 *
 * @param {object} args CLI arguments
 * @returns {object} The filter
 */
const filterOf = (args) => {
  const text = (name) =>
    typeof args[name] === 'string' && args[name] !== ''
      ? args[name]
      : undefined;

  return {
    action: text('action'),
    actor: text('actor'),
    limit: Number(args.limit) || LIMIT,
    model: text('model'),
    outcome: text('outcome'),
    since: text('since'),
    until: text('until'),
  };
};

/**
 * The latest entries
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const list = async (args) => {
  const filter = filterOf(args);
  const entries = await withHenri((henri) => henri.trail.list(filter));

  return { command: 'list', entries, filter, ok: true };
};

/**
 * Everything recorded about one person
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 * @throws {CliError} USAGE when nobody was named
 */
const about = async (args) => {
  const [, who] = args._;

  if (typeof who !== 'string' || who.trim() === '') {
    throw new CliError('USAGE', 'henri trail:about needs a person', {
      hint: 'henri trail:about someone@example.com (an external id works too)',
    });
  }

  const filter = filterOf(args);
  const entries = await withHenri((henri) =>
    henri.trail.about(who.trim(), filter)
  );

  return { command: 'about', entries, filter, ok: true, who: who.trim() };
};

/**
 * Whether the chain still holds
 *
 * @returns {Promise<object>} The result
 */
const verify = async () => {
  const result = await withHenri((henri) => henri.trail.verify());

  return { command: 'verify', ok: result.ok, ...result };
};

/**
 * Prints a listing
 *
 * @param {object} result What list() or about() answered
 * @returns {void}
 */
const printList = ({ command, entries, who }) => {
  console.log('');

  if (entries.length === 0) {
    console.log(
      command === 'about'
        ? `  Nothing is recorded about ${who}.`
        : '  The trail holds nothing matching that.'
    );
    console.log('');

    return;
  }

  if (command === 'about') {
    console.log(`  Everything recorded about ${who}`);
    console.log('');
  }

  for (const entry of entries) {
    console.log(
      `  ${String(entry.seq).padStart(6)}  ${entry.at}  ${entry.action.padEnd(
        18
      )} ${entry.outcome.padEnd(8)} ${String(entry.records).padStart(6)} ${
        entry.model || ''
      }`
    );

    const notes = [
      entry.actor ? `actor ${entry.actor}` : null,
      entry.route,
      entry.fields.length > 0 ? entry.fields.join(', ') : null,
      entry.meta
        ? Object.keys(entry.meta)
            .map((key) => `${key}=${entry.meta[key]}`)
            .join(' ')
        : null,
    ].filter(Boolean);

    if (notes.length > 0) {
      console.log(`  ${''.padStart(6)}  ${notes.join('  ')}`);
    }
  }

  console.log('');
};

/**
 * Prints a verification
 *
 * @param {object} result What verify() answered
 * @returns {void}
 */
const printVerify = ({ broken, entries, from, ok, to }) => {
  console.log('');

  if (ok) {
    console.log(
      `  The chain holds: ${entries} entr${entries === 1 ? 'y' : 'ies'}${
        from === null ? '' : `, seq ${from} to ${to}`
      }`
    );
    console.log('');

    return;
  }

  console.log(`  The chain is broken at seq ${broken.seq} (${broken.reason}).`);
  console.log(
    `  Everything up to seq ${broken.after === null ? '(nothing)' : broken.after} verifies.`
  );
  console.log('');
  console.log(
    '  A row was edited or removed. The trail is INSERT and SELECT only:'
  );
  console.log('  grant the application nothing else on this table.');
  console.log('');
};

/**
 * Runs `henri trail [list|about|verify]` (`henri trail:<command>` too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [command = 'list'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('trail'));
    }

    throw new CliError('USAGE', `Unknown trail command "${command}"`, {
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
    if (command === 'about') {
      result = await about(args);
    } else if (command === 'verify') {
      result = await verify();
    } else {
      result = await list(args);
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'verify') {
    printVerify(result);
  } else {
    printList(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.about = about;
module.exports.list = list;
module.exports.verify = verify;
