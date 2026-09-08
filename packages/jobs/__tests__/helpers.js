const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const Sql = require('@usehenri/sequelize');
// The real module, not a stand-in: what a job's tenant is scoped by is
// core's decision, and the queue is what has to ask. `enabled` is false
// unless a suite passed a `tenancy` setting, so every other suite is
// untouched -- the drizzle harness does exactly this
const Tenancy = require('@usehenri/core/src/0.tenancy');
// The target of the SQL suites: sqlite unless HENRI_TEST_POSTGRES_URL or
// HENRI_TEST_MYSQL_URL points at a server, in which case these suites run
// on that server too (`pnpm test:sql:live`)
const target = require('@usehenri/sequelize/__tests__/targets');

const { Jobs } = require('../src/jobs');

if (typeof afterAll === 'function') {
  afterAll(() => target.cleanup());
}

/**
 * A minimal henri stand-in
 *
 * @param {object} [options={}] `cwd`, and `settings` for the configuration
 *   the modules it carries read (`tenancy`)
 * @returns {object} A fake henri, with the pen calls in `calls`
 */
const fakeHenri = (options = {}) => {
  const calls = [];
  const pen = {};
  const settings = options.settings || {};

  ['error', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => calls.push([level, ...args]);
  });

  // `pen.fatal()` returns the Error its caller throws, as core's does
  pen.fatal = (...args) => {
    calls.push(['fatal', ...args]);

    return new Error(args.join(' '));
  };

  const henri = {
    calls,
    config: {
      get: (key) => settings[key],
      has: (key) => typeof settings[key] !== 'undefined',
      sourceOf: () => 'the test',
    },
    cwd: () => options.cwd || path.join(__dirname, 'fixtures', 'app'),
    pen,
  };

  const tenancy = new Tenancy();

  tenancy.henri = henri;
  tenancy.init();
  henri.tenancy = tenancy;
  // The module says at boot that it is on; that is core's line, not the
  // queue's, and `calls` is what the suites read to see what the queue said
  calls.length = 0;

  return henri;
};

/**
 * A key that names one database on the live target, and one sqlite file
 *
 * Two stores built with the same key share a database, which is what the
 * concurrency suites need.
 *
 * @param {string} [label='shared'] What the database is for
 * @returns {string} The key
 */
const sharedKey = (label = 'shared') =>
  path.join(
    os.tmpdir(),
    `henri-jobs-${label}-${randomUUID().slice(0, 8)}.sqlite`
  );

/**
 * A started store adapter on the target database
 *
 * @param {string} [key] The key of the database (a new one when absent)
 * @returns {Promise<object>} A started adapter
 */
const adapterFor = async (key) => {
  const henri = fakeHenri();
  const adapter = target.prepare(new Sql('default', target.store(key), henri));

  await adapter.start();

  return adapter;
};

/**
 * A started queue on the target database
 *
 * @param {object} [options={}] Options
 * @param {object} [options.config] The `jobs` configuration
 * @param {string} [options.cwd] The application directory (app/jobs)
 * @param {string} [options.key] The key of the database
 * @param {object} [options.adapter] An adapter to reuse
 * @param {object} [options.henri] A henri stand-in to reuse, so a suite can
 *   turn tenancy on for it
 * @returns {Promise<object>} `{ adapter, henri, jobs }`
 */
const build = async (options = {}) => {
  const henri = options.henri || fakeHenri({ cwd: options.cwd });
  const adapter = options.adapter || (await adapterFor(options.key));
  const jobs = new Jobs(henri, {
    adapter,
    config: { backoff: { jitter: 0 }, ...(options.config || {}) },
    cwd: henri.cwd(),
  });

  await jobs.start();

  return { adapter, henri, jobs };
};

/**
 * Drops an index, whatever the dialect spells it
 *
 * The downgrade helpers of the upgrade suites take a table back to what an
 * older henri wrote, and dropping an index is the one statement the four
 * dialects have no common spelling for: MySQL puts it on the table,
 * PostgreSQL and sqlite take the name alone, and SQL Server needs both
 * (`DROP INDEX <name> ON <table>`) -- and refuses to drop a column an index
 * still covers, which is what made these suites the only two that could
 * not run against it.
 *
 * @param {object} store A SqlStore
 * @param {string} table The table the index is on
 * @param {string} index The index name
 * @returns {Promise<void>} Resolves when it is gone, or was never there
 */
const dropIndex = async (store, table, index) => {
  const spellings = [
    `DROP INDEX IF EXISTS ${index} ON ${table}`,
    `DROP INDEX IF EXISTS ${index}`,
    `ALTER TABLE ${table} DROP INDEX ${index}`,
  ];

  for (const statement of spellings) {
    const dropped = await store.run(statement).then(
      () => true,
      () => false
    );

    if (dropped) {
      return;
    }
  }
};

/**
 * Stops the adapters a suite opened
 *
 * @param {Array<object>} adapters The adapters
 * @returns {Promise<void>} Resolves when they are closed
 */
const close = async (adapters) => {
  for (const adapter of adapters) {
    await adapter.stop().catch(() => null);
  }
};

module.exports = {
  adapterFor,
  build,
  close,
  dropIndex,
  fakeHenri,
  sharedKey,
  target,
};
