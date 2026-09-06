const http = require('http');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');

const Sql = require('@usehenri/sequelize');
// The target of the SQL suites: sqlite unless HENRI_TEST_POSTGRES_URL or
// HENRI_TEST_MYSQL_URL points at a server (`pnpm test:sql:live`)
const target = require('@usehenri/sequelize/__tests__/targets');

const { Webhooks } = require('../src/webhooks');

if (typeof afterAll === 'function') {
  afterAll(() => target.cleanup());
}

/**
 * A minimal henri stand-in
 *
 * `logged` holds the pen lines: `calls` is `henri.calls`, the call log of
 * core, and a stand-in that shadowed it would hide the one thing this
 * package asks it for (the request id a delivery joins on).
 *
 * @param {object} [options={}] `secret`, `cache`, `jobs`
 * @returns {object} A fake henri, with the pen lines in `logged`
 */
const fakeHenri = (options = {}) => {
  const logged = [];
  const pen = {};

  ['error', 'info', 'warn'].forEach((level) => {
    pen[level] = (...args) => logged.push([level, ...args]);
  });

  pen.fatal = (...args) => {
    logged.push(['fatal', ...args]);

    return new Error(args.join(' '));
  };

  const values = {
    secret: 'a-test-secret-that-is-long-enough',
    ...(options.config || {}),
  };

  return {
    cache: options.cache || null,
    calls: options.calls || null,
    config: {
      get: (key) => values[key],
      has: (key) => typeof values[key] !== 'undefined',
    },
    cwd: () => process.cwd(),
    jobs: options.jobs || null,
    logged,
    pen,
  };
};

/**
 * A queue stand-in that only records what was enqueued
 *
 * @returns {object} A `henri.jobs` with `enabled` and `perform`
 */
const fakeQueue = () => {
  const enqueued = [];

  return {
    enabled: true,
    enqueued,

    /**
     * Records an enqueue
     *
     * @param {string} name The job name
     * @param {object} args The job arguments
     * @param {object} options The enqueue options
     * @returns {Promise<object>} A job-shaped answer
     */
    perform: async (name, args, options) => {
      const job = { args, id: randomUUID(), name, options };

      enqueued.push(job);

      return job;
    },
  };
};

/**
 * A key that names one database on the target, and one sqlite file
 *
 * @param {string} [label='shared'] What the database is for
 * @returns {string} The key
 */
const sharedKey = (label = 'shared') =>
  path.join(
    os.tmpdir(),
    `henri-webhooks-${label}-${randomUUID().slice(0, 8)}.sqlite`
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
 * Started endpoints on the target database
 *
 * @param {object} [options={}] `config`, `key`, `adapter`, `cache`, `jobs`
 * @returns {Promise<object>} `{ adapter, henri, webhooks }`
 */
const build = async (options = {}) => {
  const henri = fakeHenri(options);
  const adapter = options.adapter || (await adapterFor(options.key));
  const webhooks = new Webhooks(henri, {
    adapter,
    config: options.config || {},
  });

  await webhooks.start();

  return { adapter, henri, webhooks };
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

/**
 * A receiving server on the loopback, which records what it was sent
 *
 * @param {Function} [handler] `(request, body) => { status, body, headers }`
 * @returns {Promise<object>} `{ url, port, received, close }`
 */
const receiver = async (handler = null) => {
  const received = [];
  const server = http.createServer((request, response) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const entry = { body, headers: request.headers, url: request.url };

      received.push(entry);

      const answer = handler ? handler(entry, received.length) : {};
      const status = answer.status || 200;

      response.writeHead(status, answer.headers || {});
      response.end(answer.body || 'ok');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const { port } = server.address();

  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    port,
    received,
    url: `http://127.0.0.1:${port}/hooks`,
  };
};

module.exports = {
  adapterFor,
  build,
  close,
  fakeHenri,
  fakeQueue,
  receiver,
  sharedKey,
  target,
};
