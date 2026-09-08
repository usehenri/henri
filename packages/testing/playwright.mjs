/**
 * Playwright: the application, once, on a port the kernel assigns, with the
 * browser pointed at it.
 *
 *   // playwright.config.js
 *   module.exports = {
 *     globalSetup: '@usehenri/testing/playwright',
 *     testDir: './test/browser',
 *   };
 *
 * That is the whole configuration. `page.goto('/tasks')` then reaches the
 * application this booted, because Playwright's `baseURL` defaults to
 * `process.env.PLAYWRIGHT_TEST_BASE_URL` and this sets it.
 *
 * ## Why an environment variable and not `use.baseURL`
 *
 * The port is the kernel's answer to `listen(0)`, which happens when henri
 * boots -- long after `playwright.config.js` was evaluated. A `baseURL`
 * written in the config file cannot know it. `globalSetup` runs after the
 * config and before the first worker is forked, which is the one window
 * where the number exists and can still be handed to the workers.
 *
 * Measured, not assumed, against Playwright 1.63.0. Nothing in this
 * repository re-measures it -- Playwright is the application's dependency,
 * and a browser in this CI to assert a fixture default is a cost the
 * deliverable does not carry -- so here is what was run and what it
 * answered:
 *
 *   - `baseURL` is an *option* fixture whose default body is
 *     `use(process.env.PLAYWRIGHT_TEST_BASE_URL)`. It is read in the worker,
 *     when the fixture is set up -- not when the config is loaded -- so a
 *     value the main process exported before forking is seen by every
 *     worker.
 *   - Being an option, anything in `use` **wins over it**: a `baseURL` in
 *     the config file, in a project, or in a `test.use()` beats the
 *     environment variable outright. `globalSetup` is handed the resolved
 *     configuration, so this says so rather than letting the browser go
 *     somewhere else in silence.
 *   - `use: { baseURL: undefined }` is not a pin: an explicit `undefined`
 *     still falls through to the environment variable.
 *   - `globalSetup` takes a bare package specifier, so there is nothing to
 *     `require.resolve()` and the same line works in a CommonJS or an ESM
 *     config file.
 *   - A function returned from `globalSetup` is run as the global teardown,
 *     which is how the application is stopped.
 *
 * ## Playwright is the application's dependency
 *
 * Nothing here imports it. This module boots henri and writes two
 * environment variables; Playwright is what loads it, so an application
 * without Playwright never reaches this file at all. `henri doctor` is what
 * says something useful in that case: a `playwright.config.*` next to a
 * `package.json` that does not depend on `@playwright/test` is reported the
 * way a `jobs` block without `@usehenri/jobs` is.
 *
 * ## The database
 *
 * This touches it exactly as much as booting does, and no more: no seed, no
 * truncation between tests.
 *
 * One server for the whole run is one database for the whole run, and the
 * tests are in other processes, in parallel by default. There is no moment
 * this module could empty a table without racing a request in flight, so a
 * `beforeEach` that truncates would be a promise it cannot keep. What it can
 * promise is an empty start: under `NODE_ENV=test` henri loads
 * `config/test.json`, which the scaffold points at a database of its own
 * (`":memory:"` on the sqlite store, `<name>_test` on a server) -- so the run
 * begins with an empty schema and, on sqlite, leaves nothing behind.
 *
 * Seeding is the application's, and the place for it is a global setup of its
 * own that wraps this one. It runs in the same process as the boot, so
 * `henri`, the models and the factories are all in hand there:
 *
 *   // test/browser/global-setup.mjs, named by `globalSetup` instead of this
 *   import { create } from '@usehenri/testing';
 *   import { boot } from '@usehenri/testing/playwright';
 *
 *   export default async function globalSetup(config) {
 *     const { teardown } = await boot(config);
 *
 *     await create('user', { email: 'ada@example.test' });
 *
 *     return teardown;
 *   }
 *
 * A test itself gets none of that: it runs in a Playwright worker, which is
 * another process, so `henri`, the models, `inbox()` and `enqueued()` are not
 * there -- the same limit `@usehenri/testing/global-setup` has under Vitest,
 * for the same reason. A browser test drives the application through the
 * application: it signs up, it fills the form, it reads the page.
 *
 * @module @usehenri/testing/playwright
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { setup, teardown } = require('./index.js');
const { serverUrl, withoutTrailingSlashes } = require('./url.js');

/**
 * The urls a configuration pins that are not the application that was just
 * booted, and which projects pin each of them.
 *
 * A top-level `use` is merged into every project by the time a global setup
 * sees the configuration -- three browsers under one `use.baseURL` are three
 * projects -- so the grouping is what keeps one mistake to one line.
 *
 * @param {object} config Playwright's resolved configuration
 * @param {string} url Where the application is
 * @returns {Array<object>} `{ baseURL, names }`, one per url
 */
const pinnedElsewhere = (config, url) => {
  const found = new Map();

  for (const project of (config && config.projects) || []) {
    const baseURL = project && project.use && project.use.baseURL;

    if (
      typeof baseURL !== 'string' ||
      withoutTrailingSlashes(baseURL) === url
    ) {
      continue;
    }

    const names = found.get(baseURL) || [];

    // The implicit project of a top-level `use` has no name
    found.set(baseURL, project.name ? [...names, project.name] : names);
  }

  return [...found].map(([baseURL, names]) => ({ baseURL, names }));
};

/**
 * Boots the application and publishes where it is
 *
 * Sets `PLAYWRIGHT_TEST_BASE_URL`, which is what `baseURL` falls back to in
 * every worker, and `HENRI_TEST_URL`, which is what `request()` from this
 * package targets when it has no instance to hold on to. Call it from a
 * global setup of your own to seed before the tests start, and return the
 * `teardown` it answers.
 *
 * @param {object} [config] Playwright's resolved configuration, when there
 * is one: it is only read to report a `baseURL` that would win over this
 * @returns {Promise<object>} `{ henri, teardown, url }`
 */
export async function boot(config) {
  const henri = await setup();
  const url = serverUrl(henri);

  process.env.HENRI_TEST_URL = url;
  process.env.PLAYWRIGHT_TEST_BASE_URL = url;

  for (const { baseURL, names } of pinnedElsewhere(config, url)) {
    const who =
      names.length === 0
        ? 'the configuration sets'
        : `${names.map((name) => `"${name}"`).join(', ')} ${names.length === 1 ? 'sets' : 'set'}`;

    // Not a refusal: pinning a baseURL is a deliberate act, and a suite
    // that boots henri for its fixtures and drives something else is
    // allowed. Silence is what it must not be -- the symptom otherwise is a
    // browser reaching nothing, with the right port there in the terminal
    // eslint-disable-next-line no-console -- a global setup's terminal is the only channel it has
    console.warn(
      `@usehenri/testing: henri is on ${url}, but ${who} use.baseURL to ${baseURL}, which wins. The browser will not reach the application this booted; remove that baseURL to use it.`
    );
  }

  return { henri, teardown, url };
}

/**
 * Playwright global setup: boot the application, point the browser at it
 *
 * @param {object} [config] Playwright's resolved configuration
 * @returns {Promise<Function>} Playwright's global teardown
 */
export default async function globalSetup(config) {
  await boot(config);

  return teardown;
}
