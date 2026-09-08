---
title: Jobs
description: A database backed queue with retries, a dead letter queue and recurring jobs, run by henri jobs.
sidebar:
  order: 10
---

A job is work that does not belong in a request: sending a mail, resizing an upload, calling a slow API, rebuilding a report. henri writes it down in the database the application already runs and a separate process performs it, so the request answers immediately and the work survives a restart.

```bash
npm install @usehenri/jobs        # once, in your application
henri generate job welcome        # writes app/jobs/welcome.js
henri jobs                        # a worker process that performs them
```

The queue lives in [`@usehenri/jobs`](https://www.npmjs.com/package/@usehenri/jobs). The package [ships a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package), so depending on it is all there is to do: it is in the boot as `henri.jobs`, at level 4. An application that does not depend on it has no `henri.jobs` at all — `henri new` does not install it, because most applications never enqueue anything. `henri doctor` asks for it as soon as `app/jobs` holds a file or the configuration has a `jobs` block, and `henri jobs` says the same.

Installing the package is not the same as using it: an application that has neither `app/jobs` nor a `jobs` configuration keeps the module inert, creates no table, and every call says so. The queue was loaded by `@usehenri/core` until 1.2 — see [Upgrading](/upgrading/#the-queue-registers-itself).

## Defining a job

`app/jobs/<name>.js` exports an object, the shape models and controllers already use. `perform(args, context)` is the only required key; the name of the job is its path under `app/jobs`, so `app/jobs/mail/digest.js` is the job `mail/digest`. A file without one fails the boot (`HENRI_JOB_INVALID_DEFINITION`), and [`henri doctor`](/reference/cli/#doctor) reports it — along with a [recurring schedule](#recurring-jobs) naming a job that is not there, which fails nothing at all and simply never runs.

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

`unique` is enforced by a unique index, so two requests racing to enqueue the same work end up with one job: the second call answers the job that already exists instead of failing. The key belongs to the job only while it is **waiting or running** — once it is done, or once it has died, the key is free and the same work may be enqueued again. (The keys the recurring scheduler writes for itself are the one exception; they are kept for the life of the row, which is what stops an occurrence being enqueued twice.)

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

**Several runners are meant to run at once against one database**, on one machine or on twenty. A job is never performed twice because two of them raced: claiming is a single statement on every dialect, so it is its own transaction, and the state is part of that statement's own `WHERE`. PostgreSQL takes `FOR UPDATE SKIP LOCKED`, MySQL an `UPDATE ... ORDER BY ... LIMIT`, MSSQL `UPDLOCK, READPAST`, sqlite a subquery (its writers are serialized anyway), and MongoDB one atomic `findOneAndUpdate` per document. The rows a claim took carry a token it reads them back by, so a runner only ever sees the jobs it actually won. A job that declares [how many of it may run at once](#how-many-at-once) is claimed by a second pass of the same statement, one row per permit the runner holds.

On `SIGINT`, `SIGTERM` or `SIGQUIT` the runner stops claiming, finishes what it is holding, writes the outcomes and exits — the usual restart of a deployment loses nothing. A runner that is killed outright leaves its jobs `running`; another runner notices that nothing has refreshed their heartbeat for `jobs.stuckAfter` (five minutes) and puts them back.

The outcome of an attempt carries the token of the claim it belongs to, so a runner that went quiet long enough to be recovered from cannot write over the runner that took its job: its outcome is dropped and a line says so. Keep `stuckAfter` above the longest a job may take, or a job that blocks the event loop will be performed twice.

`--once` drains: it performs everything that is due and exits, which is what a cron entry or a CI step wants. A retry scheduled in the future is left alone, so a drain always ends.

### At least once

Two runners never perform one job at the same time — that is the guarantee above — but the queue is **at least once**, not exactly once. A runner that is killed after `perform()` returned and before the outcome reached the database leaves the job `running`; five minutes later another runner takes it back and performs it again. There is no way around that without a transaction spanning your code and the database, which a job does not have.

So write a job the way you would write a webhook handler: charge the card with an idempotency key, `find` before you `create`, update by id rather than incrementing blindly. `job.id` is stable across attempts of the same job and is the natural key to deduplicate on.

### The queue is not in your transaction

The queue reaches its own tables through the store adapter's raw `query()`, which does **not** join an open model transaction. So this enqueues a job that runs whatever happens next:

```js
await henri.model.stores.default.transaction(async () => {
  await Invoice.create({ ... });
  await henri.jobs.perform('invoice/send', { id });  // already written
  throw new Error('rolled back');                    // the invoice is gone
});
```

That is the trade every database-backed queue makes in one direction or the other, and henri makes it towards **the job always running**: a queue that joined your transaction would silently hold work back whenever a request failed late, and a job that runs for a record that no longer exists is a `findById` returning `null`, which a job should survive anyway. Enqueue after the commit when the order matters, and write jobs that check.

## Retries and the dead letter queue

A job that throws goes back to its queue with an exponential backoff — `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter` so a hundred jobs failing on the same outage do not all come back at the same instant. The default is 5s, 20s, 80s, 5m20s, then a cap of one hour.

After `maxAttempts` the job is **dead**. It is kept, not deleted, with its last error, its stack and the history of every attempt (`{ attempt, at, duration, message, runner }`). That is the dead letter queue: the place you look when something has been failing all night.

A buried job does not reach [`henri.reporter`](/guides/logs/): the row already holds the arguments, every attempt and the error, and `henri jobs:dead` reads it back, so a second copy would be one more thing to keep in step. What would change that is one call where the queue buries a row -- the payload of a job is application data, so what of it may leave the process is this package's decision to make.

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

### A failure a retry cannot fix

Some failures are not going to get better. A remote API answered `410 Gone`, a webhook url resolves to an address the delivery must not open, an address is not an address. Spending eight attempts over three days to learn that again is noise, and the operator finds out three days late.

An error that carries `retryable: false` is buried on the spot, with its reason, however many attempts were left:

```js
module.exports = {
  perform: async ({ id }) => {
    const answer = await fetch(`https://api.example.com/things/${id}`, {
      method: 'POST',
    });

    if (answer.status === 422) {
      // The payload is wrong. It will be just as wrong in six hours
      throw Object.assign(new Error('the API refused the payload'), {
        retryable: false,
      });
    }

    if (!answer.ok) {
      throw new Error(`the API answered ${answer.status}`); // retried
    }
  },
};
```

The job lands in the dead letter queue like any other, so `henri jobs:dead`, `henri jobs:show <id>` and `henri jobs:retry <id>` still apply — it just gets there without the wait. [Outbound webhooks](/guides/webhooks/) use this for every failure a retry cannot fix.

Jobs that succeed are kept for `jobs.keepCompleted` (a day) so their timings can be read, then pruned by the runner.

## How many at once

`henri jobs --concurrency` bounds a **runner**: how many jobs that process performs at a time. What an application usually wants is a bound on a **job** — never more than one `import` anywhere, at most three per tenant — and that is a different number, because it has to hold across every runner on every machine.

A job declares it:

```js
// app/jobs/import.js
module.exports = {
  concurrency: 1, // one at a time, whatever is running it

  perform: async ({ accountId }) => {
    /* ... */
  },
};
```

```js
// app/jobs/tenant/rebuild.js
module.exports = {
  // Three at a time per tenant, and no bound at all between tenants
  concurrency: { limit: 3, key: 'tenantId' },

  perform: async ({ tenantId }) => {
    /* ... */
  },
};
```

`key` is the name of an argument, or a function of them (`key: (args) => args.account.id`). Without one the whole job shares one bound. `group` gives several jobs one bound between them:

```js
// app/jobs/tenant/import.js and app/jobs/tenant/export.js
module.exports = {
  concurrency: { limit: 2, group: 'tenant-io', key: 'tenantId' },
  // ...
};
```

Two jobs of one group must agree on the limit, or the boot says so (`HENRI_JOB_CONCURRENCY_CONFLICT`) — a group is one bound, and it cannot count to two numbers at once.

**The limit belongs to the job and never to a call.** There is no `concurrency` option on `perform()`: an option would let one caller step outside the bound the job declared, which is the one thing a bound is for.

### What it guarantees, and on what

A runner takes a **permit** before it takes the work. The permits live in a table the queue owns (`henri_jobs_limits`), one row per slot, with `(limit_key, slot)` as its primary key: a runner takes a slot by inserting it, and of every runner inserting the same slot exactly one succeeds. That is the same primitive `unique` jobs already rest on, and it is the only one that means the same thing on PostgreSQL, MySQL, MSSQL, sqlite **and** MongoDB, where an `insertOne` answers 11000.

It is deliberately not counted inside the claim. A `SELECT COUNT(*) ... WHERE state = 'running'` there is read at the statement's own snapshot, so two runners racing both see the same free room, both take it and both commit; `FOR UPDATE SKIP LOCKED` does not help, because it locks the candidate _rows_ and the second runner simply steps over them to the next ones. Making the count exact needs a lock on something shared per key — `pg_advisory_xact_lock`, `GET_LOCK`, `sp_getapplock`, and nothing at all on MongoDB. Four mechanisms, one of them missing.

The claim statement itself keeps its shape and gains one predicate: `name NOT IN (...)` on the pass that takes the unlimited work, `name IN (...) AND concurrency_key = ?` with a limit of one on the pass that takes a row the runner holds a permit for. An application with no limited job sends the statement it always sent, parameter for parameter.

The permit comes first and the work second, on purpose. The other order — claim a job, discover its key is full, put it back — makes a full key spin the runner's loop at full speed doing nothing, because the loop only sleeps when a tick claimed nothing.

**What the bound rests on, said plainly:**

- **The heartbeat.** A runner refreshes its permits four times per `jobs.stuckAfter`, and a permit nobody has refreshed for that long is freed — the same rule, and the same clock, that puts a dead runner's jobs back. A runner that goes quiet for five minutes and comes back still performing its job has lost its permit, exactly as it has lost its job. This is the same condition [at least once](#at-least-once) already rests on: keep `stuckAfter` above the longest a job may take.
- **A deploy that lowers a limit** may overlap while the permits taken under the old one drain. Raising a limit takes effect at once.
- **A rolling deploy that adds one.** A runner still on the old code does not know the job is bounded and claims it the way it always did, until it is replaced — the same window as a runner that does not have a new job's file at all. Restart the runners.
- **`performNow()` is not the queue**, so it takes no permit and counts against nothing. Neither does a job you call yourself.

`henri jobs:status` prints what was asked for and what is holding it up:

```
  Concurrency:
    import -> 1 at a time
    tenant/rebuild -> 3 at a time per key
    held tenant/rebuild:acme#0 by web-3:41:2f8c for 4f0e...
