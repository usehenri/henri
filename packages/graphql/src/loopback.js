/**
 * The `loopbackOnly: true` option of `config.graphql`.
 *
 * Core has one of these in `base/http.js`, but this package reaches into
 * core for exactly one thing -- `BaseModule`, which the module system
 * documents -- and that is worth keeping to one. The predicate itself is not
 * copied: `isLoopback` is public API on the instance
 * (`henri.utils.isLoopback`, see the API reference), so `::1`,
 * `::ffff:127.0.0.1` and the whole `127.0.0.0/8` block are handled by core's
 * definition and cannot drift from it.
 *
 * Core's version content-negotiates its 404. A GraphQL endpoint answers JSON
 * either way, so this one always does.
 *
 * @param {object} henri A henri instance
 * @returns {function} express middleware
 */
const loopbackOnly = (henri) => (req, res, next) => {
  const address = req.socket && req.socket.remoteAddress;

  if (henri.utils.isLoopback(address)) {
    return next();
  }

  return res.status(404).json({
    error: 'Not Found',
    message: 'Not Found',
    statusCode: 404,
  });
};

module.exports = { loopbackOnly };
