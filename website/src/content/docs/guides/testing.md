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

The setup file boots henri before each test file and stops it after, so `henri` and the models are globals in your tests exactly like in the application, and `request()` hits the in-process server. Each file gets a fresh boot, and with it a fresh database: an empty `:memory:` one on the sqlite store `henri new` writes, an empty in-process MongoDB on the disk adapter. `fileParallelism: false` keeps one server and one database at a time; `globals: true` gives you `describe`, `test`, `expect` and `vi` without imports.

Under `NODE_ENV=test`, henri loads `config/test.json` (falling back to `default.json`), lets the kernel assign it a port (`config.port` is ignored, so two suites never fight over one), skips the workers, keeps the disk adapter in memory, uses nodemailer's JSON transport and stays quiet in the console.

`henri new` writes that `config/test.json` when the store needs a database of its own: the same configuration as `config/default.json`, pointed somewhere else. On the default drizzle store on sqlite that is `":memory:"` instead of the file under `.henri/`, so a run starts from an empty schema and never touches the development data; on a server it is `<name>_test`, which you create once. The disk adapter gets no such file, because every boot already starts a MongoDB of its own.

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

## Mail

`inbox()` is the mail the application was asked to send during the test, oldest first. A plain array of plain objects, asserted on with the `expect` the suite already has:

```js
const { inbox, request } = require('@usehenri/testing');

test('signing up sends the confirmation mail', async () => {
  await request().post('/signup').send({ email: 'ada@example.com', password });

  const [mail] = inbox();

  expect(inbox()).toHaveLength(1);
  expect(mail.to).toContain('ada@example.com');
  expect(mail.subject).toBe('Confirm your address');
  expect(mail.html).toContain('/confirm/');
});
```

An entry carries `to`, `cc` and `bcc` (the addresses, whatever shape the mailer wrote them in), `from`, `subject`, `html`, `text`, the `mailer` and the `action` that rendered it, `deferred`, the `options` a `deliverLater()` was called with, and `message` -- the nodemailer payload itself, with everything the entry does not lift out (the attachments, the headers).

**Both doors are watched.** A message leaves through `deliver()`, which hands the rendered payload to the transport, or through `deliverLater()`, which hands it to the delivery handler -- with [`@usehenri/jobs`](/guides/jobs/) a queue row, sent by a runner a test never starts. An inbox that watched one of them would answer differently depending on which packages are installed, so both are captured and `deferred` says which door it was. What a runner sends afterwards is a second entry, `deferred: false` this time, because two things really did happen:

```js
await henri.mailers.welcome.confirm(user).deliverLater();

expect(inbox({ deferred: true })).toHaveLength(1);

const [job] = await enqueued('henri/mail');

await henri.jobs.performNow(job.name, job.args);

expect(inbox({ deferred: false })).toHaveLength(1);
```

`inbox(filter)` narrows on `action`, `deferred`, `mailer`, `subject` and `to`, where a string is compared (an address without its case) and a regular expression tested. Anything a filter cannot say is a predicate: `inbox((mail) => mail.text.includes('unsubscribe'))`. A key the inbox does not hold is **refused** rather than ignored, because a filter that is silently dropped makes an assertion pass for the wrong reason.

**The inbox is emptied before every test** by `@usehenri/testing/setup-file`, so nothing a test asserts on can come from the one before it; `clearInbox()` does the same by hand for a suite that boots henri another way. And it belongs to the application rather than to the process: it lives on the instance `setup()` booted, so a worker running its own boot reads its own mail, and `teardown()` takes it away with the instance.

## Jobs

`enqueued()` is what the queue holds. Not a copy of what went past: it reads the queue back, so the `args` have been through JSON exactly as the runner will read them, and a job enqueued by a model hook three layers down is in it like any other.

```js
const { enqueued } = require('@usehenri/testing');

test('publishing a proposal notifies the reviewers', async () => {
  await request().post('/proposals/1/publish');

  const [job] = await enqueued('notify');

  expect(await enqueued()).toHaveLength(1);
  expect(job.args).toEqual({ proposalId: 1 });
  expect(job.queue).toBe('default');
});
```

A string is the job name, and a filter takes `name`, `queue`, `state`, `limit` and `offset`. The state is `pending` by default, which is what "enqueued" means -- a job a runner already performed is `done`, not gone: `{ state: 'dead' }` reads the dead letter queue and `{ state: null }` everything the table holds. A row is what `henri jobs:show` prints (`args`, `name`, `queue`, `priority`, `runAt`, `attempts`, `state`, `error`).

Nothing performs a job on its own. `henri.jobs.performNow(job.name, job.args)` runs one here and now, which is how a test asserts on what a job _does_ rather than on the fact that it was enqueued.

Both need `@usehenri/jobs`, which is optional and stays optional -- `@usehenri/testing` does not depend on it. An application with no queue is told so, with the install line (`HENRI_JOB_QUEUE_UNAVAILABLE`), rather than handed an empty list: an assertion that passes because the feature is missing is worse than no helper at all.

`clearJobs()` forgets the jobs the queue holds, whatever their state, and answers how many. Nothing calls it for you, unlike the inbox: those are rows in the application's own database, so emptying them between tests is the suite's decision.

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
- `inbox(filter)` the mail the application was asked to send; `clearInbox()` empties it.
- `enqueued(filter)` the jobs the queue holds; `clearJobs(filter)` forgets them. Both need `@usehenri/jobs`.
- `create`, `build`, `createList`, `defineFactory`, `resetFactories` the factories.
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
