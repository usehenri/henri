const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');

const { CliError } = require('./errors');
const { usage } = require('./help');
const { boot, validInstall } = require('./utils');

/**
 * `henri runner`: one expression, or one script, inside a booted
 * application, and then out again.
 *
 * Every cron line needs this and there was no way to write one: a task that
 * has to touch the models had to be a job, a controller, or a script that
 * booted henri by hand and remembered to stop it.
 *
 * ```bash
 * henri runner 'await Task.count()'
 * henri runner script/backfill.js
 * echo 'await User.destroy({ where: { confirmedAt: null } })' | henri runner -
 * ```
 *
 * Three decisions, all of them for the person reading the crontab:
 *
 * - **It is not a web process.** The boot stops at runlevel 4, the level
 *   `henri jobs` stops at: the models, the users and the queue are there,
 *   the router and the workers are not, and no port is bound at any point.
 *   Several of these run on one machine, and a runner that grabbed 3000
 *   would be a runner that fails on the second crontab entry.
 * - **The exit code is the whole interface.** A script that resolves exits
 *   0. Anything thrown or rejected -- including a promise the expression
 *   returned -- prints the error henri would have printed and exits 1. A
 *   cron line branches on that and on nothing else.
 * - **It stops what it started.** `henri.stop()` runs whatever happened, so
 *   the stores close and the process leaves rather than hanging on an open
 *   pool.
 *
 * The globals are the ones an application has: `henri` and every model.
 */

/** Where the boot stops: the models, the users and the queue; no router */
const RUNLEVEL = 4;

/**
 * Reads everything on stdin
 *
 * @returns {Promise<string>} What was piped in
 */
const readStdin = () =>
  new Promise((resolve, reject) => {
    let source = '';

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      source += chunk;
    });
    process.stdin.on('end', () => resolve(source));
    process.stdin.on('error', reject);
  });

/**
 * What to run, and where it came from.
 *
 * A bare `-` is stdin. An argument naming a file that exists is that file;
 * anything else is source code, which is what makes
 * `henri runner 'await Task.count()'` work without a flag.
 *
 * @param {object} args CLI arguments
 * @param {string} [dir=process.cwd()] The application directory
 * @returns {Promise<{file: ?string, source: ?string, what: string}>} The work
 * @throws {CliError} USAGE when there is nothing to run
 */
const target = async (args, dir = process.cwd()) => {
  const [first] = args._;

  if (first === '-') {
    return { file: null, source: await readStdin(), what: 'stdin' };
  }

  if (typeof first !== 'string' || first.trim() === '') {
    throw new CliError('USAGE', 'henri runner needs an expression or a file', {
      hint: "henri runner 'await Task.count()', henri runner script/backfill.js, or pipe it in with henri runner -",
    });
  }

  const file = path.resolve(dir, first);

  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    return { file, source: null, what: path.relative(dir, file) };
  }

  return { file: null, source: first, what: 'the expression' };
};

/**
 * Runs source code inside this process, with `require` and the globals of
 * the application.
 *
 * An expression first, so `henri runner 'Task.count()'` answers a number;
 * statements when that will not parse, so a whole script pasted on the
 * command line works too. That is the REPL's own rule, and it is the one
 * that surprises nobody.
 *
 * @param {string} source The code
 * @param {string} name What to call it in a stack trace
 * @param {string} dir The application directory
 * @returns {Promise<*>} What it evaluated to
 */
const evaluate = async (source, name, dir) => {
  const options = { filename: name };
  const scope = (body) =>
    vm.runInThisContext(
      `(async (require, __filename, __dirname) => ${body})`,
      options
    );
  let fn;

  try {
    fn = scope(`(${source}\n)`);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    fn = scope(`{ ${source}\n}`);
  }

  const from = path.join(dir, 'henri-runner.js');

  return fn(require('module').createRequire(from), from, dir);
};

/**
 * Runs a file: it is required, so it gets its own `require`, `__dirname`
 * and everything else a module has. A function it exports is called with
 * the henri instance, and anything thenable it exports is awaited -- so
 * `module.exports = async (henri) => {...}` and a script that just does its
 * work at the top level both behave.
 *
 * @param {string} file The absolute path
 * @param {object} henri The booted instance
 * @returns {Promise<*>} What it answered
 */
const runFile = async (file, henri) => {
  const loaded = require(file);
  const exported = loaded && loaded.default ? loaded.default : loaded;

  if (typeof exported === 'function') {
    return exported(henri);
  }

  return exported;
};

/**
 * Runs one expression or one file against a booted application
 *
 * @param {object} args CLI arguments
 * @returns {Promise<{ok: boolean, value: *, what: string}>} The result
 * @throws {CliError} USAGE when there is nothing to run
 * @throws whatever the code threw
 */
const run = async (args) => {
  const dir = process.cwd();
  const work = await target(args, dir);
  const henri = await boot({ runlevel: RUNLEVEL });

  // Outside NODE_ENV=test core does this itself; a runner asked to run
  // under the test environment still expects `henri` to be there
  if (typeof global.henri === 'undefined') {
    global.henri = henri;
  }

  try {
    const value = await (work.file
      ? runFile(work.file, henri)
      : evaluate(work.source, 'henri runner', dir));

    return { ok: true, value, what: work.what };
  } finally {
    // Whatever happened: the stores close and nothing is left holding the
    // event loop open
    await henri.stop();
  }
};

/**
 * Runs `henri runner <expression|file|->`
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done (it exits)
 * @throws {CliError} USAGE with nothing to run, NOT_A_PROJECT elsewhere
 */
const main = async (args) => {
  if (args._.length === 0 && !args.json) {
    console.log(usage('runner'));

    throw new CliError('USAGE', 'henri runner needs an expression or a file', {
      hint: "henri runner 'await Task.count()', henri runner script/backfill.js, or pipe it in with henri runner -",
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
    result = await run(args);
  } catch (error) {
    console.log = log;

    if (error instanceof CliError) {
      throw error;
    }

    // The error itself, stack and all: an operator reading a cron mail
    // wants what failed, not a command line's summary of it
    console.error(error && error.stack ? error.stack : String(error));

    if (error && error.cause) {
      console.error(`Caused by: ${error.cause.stack || error.cause}`);
    }

    return process.exit(1);
  }

  console.log = log;

  if (args.json) {
    console.log(
      JSON.stringify(
        { ok: true, value: result.value === undefined ? null : result.value },
        null,
        2
      )
    );
  } else if (typeof result.value !== 'undefined') {
    // A value is worth printing: `henri runner 'Task.count()'` is a command
    // an operator types expecting an answer
    console.log(util.inspect(result.value, { colors: false, depth: 4 }));
  }

  return process.exit(0);
};

module.exports = main;
module.exports.RUNLEVEL = RUNLEVEL;
module.exports.evaluate = evaluate;
module.exports.run = run;
module.exports.target = target;
