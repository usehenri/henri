import React, { useCallback, useMemo, useState } from 'react';
import { withRouter } from 'next/router';
import { getRoute as findRoute, pathFor as findPath } from './paths';

/**
 * What henri's router attaches to a page render (`req._henri` on the server,
 * the JSON of the same URL on client-side navigation).
 */
const VIEW_KEYS = [
  'csrf',
  'data',
  'errors',
  'flash',
  'graphql',
  'localUrl',
  'paths',
  'user',
];

const DEFAULTS = {
  csrf: null,
  data: {},
  errors: null,
  flash: {},
  graphql: null,
  localUrl: '',
  paths: {},
  user: null,
};

/**
 * Context injected by withHenri: data, paths and helpers coming from the
 * controller (through res.render) and henri's router.
 */
export const HenriContext = React.createContext({
  ...DEFAULTS,
  error: null,
  fetch: null,
  getRoute: () => 'route-not-found',
  hydrate: null,
  pathFor: () => undefined,
});

/**
 * Hook giving access to the henri context
 *
 * @returns {object} the henri context value
 */
export const useHenri = () => React.useContext(HenriContext);

/**
 * Error raised by `request()` for a non-2xx answer. Carries the parsed body
 * and, for henri's boom responses (`{ statusCode, error, message, data }`),
 * their `message` and `data`.
 */
export class RequestError extends Error {
  constructor(response, body) {
    const boom = body && typeof body === 'object' ? body : {};

    super(
      boom.message || `${response.status} ${response.statusText || 'error'}`
    );
    this.name = 'RequestError';
    this.status = response.status;
    this.statusCode = boom.statusCode || response.status;
    this.error = boom.error || null;
    this.data = typeof boom.data === 'undefined' ? null : boom.data;
    this.body = body;
    this.response = response;
  }
}

/**
 * Parse a response: JSON when the server says so, text otherwise
 *
 * @param {Response} response a fetch response
 * @returns {Promise<*>} the body
 */
async function parse(response) {
  const type = response.headers.get('content-type') || '';

  if (response.status === 204) {
    return null;
  }

  if (type.includes('json')) {
    return response.json();
  }

  return response.text();
}

/**
 * The one request helper behind `fetch()`, `hydrate()` and client-side
 * navigation. Asks for JSON (henri's `res.format` answers html to a bare
 * fetch), sends the body as JSON and the CSRF token when there is one.
 *
 * @param {object} options options
 * @param {(string|object)} [options.route='/'] the url, or a `pathFor()`
 * result (`{ method, route }`, its `route` is used)
 * @param {string} [options.method='get'] the http method
 * @param {*} [options.body] the payload (objects are sent as JSON)
 * @param {?string} [options.csrf] the CSRF token (X-CSRF-Token header)
 * @param {object} [options.headers] extra headers
 * @returns {Promise<*>} the parsed body; rejects with a RequestError on a
 * non-2xx status
 */
