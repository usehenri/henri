const { check } = require('./arguments');
/**
 * Minimal replacement for express-boom: decorates `res` with `res.boom.<name>()`
 * helpers that answer with a Boom-shaped JSON body.
 *
 * `res.boom.notFound('No such thing', { id })` sends
 * `{ statusCode: 404, error: 'Not Found', message: 'No such thing', data: { id } }`
 *
 * A failure henri raises on its own behalf names itself: a third argument,
 * one of the codes of `error-codes.json`, adds `code` to that body. It is the
 * same envelope the 404 and 500 handlers answer with (`base/http.js`), so a
 * client reads one shape whether the answer came from a controller or from
 * henri.
 */
const { isCode } = require('./errors');
const { seal } = require('./headers');

const STATUSES = {
  badData: [422, 'Unprocessable Entity'],
  badGateway: [502, 'Bad Gateway'],
  badRequest: [400, 'Bad Request'],
  conflict: [409, 'Conflict'],
  forbidden: [403, 'Forbidden'],
  internal: [500, 'Internal Server Error'],
  methodNotAllowed: [405, 'Method Not Allowed'],
  notFound: [404, 'Not Found'],
  notImplemented: [501, 'Not Implemented'],
  payloadTooLarge: [413, 'Payload Too Large'],
  serverUnavailable: [503, 'Service Unavailable'],
  tooManyRequests: [429, 'Too Many Requests'],
  unauthorized: [401, 'Unauthorized'],
  unsupportedMediaType: [415, 'Unsupported Media Type'],
};

/**
 * Express middleware adding `res.boom`
 *
 * @returns {function} middleware
 */
function boom() {
  return (req, res, next) => {
    res.boom = {};

    for (const [name, [statusCode, error]] of Object.entries(STATUSES)) {
      res.boom[name] = (message = error, data = undefined, code = null) => {
        check('res.boom', [message, data], `res.boom.${name}`);

        const body = { error, message, statusCode };

        if (isCode(code)) {
          body.code = code;
        }

        if (typeof data !== 'undefined') {
          body.data = data;
        }

        // The envelope henri writes itself: the answer gate leaves it
        // alone rather than dropping a field name that is a message here
        // (see base/answers.js)
        seal(res);

        return res.status(statusCode).json(body);
      };
    }

    next();
  };
}

module.exports = boom;
module.exports.STATUSES = STATUSES;
