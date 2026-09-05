const dns = require('node:dns');
const net = require('node:net');

/**
 * Every test server binds the loopback address.
 *
 * `request()` and `agent()` start an http server with a port but no host for
 * each request, then connect to `http://127.0.0.1:<port>`. Without a host,
 * node binds the IPv6 wildcard (`[::]:port`, dual stack) and libuv sets
 * `SO_REUSEADDR`, so another process may bind the *more specific*
 * `127.0.0.1:port` at the same time -- and on macOS and the BSDs the more
 * specific socket then wins the IPv4 connection. The request is answered by
 * whatever else holds that port: another suite's application, a database the
 * suite started on a port it picked the same way, or nothing at all any more.
 *
 * The symptoms are the confusing kind: 404s on routes that exist, missing
 * middleware headers, empty bodies, status codes from a process outside the
 * suite, `socket hang up`, and `Parse Error: Expected HTTP/, RTSP/ or ICE/`
 * when the answer comes from a database speaking its own wire protocol.
 *
 * Naming the address makes the reservation exact: the kernel gives that
 * address and port to one listener only. Only calls that name no host are
 * changed, so a test binding an interface on purpose keeps it. Applying this
 * twice is a no-op.
 *
 * `@usehenri/testing/setup-file` applies it. Apply it yourself when you boot
 * henri another way:
 *
 *   // vitest.config.js
 *   setupFiles: ['@usehenri/testing/loopback']
 */
const APPLIED = Symbol.for('@usehenri/testing.loopback');
const LOOPBACK = '127.0.0.1';

/**
 * `listen(port, host)` resolves the host through `dns.lookup`, whose
 * callback is deferred even for an address that needs no resolving. The
 * handle is then bound a tick later and `server.address()` is still null when
 * `listen()` returns, which the http client reads right away. Answering
 * synchronously while our own `listen()` is running keeps the bind
 * synchronous, as it is for a host-less `listen()`; every other lookup goes
 * to node's.
 */
let binding = false;

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

/**
 * Binds every host-less `listen()` of this process to the loopback address
 *
 * @returns {boolean} false when it was already applied
 */
function bindTestServersToLoopback() {
  if (net.Server.prototype.listen[APPLIED]) {
    return false;
  }

  const { lookup } = dns;

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

  const { listen } = net.Server.prototype;

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

  net.Server.prototype.listen[APPLIED] = true;

  return true;
}

bindTestServersToLoopback();

module.exports = bindTestServersToLoopback;
module.exports.bindTestServersToLoopback = bindTestServersToLoopback;
