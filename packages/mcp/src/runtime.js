const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

/**
 * Talking to a booted application.
 *
 * The other tools of this server read files. These ones ask the process:
 * what failed, what it logged, what the router really mounted, what is in
 * the database, what an endpoint answers. That only works against a running
 * application, so this module finds one or starts one.
 *
 * ## Attach first, start second, and say which
 *
 * A henri development server exposes `/_henri/runtime` on the loopback
 * interface (`@usehenri/core`, `src/base/runtime.js`), which is what this
 * talks to. Attaching to the server the developer already has running is
 * preferred over booting a second application, for three reasons:
 *
 * - the errors and the log lines worth reading are the ones that happened
 *   in *that* process; a fresh boot has none of them;
 * - the default store (`@usehenri/disk`) is an in-memory MongoDB owned by
 *   the running process, so a second boot would answer questions about an
 *   empty database that nobody is using;
 * - a request made against the running server exercises the code the
 *   developer is looking at, hot reload included.
 *
 * When nothing answers, one is started (`henri server`, loopback, on a port
 * this module picked) and stopped when the MCP server goes away. Every
 * answer says which of the two happened, and on which url.
 *
 * ## What it refuses
 *
 * - A production application. henri mounts nothing at `/_henri/runtime`
 *   outside development, and `NODE_ENV=production` is refused before a
 *   server is started rather than booting one: the answer says so.
 * - Starting anything at all when `HENRI_MCP_AUTOSTART=0`, or when the
 *   application's dependencies are not installed. Both answer with what to
 *   do instead.
 *
 * The read rules -- what a query may be, what is redacted, how much comes
 * back -- are enforced by the application, in `base/runtime.js` of
 * `@usehenri/core`, not here: a refusal is the running henri's refusal.
 */

/** The header the runtime endpoints require */
const HEADER = { 'x-henri-runtime': '1' };

/** Where they are mounted */
const MOUNT = '/_henri/runtime';

/** How long one probe may take (ms) */
const PROBE = 1000;

/** How long a server we started may take to answer (ms) */
const BOOT = 120000;

/** How many ports after the configured one to look at (henri walks up) */
const SPAN = 20;

/** Characters of the output kept from a server that failed to start */
const OUTPUT = 4000;

/**
 * The real path of a directory, when it exists
 *
 * @param {string} dir a directory
 * @returns {string} the resolved path
 */
