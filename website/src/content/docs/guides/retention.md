---
title: Retention
description: A model says how long it keeps its records, and henri sweeps -- deleting, hiding or anonymizing, on a schedule, and never before somebody approved the rule.
---

An [erasure](/guides/privacy/) answers a person who asked. Retention answers
nobody: it is the promise the privacy policy already made -- _"we keep
proposals for two years"_ -- and the only way to keep that promise is for
something to run while nobody is watching.

So the rule goes where the promise is about, in the model:

```js
// app/models/Proposal.js
module.exports = {
  options: {
    retention: {
      action: 'anonymize',
      after: '2y',
      from: 'decidedAt',
    },
  },
  schema: {/* ... */},
};
```

`henri retention` prints every rule the application declares, the way
`henri routes` prints the routes:

```
Proposal:default              anonymize    2y after decidedAt
                              PENDING      Proposal:default:9f3c1a2b4d5e

1 rule(s) write nothing until they are approved. Add to config/<env>.json:

  "retention": { "approved": [
    "Proposal:default:9f3c1a2b4d5e"
  ] }

Nothing runs the sweep on its own: henri retention:sweep --yes
```

That output is the whole feature in miniature: what the rule does, whether
anybody approved it, and what is -- or is not -- going to run it.

## What a rule says

| Key      | Default       | What it means                                                                                       |
| -------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `after`  | required      | How long the records are kept: `'90d'`, `'18mo'`, `'2y'`, or a number of milliseconds.              |
| `from`   | `'createdAt'` | The date column the clock starts on.                                                                |
| `action` | `'delete'`    | What happens when the time is up: `delete`, `soft-delete` or `anonymize`.                           |
| `where`  | none          | The condition picking the class of records this rule is about.                                      |
| `name`   | `'default'`   | Names the rule, in the reports, the receipts and `--only`. Required once a model has more than one. |

A model with more than one class of records writes a list:

```js
options: {
  retention: [
    { after: '30d', name: 'drafts', where: { state: 'draft' } },
    { action: 'anonymize', after: '2y', from: 'decidedAt', name: 'decided' },
  ],
},
```

A rule henri cannot carry out **fails the boot** rather than sweeping under
it: `after` that cannot be read (or is under a minute), a `from` that is not
a date column, `soft-delete` on a model without `paranoid: true`, or
`anonymize` on a model that marks nothing `personal`. That last one matters:
an anonymize with nothing to write over would touch no field and report
success, which is the worst thing a compliance feature can do.

## The three verbs, and no fourth

henri already has three ways for a record to go away, and retention uses
those three:

- **`delete`** -- the row goes, for real, `deletedAt` stamp or not. A soft
  delete is a hidden row, and a hidden row is still held.
- **`soft-delete`** -- the row is stamped `deletedAt` and stops being
  returned. Only on a model that declared `options: { paranoid: true }`;
  asking for it anywhere else is refused rather than quietly turned into a
  delete, because _"we removed it after 90 days"_ and _"we hid it after 90
  days"_ are different sentences.
- **`anonymize`** -- exactly what an erasure writes. The fields marked
  `personal` get the values of the erasure, and the row, its counts and
  every foreign key pointing at it survive.

## The clock

`from` defaults to `createdAt`, and `createdAt` is usually the wrong answer.
A record's clock rarely starts when the row was inserted:

- a proposal is kept for two years **after the decision**;
- an account for a year **after it closed**;
- a booking for seven years **after the stay**.

Naming the column is how the model says which event starts the clock, and it
is the single most important thing in a rule.

A record whose `from` column is `null` has not started its clock and is
**never swept** -- an open ticket does not age out. The plan counts those
separately, as `waiting`, so a rule that quietly matches nothing is visible
rather than reassuring:

```
Ticket:closed                 delete            0 of      0 past 2026-06-08T...
                              0 written         0 left for the next run, 41203 waiting
```

Forty-one thousand tickets waiting on a `closedAt` nothing sets is a bug in
the application, and this is where it shows up.

## Two things stand between a wrong rule and a deleted table

A wrong retention rule deletes production data on a schedule, quietly, for as
long as nobody looks. henri makes that hard on purpose.

### A rule nobody approved never writes

