/**
 * The health endpoints an orchestrator asks: `GET /livez`, `GET /readyz`,
 * and `GET /healthz` and `GET /_henri/health` beside them, which answer
 * readiness so a proxy that knows one of those names, or a deployment
 * already pointing at the endpoint henri used to have, keeps working.
 *
 * Liveness and readiness are two questions with opposite consequences. A
 * failed liveness probe restarts the container; a failed readiness probe
 * takes it out of the load balancer. Answering one endpoint for both makes a
 * process with an unreachable database get killed -- which fixes nothing,
 * because the database is what is down -- instead of drained. So:
 *
 * - `/livez` never touches a store. It answers 200 as long as the process can
 *   answer at all, which is the whole question: an event loop that cannot
 *   serve this request cannot serve any, and there is nothing else a liveness
 *   probe can honestly measure from the inside.
 * - `/readyz` answers 503 while the boot is still running, while the process
 *   is shutting down, and when a store does not answer; 200 otherwise.
 *
 * Liveness stays 200 while the process drains, on purpose: a restart during a
 * graceful shutdown is the one thing that would cut the requests the drain is
 * finishing. Readiness is what says "stop sending", and it says it before the
 * port closes (`2.server.js`).
 *
 * `/healthz` is the older convention, and it is the ambiguous one: the name
 * says "health" without saying which of the two questions it answers, so one
 * deployment wires it to liveness and the next to readiness. henri answers
 * readiness there, which is what `/_henri/health` has always done and the
 * safer of the two guesses -- a readiness answer read as liveness restarts a
 * container whose database is down, so point a liveness probe at `/livez`
 * and leave `/healthz` to whatever cannot be configured.
 *
 * ```json
 * {
 *   "status": "ok",
 *   "stores": { "default": { "adapter": "disk", "ok": true, "latency": 2 } },
 *   "shared": { "adapter": "redis", "ok": true, "latency": 1 },
 *   "uptime": 42
 * }
 * ```
 *
 * `shared` is only there when `config.shared` names a shared store
 * (`base/shared.js`); a process whose counters cannot be counted is not
 * ready either.
 *
 * All three are mounted before the sessions and the limiters, never cached
 * and unauthenticated, on purpose -- a load balancer has no credentials. The
 * body therefore says nothing a stranger should not read: the names of the
 * stores and their adapter (as it always has), and `timeout` or `unreachable`
 * for a failure, never the driver's own message, which carries the connection
 * string it could not reach. The message goes to the log, where it belongs.
 */

/** `GET /healthz`: readiness, under the older ambiguous name */
const HEALTH_PATH = '/healthz';

/** `GET /livez`: the process answers */
const LIVE_PATH = '/livez';

/** `GET /_henri/health`: readiness, under the name henri answered before */
const PATH = '/_henri/health';

/** `GET /readyz`: the process can serve traffic */
const READY_PATH = '/readyz';

/** What the body calls a store that did not answer in time */
const TIMEOUT = 'timeout';

/** What the body calls any other store failure */
const UNREACHABLE = 'unreachable';

/**
 * A promise that fails after a delay
 *
 * @param {Promise} promise the promise
 * @param {number} ms the delay
 * @returns {Promise} the promise, bounded
 */
