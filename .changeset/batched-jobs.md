---
'@usehenri/jobs': minor
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/cli': minor
---

Job batches: forty jobs, and one that runs when they are all done.
`henri.jobs.batch({ callback, args, jobs })` enqueues them and seals the batch,
or takes a function that adds them itself for a list too long to write out. The
callback is an ordinary job of `app/jobs` and is handed the counts under
`batch`.

A batch **finishes**, it does not succeed: the callback runs once every job has
reached a terminal state, `dead` included, so a batch that half failed still
calls it and `failed` is a number to branch on. It runs **exactly once**, and
never before the last job is terminal. `total` is written once, when the batch
is sealed; `done` is advanced by a single `SET done = done + 1` guarded by the
claim token of the attempt that wrote the outcome, so the counter is never read
into the process to be written back and it moves for exactly one runner — the
one whose outcome landed. The callback is then enqueued under a unique key of
the batch's own, which makes settling idempotent, and the runner's sweep counts
the rows of a batch nothing else could count (a runner killed between an
outcome and its count, a job the recovery buried).

An existing queue gains one column and one table, added by the same idempotent
`henri jobs:install` the boot already runs and tolerated the same way: an
application that makes no batch is unaffected, and `batch()` on a store that has
neither is refused (`HENRI_JOB_BATCH_UNINSTALLED`) rather than counting nowhere.

`henri jobs:batches`, `henri jobs:list --batch <id>`, `henri jobs:status` and
`henri.jobs.batches.*` are how a batch is read back.
