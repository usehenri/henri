---
title: Testing
description: henri test, Vitest and @usehenri/testing.
sidebar:
  order: 12
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

## Factories

A factory makes a valid record with the fields the test does not care about already filled in. It lives in `test/factories/<name>.js` and is read the first time a test asks for one:

```js
// test/factories/proposal.js
module.exports = {
  attributes: {
    abstract: () => 'An abstract, comfortably past the sixty characters.',
    eventId: async ({ create }) => (await create('event')).id,
    speakerId: async ({ create }) => (await create('user')).id,
    title: ({ sequence }) => `A proposal long enough to pass (${sequence})`,
  },

  traits: {
    submitted: { state: 'submitted', submittedAt: () => new Date() },
  },
};
```

```js
const { build, create, createList } = require('@usehenri/testing');

const proposal = await create('proposal'); // a saved Proposal
const accepted = await create('proposal', 'submitted'); // with the trait
const mine = await create('proposal', { speakerId: me.id }); // and the test's own values
const page = await createList('proposal', 15, 'submitted');
const attributes = await build('proposal'); // the attributes, unsaved
```

Three rules hold the rest together.

**What the caller gives is never made.** An override wins over the definition and the definition's value is not evaluated at all, so `create('proposal', { speakerId: me.id })` creates no second user. An override of `undefined` says nothing, so an optional value from the test does not turn a default into a null.

**A value is a literal or a function of the build context.** There is no separate vocabulary for associations, sequences or computed fields: an association is a function that calls `create`, a sequence is a number on the context. The context carries `attrs` (what is resolved so far), `build` and `create` (nested, and counted against a nesting limit so a cycle is reported rather than run forever), `sequence` (how many records this factory has made in this process, from 1), `traits` (the ones being applied) and `uid` (four characters of this process's own, for a unique column in a suite whose workers share one database).

**Fields resolve on demand, not in the order they are written.** Reading `attrs.eventId` from another field's function resolves that field first, so a track and a proposal can share one edition whatever order the keys sit in:

```js
trackId: async ({ attrs, create }) =>
  (await create('track', { eventId: await attrs.eventId })).id,
```

A **trait** is an override object with a name, kept next to the model instead of copied into every test. It earns that place when a state is more than one field -- a submitted proposal has a `state` _and_ a `submittedAt`, an accepted one a `decidedAt` as well -- because that is knowledge about the model, not about any one test. Traits compose (`create('proposal', 'accepted', 'lightning')`) and an override still wins over all of them.

A factory writes through the model, so everything the model does still happens: the password is hashed, the timestamps are stamped, `personal` still masks, a `paranoid` model still soft-deletes. What the model refuses to mass assign needs an `after` hook, which runs on the saved record and may replace it:

```js
// test/factories/user.js
module.exports = {
  after: async (user, { attrs }) => {
    if (!attrs.roles) {
      return user;
    }

    await User.setRoles(user.externalId, attrs.roles);

    return User.findByKey(user.id);
  },

  attributes: {
    email: ({ sequence, uid }) => `speaker-${uid}-${sequence}@example.test`,
    name: 'A Speaker',
    password: 'a-password-for-the-tests',
  },

  traits: { admin: { roles: ['speaker', 'admin'] } },
};
```

A factory is named after its file and writes to the model of that name; `model: 'Proposal'` names another one, which is what a factory called after a role rather than a table needs. `build()` still makes the associations -- a foreign key has to name a row that exists -- unless the caller gives the field, which is what makes `build('proposal', { speakerId: me.id })` touch no database at all. `defineFactory(name, definition)` declares one from a test file, and wins over the file of the same name.

Whatever a test asserts on belongs in the test. Everything else belongs in the factory.

## Speed

The setup file boots the application once per test file, and `fileParallelism: false` runs those files one at a time. That is the setting to keep while **the files share one database**, which is the usual case: a store with a `url` in `config/test.json` is one database, whatever runs against it, and two files emptying tables at the same time is not a suite you can read a failure from.

Files may run at the same time when **each file gets a database of its own**, which is what the disk adapter does under `NODE_ENV=test`: `@usehenri/disk` starts a MongoDB of its own per process, in memory, on a port of that process's own. Drop `fileParallelism: false` there and the suite runs on every core. henri's own suite does exactly this and went from 58 to 14 seconds on sixteen cores.

Before turning it on, look for what the files still share. The application's directory is the usual answer: an upload root, a receipt directory, a fixture file written by one test and read by another. Anything written there has to be named per record or per process. Then prove it: run the suite ten times, not once. A suite that is fast and flaky is worse than a slow one.

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
