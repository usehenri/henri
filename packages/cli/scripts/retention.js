const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri retention`: how long this application keeps its records, and the
 * sweep that enforces it.
 *
 * - `henri retention` prints the rules: which models declare one, what it
 *   does, what its clock is measured from, and whether it has been
 *   approved. It is how a rule is checked, the way `henri routes` is how
 *   the routes are checked.
 * - `henri retention:sweep` runs it. Without `--yes` it is a dry run: it
 *   plans, counts and prints, and writes nothing. `--yes` is what a cron
 *   line carries, and it is the only thing that lets a sweep write.
 *
 * Both boot to the user module (runlevel 4, like `henri db:seed`): no port
 * is bound and no route is registered. The work itself is
 * `henri.retention` (`core/src/4.retention.js`), so an application with
 * `@usehenri/jobs` gets the same sweep on a schedule and one without it
 * runs this from cron.
 */

const COMMANDS = ['map', 'sweep'];

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
 * The rules of the application
 *
 * @returns {Promise<object>} The result
 */
const map = async () => {
  const described = await withHenri((henri) => henri.retention.describe());

  return { command: 'map', ok: true, ...described };
};

/**
 * Sweeps, or says what a sweep would do
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result, with the receipt
 */
const sweep = async (args) => {
  const only = typeof args.only === 'string' ? args.only : undefined;
  // A sweep writes when it is told to and not before: `--yes` is what a
  // cron line carries, and a run without it is a rehearsal
  const dryRun = args.yes !== true;

  return withHenri(async (henri) => {
    const receipt = await henri.retention.sweep({
      dryRun,
      only,
      source: 'cli',
    });

    return { command: 'sweep', dryRun, ok: !receipt.interrupted, receipt };
  });
};

/**
 * A period in words
 *
 * @param {number} value A number of milliseconds
 * @returns {string} `2y`, `18mo`, `90d`
 */
const period = (value) => {
  const units = [
    ['y', 31536000000],
    ['mo', 2592000000],
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
  ];

  for (const [unit, size] of units) {
    if (value % size === 0) {
      return `${value / size}${unit}`;
    }
  }

  return `${value}ms`;
};

/**
 * Prints the rules
 *
 * @param {object} result What map() answered
 * @returns {void}
 */
const printMap = (result) => {
  console.log('');

  if (result.rules.length === 0) {
    console.log('  No model says how long it keeps its records.');
    console.log('');
    console.log('  A model says it in its options:');
    console.log(
      "    options: { retention: { after: '2y', from: 'decidedAt' } }"
    );
    console.log('');
    console.log('  https://usehenri.io/guides/retention/');
    console.log('');

    return;
  }

  for (const rule of result.rules) {
    const name = `${rule.model}${rule.rule === 'default' ? '' : `:${rule.rule}`}`;
    const where =
      Object.keys(rule.where).length > 0
        ? ` where ${JSON.stringify(rule.where)}`
        : '';

    console.log(
      `  ${name.padEnd(28)} ${rule.action.padEnd(12)} ${period(rule.after)} after ${rule.from}${where}`
    );
    console.log(
      `  ${''.padEnd(28)} ${rule.approved ? 'approved' : 'PENDING '}     ${rule.token}`
    );
    console.log('');
  }

  const pending = result.rules.filter((rule) => !rule.approved);

  if (pending.length > 0) {
    console.log(
      `  ${pending.length} rule(s) write nothing until they are approved. Add to config/<env>.json:`
    );
    console.log('');
    console.log('    "retention": { "approved": [');
    console.log(
      pending.map((rule) => `      ${JSON.stringify(rule.token)}`).join(',\n')
    );
    console.log('    ] }');
    console.log('');
  }

  console.log(
    result.settings.schedule
      ? `  Swept by henri/retention (${result.settings.schedule}), which needs @usehenri/jobs`
      : '  Nothing runs the sweep on its own: henri retention:sweep --yes'
  );
  console.log('');
  console.log('  https://usehenri.io/guides/retention/');
  console.log('');
};

/**
 * Prints what a sweep did, or would do
 *
 * @param {object} result What sweep() answered
 * @returns {void}
 */
const printSweep = ({ dryRun, receipt }) => {
  console.log('');

  if (receipt.rules.length === 0) {
    console.log('  No model says how long it keeps its records.');
    console.log('');

    return;
  }

  console.log(dryRun ? '  This sweep would:' : '  Swept:');

  for (const rule of receipt.rules) {
    const name = `${rule.model}${rule.rule === 'default' ? '' : `:${rule.rule}`}`;
    const note = rule.failed
      ? `failed: ${rule.failed}`
      : rule.skipped || `${rule.written} written`;

    console.log(
      `    ${name.padEnd(28)} ${rule.action.padEnd(12)} ${String(
        dryRun ? rule.would : rule.written
      ).padStart(6)} of ${String(rule.matched).padStart(6)} past ${rule.cutoff}`
    );
    console.log(
      `    ${''.padEnd(28)} ${note.padEnd(12)} ${rule.remaining} left for the next run, ${rule.waiting} waiting`
    );
  }

  console.log('');

  if (receipt.pending > 0) {
    console.log(
      `  ${receipt.pending} rule(s) wrote nothing: not approved. Run "henri retention" for their tokens.`
    );
    console.log('');
  }

  if (dryRun) {
    console.log('  Nothing was written: add --yes to sweep for real.');
  } else if (receipt.file) {
    console.log(`  Receipt ${receipt.id}`);
    console.log(`  Written to ${receipt.file}`);
  } else {
    console.log(
      '  Not written: config.retention.receipts is false, keep what is above'
    );
  }

  console.log('');
};

/**
 * Runs `henri retention [map|sweep]` (`henri retention:<command>` too)
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE on an unknown command, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  const [command = 'map'] = args._;

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('retention'));
    }

    throw new CliError('USAGE', `Unknown retention command "${command}"`, {
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
    result = command === 'sweep' ? await sweep(args) : await map();
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.command === 'sweep') {
    printSweep(result);
  } else {
    printMap(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(result.ok ? 0 : 1);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.map = map;
module.exports.period = period;
module.exports.sweep = sweep;
