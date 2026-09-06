const { CliError } = require('./errors');
// The one place the package is named, shared with what core says at runtime
const { PACKAGE } = require('@usehenri/core/src/base/jobs');
const { usage } = require('./help');
const { validInstall } = require('./utils');

const COMMANDS = [
  'dead',
  'discard',
  'install',
  'list',
  'perform',
  'retry',
  'run',
  'show',
  'status',
];

/**
 * Prefer the @usehenri/core the project depends on and fall back to the one
 * shipped with this CLI
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
 * Boots henri up to the jobs module (runlevel 4)
 *
 * No express server, no router, no views and no `app/workers`: a runner is
 * not a web process and must never bind a port -- several of them run on one
 * machine.
 *
 * @returns {Promise<object>} The henri instance
 */
const boot = async () => {
  process.env.SKIP_WORKERS = 'true';
  process.env.CONSOLE_ONLY = 'true';

  const Henri = require(resolveHenri());
  const henri = new Henri({ runlevel: 4 });

  await henri.init();

  return henri;
};

/**
 * The queue of a booted instance
 *
 * `henri.jobs` is the module `@usehenri/jobs` ships: an application that
 * does not depend on the package has none at all.
 *
 * @param {object} henri A booted instance
 * @returns {object} The queue module (`henri.jobs`)
 * @throws {CliError} FAILED when the application has no queue
 */
const queueOf = async (henri) => {
  if (!henri.jobs || !henri.jobs.enabled) {
    await henri.stop();
    throw new CliError('FAILED', 'This application has no job queue', {
      hint: `Install ${PACKAGE} and write a job with: henri generate job <name>`,
    });
  }

  return henri.jobs;
};

/**
 * The queues named by --queue
 *
 * @param {object} args CLI arguments
 * @returns {Array<string>} The queue names
 */
const queues = (args) =>
  String(args.queue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/**
 * Runs a worker process until a signal stops it
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 */
const run = async (args) => {
  const started = Date.now();
  const henri = await boot();
  const jobs = await queueOf(henri);
  const { Runner, SIGNALS } = require(
    require.resolve('@usehenri/jobs/src/runner', { paths: [process.cwd()] })
  );
  const runner = new Runner(jobs.queue, {
    concurrency: args.concurrency,
    queues: queues(args),
    recurring: args.recurring !== false,
  });

  let result;

  try {
    if (args.once === true) {
      result = await runner.once();
    } else {
      const stopped = new Promise((resolve) => {
        const stop = () => resolve(runner.stop());

        SIGNALS.forEach((signal) => process.once(signal, stop));
      });

      runner.start();
      result = await stopped;
    }
  } finally {
    // Whatever went wrong, the runner lets go of its jobs and the drivers
    // are closed: without this the process hangs on an open pool
    await runner.stop().catch(() => null);
    await henri.stop();
  }

  return {
    command: 'run',
    duration: Date.now() - started,
    failed: result.failed,
    ok: true,
    performed: result.performed,
    queues: runner.queues,
    runner: runner.id,
  };
};

/**
 * Creates the tables of the queue
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 */
const install = async (args) => {
  const henri = await boot();
  const jobs = await queueOf(henri);
  let statements;

  try {
    statements = await jobs.queue.store.install();
  } finally {
    await henri.stop();
  }

  return {
    command: 'install',
    ok: true,
    statements,
    store: jobs.queue.config.store,
    tables: jobs.queue.config.tables,
  };
};

/**
 * Counts, timings and waits
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 */
const status = async (args) => {
  const henri = await boot();
  const jobs = await queueOf(henri);
  const recurring = jobs.queue.config.recurring.map((entry) => ({
    job: entry.job,
    name: entry.name,
    spec: entry.spec,
  }));
  let stats;

  try {
    stats = await jobs.stats();
  } finally {
    await henri.stop();
  }

  return { command: 'status', ok: true, recurring, ...stats };
};

/**
 * Lists jobs
 *
 * @param {object} args CLI arguments
 * @param {string} [state] Force a state (the `dead` command)
 * @returns {Promise<object>} The result of the command
 */
const list = async (args, state) => {
  const henri = await boot();
  const jobs = await queueOf(henri);

  try {
    const found = await jobs.list({
      limit: Number(args.limit) || 50,
      name: typeof args.name === 'string' ? args.name : undefined,
      queue: typeof args.queue === 'string' ? args.queue : undefined,
      state: state || (typeof args.state === 'string' ? args.state : undefined),
    });

    return {
      command: state || 'list',
      jobs: found,
      ok: true,
      total: found.length,
    };
  } finally {
    await henri.stop();
  }
};

/**
 * Shows one job, with its error and its history
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 * @throws {CliError} USAGE without an id, FAILED when there is no such job
 */
const show = async (args) => {
  const [, id] = args._;

  if (!id) {
    throw new CliError('USAGE', 'Missing id: henri jobs show <id>', {
      hint: 'henri jobs list gives the ids',
    });
  }

  const henri = await boot();
  const jobs = await queueOf(henri);
  let job;

  try {
    job = await jobs.get(id);
  } finally {
    await henri.stop();
  }

  if (!job) {
    throw new CliError('FAILED', `No job with id "${id}"`, {
      hint: 'henri jobs list gives the ids',
    });
  }

  return { command: 'show', job, ok: true };
};

/**
 * Enqueues a job from the command line
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 * @throws {CliError} USAGE without a name or with unreadable arguments
 */
const perform = async (args) => {
  const [, name, ...rest] = args._;

  if (!name) {
    throw new CliError(
      'USAGE',
      'Missing name: henri jobs perform <name> [json]',
      { hint: `ex: henri jobs perform welcome '{"userId":1}'` }
    );
  }

  const raw = rest.join(' ').trim();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new CliError('USAGE', `The arguments are not JSON: ${raw}`, {
        cause: error,
        hint: `ex: henri jobs perform welcome '{"userId":1}'`,
      });
    }
  }

  const henri = await boot();
  const jobs = await queueOf(henri);

  try {
    if (args.now === true) {
      const result = await jobs.performNow(name, payload);

      return {
        command: 'perform',
        inline: true,
        ok: true,
        result: result ?? null,
      };
    }

    // `--wait` is a global flag (it belongs to --inspect), so the delay of
    // an enqueue is `--in`
    const job = await jobs.perform(name, payload, {
      at: typeof args.at === 'string' ? args.at : undefined,
      queue: typeof args.queue === 'string' ? args.queue : undefined,
      wait: typeof args.in === 'string' ? args.in : undefined,
    });

    return { command: 'perform', job, ok: true };
  } finally {
    await henri.stop();
  }
};

