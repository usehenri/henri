const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Request ids (Rails' ActionDispatch::RequestId).
 *
 * Every request gets an id: the `X-Request-Id` header sent by the client
 * (a proxy or a load balancer usually sets one) when it looks sane, a random
 * uuid otherwise. The id is exposed as `req.id`, echoed in the `X-Request-Id`
 * header of every response (errors included) and kept in an
 * AsyncLocalStorage context for the whole request, so every `pen` line
 * written while handling the request carries it.
 */
const HEADER = 'X-Request-Id';
const FORMAT = /^[A-Za-z0-9._-]{1,200}$/;

const context = new AsyncLocalStorage();

/**
 * The id of the request being handled, if any
 *
 * @returns {?string} the request id or null outside of a request
 */
function currentRequestId() {
  const store = context.getStore();

  return store && typeof store.id === 'string' ? store.id : null;
}

/**
 * A new request id
 *
 * @returns {string} a uuid
 */
function generate() {
  return crypto.randomUUID();
}

/**
 * Express middleware: `req.id`, the `X-Request-Id` header and the context
 *
 * @param {object} [options={}] options
 * @param {string} [options.header='X-Request-Id'] header name
 * @returns {function} middleware
 */
function requestId({ header = HEADER } = {}) {
  return (req, res, next) => {
    const incoming = req.get(header);
    const id =
      typeof incoming === 'string' && FORMAT.test(incoming)
        ? incoming
        : generate();

    req.id = id;
    res.set(header, id);

    context.run({ id }, next);
  };
}

module.exports = {
  FORMAT,
  HEADER,
  context,
  currentRequestId,
  generate,
  requestId,
};
