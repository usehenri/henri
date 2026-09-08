---
'@usehenri/jobs': minor
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/cli': minor
---

Per-job concurrency limits. `henri jobs --concurrency` bounds a runner; a job
now bounds itself across every runner: `concurrency: 1` for one at a time,
`concurrency: { limit: 3, key: 'tenantId' }` for three per key, and `group` for
several jobs sharing one bound. The permit is taken before the work, from a
table the queue owns whose primary key is the bound — the one primitive that
means the same thing on PostgreSQL, MySQL, MSSQL, sqlite and MongoDB, which an
in-claim `COUNT(*)` does not. The claim statement keeps its shape and an
application with no limited job sends the one it always sent.

An existing queue gains one column, added by the same idempotent
`henri jobs:install` the boot already runs. It is tolerated: an application
with no limited job is unaffected whether it applied or not, and one that
declares a limit whose table cannot hold it refuses to start
(`HENRI_JOB_LIMIT_UNINSTALLED`) rather than running unbounded. A job already in
the queue when the limit was declared is bounded too.

`henri jobs:status` and `henri.jobs.limits()` report what was asked for and
which slots are held. The guide says why henri mounts no dashboard, and what
to build one from.
