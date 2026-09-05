/**
 * Route helpers shared by withHenri and the form components.
 * `paths` is the object injected by henri's router, keyed by
 * `${action}_${controller}_path`, ex: { show_tasks_path: { method, route } }.
 */

/**
 * Build a response object that stringifies to its route
 *
 * @param {string} route the route
 * @param {string} method the http method
 * @returns {{ method: string, route: string }} response
 */
const response = (route = '', method = 'get') =>
  Object.defineProperty({ method, route }, 'toString', {
    enumerable: false,
    value() {
      return this.route;
    },
  });

/**
 * Get the route (and method) for a path helper, filling its parameters
 *
 * @param {object} paths the paths injected by henri
 * @param {string} path the path name (ex: show_tasks_path)
 * @param {(string|object)} [params=null] an id (string) or the params
 * @returns {(object|string|undefined)} the route information
 */
export function pathFor(paths = {}, path = null, params = null) {
  if (path && paths && paths[path]) {
    const entry = paths[path];

    // This will render the default route with method
    if (params === null) {
      return entry;
    }

    // If a string is provided, defaults to id (client side for mongo ids)
    if (typeof params === 'string') {
      return entry.route.replace(':id', params);
    }

    // We might have a bunch of params (ids can be ObjectID objects on node,
    // hence the String() call), iterating...
    if (typeof params === 'object' && Object.keys(params).length > 0) {
      let { route } = entry;

      Object.keys(params).forEach((val) => {
        route = route.replace(`:${val}`, String(params[val]));
      });

      return response(route, entry.method);
    }
  }

  // eslint-disable-next-line no-console
  console.warn(`unable to match filler for route ${path} in pathFor`);

  return undefined;
}

/**
 * Get the route string for a path helper
 *
 * @param {object} paths the paths injected by henri
 * @param {string} route the path name (ex: show_tasks_path)
 * @param {(string|object)} [id=null] an id to replace `:id` with
 * @returns {string} the route or 'route-not-found'
 */
export function getRoute(paths = {}, route = null, id = null) {
  if (
    route &&
    paths &&
    typeof paths[route] !== 'undefined' &&
    typeof paths[route].route !== 'undefined'
  ) {
    return id
      ? paths[route].route.replace(':id', id.toString())
      : paths[route].route;
  }

  return 'route-not-found';
}
