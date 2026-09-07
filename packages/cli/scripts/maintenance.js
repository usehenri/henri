const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri maintenance`: closing an application, and opening it again.
 *
 * The three commands are the whole feature from a shell:
 *
 * - `henri maintenance` (or `:status`) reads the switch and says whether
 *   the application is closed, since when, what a visitor is being told,
 *   where the switch lives and how long a running process takes to notice.
 *   When it is closed it also prints a bypass url, so the operator can
 *   check the application without opening it to everybody.
 * - `henri maintenance:on` closes it. `--message` and `--retry-after` are
 *   what the visitor gets.
 * - `henri maintenance:off` opens it again.
 *
 * None of them deploys anything, and none of them restarts anything: the
 * switch is state the running processes re-read (`config.shared` when the
 * application names one, a file otherwise), which is the entire point --
 * see `@usehenri/core/src/base/maintenance.js` for where it lives and why.
 *
 * The boot stops at the server module (runlevel 2): the switch is built
 * there, no port is bound, no route is registered and no database is
 * opened. A command an operator runs during an incident has no business
 * needing the thing that is broken.
 */

const COMMANDS = ['status', 'on', 'off'];

/** Where the boot stops: `config` and `server`, which owns the switch */
const RUNLEVEL = 2;

/**
 * Runs one operation against a booted application and stops it again
 *
 * @param {function} work `(henri) => result`
 * @returns {Promise<*>} What the work resolved with
 */
const withHenri = async (work) => {
  const henri = await boot({ runlevel: RUNLEVEL });

  try {
    return await work(henri);
  } finally {
    await henri.stop();
  }
};

/**
 * The address a bypass token is presented at
 *
 * @param {object} henri A booted instance
 * @param {?string} token The bypass token, when there is one
 * @returns {?string} The url, null without a token
 */
const bypassUrl = (henri, token) => {
  if (!token) {
    return null;
  }

  const { config } = henri;
  const configured = config.has('url') ? config.get('url') : null;
  const port = config.has('port') ? config.get('port') : 3000;
  const base = String(configured || `http://localhost:${port}`).replace(
    /\/+$/u,
    ''
  );

  return `${base}/?maintenance=${token}`;
};

/**
 * The state of the switch, read fresh
 *
 * @returns {Promise<object>} The result
 */
const status = async () =>
  withHenri(async (henri) => {
    const state = await henri.maintenance.status();

    return {
      command: 'status',
      ok: true,
      url: bypassUrl(henri, state.token),
      ...state,
    };
  });

/**
 * Closes the application
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result, with the bypass url
 */
const on = async (args) =>
  withHenri(async (henri) => {
    await henri.maintenance.on({
      by: typeof args.by === 'string' ? args.by : null,
      message: typeof args.message === 'string' ? args.message : null,
      retryAfter:
        typeof args['retry-after'] === 'undefined'
          ? null
          : Number(args['retry-after']),
    });
    // Read back rather than trust the write: the answer is what the next
    // process to read the switch will see, which is what an operator is
    // about to act on
    const state = await henri.maintenance.status();

    return {
      command: 'on',
      ok: true,
      url: bypassUrl(henri, state.token),
      ...state,
    };
  });

/**
 * Opens the application again
 *
 * @returns {Promise<object>} The result
 */
const off = async () =>
  withHenri(async (henri) => {
    const was = await henri.maintenance.off();
    const state = await henri.maintenance.status();

    return { changed: was, command: 'off', ok: true, ...state };
  });

/**
 * How long ago something happened, in words
 *
 * @param {number} since An epoch in milliseconds
 * @returns {string} `4m`, `2h 10m`, `3d`
 */
const ago = (since) => {
  const seconds = Math.max(0, Math.round((Date.now() - since) / 1000));

  if (seconds < 60) {
    return `${seconds}s`;
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }

  return `${Math.floor(seconds / 86400)}d`;
};

/**
 * Prints what the switch says
 *
 * @param {object} result What one of the commands answered
 * @returns {void}
 */
const print = (result) => {
  console.log('');

  if (!result.enabled) {
    console.log('  This application has no maintenance switch.');
    console.log('');
    console.log('  config.maintenance is false. Remove it to get one back.');
    console.log('');

    return;
  }

  const where =
    result.where === 'shared'
      ? `${result.switch} (shared, every process on every machine)`
      : `${result.switch} (file, the processes on this machine only)`;

  if (!result.on) {
    console.log(`  ${'Open'.padEnd(14)} the application is serving`);
    console.log(`  ${'Switch'.padEnd(14)} ${where}`);
    console.log('');
    console.log('  Close it with: henri maintenance:on');
    console.log('');

    return;
  }

  console.log(
    `  ${'Closed'.padEnd(14)} since ${new Date(result.since).toISOString()} (${ago(result.since)} ago)`
  );
  console.log(`  ${'Message'.padEnd(14)} ${result.message}`);
  console.log(`  ${'Retry-After'.padEnd(14)} ${result.retryAfter}s`);
  console.log(`  ${'Switch'.padEnd(14)} ${where}`);

  if (result.by) {
    console.log(`  ${'Thrown by'.padEnd(14)} ${result.by}`);
  }

  console.log('');
  console.log(
    `  Every process picks this up within ${result.poll}ms. Nothing was deployed and nothing restarted.`
  );

  if (result.url) {
    console.log('');
    console.log('  Check the application yourself with this url. It is signed');
    console.log('  against this window, so henri maintenance:off ends it:');
    console.log('');
    console.log(`    ${result.url}`);
  } else {
    console.log('');
    console.log(
      '  No bypass url: this application has no secret to sign one with.'
    );
  }

  if (result.bypass === 'loopback') {
    console.log('');
    console.log(
      '  maintenance.bypass is "loopback": anything connecting from this'
    );
    console.log(
      '  machine gets through, a reverse proxy on it included. henri audit'
    );
    console.log('  reports that pair.');
  }

  console.log('');
  console.log('  End it with: henri maintenance:off');
  console.log('');
};

/**
 * Runs `henri maintenance [status|on|off]` (`henri maintenance:<command>`)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [command = 'status'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('maintenance'));
    }

    throw new CliError('USAGE', `Unknown maintenance command "${command}"`, {
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
    if (command === 'on') {
      result = await on(args);
    } else if (command === 'off') {
      result = await off();
    } else {
      result = await status();
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    print(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.RUNLEVEL = RUNLEVEL;
module.exports.ago = ago;
module.exports.bypassUrl = bypassUrl;
module.exports.off = off;
module.exports.on = on;
module.exports.status = status;
