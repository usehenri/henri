// Type definitions for @usehenri/inertia/engine
//
// The engine is what core loads for `"renderer": "inertia"`, and what
// `henri build` calls. An application rarely touches it.

/** The view engine core instantiates with `new InertiaEngine(henri)`. */
declare class InertiaEngine {
  constructor(henri: unknown);
  init(): Promise<true>;
  prepare(): Promise<unknown>;
  fallback(router: unknown): void;
  render(
    req: unknown,
    res: unknown,
    route: string,
    opts?: Record<string, unknown>
  ): Promise<void>;
  build(): Promise<InertiaEngine.BuildResult>;
  close(): Promise<true>;
  /**
   * The engine writes the CSP nonce of the response on every script, style
   * and stylesheet link of the document it builds, so core lets
   * `config.csp.nonce` boot with this renderer.
   */
  readonly supportsNonce: true;
}

declare namespace InertiaEngine {
  /** What `build()` reports. */
  interface BuildResult {
    /** Path of the client manifest. */
    client: string;
    /** How long the build took, in milliseconds. */
    duration: number;
    /** Path of the server bundle, or null without ssr. */
    ssr: string | null;
  }

  /** The defaults of `config.inertia`. */
  interface Options {
    /** Client entry, relative to `app/views` (`main.jsx`). */
    entry: string;
    /** Id of the root element (`app`). */
    id: string;
    /** Server render the pages (`true`). */
    ssr: boolean;
    /** Server entry, relative to `app/views` (`ssr.jsx`). */
    ssrEntry: string;
    /** Html shell, relative to `app/views` (`index.html`). */
    template: string;
  }

  interface BuildOptions {
    /** The application directory (`process.cwd()`). */
    cwd?: string;
    /** Only `config.inertia` is read, and it must be a plain object. */
    config?: { inertia?: Partial<Options> };
    /** Passed to Vite. */
    logLevel?: 'error' | 'info' | 'silent' | 'warn';
  }

  /** Builds the client (and the ssr bundle) without booting henri. */
  function build(options?: BuildOptions): Promise<BuildResult>;

  /** The component a route renders (`/tasks/` -> `tasks`). */
  function componentName(route?: string): string;

  const DEFAULTS: Options;
}

export = InertiaEngine;