```

```js
const { declared, held } = await henri.jobs.limits();
```

### The column, and an upgrade

The bound stores one thing on the job row: `concurrency_key`, the bucket it counts against. The queue's tables are created with `CREATE TABLE IF NOT EXISTS` and there is no migration chain behind them, so a **new table** appears on its own and a **new column** does not.

`henri jobs:install` — which the boot already runs unless `jobs.install` is false — adds it, and the statement that adds it is idempotent and **tolerated**: a database user who may not `ALTER` fails no boot. What decides whether limits work is asking the table, not whether that statement ran:

- An application that declares no limit **is not affected at all**. Its inserts name the columns that are there and its claim never mentions the new one.
- An application that declares one and whose table has no column for it **fails the boot** with `HENRI_JOB_LIMIT_UNINSTALLED`, naming `henri jobs:install`. A limit that is silently not applied is worse than one that refuses to start.
- A job already **in the queue** when the limit was declared carries no key. It is not left behind: a row with no key belongs to its job's own bucket, so adding a limit takes effect on the backlog — which is the moment you would be adding it.
- On MongoDB there is nothing to upgrade: a document simply has no such field.

## Batches

Forty jobs, and one that runs when they are all done: an import that resizes every image and then sends the mail, a nightly report compiled from a page of work per account.

```js
const batch = await henri.jobs.batch({
  name: `import ${account.id}`, // a label, for henri jobs:batches
  callback: 'import/finished', // the job that runs when they are done
  args: { accountId: account.id }, // its own arguments
  queue: 'imports', // and its queue, priority, maxAttempts, timeout, wait, at

  jobs: rows.map((row) => ['import/row', { id: row.id }]),
});

