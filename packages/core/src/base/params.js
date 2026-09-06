/**
 * Strong parameters: pick the fields a controller allows from the request.
 *
 * ```js
 * const data = req.permit('title', 'year');
 * // or, without the middleware
 * const data = henri.params(req).permit(['title', 'year']);
 * ```
 *
 * An action that declared what it accepts (`params` in the controller, see
 * `base/params-schema.js`) has had those fields checked and coerced before
 * it ran: they are the last source merged here, so `req.permit('year')`
 * answers the number and not the string it arrived as, and `req.permit()`
 * with no field at all answers everything the declaration accepted. Without
 * a declaration nothing changes: `permit()` answers `{}`, because nothing is
 * permitted unless it is named.
 */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Copies the own, defined properties of `source` into `target`
 *
 * @param {object} target the object receiving the values
 * @param {object} source the values (may be undefined)
 * @returns {object} target
 */
function merge(target, source) {
  if (!source || typeof source !== 'object') {
    return target;
  }

  for (const key of Object.keys(source)) {
    if (!FORBIDDEN.has(key) && typeof source[key] !== 'undefined') {
      target[key] = source[key];
    }
  }

  return target;
}

/**
 * Builds the parameters helper for a request.
 *
 * Values come from the query string, then the body, then the path
 * parameters; a later source wins over an earlier one.
 *
 * @param {Express.Request} req the request
 * @returns {{all: function(): object, permit: function(...string): object}} helper
 */
function params(req) {
  const merged = {};
  const accepted = (req && req._accepted) || null;

  merge(merged, req && req.query);
  merge(merged, req && req.body);
  merge(merged, req && req.params);
  merge(merged, accepted);

  return {
    /**
     * Every parameter, merged (do not mass-assign this to a model)
     *
     * @returns {object} a copy of the merged parameters
     */
    all: () => Object.assign({}, merged),

    /**
     * Only the listed fields; missing ones are omitted, not set to undefined.
     * With no field at all: everything the action declared it accepts, which
     * is the same list, already checked and coerced.
     *
     * @param {...(string|Array<string>)} fields allowed field names
     * @returns {object} a plain object containing only the permitted fields
     */
    permit: (...fields) => {
      const allowed = fields.flat(Infinity);
      const result = {};

      if (allowed.length === 0 && accepted) {
        return Object.assign({}, accepted);
      }

      for (const field of allowed) {
        if (
          typeof field === 'string' &&
          !FORBIDDEN.has(field) &&
          Object.prototype.hasOwnProperty.call(merged, field)
        ) {
          result[field] = merged[field];
        }
      }

      return result;
    },
  };
}

/**
 * Express middleware adding `req.permit(...fields)`
 *
 * @returns {function} middleware
 */
function permitMiddleware() {
  return (req, res, next) => {
    req.permit = (...fields) => params(req).permit(...fields);

    next();
  };
}

module.exports = { params, permitMiddleware };
