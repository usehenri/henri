const escapeHtml = require('escape-html');
const { redactUrl } = require('./redact');
const { isLoopback } = require('../utils');
const { recorder } = require('./runtime');
const { STATUSES } = require('./boom');
const { coded } = require('./errors');

/**
 * Escape a string for html
 *
 * @param {any} value the value
 * @returns {string} the escaped string
 */
const escape = (value) => escapeHtml(String(value));

/**
 * Minimal html error page
 *
 * @param {number} status http status
 * @param {string} title the reason phrase
 * @param {string} [details=''] preformatted details (dev only)
 * @param {?string} [code=null] the henri error code of the failure
 * @returns {string} html
 */
const page = (status, title, details = '', code = null) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${status} ${escape(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2em;color:#222}code{color:#666}pre{white-space:pre-wrap;background:#f6f6f6;padding:1em;overflow:auto}</style>
</head>
<body><h1>${status} ${escape(title)}</h1>${
  code ? `<p><code>${escape(code)}</code></p>` : ''
}${details ? `<pre>${escape(details)}</pre>` : ''}</body>
</html>
`;

/**
 * Reason phrase for a status code
 *
 * @param {number} status http status
 * @returns {string} the reason phrase
 */
const reason = (status) => {
  const found = Object.values(STATUSES).find(([code]) => code === status);

  return found ? found[1] : 'Error';
};

/**
 * Answer with a content-negotiated error: json for api clients (boom shape),
 * html for browsers, plain text otherwise
 *
 * @param {Express.Response} res the response
 * @param {number} status the http status
 * @param {string} message the message
 * @param {object} [extra={}] extra json data (dev only details)
 * @param {string} [details=''] preformatted html details (dev only)
 * @param {?string} [code=null] the henri error code of the failure
 * @param {?string} [redirect=null] where a browser goes instead of the page
 * @returns {void}
 */
function negotiate(
  res,
  status,
  message,
  extra = {},
  details = '',
  code = null,
  redirect = null
) {
  const title = reason(status);
  const body = { error: title, message, statusCode: status };

  if (code) {
    body.code = code;
  }

  if (Object.keys(extra).length > 0) {
    body.data = extra;
  }

  res.status(status);

  return res.format({
    // An error may name somewhere a browser is better off: the login page,
    // when a policy refused an anonymous visitor. API clients still get the
    // status and the body, which is the only thing they can act on
    html: () =>
      redirect
        ? res.redirect(redirect)
        : res.type('html').send(page(status, title, details, code)),
    json: () => res.json(body),
    // Escaped as well: static analyzers treat every send() as an html sink
    // eslint-disable-next-line sort-keys
    default: () =>
      res
        .type('txt')
        .send(
          escape(`${status} ${title}\n${code ? `${code}\n` : ''}${message}\n`)
        ),
  });
}

/**
 * The 404 handler for routes nothing claimed (mounted after the router)
 *
 * @param {Henri} henri the henri instance
 * @returns {function} express middleware
 */
function notFound(henri) {
  return (req, res) => {
    const message = henri.isProduction
      ? 'Not Found'
      : `Cannot ${req.method} ${req.originalUrl || req.url}`;

    return negotiate(res, 404, message);
  };
}

/**
 * The error handler (mounted last)
 * Logs through pen, then answers json for api clients (res.boom shape) and a
 * minimal page for browsers: message + stack in development, nothing more
 * than the status in production.
 *
 * @param {Henri} henri the henri instance
 * @returns {function} express error middleware
 */
function errorHandler(henri) {
  return (error, req, res, next) => {
    const err = error instanceof Error ? error : new Error(String(error));
    const status = normalizeStatus(err.status || err.statusCode);
    const where = `${req.method} ${redactUrl(req.originalUrl || req.url)}`;

    if (status >= 500) {
      henri.pen.error('server', where, err.stack || err.message);
    } else {
      henri.pen.warn('server', where, `${status}`, err.message);
    }

    // Kept with the request that caused it, for `henri mcp` to hand to an
    // agent instead of making it reproduce the failure first
    const record = recorder(henri);

    record && record.error(err, { req, status });

    // Reported once, from here: this handler is the only place a request
    // failure is answered, so nothing else has to know about the seam. A
    // 4xx is an answer, not a failure, and is not reported. Not awaited --
    // the client is not kept waiting for somebody else's api
    // (base/reporting.js)
    if (status >= 500 && henri.reporter) {
      henri.reporter.report(err, { req, source: 'request', status });
    }

    if (res.headersSent) {
      return next(err);
    }

    // A guard that could not reach its store (base/shared.js) asks for a
    // retry rather than pretending the request failed
    if (status === 503 && Number(err.retryAfter) > 0) {
      res.set('Retry-After', String(Math.ceil(err.retryAfter)));
    }

    // 4xx errors carry a message meant for the client (body parser, boom...)
    const exposed = status < 500 || henri.isDev || henri.isTest;
    const message = exposed ? err.message : reason(status);
    const extra = henri.isDev || henri.isTest ? { stack: err.stack } : {};
    const details = henri.isDev || henri.isTest ? err.stack || err.message : '';

    return negotiate(
      res,
      status,
      message,
      extra,
      details,
      coded(err),
      status < 500 && typeof err.redirect === 'string' ? err.redirect : null
    );
  };
}

/**
 * Make sure a status is a valid http error status
 *
 * @param {any} status the status
 * @returns {number} a valid status (500 by default)
 */
function normalizeStatus(status) {
  const code = parseInt(status, 10);

  return code >= 400 && code < 600 ? code : 500;
}

/**
 * Only allow requests coming from this machine (loopback)
 * Used by the development-only endpoints (/_routes, /_controllers).
 *
 * @returns {function} express middleware
 */
function loopbackOnly() {
  return (req, res, next) => {
    const address = req.socket && req.socket.remoteAddress;

    if (isLoopback(address)) {
      return next();
    }

    return negotiate(res, 404, 'Not Found');
  };
}

module.exports = {
  errorHandler,
  loopbackOnly,
  negotiate,
  notFound,
  page,
};
