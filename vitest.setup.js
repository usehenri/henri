const dns = require('node:dns');
const net = require('node:net');

/**
 * The environment configures a henri application (see `0.config.js`), and
 * `DATABASE_URL` is the one variable this repository does not own: a
 * developer machine or a CI job may export it for something else entirely.
 * The suites boot applications whose stores are their own (the demo app runs
 * on @usehenri/disk, the SQL suites on sqlite), so the variable is dropped
 * here rather than left to repoint them.
 */
delete process.env.DATABASE_URL;

/**
 * Every test server binds the loopback address.
 *
 * `supertest(app)` starts an http server with `app.listen(0)` for each
 * request and connects to `http://127.0.0.1:<port>`. Without a host, node
 * binds the IPv6 wildcard (`[::]:port`, dual stack) and libuv sets
 * `SO_REUSEADDR`, so another process may bind the *more specific*
 * `127.0.0.1:port` at the same time -- and on macOS and the BSDs the more
 * specific socket then wins the IPv4 connection. The request is answered by
 * whatever else holds that port: another suite's application (stray 404s on
 * routes that exist, missing middleware headers, foreign status codes), the
 * mongod that mongodb-memory-server binds on `127.0.0.1` on a port it picked
 * the same way (`Parse Error: Expected HTTP/, RTSP/ or ICE/`), or nothing at
 * all any more (`socket hang up`).
 *
 * Naming the address makes the reservation exact: the kernel gives that
 * address and port to one listener only. Measured over 6000 sequential
 * supertest requests against two applications: 12 answers from the wrong
 * server on the wildcard, none on the loopback.
 *
 * Only calls that name no host are changed, so a test binding an interface
 * on purpose keeps it.
 */
const LOOPBACK = '127.0.0.1';

/**
 * `listen(port, host)` resolves the host through `dns.lookup`, whose
 * callback is deferred even for an address that needs no resolving. The
 * handle is then bound a tick later and `server.address()` is still null
 * when `listen()` returns, which supertest reads right away. Answering
 * synchronously while our own `listen()` is running keeps the bind
 * synchronous, as it is for a host-less `listen()`; every other lookup goes
 * to node's.
 */
let binding = false;

const { lookup } = dns;

/**
 * `dns.lookup()`, answering an address literal on the spot while binding
 *
 * @param {string} hostname the host to resolve
 * @param {object|function} options options, or the callback
 * @param {function} [callback] the callback
 * @returns {*} whatever `dns.lookup` answers
 */
dns.lookup = function lookupWhileBinding(hostname, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  const family = net.isIP(hostname);

  if (binding && family && typeof done === 'function') {
    // `listen()` asks for every address (`{ all: true }`)
    return options && options.all
      ? done(null, [{ address: hostname, family }])
      : done(null, hostname, family);
  }

  return lookup.apply(this, arguments);
};

// Node tags dns.lookup so util.promisify() resolves { address, family }
for (const symbol of Object.getOwnPropertySymbols(lookup)) {
  dns.lookup[symbol] = lookup[symbol];
}

/**
 * The arguments of a `listen()` call, with the loopback address added when
 * the call names no host and no unix socket path
 *
 * @param {Array} args the arguments of `net.Server.prototype.listen`
 * @returns {?Array} the arguments to use, or null to leave the call alone
 */
function onLoopback(args) {
  const [first, second] = args;

  // Port: `listen(port[, backlog][, callback])`
  if (typeof first === 'number' && typeof second !== 'string') {
    return [first, LOOPBACK, ...args.slice(1)];
  }

  // Options: `listen({ port, ... })`
  if (
    first &&
    typeof first === 'object' &&
    typeof first.port !== 'undefined' &&
    typeof first.host === 'undefined' &&
    typeof first.path === 'undefined'
  ) {
    return [Object.assign({}, first, { host: LOOPBACK }), ...args.slice(1)];
  }

  return null;
}

const { listen } = net.Server.prototype;

/**
 * `Server.listen()`, defaulting the host to the loopback address
 *
 * @param {...*} args the arguments of `net.Server.prototype.listen`
 * @returns {net.Server} the server
 */
net.Server.prototype.listen = function listenOnLoopback(...args) {
  const called = onLoopback(args);

  if (!called) {
    return listen.apply(this, args);
  }

  binding = true;

  try {
    return listen.apply(this, called);
  } finally {
    binding = false;
  }
};
