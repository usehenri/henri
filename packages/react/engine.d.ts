// Type definitions for @usehenri/react/engine
//
// The engine is what core loads for `"renderer": "react"`, and what
// `henri build` calls. An application rarely touches it; `app/views/
// next.config.js` and a deployment script do.

/** The view engine core instantiates with `new ReactEngine(henri)`. */
declare class ReactEngine {
  constructor(henri: unknown, deps?: { next?: Function; spawn?: Function });
  init(): Promise<true>;
  prepare(): Promise<true>;
  fallback(router: unknown): void;
  render(
    req: unknown,
    res: unknown,
    route: string,
    opts?: Record<string, unknown>
  ): Promise<void>;
  build(): Promise<ReactEngine.BuildResult | null>;
  reload(): Promise<true>;
  close(): Promise<true>;
  /**
   * Next carries the CSP nonce itself, off the request header henri writes,
   * so core lets `config.csp.nonce` boot with this renderer.
   */
  readonly supportsNonce: true;
  /** The `_document` this application wrote, if it wrote one. */
  customDocument(): string | null;
}

declare namespace ReactEngine {
  /** What `build()` reports. */
  export interface BuildResult {
    /** The next.js build id, when one was written. */
    buildId: string | null;
    bundler: string;
    /** The directory that was built (`<cwd>/app/views`). */
    dir: string;
    distDir: string;
  }

  export interface BuildOptions {
    /** The application directory (`process.cwd()`). */
    cwd?: string;
    /**
     * The configuration: a plain object, or henri's config module. Only
     * `renderer` is read -- `build()` answers `null` for another one.
     */
    config?:
      | Record<string, unknown>
      | { has(key: string): boolean; get(key: string): unknown }
      | null;
    /** Where the lines go; defaults to the console. */
    pen?: {
      error(name: string, ...args: unknown[]): void;
      info(name: string, ...args: unknown[]): void;
      warn(name: string, ...args: unknown[]): void;
    };
    bundler?: 'turbopack' | 'webpack';
    distDir?: string | null;
  }

  /**
   * Builds the pages for production without booting henri. `henri build`
   * calls this; a deployment can call it directly.
   */
  export function build(options?: BuildOptions): Promise<BuildResult | null>;

  /**
   * The next.js configuration of an application: the sass load paths, plus
   * the `config/webpack.js` and `config/next.js` hooks. This is what
   * `app/views/next.config.js` re-exports.
   */
  export function createNextConfig(cwd?: string): Record<string, any>;

  /** Creates `next.config.js` and `jsconfig.json` when they are missing. */
  export function ensureNextConfig(dir: string, pen: unknown): string[];

  /** The page a route renders (`/tasks/index` -> `/tasks`). */
  export function pagePath(route?: string): string;

  /** `webpack` when `config/webpack.js` has a hook, `turbopack` otherwise. */
  export function selectBundler(cwd: string): 'turbopack' | 'webpack';

  export { ReactEngine };
}

export = ReactEngine;
