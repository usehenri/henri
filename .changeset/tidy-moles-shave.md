---
'@usehenri/core': minor
'@usehenri/cli': minor
'@usehenri/jobs': minor
'@usehenri/drizzle': patch
'@usehenri/mongoose': patch
'@usehenri/sequelize': patch
---

Retention, and the access trail.

A model now says how long it keeps its records, in its options:

```js
options: {
  retention: { action: 'anonymize', after: '2y', from: 'decidedAt' },
},
```

`action` is one of the three verbs henri already had -- `delete`,
`soft-delete` (only on a `paranoid` model) and `anonymize` (exactly what an
erasure writes) -- and `from` is the date column the clock starts on, which
is rarely `createdAt`. A record whose `from` is null never ages out and is
counted separately. A model with more than one class of records writes a
list of named rules with a `where` each.

`henri.retention.sweep()` enforces them and needs nothing installed:
`henri retention:sweep --yes` is what a cron line runs, and with
`@usehenri/jobs` installed `config.retention.schedule` registers the
recurring `henri/retention` job. The boot says which of the two it is, by
name, so a rule nothing applies is never silent.

Two things stand between a wrong rule and a deleted table: a rule writes
nothing until its token is in `config.retention.approved` (a line in the
configuration, so a person, a diff and a review), and
`config.retention.batch` bounds one run. `henri retention:sweep` without
`--yes` plans, counts and prints, and writes nothing. Every sweep leaves a
receipt in `config.retention.receipts`.

`config.trail` turns on the access trail: an append-only, hash-chained
record of who read or changed personal data, in a table henri owns. It
records the export, the erasure, every retention sweep and -- with
`trail.reads` -- the answers henri serializes; `henri.trail.record()` is how
an application adds its own. It holds field names, counts, public
identifiers and digests, and refuses anything else
(`HENRI_TRAIL_VALUE_REFUSED`). `henri trail`, `henri trail:about <who>` (which
answers from an address whose digest is all that is stored) and
`henri trail:verify` read it back.

`henri.jobs.recur(name, entry)` is the seam a framework module uses to ask
for a schedule the configuration did not write; an entry the application
declared under the same name still wins.

The drizzle adapter no longer offers to drop the tables henri owns
(`henri_jobs`, `henri_jobs_schedules`, `henri_trail`): a push that obeyed
would have taken an application's job history or its audit trail with it.
