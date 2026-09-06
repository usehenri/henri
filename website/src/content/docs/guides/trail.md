---
title: The access trail
description: An append-only, hash-chained record of who read or changed personal data -- what it records, what it must never hold, and how to read it back.
---

**Read this paragraph before turning it on.** The trail records the
operations henri performs itself on personal data -- the export, the erasure,
the retention sweeps -- and, when you ask for it, the reads that leave
through the answers henri serializes. It does **not** record what your own
code does with your own model calls. A trail with holes in it reads as
evidence and is not, so the boundary is stated here rather than implied:
`henri.trail.record()` is how everything on your side of it gets in.

```json
{ "trail": {} }
```

That is the whole setup. henri creates a table at boot and appends to it. The
trail is off until this key is there, and off means off: no table, no
statement, no cost.

## What is recorded

**The operations henri owns.** Core owns every one of these call sites, so
this half is complete by construction -- there is no way to run
`henri privacy:erase` without an entry, and a refusal is written down too:

| Action            | When                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `privacy.export`  | `henri privacy:export`, or `henri.privacy.export()`                   |
| `privacy.erase`   | `henri privacy:erase`, including dry runs and refusals                |
| `retention.sweep` | one entry per rule, every sweep (see [Retention](/guides/retention/)) |
| `trail.pruned`    | the checkpoint a prune leaves behind                                  |

**Reads, when you ask for them.** `config.trail.reads` turns on one entry per
answer henri serializes -- `res.resource()`, `res.collection()` and
`res.render()`, which are the three places henri turns records into a
payload:

```json
{ "trail": { "reads": "personal" } }
```

`"personal"` records the answers carrying a model that has a field marked
`personal`; `"all"` records every answer. Each recorded read costs a round
trip and an insert, and a read that cannot be recorded is not sent -- an
audit trail that fails open is not one. Leave it off unless you want it.

**Everything else is yours.** A controller that reads with a model call and
answers with `res.json()` is outside the boundary:

```js
await henri.trail.record({
  action: 'app.exported',
  model: 'Proposal',
  records: rows.length,
  ids: rows.map((row) => row.externalId),
  meta: { format: 'csv' },
});
```

## What it must never hold

No values. Ever. An entry holds field **names**, counts, public identifiers
(`externalId`, which is already what leaves the server) and digests -- never
a name, an address, a phone number or the contents of anything.

That is enforced, not documented. The `meta` of an entry goes through a guard
that refuses:

- a key that is a field the models marked `personal`;
- a key masked by `config.filterParameters`;
- a value that is not a short scalar, or a string longer than 200 characters;
- a string that looks like an email address.

```js
await henri.trail.record({ action: 'app.thing', meta: { name: 'Ada' } });
// HENRI_TRAIL_VALUE_REFUSED: the trail refuses to record "name": it is a
// field the models marked personal
```

The worst possible outcome for a feature that records who read personal data
is a second copy of it, so the failure is loud rather than a truncation.

The person an entry is about is named the way an erasure receipt names them:
their `externalId` when they have one, and an HMAC of their address keyed
with `config.secret`. The address itself is never in the table -- which is
what makes the trail survive the erasure it recorded.

### It records no address, and is not going to

An IP address is a value about a person, and this table refuses values. It
would also be the one place holding personal data that an erasure cannot
reach: the entries are hash-chained, so a row written over breaks the chain
that makes the trail evidence in the first place. Where a request came from
belongs in [the call log](/guides/calls/#the-clients-address), which holds
values on purpose, is kept for days rather than a year, and can be erased.

## How it stays append-only

A database will happily let anyone `UPDATE` a row, so "append-only" is not a
promise the application layer can make. What it can do is make an edit
**visible**.

**henri only ever `INSERT`s and `SELECT`s.** There is no `UPDATE` in the
code that reaches this table. The one `DELETE` is the prune below.

**Every entry is numbered under a unique index.** `seq` is one more than the
last. Two processes appending at the same moment do not fork the chain: one
insert wins, the other is refused by the index, re-reads the head and chains
onto it.

**Every entry is hashed onto the one before it.**

```
hash = HMAC-SHA256(config.secret, prev + canonical(entry))
```

Change a field of an old row, or take a row away, and every hash after it
stops following. `henri trail:verify` walks the chain and says where:

```
The chain is broken at seq 4812 (hash).
Everything up to seq 4811 verifies.
```

The key is `config.secret`, so re-chaining the tail is not something a stolen
database connection can do.

**And then do the real thing.** Tamper-evidence is the fallback; the strong
form is the one the database enforces. Grant the application role
`INSERT, SELECT` on this table and nothing else:

```sql
REVOKE UPDATE, DELETE ON henri_trail FROM app;
GRANT INSERT, SELECT ON henri_trail TO app;
```

(with `config.trail.keep: false`, so nothing tries to prune).

## Its own retention

A record of who touched personal data is personal data. `config.trail.keep`
is a year by default, and the [retention sweep](/guides/retention/) is what
enforces it.

A prune takes a **prefix** of the chain -- the oldest entries, up to and
including the newest one past the cutoff -- and then appends a
`trail.pruned` checkpoint carrying the hash of the last entry it removed. A
hole in the middle of the sequence would be a break nothing can explain; a
prefix plus a checkpoint leaves a chain that still verifies from a known
link.

## Reading it back

A query surface is part of the feature, not a follow-up. The two questions an
application actually has to answer:

**"Prove the erasure happened."**

```bash
henri trail:about ada@example.com
```

```
Everything recorded about ada@example.com

    841  2026-09-04T09:12:02.881Z  privacy.erase      ok            3 User
         actor 0192f3c1-...  receipt=6f2a... strategy=anonymize dryRun=false
    712  2026-08-30T14:02:55.104Z  privacy.export     ok            9 User
```

The address is not in the table. henri digests what you asked about and looks
for that, which is why this still works after the erasure took the address
away.

**"Who saw this record?"**

```bash
henri trail --model=Proposal --action=record.read --since=2026-08-01
```

And from the application:

```js
await henri.trail.list({ action: 'privacy.erase', limit: 50 });
await henri.trail.count({ model: 'Proposal', since: '2026-08-01' });
await henri.trail.about(user);
await henri.trail.verify();
```

## The commands

```bash
henri trail                             # the latest entries
henri trail --action=privacy.erase      # every erasure this application performed
henri trail --model=Proposal --limit=100
henri trail:about ada@example.com       # everything recorded about one person
henri trail:verify                      # whether anything was edited or removed
henri trail --json                      # the same, as data
```

All of them boot the models only: no port is bound and no route is
registered.

## What is not here

- **Reads your own code performs.** henri hooks the three places it
  serializes records itself. A model call in a controller is invisible to it,
  and `henri.trail.record()` is the way in. This is the one limit worth
  repeating.
- **A second database.** The trail lives in one of `config.stores`, and its
  writes are on the request path when `reads` is on. Recording every read of
  every row is not what this is for.
- **Shipping the entries somewhere.** There is no exporter. `henri trail
--json` and `henri.trail.list()` are what a log shipper or a report reads.
- **The values themselves.** An entry holds names, counts and identifiers,
  and a `meta` carrying a value is refused. What a request sent and what it
  got back is a [call log](/guides/calls/), which is the deliberate opposite
  of this one: it holds values, it is sampled rather than complete, and it is
  not evidence of anything.
