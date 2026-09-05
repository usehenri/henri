const { negotiate } = require('./http');

/**
 * Request timeout: a request still without an answer after
 * `config.requestTimeout` ms (30s by default) gets a 503. Nothing happens
 * once the headers are out (streams, server-sent events): only `req.timedout`
 * is set, so a long handler can check it before doing more work.
 *
 * @param {Henri} henri the henri instance
 * @param {number} ms the timeout (ms)
 * @returns {function} middleware
 */
function requestTimeout(henri, ms) {
  return (req, res, next) => {
    const timer = setTimeout(() => {
      req.timedout = true;

      if (res.headersSent || res.writableEnded) {
        return;
      }

      henri.pen.warn(
        'server',
        `${req.method} ${req.originalUrl || req.url}`,
        `timed out after ${ms}ms`
      );
      res.set('Connection', 'close');
      negotiate(res, 503, `Request timed out after ${ms}ms`, { timeout: ms });
    }, ms);
    const clear = () => clearTimeout(timer);

    timer.unref();
    res.on('finish', clear);
    res.on('close', clear);

    next();
  };
}

module.exports = requestTimeout;