export async function request({
  route = '/',
  method = 'get',
  body,
  csrf = null,
  headers = {},
} = {}) {
  const init = {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    method: method.toUpperCase(),
  };

  if (csrf) {
    init.headers['X-CSRF-Token'] = csrf;
  }

  if (typeof body !== 'undefined' && init.method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const url =
    route && typeof route === 'object' && route.route
      ? route.route
      : String(route);
  const response = await fetch(url, init);
  const parsed = await parse(response);

  if (!response.ok) {
    throw new RequestError(response, parsed);
  }

  return parsed;
}

/**
 * Keep the view keys of what henri sent
 *
 * @param {*} source `req._henri` or the JSON of a page
 * @returns {object} the view props
 */
function pickView(source) {
  const view = {};

  if (source && typeof source === 'object') {
    for (const key of VIEW_KEYS) {
      if (typeof source[key] !== 'undefined') {
        view[key] = source[key];
      }
    }
  }

  return view;
}

/**
 * Is this a page rendered by henri (the JSON henri's router sends)?
 *
 * @param {*} body a parsed response
 * @returns {boolean} yes?
 */
function isHenriPage(body) {
  return Boolean(
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    Object.prototype.hasOwnProperty.call(body, 'data')
  );
}

/**
 * Get a component display name
 *
 * @param {React.Component} Component the component
 * @returns {string} its name
 */
function getDisplayName(Component) {
  return Component.displayName || Component.name || 'Unknown';
}

/**
 * Wraps a page so it receives the controller data (and helpers) as props
 *
 * @param {React.Component} ComposedComponent the page
 * @returns {React.Component} the wrapped page
 */
export default (ComposedComponent) => {
  /**
   * The wrapper: `data` follows the `data` prop (client-side navigation gives
   * new props), `hydrate()` overrides it until the props change again.
   *
   * @param {object} props what getInitialProps returned
   * @returns {React.Element} the page in its HenriContext
   */
  function WithHenri(props) {
    const { csrf = null, paths = {} } = props;
    const [hydrated, setHydrated] = useState(null);
    const [error, setError] = useState(null);
    const data =
      hydrated && hydrated.source === props.data
        ? hydrated.data
        : (props.data ?? DEFAULTS.data);

    const doFetch = useCallback(
      (target = {}, body) => {
        const { route = '/', method = 'get' } =
          typeof target === 'string' ? { route: target } : target || {};

        return request({ body, csrf, method, route });
      },
      [csrf]
    );

    const hydrate = useCallback(async () => {
      try {
        const body = await request({
          csrf,
          route: document.location.href,
        });

        if (!isHenriPage(body)) {
          setError(
            new Error(
              'hydrate(): the response is not a henri page, keeping the current data'
            )
          );

          return null;
        }

        setError(null);
        setHydrated({ data: body.data, source: props.data });

        return body.data;
      } catch (err) {
        setError(err);

        return null;
      }
    }, [csrf, props.data]);

    const pathFor = useCallback(
      (path = null, params = null) => findPath(paths, path, params),
      [paths]
    );

    const getRoute = useCallback(
      (route = null, id = null) => findRoute(paths, route, id),
      [paths]
    );

    // The view props, normalized (a page rendered without getInitialProps
    // still gets `user: null`, `paths: {}`...)
    const view = {
      csrf,
      data,
      error: error || props.error || null,
      errors: props.errors ?? DEFAULTS.errors,
      flash: props.flash ?? DEFAULTS.flash,
      graphql: props.graphql ?? DEFAULTS.graphql,
      localUrl: props.localUrl ?? DEFAULTS.localUrl,
      paths,
      user: props.user ?? DEFAULTS.user,
    };

    const value = useMemo(
      () => ({
        ...view,
        fetch: doFetch,
        getRoute,
        hydrate,
        pathFor,
      }),
      [
        doFetch,
        getRoute,
        hydrate,
        pathFor,
        view.csrf,
        view.data,
        view.error,
        view.errors,
        view.flash,
        view.graphql,
        view.localUrl,
        view.paths,
        view.user,
      ]
    );

    return (
      <HenriContext.Provider value={value}>
        <ComposedComponent
          hydrate={hydrate}
          fetch={doFetch}
          pathFor={pathFor}
          getRoute={getRoute}
          {...props}
          {...view}
        />
      </HenriContext.Provider>
    );
  }

  WithHenri.displayName = `withHenri(${getDisplayName(ComposedComponent)})`;

  /**
   * Server side: henri's router and view engine attached the view options to
   * the request (never the url query). Client side: the same url as JSON.
   *
   * @param {object} ctx next.js context
   * @returns {Promise<object>} the page props
   */
  WithHenri.getInitialProps = async (ctx) => {
    let view = {};
    let error = null;

    if (ctx.req) {
      view = pickView(ctx.req._henri);
    } else {
      try {
        const body = await request({ route: ctx.asPath || ctx.pathname });

        view = pickView(body);
      } catch (err) {
        error = { message: err.message, status: err.status || null };
      }
    }

    let composedInitialProps = {};

    if (ComposedComponent.getInitialProps) {
      composedInitialProps = await ComposedComponent.getInitialProps(ctx);
    }

    return { ...DEFAULTS, ...view, error, ...composedInitialProps };
  };

  return withRouter(WithHenri);
};
