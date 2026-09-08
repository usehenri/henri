---
'@usehenri/testing': minor
'@usehenri/cli': patch
---

A browser suite an application does not have to wire up: `@usehenri/testing/playwright`.

`@usehenri/testing` could boot the application once for a whole Vitest run, and `HENRI_TEST_URL` said where it was. What it could not do is the one thing a browser suite needs, which is to tell Playwright the same thing -- and the reason is a real one rather than an oversight: the port is the kernel's answer to `listen(0)`, which happens when henri boots, long after `playwright.config.js` was read. A `baseURL` written in the config file cannot know it.

```js
// playwright.config.js
module.exports = {
  globalSetup: '@usehenri/testing/playwright',
  testDir: './test/browser',
};
```

That is the whole configuration, and `page.goto('/signup')` then reaches the application, on a port nobody chose. `globalSetup` runs after the config and before the first worker is forked, which is the one window where the number exists and can still be handed to the workers; henri exports it as `PLAYWRIGHT_TEST_BASE_URL`, which is what Playwright's `use.baseURL` falls back to.

**The precedence, measured against Playwright 1.63.0** rather than assumed, because the whole recipe rests on it. `baseURL` is an option fixture whose default body reads that variable in the worker, when the fixture is set up -- so a value the main process exported before forking is seen by every worker. Being an option, **anything in `use` wins over it**: a `baseURL` in the config file, in a project, or in a `test.use()` beats the variable outright. henri does not fight that -- pinning one is a deliberate act -- but it will not let it be silent either: the global setup is handed the resolved configuration, so it names the project, the url it pins and the url henri is actually on. An explicit `use: { baseURL: undefined }`, which is what reading the variable in the config file writes, is not a pin and still falls through.

**Playwright is the application's dependency and stays one.** Nothing in this package imports it; Playwright is what loads the file, so an application without it never gets there. `henri new` does not add it either -- a browser and a few hundred megabytes are not a scaffold's decision. What notices is `henri doctor`, which reports a `playwright.config.*` next to a `package.json` with no `@playwright/test` (`deps.playwright`), with the install line and the `playwright install` that follows it.

**It does nothing to the database, on purpose.** One server for the whole run is one database for the whole run, and the tests are in other processes, in parallel by default: there is no moment this could empty a table without racing a request in flight, so a `beforeEach` that truncates would be a promise it cannot keep. What it does promise is an empty start, which `config/test.json` already gives. Seeding belongs to a global setup of your own that wraps `boot(config)` from the same subpath -- it runs in the process that booted henri, so the models and the factories are in hand there.

The url both global setups publish is now built from the address the listener was actually given (`http://127.0.0.1:<port>`) instead of the `localhost` line the terminal prints. Under `NODE_ENV=test` the server binds `127.0.0.1` and nothing else, while `localhost` resolves to `::1` first on most machines: Node's http client hides that by trying both families and a browser mostly does, and "mostly" is not a thing to point a suite at.
