---
'@usehenri/jobs': minor
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/mcp': patch
---

Real background jobs, in a new package: `@usehenri/jobs`.

What henri called workers was a hook that ran a file at boot, and the documented example was a `setInterval`. There was no way to say "send this mail later" or "process this upload in the background": no queue, no retries, no schedule, and nothing to look at when something failed. Rails has had that for a decade and now ships a database-backed queue by default; this is henri's.

A job is `app/jobs/<name>.js` exporting `perform(args, context)` alongside its `queue`, `priority`, `maxAttempts`, `timeout` and `backoff` — the shape models and controllers already use. `henri generate job <name>` writes one and `henri destroy job <name>` removes it. The application enqueues with `henri.jobs.perform(name, args, options)`, `performIn(delay, ...)` and `performAt(date, ...)`, which write one row and return; `performNow()` runs one inline for tests and the console. Arguments are stored as JSON and anything that would not survive the round trip — a model instance, a function, `undefined`, a `Date` that would come back a string, a cycle — is refused with the path that holds it instead of being dropped silently.

`henri jobs` runs a worker process: it claims jobs, performs `jobs.concurrency` of them at a time, honours the recurring schedules, puts back the jobs of runners that died and stops on `SIGINT`, `SIGTERM` and `SIGQUIT` after finishing what it holds. `--queue` limits it to some queues and `--once` drains what is due and exits. Several runners are meant to run at once against one database: claiming is a single statement on every dialect — `FOR UPDATE SKIP LOCKED` on PostgreSQL, `UPDATE ... ORDER BY ... LIMIT` on MySQL, `UPDLOCK, READPAST` on MSSQL, a subquery on sqlite, an atomic `findOneAndUpdate` per document on MongoDB — so it is its own transaction, the state is part of its own `WHERE`, and the rows it took carry a token it reads them back by. No job is ever performed twice because two runners raced.

A job that throws is retried with an exponential backoff and, once out of attempts, kept in a **dead letter queue** with its error, its stack and the history of every attempt. `henri jobs:dead`, `jobs:show <id>`, `jobs:retry` and `jobs:discard` drive it from the command line, `henri.jobs.dead.*` from the application. `henri jobs:status` gives the counts by queue and state, the timings of the finished jobs and how long the oldest due job has waited — with `--json`, like every other henri command.

Recurring jobs are declared under `jobs.recurring` in the configuration (a five-field cron expression read in UTC, or a plain `every` interval) and honoured by the runner itself, with no second process. Missed runs do not pile up: the moment that follows is computed from now, so an hour of downtime on an hourly job costs one run, not sixty.

The queue owns `henri_jobs` and `henri_jobs_schedules` and reaches them through the store adapter's own `query()` or its MongoDB collections, never through a model, so it cannot collide with the application's schema and works on a store that has no models at all. `henri jobs:install` creates the tables and is idempotent; the boot creates them too unless `jobs.install` says otherwise.

`henri.mailers.deliverLater()` now goes through it: core registers the delivery handler, and the rendered message becomes a job on the `mailers` queue, retried and visible like any other.

`app/workers` is untouched and still the right answer for a long-lived process that starts with the server. The [Jobs guide](https://usehenri.io/guides/jobs/) says when to reach for which.
