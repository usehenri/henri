---
'@usehenri/core': minor
'@usehenri/jobs': minor
'@usehenri/cli': minor
---

The queue and the version table know which tenant a row belongs to.

`henri_jobs` gains a `tenant` column. `henri.jobs.perform()` stamps the tenant
of the request or job it was called from, the way `henri.webhooks.emit()`
already defaults its `owner`, and **the runner enters that tenant before it
calls `perform()`** — so a job that touches a tenanted model no longer needs a
first line putting the tenant back, and forgetting it is no longer a job that
dies in the dead letter queue. A row with no tenant enters no scope, because
null is not every tenant: a recurring occurrence, a job enqueued from a script,
one enqueued with `tenant: null` and every row that predates the column all
behave exactly as they did. Naming a different tenant while one is in scope is
`HENRI_TENANT_CROSS_WRITE`. `henri jobs:list --tenant`, `jobs:dead`,
`jobs:retry --all`, `jobs:discard --all` and `jobs:perform` take it, `jobs:show`
prints it and every `--json` job carries it. A batch carries the tenant it was
made in, so its callback is performed there too.

`henri_versions` gains one as well, read off the record's own tenant column
rather than off the scope, so a sweep running across every customer still names
the right one. `henri.versions.list()`, `count()`, `of()` and `get()` are
narrowed to the tenant in scope and **refused** (`HENRI_TENANT_REQUIRED`) when
there is none — a table of everybody's old values is read the way a tenanted
model is. `restore()` on a record that is _gone_ creates it, and a create is
stamped with the tenant in scope, so restoring another tenant's version (or one
written before the column existed) is `HENRI_VERSION_CROSS_TENANT` rather than
that record quietly appearing here. `henri versions`, `versions:show` and
`versions:restore` run across every tenant like the operator commands they are,
take `--tenant`, and reify as the tenant the row names.

`henri privacy:export`, `henri privacy:erase` and `henri retention:sweep` now
walk the models inside `henri.tenancy.unscoped()`. They were unusable on a
tenanted model before this: from a command line there is no tenant in scope, so
the first model call raised `HENRI_TENANT_REQUIRED`.

**An application with no `config.tenancy` is unaffected**: no column is asked
for, nothing is stamped, nothing is narrowed and there is no boot line. Both
columns arrive through the tolerated `ALTER` of the idempotent install, and both
stores ask the table rather than trusting it ran — so an application that turned
tenancy on and whose table cannot hold the column fails the boot naming it
(`HENRI_JOB_TENANT_UNINSTALLED`, `HENRI_VERSION_TENANT_UNINSTALLED`) instead of
writing rows nothing can scope. For most people the upgrade is the next deploy.