function withTimeout(promise, ms) {
  let timer;

  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`no answer after ${ms}ms`);

        error.timeout = true;
        reject(error);
      }, ms);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Where the process is in its life, when that alone makes it unready
 *
 * The boot is what mounts these routes, so nothing answers before runlevel 2
 * and nothing listens before the router starts the server: a probe sent
 * during the first half of a boot is refused by the kernel, not by henri.
 * The window this covers is the second half -- the port is open while the
 * modules above the router (an application's own, at runlevel 6) are still
 * initializing -- and every shutdown, from its first moment.
 *
 * @param {Henri} henri the henri instance
 * @returns {?string} why it cannot serve, null when it can
 */
function phase(henri) {
  if (henri.server && henri.server.draining) {
    return 'shutting down';
  }

  if (henri.modules && henri.modules.initialized === false) {
    return 'starting';
  }

  return null;
}

/**
 * Ping every store of the application
 *
 * @param {Henri} henri the henri instance
 * @param {number} timeout how long a store may take (ms)
 * @returns {Promise<{ok: boolean, checks: object}>} what each store answered
 */
async function ping(henri, timeout) {
  const stores = (henri.model && henri.model.stores) || {};
  const checks = {};
  let ok = true;

  for (const name of Object.keys(stores)) {
    const store = stores[name];
    const adapter = store.adapterName || 'unknown';
    const started = Date.now();

    if (typeof store.ping !== 'function') {
      checks[name] = { adapter, ok: true, skipped: true };
      continue;
    }

    try {
      await withTimeout(
        Promise.resolve().then(() => store.ping()),
        timeout
      );
      checks[name] = { adapter, latency: Date.now() - started, ok: true };
    } catch (error) {
      ok = false;
      checks[name] = {
        adapter,
        error: error.timeout ? TIMEOUT : UNREACHABLE,
        ok: false,
      };

      henri.pen.error('health', name, error.message);
    }
  }

  return { checks, ok };
}

/**
 * Ping the shared store (`config.shared`), when there is one.
 *
 * It belongs in readiness rather than beside the databases: with the default
 * `onError: "closed"` a process whose shared store is down refuses every
 * guarded request, which is exactly "do not send me traffic", and with
 * `"open"` it is still worth taking out of the pool while the counters are
 * not being counted.
 *
 * @param {Henri} henri the henri instance
 * @param {number} timeout how long it may take (ms)
 * @returns {Promise<?object>} what it answered, null without a shared store
 */
async function pingShared(henri, timeout) {
  const shared = henri.shared || null;

  if (!shared) {
    return null;
  }

  const started = Date.now();

  try {
    await withTimeout(
      Promise.resolve().then(() => shared.ping()),
      timeout
    );

    return { adapter: shared.name, latency: Date.now() - started, ok: true };
  } catch (error) {
    henri.pen.error('health', 'shared', error.message);

    return {
      adapter: shared.name,
      error: error.timeout ? TIMEOUT : UNREACHABLE,
      ok: false,
    };
  }
}

/**
 * What every one of these endpoints answers, before its own keys
 *
 * @param {Henri} henri the henri instance
 * @param {object} req the request
 * @returns {object} the body
 */
function body(henri, req) {
  const answer = {
    requestId: req.id,
    status: 'ok',
    uptime: Math.round(process.uptime()),
  };

  if (!henri.isProduction) {
    answer.version = henri.release;
  }

  return answer;
}

/**
 * The liveness handler: is this process running and answering
 *
 * @param {Henri} henri the henri instance
 * @returns {function} express handler
 */
function live(henri) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');

    return res.status(200).json(body(henri, req));
  };
}

/**
 * The readiness handler: can this process serve traffic
 *
 * @param {Henri} henri the henri instance
 * @param {object} [options={}] options
 * @param {number} [options.timeout=2000] how long a store may take (ms)
 * @returns {function} express handler
 */
function ready(henri, { timeout = 2000 } = {}) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const answer = body(henri, req);
    const stopping = phase(henri);

    if (stopping) {
      return res.status(503).json(
        Object.assign(answer, {
          reason: stopping,
          status: 'unavailable',
          stores: {},
        })
      );
    }

    const [{ checks, ok }, shared] = await Promise.all([
      ping(henri, timeout),
      pingShared(henri, timeout),
    ]);

    answer.stores = checks;

    if (shared) {
      answer.shared = shared;
    }

    if (!ok) {
      answer.reason = 'a store did not answer';
      answer.status = 'unavailable';
    } else if (shared && !shared.ok) {
      answer.reason = 'the shared store did not answer';
      answer.status = 'unavailable';
    }

    return res.status(answer.status === 'ok' ? 200 : 503).json(answer);
  };
}

module.exports = ready;
module.exports.HEALTH_PATH = HEALTH_PATH;
module.exports.LIVE_PATH = LIVE_PATH;
module.exports.PATH = PATH;
module.exports.READY_PATH = READY_PATH;
module.exports.live = live;
module.exports.phase = phase;
module.exports.pingShared = pingShared;
module.exports.ready = ready;
module.exports.withTimeout = withTimeout;