batch.id; // the batch
batch.total; // 40
batch.jobs; // the ids of the jobs it enqueued
```

A job of the list is `'name'`, `['name', args]`, `['name', args, options]` or `{ name, args, options }` — the options being `perform()`'s own, so one job of a batch can have its own queue or priority.

The callback is an ordinary job of `app/jobs`, and it is handed the counts under `batch`:

```js
// app/jobs/import/finished.js
module.exports = {
  perform: async ({ accountId, batch }) => {
    // batch: { id, name, total, done, failed, succeeded }
    const account = await Account.findById(accountId);

    await henri.mailers.imports.done(account, batch).deliverLater();
  },
};
```

The `batch` key is henri's, so an `args` of your own that carries one is overwritten; and because the counts go in there, `args` has to be a plain object.

When there are too many jobs to write out — a cursor over a table, a stream — the second argument builds the batch instead, and the batch is sealed when it resolves:

```js
const batch = await henri.jobs.batch(
  { callback: 'import/finished' },
  async (open) => {
    for await (const row of rows) {
      await open.add('import/row', { id: row.id });
    }
  }
);
```

A **batch is built where it is created**. `add()` is a call on the handle that `batch()` answered, and once the batch is sealed it refuses (`HENRI_JOB_BATCH_CLOSED`) — there is no adding a job to a batch from another process later, because that is exactly the race that would let a callback run with work still on its way in. A builder that throws leaves the batch unsealed on purpose: the jobs it added still run, the callback never does, and `henri jobs:batches` shows it. Without either a list or a function the batch comes back open, and `batch.seal()` closes it when you are ready.

### A batch finishes, it does not succeed

The callback runs once **every job of the batch has reached a terminal state** — `dead` included — and it is handed the counts. A batch whose last job failed is a finished batch with a failure in it, and what that means is the application's to decide: a callback that only ran when everything succeeded would be a callback that never runs and nobody notices.

So `failed` is a number the callback reads, `henri jobs:dead` has the rows, and `henri.jobs.batches.jobs(id, { state: 'dead' })` is the list of what went wrong in this batch.

An **empty** batch (`jobs: []`) has nothing to wait for and finishes the moment it is made. A batch with no `callback` at all is a counter you can look at.

### Exactly once, and never early

Two promises, and they rest on the same three writes.

`total` is written **once**, when the batch is sealed, and never moves again. `done` is advanced by **one statement per terminal outcome**, and that statement is the whole of it:

```sql
UPDATE henri_jobs_batches
   SET done = done + 1, failed = failed + ?, updated_at = ?
 WHERE id = ? AND finished_at IS NULL
   AND EXISTS (SELECT 1 FROM henri_jobs
                WHERE id = ? AND batch_id = ? AND claim_token = ?
                  AND state IN ('done', 'dead'))
