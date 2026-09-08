/**
 * The url of the running server, taken from the socket rather than from the
 * configuration.
 *
 * `henri.server.url` is the line printed in the terminal, and it says
 * `http://localhost:<port>` because that is what a person pastes into a
 * browser. A test client is not a person: under `NODE_ENV=test` the server
 * binds `127.0.0.1` and nothing else, while `localhost` is a name that
 * resolves to `::1` first on most machines. Node's http client hides that
 * (it tries both families), a browser mostly does, and "mostly" is not a
 * thing to build a suite on.
 *
 * So the url published to another process is built from
 * `httpServer.address()`: the address the kernel actually gave the listener,
 * and the port it actually assigned.
 *
 * @module @usehenri/testing/url
 */

/** The wildcards, which no client can connect to */
const WILDCARDS = new Set(['::', '0.0.0.0']);

/**
 * A url with its trailing slashes taken off, walked rather than matched.
 *
 * `/\/+$/` is the polynomial-ReDoS shape a static analyser flags, and this
 * repository has replaced it three times already -- the rule written in the
 * headers that were fixed is: walk, don't match. It is a url from a socket
 * rather than from a request, so this is a defect and not an incident, and
 * the walk costs nothing either way.
 *
 * @param {string} value the url
 * @returns {string} the url without its trailing slashes
 */
function withoutTrailingSlashes(value) {
  const text = String(value);
  let end = text.length;

  while (end > 0 && text[end - 1] === '/') {
    end -= 1;
  }

  return text.slice(0, end);
}

/**
 * The host part of a url for a bound address
 *
 * @param {object} address What `httpServer.address()` answered
 * @returns {string} The host, bracketed when it is an IPv6 literal
 */
const hostOf = ({ address, family }) => {
  if (WILDCARDS.has(address)) {
    // A dual-stack listener answers on the loopback too, and 127.0.0.1
    // needs no resolving at all
    return '127.0.0.1';
  }

  return family === 6 || family === 'IPv6' ? `[${address}]` : address;
};

/**
 * Where another process reaches this henri, without a trailing slash
 *
 * @param {object} henri A running henri instance
 * @returns {?string} The url, or null when nothing is listening
 */
const serverUrl = (henri) => {
  const server = henri && henri.server;
  const address =
    server && server.httpServer && server.httpServer.listening
      ? server.httpServer.address()
      : null;

  // A unix socket answers a string, and a server that never listened
  // answers null: neither is a url this can build, so the instance's own
  // line is the best there is
  if (!address || typeof address !== 'object') {
    return server && server.url ? withoutTrailingSlashes(server.url) : null;
  }

  return `http://${hostOf(address)}:${address.port}`;
};

module.exports = { serverUrl, withoutTrailingSlashes };