/**
 * Puts dead jobs back in their queue
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 * @throws {CliError} USAGE without an id and without --all
 */
const retry = async (args) => {
  const [, id] = args._;

  if (!id && args.all !== true) {
    throw new CliError('USAGE', 'Missing id: henri jobs retry <id>, or --all', {
      hint: 'henri jobs dead lists the dead jobs',
    });
  }

  const henri = await boot();
  const jobs = await queueOf(henri);

  try {
    if (id) {
      const job = await jobs.dead.retry(id);

      if (!job) {
        throw new CliError('FAILED', `No job with id "${id}"`);
      }

      return { command: 'retry', job, ok: true, requeued: 1 };
    }

    const requeued = await jobs.dead.retryAll({
      name: typeof args.name === 'string' ? args.name : undefined,
      queue: typeof args.queue === 'string' ? args.queue : undefined,
    });

    return { command: 'retry', ok: true, requeued };
  } finally {
    await henri.stop();
  }
};

/**
 * Deletes dead jobs
 *
 * @param {object} args CLI arguments
 * @returns {Promise<object>} The result of the command
 * @throws {CliError} USAGE without an id and without --all
 */
const discard = async (args) => {
  const [, id] = args._;

  if (!id && args.all !== true) {
    throw new CliError(
      'USAGE',
      'Missing id: henri jobs discard <id>, or --all',
      { hint: 'henri jobs dead lists the dead jobs' }
    );
  }

  const henri = await boot();
  const jobs = await queueOf(henri);

  try {
    if (id) {
      const gone = await jobs.dead.discard(id);

      if (!gone) {
        throw new CliError('FAILED', `No job with id "${id}"`);
      }

      return { command: 'discard', discarded: 1, ok: true };
    }

    const discarded = await jobs.dead.discardAll({
      name: typeof args.name === 'string' ? args.name : undefined,
      queue: typeof args.queue === 'string' ? args.queue : undefined,
    });

    return { command: 'discard', discarded, ok: true };
  } finally {
    await henri.stop();
  }
};

/**
 * A duration in milliseconds, for humans
 *
 * @param {?number} value A duration
 * @returns {string} The duration
 */
const ms = (value) =>
  value === null || typeof value === 'undefined' ? '-' : `${value}ms`;

/**
 * Prints a list of jobs
 *
 * @param {Array<object>} jobs The jobs
 * @returns {void}
 */