```

- The counter is **never read into the process to be written back**. `done = done + 1` is evaluated by the engine under a row lock of its own — PostgreSQL and MySQL re-evaluate the row after waiting for the writer in front, MSSQL takes an update lock, sqlite serializes its writers outright — so four runners finishing at the same instant make four increments and not one. MongoDB's `$inc` is the same guarantee on a document.
- The `EXISTS` is what makes it exactly once: the counter only moves while the job row still holds **the claim token of the attempt that wrote its outcome**, and that is true of exactly one runner. A runner whose heartbeat went stale had its job taken away and its outcome refused — it counts nothing, and the runner that took the job over counts it once when it finishes. (On MongoDB the check is a `findOne` before the `$inc`, and it is exact for the same reason: a document that is terminal and holds this token can never be claimed, recovered or written again.)
- `finished_at IS NULL` stops a batch that has already called its callback from ever counting again.

So `done` reaches `total` after the last job of the batch is terminal, and not before — which is what the callback's own test asserts, by asking the database what is left of its batch at the moment it runs.

The callback is then enqueued under a **unique key of the batch's own**, the way a [recurring](#recurring-jobs) occurrence is: two runners that both saw the last outcome send the same insert, the index refuses one of them, and it is answered with the job the other one enqueued. The batch is stamped finished _after_ that, so a process dying in between leaves it unfinished and the next sweep settles it again — settling is idempotent, which is the point.

### What a batch is not

- **It is not a transaction.** A runner that dies mid-batch leaves its job to be recovered, the counter unmoved and the batch unfinished until that job reaches an outcome — which is the right answer, and the reason the counter cannot be advanced at claim time.
- **It is not atomic with your database** either: [the queue is not in your transaction](#the-queue-is-not-in-your-transaction), so a batch enqueued inside one that rolls back is a batch that runs, callback and all. Enqueue after the commit when the order matters.
- **A job cannot be added to a batch that is sealed**, and that refusal is asked of the table rather than of the handle in your process's memory.
- **A batch is not a pipeline.** There is no order between its jobs, no batch inside a batch, and no cancelling one.

Two things leave a batch short of its total with every job of it terminal: a runner killed between writing an outcome and counting it, and a job buried by the recovery of a dead runner, whose outcome no attempt of anybody's ever wrote. The runner's sweep answers both — it counts the rows of a batch that has not moved for `jobs.stuckAfter` and settles it — so the callback is late by a sweep rather than never. That count only ever moves a batch **forward**, so a finished job pruned out of the table can never undo one.

A job of a batch that is [put back](#retries-and-the-dead-letter-queue) gives its slot back first, so it is counted once when it finishes rather than twice; a job of a batch that is **discarded** leaves that batch unfinished for good, and `henri.jobs.batches.discard(id)` is the way to forget it.

### What a batch looks like from the outside

```bash
henri jobs:batches                 # what is running, and what it is waiting for
henri jobs:batches --finished
henri jobs:list --batch <id>       # the jobs of one batch
henri jobs:status                  # says which batches are still running
```

```
  4f0e8f2c-...  running   38/40 done, 1 dead  import acme
      -> import/finished (not enqueued yet)