const real = (dir) => {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

/**
 * A port nothing is listening on
 *
 * @returns {Promise<number>} the port
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();

      server.close(() => resolve(port));
    });
  });

/**
 * Wait
 *
 * @param {number} ms how long
 * @returns {Promise<void>} resolves after ms
 */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A henri application answering on a port, and whether it is this one
 *
 * @param {number} port the port
 * @param {string} cwd the application directory
 * @returns {Promise<?object>} the identity, or null
 */
const probe = async (port, cwd) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${MOUNT}`, {
      headers: HEADER,
      signal: AbortSignal.timeout(PROBE),
    });

    if (!response.ok) {
      return null;
    }

    const identity = await response.json();

    return identity && identity.app && real(identity.app.cwd) === cwd
      ? identity
      : null;
  } catch {
    return null;
  }
};

/**
 * Is a henri answering there without the runtime endpoints? (a production
 * server, or one older than the endpoints)
 *
 * @param {number} port the port
 * @returns {Promise<?object>} `{ port, production }` or null
 */
const health = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_henri/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(PROBE),
    });
    const body = await response.json();

    if (!body || typeof body.status !== 'string') {
      return null;
    }

    // The version is only told outside production (base/health.js)
    return { port, production: typeof body.version === 'undefined' };
  } catch {
    return null;
  }
};

/**
 * A running henri application, found or started
 *
 * @class Runtime
 */
class Runtime {
  /**
   * @param {object} app the App of this server (src/app.js)
   * @memberof Runtime
   */
  constructor(app) {
    this.app = app;
    this.cwd = real(app.cwd);
    this.autostart = process.env.HENRI_MCP_AUTOSTART !== '0';
    this.child = null;
    this.port = null;
    this.source = null;
    this.identity = null;
    this.starting = null;
    this.stop = this.stop.bind(this);
  }

  /**
   * The port `config/<env>.json` asks for
   *
   * @returns {number} the port (3000 when unset)
   * @memberof Runtime
   */
  configuredPort() {
    try {
      const config = this.app.cli.utils.readConfig(this.cwd, undefined);

      return Number(config && config.port) || 3000;
    } catch {
      return 3000;
    }
  }

  /**
   * The url of the application, once reached
   *
   * @returns {string} the base url
   * @memberof Runtime
   */
  url() {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Look for this application on the ports it could be on
   *
   * @param {number} first the first port to look at
   * @returns {Promise<?object>} the identity, or null
   * @memberof Runtime
   */
  async find(first) {
    const ports = Array.from({ length: SPAN + 1 }, (_, at) => first + at);
    const found = await Promise.all(
      ports.map(async (port) => ({
        identity: await probe(port, this.cwd),
        port,
      }))
    );
    const answered = found.find((entry) => entry.identity);

    if (!answered) {
      return null;
    }

    this.port = answered.port;
    this.identity = answered.identity;

    return answered.identity;
  }

  /**
   * The application, attached to or started
   *
   * @returns {Promise<object>} `{ ok, app, source, url }` or `{ ok, error }`
   * @memberof Runtime
   */
  async reach() {
    if (this.port) {
      const still = await probe(this.port, this.cwd);

      if (still) {
        this.identity = still;

        return this.answer();
      }

      this.port = null;
    }

    const first = this.configuredPort();
    const attached = await this.find(first);

    if (attached) {
      this.source = this.child ? 'started' : 'attached';

      return this.answer();
    }

    const refusal = await this.refusal(first);

    if (refusal) {
      return { error: refusal, ok: false };
    }

    if (!this.starting) {
      this.starting = this.start().finally(() => (this.starting = null));
    }

    return this.starting;
  }

  /**
   * Why this application must not be started, if it must not
   *
   * @param {number} first the first port looked at
   * @returns {Promise<?object>} the error, or null
   * @memberof Runtime
   */
  async refusal(first) {
    const other = (
      await Promise.all(
        Array.from({ length: SPAN + 1 }, (_, at) => health(first + at))
      )
    ).find(Boolean);

    if (other && other.production) {
      return {
        code: 'PRODUCTION',
        hint: 'Run the application in development (NODE_ENV unset or "dev") to let an agent read it',
        message: `a henri application is answering on port ${other.port} in production: henri mounts no runtime endpoint there, and this server will not start a second application to work around it`,
      };
    }

    if (other) {
      return {
        code: 'NO_RUNTIME',
        hint: 'Upgrade @usehenri/core in the application',
        message: `something henri-shaped answers on port ${other.port} but has no ${MOUNT}: it is older than the runtime endpoints`,
      };
    }

    if (process.env.NODE_ENV === 'production') {
      return {
        code: 'PRODUCTION',
        hint: 'Unset NODE_ENV, or set it to dev, and try again',
        message:
          'NODE_ENV is production: this server will not boot a production application to read its database and its logs',
      };
    }

    if (!this.autostart) {
      return {
        code: 'NO_SERVER',
        hint: 'Start it with `henri server`, or unset HENRI_MCP_AUTOSTART',
        message: `no henri development server of ${this.cwd} answers, and HENRI_MCP_AUTOSTART=0 forbids starting one`,
      };
    }

    if (!fs.existsSync(path.join(this.cwd, 'node_modules'))) {
      return {
        code: 'NOT_INSTALLED',
        hint: `Install them: ${this.app.cli.utils.detectPackageManager(this.cwd)} install`,
        message: `the dependencies of ${this.cwd} are not installed, so no application can be started`,
      };
    }

    return null;
  }

  /**
   * Start a development server of this application and wait for it
   *
   * @returns {Promise<object>} `{ ok, app, source, url }` or `{ ok, error }`
   * @memberof Runtime
   */
  async start() {
    const port = await freePort();
    const runner = path.join(__dirname, 'run-cli.js');
    const env = Object.assign({}, process.env, {
      FORCE_COLOR: '0',
      HENRI_HOST: '127.0.0.1',
      NO_COLOR: '1',
    });

    // The port henri asks for, whatever config/<env>.json says (0.config.js)
    env['HENRI_CONFIG__port'] = String(port);
    delete env.HENRI_MCP_AUTOSTART;

    const child = spawn(process.execPath, [runner, 'server'], {
      cwd: this.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let exited = null;

    const keep = (chunk) => {
      output = `${output}${chunk}`.slice(-OUTPUT);
    };

    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('exit', (code) => (exited = code === null ? 'a signal' : code));
    child.on('error', (error) => {
      exited = error.message;
    });

    this.child = child;

    const until = Date.now() + BOOT;

    while (Date.now() < until && exited === null) {
      if (await this.find(port)) {
        this.source = 'started';

        return this.answer();
      }

      await wait(400);
    }

    await this.stop();

    return {
      error: {
        code: 'START_FAILED',
        hint: 'Run `henri server` yourself to see what it says, or `henri doctor`',
        message:
          exited === null
            ? `the application did not answer within ${BOOT / 1000}s of being started`
            : `the application exited (${exited}) instead of starting`,
        output: output.trim(),
      },
      ok: false,
    };
  }

  /**
   * What every runtime tool says about the application it talked to: enough
   * to know which process answered, not the whole identity (that is the
   * henri://runtime resource, read once)
   *
   * @returns {object} `{ ok, app, source, url }`
   * @memberof Runtime
   */
  answer() {
    const identity = this.identity || {};
    const app = identity.app || {};

    return {
      app: {
        cwd: app.cwd,
        env: app.env,
        pid: app.pid,
        release: app.release,
        stores: identity.stores,
        uptime: app.uptime,
      },
      ok: true,
      source: this.source || 'attached',
      url: this.url(),
    };
  }

  /**
   * Everything the application says about itself (the henri://runtime
   * resource)
   *
   * @returns {Promise<object>} the identity, or `{ error }`
   * @memberof Runtime
   */
  async describe() {
    const reached = await this.reach();

    if (!reached.ok) {
      return reached;
    }

    return Object.assign(
      { source: reached.source, url: reached.url },
      this.identity
    );
  }

  /**
   * Call one runtime endpoint
   *
   * @param {string} endpoint the path under the mount (`/logs`)
   * @param {object} [options={}] `{ body, query }`
   * @returns {Promise<object>} the answer, or `{ error }`
   * @memberof Runtime
   */
  async call(endpoint, { body = null, query = null } = {}) {
    const reached = await this.reach();

    if (!reached.ok) {
      return reached;
    }

    const search = query ? `?${new URLSearchParams(query)}` : '';
    const url = `${this.url()}${MOUNT}${endpoint}${search}`;

    try {
      const response = await fetch(url, {
        body: body ? JSON.stringify(body) : undefined,
        headers: body
          ? Object.assign({ 'content-type': 'application/json' }, HEADER)
          : HEADER,
        method: body ? 'POST' : 'GET',
        signal: AbortSignal.timeout(30000),
      });
      const answered = await response.json();

      if (answered && answered.error) {
        return Object.assign(this.answer(), {
          error: answered.error,
          ok: false,
        });
      }

      return Object.assign(
        { app: reached.app, source: reached.source, url: reached.url },
        answered
      );
    } catch (error) {
      return {
        error: {
          code: 'UNREACHABLE',
          message: `${url} did not answer: ${error.message}`,
        },
        ok: false,
      };
    }
  }

  /**
   * Make a request against the application, the way a browser would
   *
   * @param {object} options `{ body, headers, method, path }`
   * @returns {Promise<object>} the answer, or `{ error }`
   * @memberof Runtime
   */
  async request({ body = null, headers = {}, method = 'GET', path: route }) {
    const reached = await this.reach();

    if (!reached.ok) {
      return reached;
    }

    const url = `${this.url()}${route.startsWith('/') ? route : `/${route}`}`;
    const sent = Object.assign({}, headers);
    const started = Date.now();

    if (body !== null && typeof body === 'object' && !sent['content-type']) {
      sent['content-type'] = 'application/json';
    }

    let response;
    let payload;

    if (body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }

    try {
      response = await fetch(url, {
        body: payload,
        headers: sent,
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      return Object.assign(this.answer(), {
        error: {
          code: 'UNREACHABLE',
          message: `${method} ${url} did not answer: ${error.message}`,
        },
        ok: false,
      });
    }

    const text = await response.text();

    return {
      app: reached.app,
      body: text.length > 20000 ? `${text.slice(0, 20000)}...` : text,
      headers: Object.fromEntries(response.headers.entries()),
      method,
      ms: Date.now() - started,
      requestId: response.headers.get('x-request-id'),
      source: reached.source,
      status: response.status,
      truncated: text.length > 20000,
      url,
    };
  }

  /**
   * Stop the application this server started (never one it attached to)
   *
   * @returns {Promise<boolean>} whether something was stopped
   * @memberof Runtime
   */
  async stop() {
    const { child } = this;

    this.child = null;
    this.port = null;
    this.identity = null;
    this.source = null;

    if (!child || child.exitCode !== null || child.killed) {
      return false;
    }

    const ended = new Promise((resolve) => child.once('exit', resolve));

    child.kill('SIGTERM');

    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);

    killer.unref();
    await ended;
    clearTimeout(killer);

    return true;
  }
}

module.exports = { MOUNT, Runtime, freePort, probe };
