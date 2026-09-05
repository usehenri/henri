/**
 * JSON request against a henri route, outside of Inertia's page lifecycle
 * (ex: reading `res.render()` data as JSON, hitting an API route).
 *
 * The target is a route string or a path helper result ({ method, route }).
 * GET data goes in the query string, anything else as a JSON body. Resolves
 * with the parsed response (JSON when the server sends JSON, text otherwise)
 * and rejects with an error carrying `status` and `response` on non-2xx.
 *
 * @param {(string|{ method?: string, route: string })} target the route
 * @param {object} [options] options
 * @param {string} [options.method] http method (default: the target's or GET)
 * @param {*} [options.data] the payload
 * @param {?string} [options.csrf] the CSRF token sent as X-CSRF-Token
 * @param {object} [options.headers] extra headers
 * @returns {Promise<*>} the response body
 */
export async function request(
  target,
  { method, data, csrf = null, headers = {} } = {}
) {
  const route =
    typeof target === 'string' ? target : (target && target.route) || '/';
  const verb = String(
    method || (target && typeof target === 'object' && target.method) || 'get'
  ).toUpperCase();
  const init = {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...headers,
    },
    method: verb,
  };
  let url = route;

  if (typeof data !== 'undefined' && data !== null) {
    if (verb === 'GET' || verb === 'HEAD') {
      const query = new URLSearchParams(data).toString();

      url = query
        ? `${route}${route.includes('?') ? '&' : '?'}${query}`
        : route;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(data);
    }
  }

  const res = await fetch(url, init);
  const type = res.headers.get('content-type') || '';
  const body = type.includes('json') ? await res.json() : await res.text();

  if (!res.ok) {
    const error = new Error(`${verb} ${url} failed with status ${res.status}`);

    error.status = res.status;
    error.response = body;

    throw error;
  }

  return body;
}
