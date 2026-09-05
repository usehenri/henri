 
/**
 * Runs the real engine against the fixture application in a child process
 * (vite and the built server bundle are ESM, which the test runner does not
 * need to load itself). Prints a JSON report on stdout.
 *
 *   node harness.js build         -> builds dist/client and dist/ssr
 *   node harness.js production    -> renders with the build
 *   node harness.js development   -> renders with the vite dev server
 */
const path = require('path');
const Engine = require('../../engine');

const cwd = __dirname;
const mode = process.argv[2] || 'production';

/**
 * A henri look-alike with what the engine reads
 *
 * @param {boolean} production production mode?
 * @returns {object} the fake
 */
function fakeHenri(production) {
  const henri = {
    _middlewares: [],
    addMiddleware(name, func) {
      henri._middlewares.push({ func, name });
    },
    config: {
      get: (key) => ({ renderer: 'inertia' })[key],
      has: (key) => key === 'renderer',
    },
    cwd: () => cwd,
    isDev: !production,
    isProduction: production,
    isTest: false,
    pen: {
      error: (...args) => console.error(...args),
      fatal: (...args) => console.error(...args),
      info: () => {},
      warn: () => {},
    },
    server: { express: null, httpServer: null },
    utils: {
      checkPackages: async () => true,
      resolvePackageJson: (name) =>
        require(require.resolve(`${name}/package.json`, { paths: [cwd] })),
    },
  };

  return henri;
}

/**
 * A minimal request
 *
 * @param {string} url the url
 * @param {object} [headers={}] headers
 * @returns {object} the request
 */
const fakeReq = (url, headers = {}) => ({
  headers: Object.assign({ host: 'localhost:3000' }, headers),
  method: 'GET',
  originalUrl: url,
  protocol: 'http',
  query: {},
  url,
});

/**
 * A minimal response
 *
 * @returns {object} the response
 */
const fakeRes = () => ({
  body: null,
  end() {
    return this;
  },
  getHeader(name) {
    return this.headers[name.toLowerCase()];
  },
  headers: {},
  json(payload) {
    this.body = payload;

    return this;
  },
  send(payload) {
    this.body = payload;

    return this;
  },
  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  },
  statusCode: 200,
});

/**
 * Main
 *
 * @returns {Promise<void>} nothing
 */
async function main() {
  const out = { mode };

  if (mode === 'build') {
    // Vite logs on stdout: keep it quiet so the report stays parseable
    out.build = await Engine.build({ cwd, logLevel: 'silent' });
  } else {
    const henri = fakeHenri(mode === 'production');
    const engine = new Engine(henri);
    const started = Date.now();

    await engine.init();
    await engine.prepare();
    out.prepared = Date.now() - started;
    out.version = engine.version;
    out.middlewares = henri._middlewares.map((middleware) => middleware.name);

    const opts = {
      data: { greeting: 'hello from the fixture' },
      localUrl: 'http://localhost:3000/',
      paths: { index_tasks_path: { method: 'get', route: '/tasks' } },
      query: {},
      user: { email: 'felix@example.com' },
    };

    const res = fakeRes();

    await engine.render(fakeReq('/'), res, '/', opts);
    out.html = { body: res.body, headers: res.headers, status: res.statusCode };

    const json = fakeRes();

    await engine.render(
      fakeReq('/tasks', {
        'x-inertia': 'true',
        'x-inertia-version': engine.version,
      }),
      json,
      '/tasks/index',
      { data: { tasks: [{ name: 'write tests' }] }, paths: opts.paths }
    );
    out.json = {
      body: json.body,
      headers: json.headers,
      status: json.statusCode,
    };

    const tasks = fakeRes();

    await engine.render(fakeReq('/tasks'), tasks, '/tasks', {
      data: { tasks: [{ name: 'ship inertia' }] },
    });
    out.tasks = { body: tasks.body, status: tasks.statusCode };

    await engine.close();
  }

  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

module.exports = { cwd, dist: path.join(cwd, 'app', 'views', 'dist') };
