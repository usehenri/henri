---
title: Testing
description: henri test, Vitest and @usehenri/testing.
sidebar:
  order: 11
---

Tests run on [Vitest](https://vitest.dev). `henri test` spawns the Vitest installed in the application with `NODE_ENV=test` and exits with its code; `@usehenri/testing` boots the application inside the test worker and binds [supertest](https://github.com/ladjs/supertest) to it. The package ships its own types, so `request()` and the supertest chain behind it complete in an editor ([Types](/reference/types/)). `henri new` sets all of this up; in an existing application:

```bash
pnpm add -D vitest @usehenri/testing
```

```js
// vitest.config.js
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

Booting through the setup file also binds every server the suite starts to `127.0.0.1`. Without that, a server started with a port but no host takes the IPv6 wildcard, another process can hold the same port on the loopback address, and a request is answered by whichever of the two the kernel prefers. The symptoms look like anything but a port problem: a `404` on a route that exists, a missing header, an empty body, a hung socket. Booting henri another way, apply it yourself with `setupFiles: ['@usehenri/testing/loopback']`.

The setup file boots henri before each test file and stops it after, so `henri` and the models are globals in your tests exactly like in the application, and `request()` hits the in-process server. Each file gets a fresh boot: with the disk adapter that is an empty in-memory database. `fileParallelism: false` keeps one server and one database at a time; `globals: true` gives you `describe`, `test`, `expect` and `vi` without imports.

Under `NODE_ENV=test`, henri loads `config/test.json` (falling back to `default.json`), lets the kernel assign it a port (`config.port` is ignored, so two suites never fight over one), skips the workers, keeps the disk adapter in memory, uses nodemailer's JSON transport and stays quiet in the console.

## Writing tests

```js
// test/tasks.test.js
const { request, setup } = require('@usehenri/testing');

describe('tasks', () => {
  beforeAll(() => setup()); // a no-op once the setup file booted henri

  test('lists tasks', async () => {
    await Task.create({ name: 'write tests' });

    const res = await request().get('/tasks').set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toHaveLength(1);
  });

  test('rejects an empty task', async () => {
    const res = await request().post('/tasks').send({ category: 'low' });

    expect(res.status).toBe(422);
    expect(res.body.data.errors.name).toBeDefined();
  });
});
```

`henri generate test tasks` writes a file like this one, and `henri destroy test tasks` removes it.

For login flows use `agent()`, which keeps the cookies between requests. Requests made with a session cookie must send the CSRF token back: read the `henri.csrf` cookie from the login answer, or set `"csrf": false` in `config/test.json`.

## API

`@usehenri/testing` exports:

- `setup({ workers = false })` boots henri for the application in `process.cwd()` and resolves with the instance. Idempotent: safe in every `beforeAll`.
- `teardown()` stops it.
- `request()` a supertest request bound to the running server.
- `agent()` a supertest agent (keeps cookies between requests).
- `henri` the running instance (also `global.henri`).
- `supertest` the underlying module.

Without the setup file, boot from the test file itself with `beforeAll(() => setup())` and `afterAll(() => teardown())`. To boot once for the whole run instead of once per file, use `globalSetup: ['@usehenri/testing/global-setup']`: henri then runs in Vitest's main process, tests only reach it over HTTP through `request()`, and `henri` or the model globals are not available in the workers.

## Running

```bash
henri test                        # vitest run
henri test --watch                # vitest in watch mode
henri test test/tasks.test.js -t lists
```

Everything after `test` is passed to Vitest, except henri's own flags. The scaffolded `package.json` maps `pnpm test` to `henri test`.
