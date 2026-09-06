// Type definitions for @usehenri/inertia
//
// `Head`, `Link`, `router`, `usePage` and `useForm` are re-exported from
// @inertiajs/react unchanged, so their own declarations are re-exported too
// rather than restated here. Only henri's additions are declared.

export { Head, Link, router, usePage, useForm } from '@inertiajs/react';

/** A path helper of the current user, keyed `<action>_<controller>_path`. */
export interface PathHelper {
  route: string;
  method: string;
}

/** The path helpers a page received, filtered by the roles of the user. */
export type Paths = Record<string, PathHelper>;

/** The current user, as it may leave the server. */
export interface PublicUser {
  id: string;
  email: string;
  roles: string[];
  [field: string]: unknown;
}

/**
 * What `useHenri()` answers.
 *
 * Not the same shape as `@usehenri/react`'s: the Inertia page carries `query`,
 * `errors` defaults to `{}` rather than to null, and there is no `error` --
 * a failed request throws instead.
 */
export interface HenriView {
  /** The CSRF token of the request; `<Form>` sends it for you. */
  csrf: string | null;
  /** What the controller passed to `res.render({ data })`. */
  data: Record<string, any>;
  /** Validation errors of the last write (`res.inertia.errors()`). */
  errors: Record<string, any>;
  /** Flash messages by type. */
  flash: Record<string, unknown[]>;
  graphql: any | null;
  /** Where the server answers, for absolute links. */
  localUrl: string;
  paths: Paths;
  /** The query string of the request. */
  query: Record<string, any>;
  user: PublicUser | null;
  /** A JSON request against the application, with the CSRF token attached. */
  fetch(
    target: string | { method?: string; route: string },
    payload?: any
  ): Promise<any>;
  /** Reloads the `data` prop through the Inertia router. */
  hydrate(options?: Record<string, unknown>): any;
  /**
   * A path helper.
   *
   * - without `params`: the `{ method, route }` entry, unfilled
   * - with a string: the route with `:id` replaced, as a string
   * - with an object: `{ method, route }` with the named parameters replaced
   * - `undefined` when the route is unknown to this user
   */
  pathFor(
    path?: string | null,
    params?: string | Record<string, unknown> | null
  ): PathHelper | string | undefined;
  /** The route of a helper (`'route-not-found'` when it is unknown). */
  getRoute(route?: string | null, id?: string | null): string;
}

/** The view options of the page being rendered. */
export declare function useHenri(): HenriView;

/** The same, from the props of a page rendered outside a hook. */
export declare function henriProps(props?: Record<string, any>): HenriView;

/** The defaults `henriProps()` fills in. */
export declare const EMPTY: Readonly<{
  csrf: null;
  data: Record<string, never>;
  errors: Record<string, never>;
  flash: Record<string, never>;
  graphql: null;
  localUrl: '';
  paths: Record<string, never>;
  query: Record<string, never>;
  user: null;
}>;

/** A path helper, curried over the `paths` of a page. */
export declare function pathFor(
  paths?: Paths,
  path?: string | null,
  params?: string | Record<string, unknown> | null
): PathHelper | string | undefined;

/** The route of a helper (`'route-not-found'` when it is unknown). */
export declare function getRoute(
  paths?: Paths,
  route?: string | null,
  id?: string | null
): string;

/** Options of `request()`. */
export interface RequestOptions {
  /** Wins over `target.method` (`get`). */
  method?: string;
  /** The query string on a GET, a JSON body otherwise. */
  data?: any;
  /** Sent as `X-CSRF-Token`. */
  csrf?: string | null;
  headers?: Record<string, string>;
}

/**
 * A JSON request against the application. Answers the parsed body, and throws
 * an `Error` carrying `status` and `response` (the parsed body) on anything
 * but a 2xx -- there is no error class here, unlike in `@usehenri/react`.
 */
export declare function request(
  target: string | { method?: string; route: string },
  options?: RequestOptions
): Promise<any>;

/** Where a form submits: a path, or a path helper from `pathFor()`. */
export type FormAction =
  string | { method?: string; route?: string; url?: string };

/** `{ method, url }`, the shape Inertia's own `<Form>` takes. */
export declare function normalizeAction(
  action: FormAction,
  method?: string
): { method: string; url: string };

export interface FormProps {
  /** Where to submit; a `pathFor()` result works as it is. */
  action?: FormAction;
  /** Wins over `action.method` (`post`). */
  method?: string;
  /**
   * The token for the hidden `_csrf` field. Left out, the token of the page is
   * used; `false` leaves the field out entirely.
   */
  csrf?: string | false;
  children?: any;
  [prop: string]: any;
}

/**
 * Inertia's `<Form>` with henri's CSRF field and path helpers: everything else
 * is forwarded, so its render prop and its options work unchanged.
 */
export declare function Form(props: FormProps): any;

/** Options of `resolvePage()`. */
export interface ResolvePageOptions {
  /** Where the pages live in the glob (`'./pages'`). */
  dir?: string;
  /** Tried in order (`['jsx', 'tsx', 'js', 'ts']`). */
  extensions?: string[];
}

/**
 * Resolves the component of a page name against an `import.meta.glob()` map,
 * trying `<dir>/<name>.<ext>` then `<dir>/<name>/index.<ext>`. This is what an
 * application's `main.jsx` passes to `createInertiaApp({ resolve })`.
 */
export declare function resolvePage(
  pages: Record<string, (() => Promise<any>) | any>,
  name: string,
  options?: ResolvePageOptions
): Promise<any> | any;
