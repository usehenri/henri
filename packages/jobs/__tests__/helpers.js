const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const Sql = require('@usehenri/sequelize');
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
 * @param {object} [options={}] `cwd`
 * @returns {object} A fake henri, with the pen calls in `calls`
 */
const fakeHenri = (options = {}) => {
  const calls = [];
  const pen = {};

  ['error', 'fatal', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => calls.push([level, ...args]);
  });

  return {
    calls,
    cwd: () => options.cwd || path.join(__dirname, 'fixtures', 'app'),
    pen,
  };
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
 * @returns {Promise<object>} `{ adapter, henri, jobs }`
 */
const build = async (options = {}) => {
  const henri = fakeHenri({ cwd: options.cwd });
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

module.exports = { adapterFor, build, close, fakeHenri, sharedKey, target };
