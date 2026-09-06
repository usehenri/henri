/**
 * Draining: what happens between the signal and `henri.stop()`.
 *
 * A rolling deploy sends SIGTERM and expects the process to leave without
 * dropping anything. Stopping the modules first cuts the requests being
 * served -- the store the controller is querying goes away under it -- and
 * closing the port first without waiting cuts them just as surely. The order
 * that does not drop a request is: say "not ready", stop accepting, let what
 * is in flight finish, and only then stop the modules.
 *
 * 1. `henri.server.draining` turns true, so `/readyz` (and `/_henri/health`)
 *    answers 503 while the port is still open. A load balancer that polls
 *    readiness has that long to take this process out of its pool.
 * 2. `shutdown.delay` milliseconds pass, if an application asked for them.
 *    Zero by default, because a deployment that drains on the pod's
 *    termination -- Kubernetes stops routing when the pod turns Terminating,
 *    before the signal -- pays nothing for it; a proxy that only polls
 *    readiness wants a couple of its intervals here.
 * 3. The listener closes, so the port stops accepting connections and the
 *    load balancer's own health check fails at the TCP level. The idle
 *    keep-alive sockets are hung up at the same moment: `server.close()`
 *    waits for every open connection, and a keep-alive socket that will never
 *    send another request holds it open for the whole keep-alive timeout.
 * 4. The requests still in flight run to their end, up to `shutdown.drain`
 *    (10 seconds). What is still open then is destroyed and said so: the
 *    alternative is a container that misses its termination grace period and
 *    is killed with SIGKILL, which drops the same requests without the log
 *    line.
 *
 * Then, and only then, `henri.stop()` walks the modules backwards.
 *
 * Who installs the signal handlers is a decision, not an accident: henri
 * installs them. It is what runs the process -- `henri server` boots and
 * exits it, and the exit code is already the module system's -- so a default
 * of "nothing handles SIGTERM" would mean every application drops requests
 * until it writes the handler itself. The surprise a library owes its host is
 * paid for in three ways: the handlers go on when the server starts listening
 * and never under `NODE_ENV=test`, `stop()` takes them off again, and
 * `shutdown.signals: false` leaves the signals alone for an application that
 * wants to own them -- `henri.server.shutdown('SIGTERM')` is then the whole
 * handler it has to write. A `henri jobs` runner boots to runlevel 4 and
 * never starts the server, so the two never both hold a handler in one
 * process; on its side, the runner does the same thing in the same order
 * (stop claiming, finish what is in flight, then let go).
 */

/** What an application gets without saying anything (ms, ms, boolean) */
const DEFAULTS = { delay: 0, drain: 10000, signals: true };

/**
 * A positive number, or the fallback
 *
 * @param {*} value the value
 * @param {number} fallback the fallback
 * @returns {number} a number of milliseconds, zero or more
 */
const milliseconds = (value, fallback) =>
  Number.isFinite(Number(value)) && Number(value) >= 0
    ? Number(value)
    : fallback;

/**
 * The normalized `shutdown` settings
 *
 * @param {object} config henri's config module (or anything with get/has)
 * @returns {{delay: number, drain: number, signals: boolean}} the settings
 */
function settings(config) {
  const has =
    Boolean(config) &&
    typeof config.has === 'function' &&
    config.has('shutdown');
  const value = has ? config.get('shutdown') : {};
  const asked =
    value && typeof value === 'object' && !Array.isArray(value) ? value : {};

  return {
    delay: milliseconds(asked.delay, DEFAULTS.delay),
    drain: milliseconds(asked.drain, DEFAULTS.drain),
    signals: asked.signals !== false,
  };
}

/**
 * How many connections the server still holds
 *
 * @param {http.Server} server the http server
 * @returns {Promise<number>} the count, zero when it cannot be read
 */
function connections(server) {
  return new Promise((resolve) => {
    if (typeof server.getConnections !== 'function') {
      return resolve(0);
    }

    return server.getConnections((error, count) =>
      resolve(error ? 0 : count || 0)
    );
  });
}

/**
 * Waits, without holding the event loop open
 *
 * @param {number} ms how long to wait
 * @returns {Promise<void>} resolves when the time is up
 */
function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);

    timer.unref();
  });
}

/**
 * Stops accepting connections and waits for the requests in flight
 *
 * The server is closed, the idle keep-alive sockets are hung up, and what is
 * still running gets `deadline` milliseconds before its socket is destroyed.
 *
 * @param {http.Server} server the http server
 * @param {object} [options={}] options
 * @param {number} [options.deadline=10000] how long the in-flight requests get (ms)
 * @param {number} [options.delay=0] how long to keep serving before closing (ms)
 * @param {object} [options.pen] henri's pen, to say what happened
 * @returns {Promise<{drained: boolean, forced: boolean, open: number}>} what the drain did
 */
async function drain(server, { deadline, delay, pen } = {}) {
  const wait = milliseconds(delay, DEFAULTS.delay);
  const limit = milliseconds(deadline, DEFAULTS.drain);
  const say = (level, ...args) =>
    pen && typeof pen[level] === 'function' && pen[level]('server', ...args);

  if (!server || !server.listening) {
    return { drained: false, forced: false, open: 0 };
  }

  if (wait > 0) {
    say('info', `not ready, still serving for ${wait}ms`);
    await sleep(wait);
  }

  const open = await connections(server);
  const closed = new Promise((resolve) => server.close(() => resolve()));

  say(
    'info',
    'no longer accepting connections',
    `${open} open, ${limit}ms to finish`
  );

  // The keep-alive sockets holding no request would otherwise keep close()
  // waiting for their idle timeout
  if (typeof server.closeIdleConnections === 'function') {
    server.closeIdleConnections();
  }

  let forced = false;
  const timer = setTimeout(() => {
    forced = true;
    connections(server).then((left) =>
      say('error', `${left} connection(s) still open after ${limit}ms, closing`)
    );

    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
  }, limit);

  timer.unref();

  await closed;
  clearTimeout(timer);

  return { drained: true, forced, open };
}

module.exports = { DEFAULTS, connections, drain, settings };
