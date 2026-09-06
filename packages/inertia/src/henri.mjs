import { useMemo } from 'react';
import { router, usePage } from '@inertiajs/react';
import { getRoute as findRoute, pathFor as findPath } from './paths.mjs';
import { request } from './request.mjs';

/**
 * Empty henri props (what a page gets when rendered without a controller)
 */
export const EMPTY = Object.freeze({
  csrf: null,
  data: {},
  errors: {},
  flash: {},
  graphql: null,
  i18n: null,
  localUrl: '',
  paths: {},
  query: {},
  user: null,
});

/**
 * Build the henri context value from the Inertia page props
 *
 * @param {object} [props={}] the page props (`usePage().props`)
 * @returns {object} data, user, paths, errors, flash, csrf, localUrl, query,
 * graphql and the pathFor(), getRoute(), fetch() and hydrate() helpers
 */
export function henriProps(props = {}) {
  const {
    csrf = null,
    data = {},
    errors = {},
    flash = {},
    graphql = null,
    i18n = null,
    localUrl = '',
    paths = {},
    query = {},
    user = null,
  } = props || {};

  return {
    csrf,
    data,
    errors,
    fetch: (target, payload) => request(target, { csrf, data: payload }),
    flash,
    getRoute: (route = null, id = null) => findRoute(paths, route, id),
    graphql,
    // Fetch the controller data again (an Inertia partial reload)
    hydrate: (options = {}) => router.reload({ only: ['data'], ...options }),
    // What this page is in, and where the strings are. `useTranslation()`
    // is the hook that reads it; this is here so a page that only wants the
    // locale (an Intl.NumberFormat, an html `lang`) does not need one
    i18n,
    localUrl,
    pathFor: (path = null, params = null) => findPath(paths, path, params),
    paths,
    query,
    user,
  };
}

/**
 * Hook giving access to what the controller passed to res.render() and to
 * henri's route helpers, shaped like the @usehenri/react context
 *
 * @returns {object} see henriProps()
 */
export function useHenri() {
  const { props } = usePage();

  return useMemo(() => henriProps(props), [props]);
}