Every rule has a token -- `Model:rule:<digest of its terms>` -- and a sweep
applies a rule only when `config.retention.approved` holds it. A new rule, or
a rule whose `after`, `from`, `action` or `where` changed, is **pending**: it
is planned, counted and reported, and it writes nothing.

Approving is a line in `config/<env>.json`, which means a person, a diff and
a review:

```json
{
  "retention": {
    "approved": ["Proposal:decided:9f3c1a2b4d5e"]
  }
}
```

The token is a plain digest of the rule's terms, not a keyed one, so it means
the same thing on a laptop, in the test suite and in production;
`henri retention` prints the one to paste. It is an identifier, not a
capability -- anybody who can add a token to the configuration can also set
`approve: false`. Change `'2y'` to `'2h'` and the token changes with it -- the rule is
pending again, and the sweep that would have taken the table out does
nothing instead.

`config.retention.approve: false` gives that up, deliberately, for an
application whose deployment is the review.

### A run is bounded

`config.retention.batch` (`1000`) is how many records one rule may take in
one sweep. The rest is reported as `remaining` and taken by the next run, so
a genuine backlog drains over a few nights and a mistake cannot empty a table
in one pass. `false` lifts the bound.

And the command is a rehearsal unless it is told otherwise:
`henri retention:sweep` plans, counts and prints, and writes nothing. `--yes`
is the only thing that lets it write.

## What runs it

The sweep is core and needs nothing installed. Three things call it:

**From cron**, which is what an application without the queue does:

```
0 3 * * * cd /srv/app && henri retention:sweep --yes
```

**From the queue**, when the application depends on
[`@usehenri/jobs`](/guides/jobs/). Set a schedule and henri registers the
recurring `henri/retention` job itself:

```json
{ "retention": { "schedule": "0 3 * * *" } }
```

**From the application**, on a page of its own:

```js
const receipt = await henri.retention.sweep({ only: 'Proposal' });
```

The queue is a package an application installs, so henri never assumes it.
The boot line says which of the three it is, by name:

```
retention  2 rules  nothing runs them here: @usehenri/jobs is not part of this boot,
                    so cron runs "henri retention:sweep --yes"  1 not approved: they
                    plan and write nothing
```

A rule that nothing applies is a promise nobody keeps, and the boot log is
where you find that out.

## What proves it ran

A receipt, in `config.retention.receipts` (`privacy/`, next to the erasure
receipts), naming every rule, what it did and what is left:

```json
{
  "version": 1,
  "at": "2026-09-06T03:00:00.412Z",
  "dryRun": false,
  "interrupted": false,
  "pending": 0,
  "rules": [
    {
      "model": "Proposal",
      "rule": "decided",
      "action": "anonymize",
      "cutoff": "2024-09-06T03:00:00.412Z",
      "matched": 128,
      "would": 128,
      "written": 128,
      "remaining": 0,
      "waiting": 41,
      "fields": ["notes"],
      "sample": ["0192f3c1-...", "0192f3c2-..."],
      "token": "Proposal:decided:9f3c1a2b4d5e"
    }
  ]
}
```

`sample` is up to twenty public identifiers -- a sample, never an index. A
receipt is proof that an operation happened, not a copy of the rows it
touched.

With the [access trail](/guides/trail/) on, every rule is also one appended,
hash-chained entry, which is how `henri trail --action=retention.sweep`
answers "what has this rule ever done".

## Being interrupted

A sweep is not a transaction and does not need to be one. Every rule is a
query over the age of a row, so a sweep that dies halfway leaves the rest
exactly as the next sweep will find it: it is a filter, not a cursor. A rule
that throws stops that rule and nothing else -- the receipt marks it `failed`
and the sweep as `interrupted`, and the rules that could run did.

## The commands

```bash
henri retention                              # the rules, and which are approved
henri retention:sweep                         # what a sweep would do; writes nothing
henri retention:sweep --yes                   # sweep, for real
henri retention:sweep --yes --only=Proposal   # one model
henri retention:sweep --only=Proposal:drafts  # one rule of it
henri retention --json                        # the same, as data
```

All of them boot the models only: no port is bound and no route is
registered.

## The trail's own retention

The [access trail](/guides/trail/) is a record of who touched personal data,
which makes it personal data too. It has its own retention
(`config.trail.keep`, a year by default), and the retention sweep is what
enforces it: a non-dry sweep prunes the trail and leaves a checkpoint behind
so what remains still verifies.
