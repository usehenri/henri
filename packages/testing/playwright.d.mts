// `globalSetup: '@usehenri/testing/playwright'`: boots the application once
// for the run, on a port the kernel assigns, and points Playwright's
// `baseURL` at it through `PLAYWRIGHT_TEST_BASE_URL`. Tests run in Playwright
// workers, so they reach the application over http and get no `henri` global.
//
// Playwright is the application's dependency: nothing here imports it, and
// the configuration is not typed against it either.

import type { Henri } from '@usehenri/core';

/** What `boot()` answers. */
export interface PlaywrightBoot {
  /** The running instance (also `global.henri`, in this process only). */
  henri: Henri;
  /** Stops it. Return this from a global setup of your own. */
  teardown(): Promise<boolean>;
  /** Where the application is, without a trailing slash. */
  url: string;
}

/**
 * Boots the application and publishes where it is, for a global setup of
 * your own that seeds before the tests start.
 *
 *     const { teardown } = await boot(config);
 *
 * `config` is Playwright's resolved configuration, and is only read to
 * report a `use.baseURL` that would win over the one this publishes.
 */
export function boot(config?: unknown): Promise<PlaywrightBoot>;

/** Boots the application and returns Playwright's global teardown. */
declare function globalSetup(config?: unknown): Promise<() => Promise<boolean>>;

export default globalSetup;