const printJobs = (jobs) => {
  if (jobs.length === 0) {
    console.log('  No job matches');

    return;
  }

  for (const job of jobs) {
    console.log(
      `  ${job.id}  ${job.state.padEnd(7)} ${job.queue}/${job.name}  ${job.attempts}/${job.maxAttempts}  ${job.runAt}`
    );

    if (job.error) {
      console.log(`      ${job.error.message}`);
    }
  }
};

/**
 * Prints a result for humans
 *
 * @param {object} result What a command returned
 * @returns {void}
 */
const print = (result) => {
  console.log('');

  if (result.command === 'run') {
    console.log(
      `  Runner ${result.runner} stopped: ${result.performed} performed, ${result.failed} failed (${result.duration}ms)`
    );
  }

  if (result.command === 'install') {
    console.log(
      `  Queue ready in the "${result.store}" store: ${Object.values(result.tables).join(', ')}`
    );
  }

  if (result.command === 'status') {
    const { totals } = result;

    console.log(
      `  ${totals.pending} pending, ${totals.running} running, ${totals.done} done, ${totals.dead} dead`
    );
    console.log('');

    for (const queue of result.queues) {
      console.log(
        `  ${queue.queue.padEnd(16)} pending ${queue.pending}  running ${queue.running}  done ${queue.done}  dead ${queue.dead}  waiting ${ms(queue.waiting)}`
      );
    }

    for (const timing of result.timings) {
      console.log(
        `  ${timing.queue.padEnd(16)} ${timing.runs} run(s), ${ms(timing.average)} on average (${ms(timing.shortest)} to ${ms(timing.longest)})`
      );
    }

    if (result.recurring.length > 0) {
      console.log('');
      console.log('  Recurring:');
      result.recurring.forEach((entry) =>
        console.log(`    ${entry.name} -> ${entry.job} (${entry.spec})`)
      );
    }
  }

  if (result.command === 'list' || result.command === 'dead') {
    printJobs(result.jobs);
  }

  if (result.command === 'show') {
    const { job } = result;

    console.log(`  ${job.id}  ${job.state}  ${job.queue}/${job.name}`);
    console.log(
      `  attempts ${job.attempts}/${job.maxAttempts}, run at ${job.runAt}`
    );
    console.log(`  args ${JSON.stringify(job.args)}`);

    if (job.error) {
      console.log('');
      console.log(`  ${job.error.message}`);
      console.log(job.error.stack || '');
    }

    if (job.history.length > 0) {
      console.log('');
      console.log('  History:');
      job.history.forEach((entry) =>
        console.log(
          `    #${entry.attempt} ${entry.at} ${ms(entry.duration)} ${entry.message}`
        )
      );
    }
  }

  if (result.command === 'perform') {
    console.log(
      result.inline
        ? `  Performed inline: ${JSON.stringify(result.result)}`
        : `  Enqueued ${result.job.name} as ${result.job.id} on ${result.job.queue}`
    );
  }

  if (result.command === 'retry') {
    console.log(`  Requeued ${result.requeued} job(s)`);
  }

  if (result.command === 'discard') {
    console.log(`  Discarded ${result.discarded} job(s)`);
  }

  console.log('');
};

const RUNNERS = {
  dead: (args) => list(args, 'dead'),
  discard,
  install,
  list,
  perform,
  retry,
  run,
  show,
  status,
};

/**
 * Runs `henri jobs [run|install|status|list|dead|show|perform|retry|discard]`
 * (`henri jobs:<command>` too). Without a command it runs a worker.
 *
 * With --json the result is printed as one JSON object on stdout.
 *
 * @param {object} args CLI arguments
 * @returns {Promise<void>} Resolves when done
 * @throws {CliError} USAGE for an unknown command
 */
const main = async (args) => {
  const [named] = args._;
  const command = named || 'run';

  if (!COMMANDS.includes(command)) {
    if (!args.json) {
      console.log(usage('jobs'));
    }

    throw new CliError('USAGE', `Unknown jobs command "${command}"`, {
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
    result = await RUNNERS[command](args);
  } finally {
    console.log = log;
  }

  if (args.json) {
    // `process.exit()` truncates a pipe that has not drained: wait for it
    await new Promise((resolve) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, resolve)
    );
  } else {
    print(result);
  }

  // The drivers are closed by henri.stop(); leave nothing behind
  process.exit(0);
};

module.exports = main;
module.exports.COMMANDS = COMMANDS;
module.exports.boot = boot;
module.exports.print = print;
