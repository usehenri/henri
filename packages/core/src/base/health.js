/**
 * `GET /_henri/health`: pings every store through the adapter contract
 * (`ping()`), answers 200 when they all respond and 503 otherwise:
 *
 * ```json
 * {
 *   "status": "ok",
 *   "stores": { "default": { "adapter": "disk", "ok": true, "latency": 2 } },
 *   "uptime": 42
 * }
 * ```
 *
 * Mounted before the sessions, never cached, no authentication.
 */
const PATH = '/_henri/health';

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
      timer = setTimeout(
        () => reject(new Error(`no answer after ${ms}ms`)),
        ms
      );
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The health check handler
 *
 * @param {Henri} henri the henri instance
 * @param {object} [options={}] options
 * @param {number} [options.timeout=2000] how long a store may take (ms)
 * @returns {function} express handler
 */
function health(henri, { timeout = 2000 } = {}) {
  return async (req, res) => {
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
        checks[name] = { adapter, ok: false };

        if (!henri.isProduction) {
          checks[name].error = error.message;
        }

        henri.pen.error('health', name, error.message);
      }
    }

    const body = {
      requestId: req.id,
      status: ok ? 'ok' : 'unavailable',
      stores: checks,
      uptime: Math.round(process.uptime()),
    };

    if (!henri.isProduction) {
      body.version = henri.release;
    }

    res.set('Cache-Control', 'no-store');

    return res.status(ok ? 200 : 503).json(body);
  };
}

module.exports = health;
module.exports.PATH = PATH;
module.exports.withTimeout = withTimeout;