```

```js
await henri.jobs.batches.get(id); // one batch and its counts
await henri.jobs.batches.list({ finished: false });
await henri.jobs.batches.jobs(id, { state: 'dead' });
await henri.jobs.batches.discard(id);
```

A finished batch is kept for `jobs.keepCompleted`, like a finished job, and pruned by the same sweep.

### The table, and an upgrade

A batch stores one column on the job row (`batch_id`) and one table of its own (`henri_jobs_batches`). The queue's tables are created with `CREATE TABLE IF NOT EXISTS` and there is no migration chain behind them, so — exactly as for the [concurrency key](#the-column-and-an-upgrade) — a **new table** appears on its own and a **new column** does not.

`henri jobs:install`, which the boot already runs unless `jobs.install` is false, adds both, and the `ALTER` is idempotent and **tolerated**: a database user who may not alter the table fails no boot. What decides whether batches work is asking the database, not whether that statement ran:

- An application that makes no batch **is not affected at all**. Its inserts name the columns that are there.
- `henri.jobs.batch()` on a store that has neither **is refused** with `HENRI_JOB_BATCH_UNINSTALLED`, naming `henri jobs:install`. A batch is refused rather than run with a counter nothing can hold — there is nothing declared in a file to fail a boot over, so the refusal is at the call.
- On MongoDB there is nothing to upgrade: a document has no such field, and a collection appears when something is written into it.

## A job a package ships

A package that does work of its own registers its job on the queue rather than asking every application to write a file that would only forward the call:

```js
henri.jobs.define('acme/deliver', {
  maxAttempts: 8,
  queue: 'acme',
  perform: (args, context) => deliver(args),
});
```

It has to happen while the queue is up and in every process that has it, which means from a module at runlevel 4 or later — `henri jobs` boots to exactly that level, so the runner has the definition too. [`@usehenri/webhooks`](/guides/webhooks/) registers `henri/webhook` this way.

A file of `app/jobs` with the same name **wins**: `define()` answers `false` and keeps what the application wrote, the way `app/jobs/henri/mail.js` wins over the built-in mail job. That is how an application overrides a package's job — add tracking, change the transport — without the package knowing.

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

`henri.mailers` renders a message and, with `deliverLater()`, hands it over instead of sending it inline. Installing `@usehenri/jobs` is what makes that a real queue: the module registers the delivery handler, and the rendered message becomes a job on the `mailers` queue (`jobs.mailQueue`). Without the package the message is sent out of band, which is not a queue and cannot hold anything back: `deliverLater({ wait: '5m' })` is refused, and says to install the package rather than sending the mail now.

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

## No dashboard, and what to build one from

henri mounts no queue dashboard, in any environment, and will not. This is a decision rather than a gap, so here is the argument.

The obvious counter is that `/_routes`, `/_openapi.json` and `/_mailers` are already pages henri mounts in development, behind loopback, and one more would cost nothing. But look at what those three show: an application's **routes**, its **API description**, its **mail templates**. Every one of them is a description of the application, written by the people reading it. A queue page is the first that would show the application's **data** — a job's arguments are the customer's email address, the invoice being rebuilt, the account being merged. henri spends a whole [privacy](/guides/privacy/) tranche making sure fields marked personal do not reach an answer it builds; printing them in a browser tab because a page is convenient would be that decision made twice, differently. And a queue page that hides the arguments cannot tell you why a job died, which is the only reason to open it.

The second half is where a dashboard is actually wanted, which is production. There henri must not mount one at all: a route that exists in production has to be authenticated, authorized, rate limited, CSRF-defended and kept out of `henri audit`'s way, and every mounted admin runtime people have come to resent got there one reasonable feature at a time. A page henri ships is a page henri chooses the auth model of. A page **you** ship goes behind your `roles`, your [policy](/guides/policies/), your own decision about who may read an argument — and it shows up in `henri routes`, `henri audit` and your own tests like any other route.

So the answer is a read-only page of your own, over an API that is already there:

```js
// app/controllers/admin/jobs.js
module.exports = {
  index: async (req, res) => {
    await req.authorize('read', 'Jobs');

    const [stats, dead, limits, batches] = await Promise.all([
      henri.jobs.stats(),
      henri.jobs.dead.list({ limit: 50 }),
      henri.jobs.limits(),
      henri.jobs.batches.list({ finished: false }),
    ]);

    return { batches, dead, limits, stats };
  },
};
```

`stats()`, `list()`, `get()`, `limits()`, `batches.*` and the whole `dead.*` API are the same calls `henri jobs:*` makes, and every one of those commands takes `--json`, so a script, a Grafana exporter or a page all read the same numbers. What henri owns instead of a page is the [telemetry](/guides/telemetry/): the queue depth by queue and state, and how long claiming takes — the two numbers a screenshot cannot alert on.

## Storage

The queue owns four tables of its own, `henri_jobs`, `henri_jobs_schedules`, `henri_jobs_limits` and `henri_jobs_batches`, and reaches them through the store adapter's own surface — `query()` on the SQL adapters, the collections on MongoDB. **No henri model is involved**, so the queue cannot collide with the application's schema, does not follow its model conventions and works on a store that has no models at all.

Every moment is stored as a `BIGINT` of milliseconds since the epoch rather than a timestamp column: sqlite has no date type, the SQL servers disagree on the precision and the zone of a bare `TIMESTAMP`, and the claim compares `run_at` to the runner's clock — a comparison that has to mean the same thing everywhere.

```bash
henri jobs:install         # creates the tables and the indexes; idempotent
```

The tables are also created when the application boots with a queue, so development needs nothing. In production, where the application may not be allowed to create tables, run `henri jobs:install` once as part of the deploy and set `"install": false` so the boot stops trying.

Every adapter is supported: `drizzle` (sqlite, postgres, mysql), `postgresql`, `mysql`, `mariadb`, `mssql`, `mongoose` and `disk`. MongoDB claims one document at a time with `findOneAndUpdate`, which is atomic on a standalone `mongod` as much as on a replica set, so the guarantee holds there too — at the cost of one round trip per job instead of one per batch.

## What is not here

Deliberately absent: a mounted dashboard ([above](#no-dashboard-and-what-to-build-one-from)), priorities that change after an enqueue, an order between the jobs of a [batch](#batches) or a batch inside one, and a way to cancel a job that a runner is already performing — JavaScript cannot stop a function that is running, which is why `timeout` aborts a signal and hopes.

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
