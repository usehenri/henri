# @usehenri/testing

Boots a henri app for its tests and binds [supertest](https://github.com/ladjs/supertest)
to the running server. Built for [Vitest](https://vitest.dev), which `henri test` runs.

```bash
pnpm add -D vitest @usehenri/testing
```

## Setup

`vitest.config.js` in the app:

```js
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    globals: true,
    include: ['test/**/*.{spec,test}.js'],
    setupFiles: ['@usehenri/testing/setup-file'],
  },
});
```

The setup file boots henri (`NODE_ENV=test`, `config/test.json`, a free port,
workers skipped) before each test file and stops it after, inside the test
worker: `henri` and the models are globals in the tests, exactly like in the
app. `fileParallelism: false` keeps one server and one database at a time.

## Writing tests

```js
// test/tasks.spec.js
const { request } = require('@usehenri/testing');

describe('tasks', () => {
  test('lists tasks', async () => {
    await Task.create({ title: 'write tests' });

    const res = await request().get('/tasks').set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
  });
});
```

Without the setup file, boot henri from the test file itself; `setup()` is a
no-op when henri is already running:

```js
const { request, setup, teardown } = require('@usehenri/testing');

beforeAll(() => setup());
afterAll(() => teardown());
```

## API

- `setup({ workers = false })` boots henri for the app in `process.cwd()` and
  resolves with the instance. Idempotent.
- `teardown()` stops it.
- `request()` a supertest request bound to the running server.
- `agent()` a supertest agent (keeps cookies between requests).
- `henri` the running instance (also `global.henri`).
- `supertest` the underlying module.

## One server for the whole run

`globalSetup: ['@usehenri/testing/global-setup']` boots henri once in Vitest's
main process. Tests only get HTTP access through `request()` (no `henri` or
model globals in the workers) since global setup runs in another process.

```bash
henri test                   # vitest run
henri test --watch           # vitest in watch mode
henri test test/tasks.spec.js -t "lists"
```
