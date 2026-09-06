---
title: Jobs
description: A database backed queue with retries, a dead letter queue and recurring jobs, run by henri jobs.
sidebar:
  order: 9
---

A job is work that does not belong in a request: sending a mail, resizing an upload, calling a slow API, rebuilding a report. henri writes it down in the database the application already runs and a separate process performs it, so the request answers immediately and the work survives a restart.

```bash
npm install @usehenri/jobs        # once, in your application
henri generate job welcome        # writes app/jobs/welcome.js
henri jobs                        # a worker process that performs them
```

The queue lives in [`@usehenri/jobs`](https://www.npmjs.com/package/@usehenri/jobs). Install it and henri exposes it as `henri.jobs`; an application that has neither `app/jobs` nor a `jobs` configuration never loads it.

## Defining a job

`app/jobs/<name>.js` exports an object, the shape models and controllers already use. `perform(args, context)` is the only required key; the name of the job is its path under `app/jobs`, so `app/jobs/mail/digest.js` is the job `mail/digest`.

```js
// app/jobs/welcome.js
module.exports = {
  queue: 'mailers', // which queue a runner picks it up from (default: 'default')
  priority: 0, // lower goes first (default: 0)
  maxAttempts: 5, // attempts before the dead letter queue
  timeout: '30s', // how long one attempt may take (default: none)
  backoff: { base: '5s', factor: 4, max: '1h', jitter: 0.15 },

  perform: async (args, { henri, job, signal }) => {
    const user = await User.findById(args.userId);

    await henri.mailers.welcome.confirm(user).deliver();
  },
};
```

`context` carries:

| Key      | What it is                                                                           |
| -------- | ------------------------------------------------------------------------------------ |
| `henri`  | The running instance: models, `henri.mail`, `henri.mailers`, `henri.pen`, the config |
| `job`    | `{ id, name, queue, args, attempt, maxAttempts, enqueuedAt, runner }`                |
| `signal` | An `AbortSignal`, aborted when the attempt runs past its `timeout`                   |

Throwing fails the attempt. Returning succeeds; the value is not stored.

`henri destroy job welcome` removes the file.

## Enqueuing

From a controller, a model hook, another job or `henri console`:

```js
// now
await henri.jobs.perform('welcome', { userId: user.id });

// in five minutes
await henri.jobs.performIn('5m', 'welcome', { userId: user.id });

// at a moment
await henri.jobs.performAt(user.trialEndsAt, 'trial/expired', {
  userId: user.id,
});
```

Nothing runs in the web process: each of these writes one row and returns the job. `henri.jobs.enqueue()` is another name for `perform()`.

The third argument overrides the job's own options for this one call:

```js
await henri.jobs.perform(
  'report',
  { month: '2026-03' },
  {
    queue: 'reports',
    priority: -10,
    maxAttempts: 2,
    timeout: '10m',
    wait: '1h', // same as performIn
    at: someDate, // same as performAt
    unique: `report:2026-03`, // no second job may hold this key
  }
);
```

`unique` is enforced by a unique index, so two requests racing to enqueue the same work end up with one job: the second call answers the job that already exists instead of failing. The key belongs to the job only while it is **waiting or running** — once it is done, or once it has died, the key is free and the same work may be enqueued again.

A name with no file under `app/jobs` is refused on the spot, with the list of the jobs there are — a typo never becomes a row nobody performs.

`henri.jobs.performNow('welcome', args)` performs a job inline, without the queue. It is for tests and for the console; a request should enqueue.

### What may be passed

Arguments are stored as JSON, so they have to survive `JSON.stringify` and come back the same. **Strings, finite numbers, booleans, `null`, plain objects and arrays** go through unchanged. A `Date` is stored as its ISO string and comes back as a string.

Everything else is **refused with an error naming the path**, rather than being dropped silently the way `JSON.stringify` would:

```js
await henri.jobs.perform('welcome', { user }); // a model instance
// JobArgumentError: args.user is a Task instance, which cannot be stored:
// pass its id or a plain object
```

The same goes for `undefined`, a function, a symbol, a bigint, `NaN`, `Infinity`, a circular reference, a `Map`, a `Set` and a `Buffer`. Pass an id and load the record in `perform` — the job may run minutes later, on another machine, and the record will have changed anyway.

Serialized arguments are capped at 512 KB (`jobs.maxArgsBytes`); over that the enqueue fails rather than storing a truncated payload. Store the blob somewhere and pass its id.

## Running them

```bash
henri jobs                                  # every queue, concurrency 5
henri jobs --queue=mailers,reports          # only these
henri jobs --concurrency=20                 # more at once
henri jobs --once                           # perform what is due, then exit
henri jobs --no-recurring                   # ignore the schedules
```

The runner boots the application to the models (runlevel 4): no HTTP server, no views, no `app/workers`. It claims a batch of jobs, performs up to `concurrency` of them at a time, and polls every `jobs.pollInterval` (one second) when the queue is empty.

**Several runners are meant to run at once against one database**, on one machine or on twenty. A job is never performed twice because two of them raced: claiming is a single statement on every dialect, so it is its own transaction, and the state is part of that statement's own `WHERE`. PostgreSQL takes `FOR UPDATE SKIP LOCKED`, MySQL an `UPDATE ... ORDER BY ... LIMIT`, MSSQL `UPDLOCK, READPAST`, sqlite a subquery (its writers are serialized anyway), and MongoDB one atomic `findOneAndUpdate` per document. The rows a claim took carry a token it reads them back by, so a runner only ever sees the jobs it actually won.

On `SIGINT`, `SIGTERM` or `SIGQUIT` the runner stops claiming, finishes what it is holding, writes the outcomes and exits — the usual restart of a deployment loses nothing. A runner that is killed outright leaves its jobs `running`; another runner notices that nothing has refreshed their heartbeat for `jobs.stuckAfter` (five minutes) and puts them back.

The outcome of an attempt carries the token of the claim it belongs to, so a runner that went quiet long enough to be recovered from cannot write over the runner that took its job: its outcome is dropped and a line says so. Keep `stuckAfter` above the longest a job may take, or a job that blocks the event loop will be performed twice.

`--once` drains: it performs everything that is due and exits, which is what a cron entry or a CI step wants. A retry scheduled in the future is left alone, so a drain always ends.

### At least once

Two runners never perform one job at the same time — that is the guarantee above — but the queue is **at least once**, not exactly once. A runner that is killed after `perform()` returned and before the outcome reached the database leaves the job `running`; five minutes later another runner takes it back and performs it again. There is no way around that without a transaction spanning your code and the database, which a job does not have.

So write a job the way you would write a webhook handler: charge the card with an idempotency key, `find` before you `create`, update by id rather than incrementing blindly. `job.id` is stable across attempts of the same job and is the natural key to deduplicate on.

## Retries and the dead letter queue

A job that throws goes back to its queue with an exponential backoff — `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter` so a hundred jobs failing on the same outage do not all come back at the same instant. The default is 5s, 20s, 80s, 5m20s, then a cap of one hour.

After `maxAttempts` the job is **dead**. It is kept, not deleted, with its last error, its stack and the history of every attempt (`{ attempt, at, duration, message, runner }`). That is the dead letter queue: the place you look when something has been failing all night.

```bash
henri jobs:dead                  # what died
henri jobs:dead --json           # the same, for a script
henri jobs show <id>             # the error, the stack, the history
henri jobs:retry <id>            # put it back in its queue
henri jobs:retry --all           # put all of them back
henri jobs:discard <id>          # delete it for good
henri jobs:discard --all --queue=mailers
```

The same from the application, so a dashboard can be built on it:

```js
await henri.jobs.dead.count();
await henri.jobs.dead.list({ queue: 'mailers', limit: 20 });
await henri.jobs.dead.get(id);
await henri.jobs.dead.retry(id, { wait: '10m' }); // attempts start over
await henri.jobs.dead.retryAll({ name: 'welcome' });
await henri.jobs.dead.discard(id);
await henri.jobs.dead.discardAll();
```

A retry resets the attempt count, so the retry policy applies again from the start. A job a runner is performing right now is refused rather than requeued: that would hand the same work to a second runner.

A runner that does not have a job's file — an older process during a rolling deploy — puts the job back with a backoff instead of killing it, so the deploy finishes and the job runs.

Jobs that succeed are kept for `jobs.keepCompleted` (a day) so their timings can be read, then pruned by the runner.

## Recurring jobs

The cron of the application, declared in `config/<env>.json` and honoured by the runner itself — there is no second process to deploy.

```json
{
  "jobs": {
    "recurring": {
      "nightly-cleanup": { "job": "cleanup", "cron": "0 3 * * *" },
      "refresh-stats": {
        "job": "stats/refresh",
        "every": "15m",
        "queue": "low"
      },
      "digest": {
        "job": "mail/digest",
        "cron": "0 8 * * mon",
        "args": { "span": "week" }
      }
    }
  }
}
```

`cron` is the usual five fields (minute hour day month weekday), with ranges, steps, lists, `mon`/`jan` names and the `@hourly`, `@daily`, `@weekly`, `@monthly`, `@yearly` shorthands. **Cron expressions are read in UTC**, so a schedule means the same absolute moment wherever a runner is deployed and no daylight saving change makes it fire twice or not at all. `every` is a plain interval anchored on the epoch (`'15m'` fires at :00, :15, :30, :45). A schedule needs one or the other, never both; without a `job` it runs the job of its own name.

**Missed runs do not pile up.** A schedule holds the next moment it is due. When that moment has passed, the runner that moves the schedule forward — exactly one, because the update only matches while the schedule still holds the moment it read — enqueues the job, and the moment that follows is computed **from now**, not from the one that was missed. An hour of downtime on an hourly job costs one run, not sixty. The enqueued job also carries a unique key of its slot, so two runners cannot both put it in.

Changing a `cron` or an `every` in the configuration moves the schedule to the next moment of the new expression without running it; removing it from the configuration forgets it.

An expression henri cannot read, or one that can never come round (`0 0 30 2 *`), **fails the boot** rather than being discovered by a runner on its first tick. A schedule naming a job that is not in `app/jobs` is reported at boot and skipped, and so is any schedule that fails: one broken schedule never stops a runner claiming.

## Delivering mail through the queue

`henri.mailers` renders a message and, with `deliverLater()`, hands it over instead of sending it inline. Installing `@usehenri/jobs` is what makes that a real queue: henri registers the delivery handler, and the rendered message becomes a job on the `mailers` queue (`jobs.mailQueue`).

```js
await henri.mailers.welcome.confirm(user).deliverLater();
await henri.mailers.welcome.confirm(user).deliverLater({ wait: '10m' });
```

The options of the call are the options of `perform()`, so `wait`, `at`, `queue` and `priority` all work. What is stored is the **rendered** payload, so the runner needs neither the models nor a view engine to send it; a message that fails to send is retried and ends in the dead letter queue like any other job. Without the queue the mailers deliver out of band, which the [mail guide](/guides/mail/#delivering-later) is explicit about not being a queue.

An application that wants its own delivery (tracking, another transport) writes `app/jobs/henri/mail.js`; a file always wins over the job the package ships.

## What the queue holds

```bash
henri jobs:status          # counts by queue and state, timings, schedules
henri jobs:status --json
henri jobs list --state=pending --queue=mailers --limit=100
```

```js
const stats = await henri.jobs.stats();
// {
//   totals: { pending: 12, running: 3, done: 480, dead: 2 },
//   queues: [{ queue: 'mailers', pending: 12, running: 3, done: 480, dead: 2, waiting: 8123 }],
//   timings: [{ queue: 'mailers', runs: 480, shortest: 12, longest: 3100, average: 240 }],
//   jobs: ['henri/mail', 'welcome'],
// }

await henri.jobs.list({ state: 'pending', queue: 'mailers' });
await henri.jobs.get(id);
await henri.jobs.count({ state: 'dead' });
```

`waiting` is how long the oldest job that is already due has been waiting in that queue — the number to alert on. Timings are milliseconds, over the finished jobs still in the table.

Every moment a job carries (`runAt`, `createdAt`, `startedAt`, `finishedAt`, `claimedAt`, `updatedAt`) is an ISO string; `duration` is in milliseconds.

## Storage

The queue owns two tables of its own, `henri_jobs` and `henri_jobs_schedules`, and reaches them through the store adapter's own surface — `query()` on the SQL adapters, the collections on MongoDB. **No henri model is involved**, so the queue cannot collide with the application's schema, does not follow its model conventions and works on a store that has no models at all.

Every moment is stored as a `BIGINT` of milliseconds since the epoch rather than a timestamp column: sqlite has no date type, the SQL servers disagree on the precision and the zone of a bare `TIMESTAMP`, and the claim compares `run_at` to the runner's clock — a comparison that has to mean the same thing everywhere.

```bash
henri jobs:install         # creates the tables and the indexes; idempotent
```

The tables are also created when the application boots with a queue, so development needs nothing. In production, where the application may not be allowed to create tables, run `henri jobs:install` once as part of the deploy and set `"install": false` so the boot stops trying.

Every adapter is supported: `postgresql`, `mysql`, `mssql`, `drizzle` (sqlite, postgres, mysql), `mongoose` and `disk`. MongoDB claims one document at a time with `findOneAndUpdate`, which is atomic on a standalone `mongod` as much as on a replica set, so the guarantee holds there too — at the cost of one round trip per job instead of one per batch.

## Jobs or workers?

[Workers](/guides/workers/) are not going anywhere, and they are not the same thing.

- A **job** is a unit of work with arguments, enqueued by the application, performed once, retried on failure, and visible in a queue. Reach for it whenever something should happen _because_ something happened.
- A **worker** (`app/workers`) is a long-lived process that starts with the server and stops with it: a listener on a message broker, a connection to a device, a cache warmer. It has no arguments, no retries and no record; when it stops running, nothing tells you.

A worker that does `setInterval(() => doSomething(), 60000)` should be a recurring job: it survives a restart, it does not run once per server process, and you can see whether it ran.

## Configuration

Everything below has a default; the `jobs` block only says what differs.

```json
{
  "jobs": {
    "store": "default",
    "table": "henri_jobs",
    "queue": "default",
    "queues": [],
    "concurrency": 5,
    "maxAttempts": 5,
    "timeout": null,
    "backoff": { "base": "5s", "factor": 4, "max": "1h", "jitter": 0.15 },
    "pollInterval": "1s",
    "stuckAfter": "5m",
    "keepCompleted": "1d",
    "maxArgsBytes": 524288,
    "mailQueue": "mailers",
    "install": true,
    "recurring": {}
  }
}
```

Every duration is a number of milliseconds or a string (`'250ms'`, `'30s'`, `'5m'`, `'2h'`, `'1d'`, `'1w'`). See the [configuration reference](/configuration/#the-jobs-object) for what each key does.

## Testing them

`@usehenri/testing` boots the application, so `henri.jobs` is there. Perform a job inline, or drain the queue:

```js
const { henri, setup } = require('@usehenri/testing');

test('signing up sends the welcome mail', async () => {
  await setup();
  await request().post('/users').send({ email: 'ada@example.com' });

  const [job] = await henri().jobs.list({ state: 'pending' });

  expect(job.name).toBe('welcome');
});
```

`henri.jobs.performNow(name, args)` runs one without the queue, and the `Runner` of `@usehenri/jobs` has an `once()` that drains what is due — the same thing `henri jobs --once` does, and the way to test a job end to end without waiting on a clock.
