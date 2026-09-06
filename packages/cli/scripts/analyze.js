const { CliError } = require('./errors');
const { validInstall } = require('./utils');

/**
 * Prefer the @usehenri/core the project depends on and fall back to the
 * one shipped with this CLI
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
 * Milliseconds, printed the way the boot chart shows them
 *
 * @param {?number} value the duration
 * @returns {string} the label
 */
const ms = (value) => (typeof value === 'number' ? `${value}ms` : '-');

/**
 * Pad a column of a table
 *
 * @param {Array<Array<string>>} rows the rows
 * @param {number} column the column index
 * @returns {number} its width
 */
const width = (rows, column) =>
  Math.max(...rows.map((row) => (row[column] || '').length));

/**
 * Print a table with padded columns
 *
 * @param {Array<Array<string>>} rows the rows, headers included
 * @returns {void}
 */
const table = (rows) => {
  const widths = rows[0].map((cell, column) => width(rows, column));

  for (const row of rows) {
    console.log(
      `   ${row
        .map((cell, column) =>
          column === row.length - 1 ? cell : (cell || '').padEnd(widths[column])
        )
        .join('  ')
        .trimEnd()}`
    );
  }
};

/**
 * Print the boot chart of an application
 *
 * Boots henri the way `henri server` does, prints what the boot did and
 * stops it again: the order the modules ran in, how long each one took,
 * what it waited on and the chain that decided the total.
 *
 * @param {object} [args] CLI arguments (`--json`, `--level`, a module name)
 * @returns {Promise<void>} Resolves when printed
 * @throws {CliError} when the application fails to boot
 */
const main = async (args = {}) => {
  validInstall({ fatal: true });

  const only = args._ && args._.length > 0 ? String(args._[0]) : null;
  const runlevel = level(args);
  const Henri = require(resolveHenri());
  const log = console.log;
  let analysis;
  let failure = null;

  // With --json stdout is the chart only: the boot log goes to stderr
  if (args.json) {
    console.log = (...parts) => console.error(...parts);
  }

  try {
    const henri = new Henri({ runlevel });

    try {
      await henri.init();
    } catch (error) {
      failure = error;
    }

    analysis = henri.analyze(only);

    try {
      await henri.stop();
    } catch (error) {
      // A boot that failed halfway may not stop cleanly: the chart is what
      // the command is about, and the failure is reported below
    }
  } finally {
    console.log = log;
  }

  if (args.json) {
    console.log(JSON.stringify(analysis, null, 2));
  } else if (analysis) {
    print(analysis, only);
  }

  if (failure) {
    throw new CliError('FAILED', message(failure), {
      cause: failure,
      hint: analysis
        ? `${analysis.failed || 'a module'} failed; run henri analyze --json for the whole chart`
        : 'the boot failed before the module graph was built',
    });
  }

  // The server and the stores are closed by henri.stop(); leave nothing
  // behind (the terminal keypress handlers keep the loop alive otherwise)
  process.exit(0);
};

/**
 * The level the boot should stop at
 *
 * @param {object} args CLI arguments
 * @returns {number} the ceiling
 * @throws {CliError} USAGE when --level is not a level
 */
const level = (args) => {
  if (typeof args.level === 'undefined') {
    return 6;
  }

  const value = Number(args.level);

  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new CliError('USAGE', `Invalid --level "${args.level}"`, {
      hint: 'The levels go from 0 (configuration only) to 6 (the whole boot)',
    });
  }

  return value;
};

/**
 * The message of a boot failure, without the wrapper henri adds
 *
 * @param {Error} error the error henri.init() rejected with
 * @returns {string} the message
 */
const message = (error) => {
  const cause = error.cause || error;

  return cause.message || String(cause);
};

/**
 * Print the whole chart, or one module
 *
 * @param {object} analysis what henri.analyze() returned
 * @param {?string} only the module the chart is about, if any
 * @returns {void}
 */
const print = (analysis, only) => {
  console.log('');

  if (only) {
    return one(analysis, only);
  }

  console.log(
    ` Boot: ${ms(analysis.duration)}, ${analysis.modules.length} modules, level ${analysis.ceiling}${
      analysis.ok ? '' : ' (failed)'
    }`
  );
  console.log('');

  table([
    ['Module', 'Level', 'Pin', 'Started', 'Took', 'Waited on'],
    ...analysis.modules.map((module) => [
      module.name,
      String(module.runlevel),
      module.pin,
      ms(module.startedAt),
      ms(module.duration),
      waits(module),
    ]),
  ]);

  if (analysis.ok) {
    console.log('');
    console.log(' Critical path');
    console.log(
      `   ${analysis.criticalPath
        .map((step) => `${step.name} (${ms(step.duration)})`)
        .join(' -> ')}`
    );
  }

  console.log('');
  console.log(' Levels');
  table(
    analysis.chart.map((entry) => [
      String(entry.level),
      entry.purpose,
      entry.modules.join(', ') || '-',
    ])
  );

  if (analysis.skipped.length > 0) {
    console.log('');
    console.log(
      ` Left out by the level: ${analysis.skipped
        .map((entry) => `${entry.name} (${entry.runlevel})`)
        .join(', ')}`
    );
  }

  reload(analysis);

  if (!analysis.ok) {
    console.log('');
    console.log(` Failed: ${analysis.failed || 'before anything started'}`);
    console.log(`   still running: ${states(analysis, 'running') || 'none'}`);
    console.log(`   never started: ${states(analysis, 'waiting') || 'none'}`);
  }

  console.log('');
};

/**
 * Print the last reload, when the instance saw one
 *
 * @param {object} analysis what henri.analyze() returned
 * @returns {void}
 */
const reload = (analysis) => {
  if (!analysis.reload) {
    return;
  }

  console.log('');
  console.log(` Last reload: ${ms(analysis.reload.duration)}`);
  console.log(
    `   released: ${analysis.reload.released.join(', ') || 'nothing'}`
  );
  console.log(
    `   reloaded: ${analysis.reload.modules
      .map((module) => module.name)
      .join(', ')}`
  );
};

/**
 * Print one module: where it landed and who is on either side of it
 *
 * @param {object} analysis what henri.analyze(name) returned
 * @param {string} only the module name
 * @returns {void}
 */
const one = (analysis, only) => {
  const [module] = analysis.modules;

  if (!module) {
    console.log(` No module named "${only}" took part in this boot.`);
    console.log('');

    return;
  }

  console.log(
    ` ${module.name}: level ${module.runlevel}, pinned by ${module.pin}`
  );
  console.log('');
  table([
    ['Started', ms(module.startedAt)],
    ['Took', ms(module.duration)],
    ['State', module.state],
    ['Waited on', waits(module) || 'nothing'],
    ['Held up by', module.blockedBy || 'nothing'],
    ['Waiting on it', module.blocks.join(', ') || 'nothing'],
  ]);
  console.log('');
};

/**
 * What a module waited on, with the reason for each
 *
 * @param {object} module a module of the analysis
 * @returns {string} the label
 */
const waits = (module) =>
  module.waitsOn.map((entry) => `${entry.name} (${entry.why})`).join(', ');

/**
 * The modules of the analysis in a given state
 *
 * @param {object} analysis what henri.analyze() returned
 * @param {string} state the state
 * @returns {string} their names
 */
const states = (analysis, state) =>
  analysis.modules
    .filter((module) => module.state === state)
    .map((module) => module.name)
    .join(', ');

module.exports = main;
module.exports.print = print;
module.exports.table = table;
