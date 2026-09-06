const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri calls`: the calls the application answered and the calls it made.
 *
 * - `henri calls <request-id>` is the one worth having the table for: the
 *   call that came in, every call that went out because of it, in the order
 *   they happened, with the timings. `henri calls` on its own prints the
 *   latest calls instead, filtered by `--direction`, `--service`,
 *   `--status`, `--since` and `--until`.
 * - `henri calls:stats` says what has been written and what was dropped
 *   rather than written -- by the sampling, by the per-second ceiling or by
 *   a full buffer -- and lists the partitions when there are any.
 * - `henri calls:sweep` takes the calls past `config.calls.keep` away. The
 *   retention sweep already does it; this is for running it on its own.
 *
 * All three boot to runlevel 4: no port is bound and no route is
 * registered. The work is `henri.calls` (`core/src/4.calls.js`).
 */

const COMMANDS = ['list', 'stats', 'sweep'];

/** How many calls a listing prints unless `--limit` says */
const LIMIT = 25;

/** Anything shaped like a request id, so `henri calls <id>` needs no flag */
const REQUEST_ID = /^[A-Za-z0-9._-]{6,200}$/;

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
    direction: text('direction'),
    limit: Number(args.limit) || LIMIT,
    outcome: text('outcome'),
    service: text('service'),
    since: text('since'),
    status: Number(args.status) || undefined,
    until: text('until'),
  };
};

/**
 * The latest calls, or one request's story
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 */
const list = async (args) => {
  const [first, second] = args._;
  const named =
    typeof args.request === 'string'
      ? args.request
      : [first, second].find(
          (value) =>
            typeof value === 'string' &&
            value !== 'list' &&
            REQUEST_ID.test(value)
        ) || null;
  const filter = filterOf(args);
  const calls = await withHenri((henri) =>
    named ? henri.calls.about(named, filter) : henri.calls.list(filter)
  );

  return { calls, command: 'list', filter, ok: true, requestId: named };
};

/**
 * What was written, and what was not
 *
 * @returns {Promise<object>} The result
 */
const stats = async () => {
  const found = await withHenri((henri) => henri.calls.stats());

  return { command: 'stats', ok: true, ...found };
};

/**
 * Takes the calls past `config.calls.keep` away
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result
 * @throws {CliError} USAGE when nobody said yes
 */
const sweep = async (args) => {
  if (args.yes !== true) {
    throw new CliError('USAGE', 'henri calls:sweep removes rows', {
      hint: 'Run it again with --yes. `henri calls:stats` says how many there are',
    });
  }

  const result = await withHenri((henri) => henri.calls.prune());

  return { command: 'sweep', ok: true, ...result };
};

/**
 * How long a call took, padded
 *
 * @param {?number} duration Milliseconds, or nothing
 * @returns {string} The column
 */
const took = (duration) =>
  duration === null ? '     -' : `${String(duration).padStart(4)}ms`;

/**
 * Prints a listing
 *
 * @param {object} result What list() answered
 * @returns {void}
 */
const printList = ({ calls, requestId }) => {
  console.log('');

  if (calls.length === 0) {
    console.log(
      requestId
        ? `  Nothing was recorded for request ${requestId}.`
        : '  The call log holds nothing matching that.'
    );
    console.log('');

    return;
  }

  if (requestId) {
    console.log(`  Request ${requestId}`);
    console.log('');
  }

  for (const call of calls) {
    const arrow = call.direction === 'in' ? '<-' : '->';
    const what = call.direction === 'in' ? call.route || call.url : call.url;

    console.log(
      `  ${call.at}  ${arrow} ${String(call.status || call.outcome).padEnd(
        8
      )} ${took(call.duration)}  ${call.method.padEnd(6)} ${what || ''}`
    );

    const notes = [
      call.service ? `service ${call.service}` : null,
      call.actor ? `actor ${call.actor}` : null,
      call.error ? `error ${call.error}` : null,
      call.truncated.length > 0
        ? `truncated ${call.truncated.join(', ')}`
        : null,
    ].filter(Boolean);

    if (notes.length > 0) {
      console.log(`  ${''.padStart(24)}  ${notes.join('  ')}`);
    }
  }

  console.log('');

  if (!requestId) {
    console.log(
      '  henri calls <request-id> prints one request and everything it caused.'
    );
    console.log('');
  }
};

/**
 * Prints the counters
 *
 * @param {object} result What stats() answered
 * @returns {void}
 */
const printStats = (result) => {
  console.log('');

  if (!result.enabled) {
    console.log('  This application keeps no call log.');
    console.log('  Turn it on with "calls": {} in config/<env>.json.');
    console.log('');

    return;
  }

  console.log(`  ${result.total} row(s), ${result.buffered} waiting`);
  console.log(`  written    ${result.written}`);
  console.log(
    `  dropped    ${result.dropped.rate} over the per-second ceiling`
  );
  console.log(`             ${result.dropped.buffer} with a full buffer`);
  console.log(`             ${result.dropped.failed} the store refused`);

  if (result.partitions.length > 0) {
    console.log('');
    console.log(`  ${result.partitions.length} partition(s):`);

    for (const partition of result.partitions.slice(0, 10)) {
      console.log(
        `    ${partition.name}  ${new Date(partition.from)
          .toISOString()
          .slice(
            0,
            10
          )} to ${new Date(partition.to).toISOString().slice(0, 10)}`
      );
    }
  }

  console.log('');
};

/**
 * Prints a sweep
 *
 * @param {object} result What sweep() answered
 * @returns {void}
 */
const printSweep = ({ before, partitions, removed }) => {
  console.log('');

  if (before === null) {
    console.log('  Nothing to sweep: the call log is off, or keeps forever.');
    console.log('');

    return;
  }

  console.log(
    `  ${removed} row(s) removed, everything before ${new Date(
      before
    ).toISOString()}`
  );

  if (partitions.length > 0) {
    console.log(`  ${partitions.length} partition(s) dropped whole:`);
    console.log(`    ${partitions.join(', ')}`);
  }

  console.log('');
};

/**
 * Runs `henri calls [list|stats|sweep]` (`henri calls:<command>` too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [first] = args._;
  const command = COMMANDS.includes(first) ? first : 'list';

  // `henri calls stats` is a command, `henri calls 018f-...` is a request
  if (
    typeof first === 'string' &&
    first !== '' &&
    command === 'list' &&
    !REQUEST_ID.test(first)
  ) {
    if (!args.json) {
      console.log(usage('calls'));
    }

    throw new CliError('USAGE', `Unknown calls command "${first}"`, {
      hint: `Available commands: ${COMMANDS.join(', ')}, or a request id`,
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
    if (command === 'stats') {
      result = await stats();
    } else if (command === 'sweep') {
      result = await sweep(args);
    } else {
      result = await list(args);
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'stats') {
    printStats(result);
  } else if (result.command === 'sweep') {
    printSweep(result);
  } else {
    printList(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.list = list;
module.exports.stats = stats;
module.exports.sweep = sweep;
