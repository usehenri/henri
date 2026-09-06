// Type definitions for @usehenri/react
//
// Hand-written. The components are declared as `(props) => any` rather than as
// `React.FC`: `@usehenri/react` does not depend on `@types/react`, so a
// JavaScript application installs nothing extra, and a project that does have
// `@types/react` still gets its props checked in JSX.

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

/** What a failed `hydrate()` or `fetch()` left behind. */
export interface HenriError {
  message: string;
  status: number | null;
}

/** What `useHenri()` answers, and what a page receives as props. */
export interface HenriView {
  /** The CSRF token of the request, to send back on a write. */
  csrf: string | null;
  /** What the controller passed to `res.render({ data })`. */
  data: Record<string, any>;
  /** The last hydrate or fetch error, when there was one. */
  error: Error | HenriError | null;
  /**
   * The GraphQL errors when the page was rendered from a query, or the
   * messages a redirecting handler left in the flash, keyed by field.
   */
  errors: Record<string, any> | readonly unknown[] | null;
  /** Flash messages by type; reading them on the server consumed them. */
  flash: Record<string, unknown[]>;
  graphql: any | null;
  /** Where the server answers, for absolute links. */
  localUrl: string;
  paths: Paths;
  user: PublicUser | null;
  /** Re-fetches the current page as JSON and refreshes `data`. */
  hydrate(): Promise<any | null>;
  /** A JSON request against the application. */
  fetch(
    target?: string | { route?: string; method?: string },
    body?: any
  ): Promise<any>;
  /**
   * A path helper.
   *
   * - without `params`: the `{ method, route }` entry, unfilled
   * - with a string: the route with `:id` filled, as a string
   * - with an object: `{ method, route }` with every named parameter filled
   * - `undefined` when the route is unknown to this user
   */
  pathFor(
    path?: string | null,
    params?: string | Record<string, unknown> | null
  ): PathHelper | string | undefined;
  /** The route of a helper (`'route-not-found'` when it is unknown). */
  getRoute(route?: string | null, id?: string | null): string;
}

/**
 * The props `withHenri` adds to a page, on top of whatever the page declares
 * itself. `router` comes from next's `withRouter`.
 */
export type HenriProps = HenriView & { router: any };

/**
 * Wraps a next.js page: reads the view options henri put on the request (or
 * fetches them as JSON on a client navigation) and passes them down, both as
 * props and through `useHenri()`.
 *
 *     import withHenri from '@usehenri/react';
 *
 *     const Tasks = ({ data, pathFor }) => ...;
 *
 *     export default withHenri(Tasks);
 */
declare function withHenri<P extends object>(
  ComposedComponent: (props: P & HenriProps) => any
): (props: Partial<P>) => any;

export default withHenri;

/** The context `withHenri` provides; `useHenri()` is the way to read it. */
export declare const HenriContext: any;

/** The view options of the page being rendered. */
export declare function useHenri(): HenriView;

/** Options of `request()`. */
export interface RequestOptions {
  /** The path, or a path helper. */
  route?: string | { route?: string; method?: string };
  /** Defaults to `get`. */
  method?: string;
  /** Sent as JSON on anything but a GET. */
  body?: any;
  /** Sent as `X-CSRF-Token`. */
  csrf?: string | null;
  headers?: Record<string, string>;
}

/**
 * A JSON request against the application. Answers the parsed body (`null` on a
 * 204) and throws a `RequestError` on anything but a 2xx.
 */
export declare function request(options?: RequestOptions): Promise<any>;

/**
 * What `request()` throws. henri's error bodies
 * (`{ statusCode, error, message, data }`) are unpacked onto it.
 */
export declare class RequestError extends Error {
  constructor(response: Response, body: any);
  name: 'RequestError';
  /** The http status. */
  status: number;
  /** The `statusCode` of the body, or the http status. */
  statusCode: number;
  /** The `error` of the body (`'Not Found'`), or null. */
  error: string | null;
  /** The `data` of the body (validation errors, ...), or null. */
  data: any | null;
  /** The parsed body. */
  body: any;
  /** The raw fetch response. */
  response: Response;
}
