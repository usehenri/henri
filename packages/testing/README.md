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
app. `fileParallelism: false` keeps one server and one database at a time --
drop it only when each file gets a database of its own, which is what the disk
adapter does under `NODE_ENV=test`.

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

## Factories

A factory makes a valid record with the fields the test does not care about
already filled in. It lives in `test/factories/<name>.js`, is named after its
file and writes to the model of that name.

```js
// test/factories/task.js
module.exports = {
  attributes: {
    name: ({ sequence }) => `Task ${sequence}`,
    ownerId: async ({ create }) => (await create('user')).id,
  },

  traits: {
    done: { completedAt: () => new Date(), state: 'done' },
  },
};
```

```js
const { build, create, createList } = require('@usehenri/testing');

await create('task'); // saved, with an owner
await create('task', 'done'); // with the trait
await create('task', { ownerId: me.id }); // no second user is made
await createList('task', 3, 'done');
await build('task'); // the attributes, unsaved
```

A value is a literal or a function of the build context (`attrs`, `build`,
`create`, `sequence`, `traits`, `uid`), and fields resolve on demand: reading
`await attrs.eventId` from another field resolves that one first. An override
always wins, and the definition's value is then not evaluated at all.

`after(record, context)` runs on the saved record and may replace it, which is
how a factory grants roles the model will not mass assign.
`defineFactory(name, definition)` declares one from a test file.

## API

- `setup({ workers = false })` boots henri for the app in `process.cwd()` and
  resolves with the instance. Idempotent.
- `teardown()` stops it.
- `request()` a supertest request bound to the running server.
- `agent()` a supertest agent (keeps cookies between requests).
- `create(name, ...traits, overrides)` a saved record from a factory.
- `build(name, ...traits, overrides)` the attributes, without saving.
- `createList(name, count, ...traits, overrides)` several of them.
- `defineFactory(name, definition)` a factory without a file.
- `resetFactories()` forgets the definitions and the sequences.
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
