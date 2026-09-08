---
title: Model versions
description: The history of a record, kept row by row -- what changed, who changed it, and how to put it back. Opt-in per model, and nothing at all until a model asks.
---

A model says so, and henri keeps its history:

```js
// app/models/Article.js
module.exports = {
  options: { versioned: true },
  schema: {
    body: { type: 'text' },
    published: { default: false, type: 'boolean' },
    title: { required: true, type: 'string' },
  },
};
```

From then on, every create, update and delete of an `Article` writes one row
into a table henri owns: when it happened, which record, what changed from
what to what, who did it and during which request.

```
$ henri versions Article

  2026-03-04T10:12:44.918Z  update   Article 018f2a41-...-7000-...
    01a077c7-...  actor 018f0a11-...  request 4f2c...
    title: The old headline -> The new headline
    published: false -> true
```

**Nothing above is true of a model that did not ask.** No table is created,
no hook is registered on any model, no middleware is mounted and the boot
says nothing. An application with no versioned model pays nothing for this
page, which is the same bargain [the call log](/guides/calls/) makes.

## This is not the access trail

henri has three records and they are deliberately different things. Reaching
for the wrong one is the mistake worth avoiding, so:

|                                    | answers                          | holds                                                                    | kept for                 |
| ---------------------------------- | -------------------------------- | ------------------------------------------------------------------------ | ------------------------ |
| [The access trail](/guides/trail/) | who saw this record              | field _names_, counts, identifiers, digests — and it **refuses a value** | a year                   |
| [The call log](/guides/calls/)     | what did this request do         | the bodies of the exchange, sampled                                      | days                     |
| **Versions**                       | what did this record used to say | **the values themselves**, completely                                    | as long as you keep them |

Versions exist to hold the values. That is not a compromise, it is the
feature: without the old value there is no reconstructing the record, and
without that this is a worse trail. What it costs is the rest of this page.

## What a row holds, per event

- **`create`** — `changes` is `{ field: [null, value] }` for every stored
  field the record was created with. No snapshot: the `new` side of the
  diff already _is_ the whole record.
- **`update`** — `changes` is `{ field: [old, new] }` for the fields that
  moved, and nothing else. **A soft delete is one of these**: the row is
  still in the table with `deletedAt` set, so the diff describes it exactly.
- **`destroy`** — the row leaving the database. `changes` is empty and
  `snapshot` holds every stored field. This is the one event where a diff
  is not enough, and the reason is the rule: a diff describes a change _to
  something_, and after a real delete there is no something left to
  describe or to fold back from.

Every row also carries the record's **`externalId`** and never its primary
key — the public identifier is the one that leaves the server, and a version
table full of primary keys would undo that (see
[Models](/guides/models/#identifiers)).

The two columns henri does not repeat are `createdAt` and `updatedAt`: the
version's own moment already says both.

## Who did it

`actor` is the `externalId` of the person who was signed in, and
`requestId` is the id henri already threads through the logs and the call
log — so a version joins to both without anything in your code carrying a
name around:

```js
// Four calls deep in a service, with no idea versioning exists
article.title = 'The new headline';
await article.save();
```

Outside a request there is nobody signed in, and henri says so rather than
guessing: `actor` is `null` and `source` is `system`. A job, a console
session, a seed or a task that knows better says so for the length of a
call:

```js
await henri.versions.acting({ actor: user, source: 'job' }, async () => {
  await article.update({ published: true });
});
```

It is an async context rather than a setting, so two jobs running at the
same moment in one process never claim each other's actor. `source` is one
of `console`, `http`, `job`, `seed`, `system` and `task`.

## Narrowing what is kept

```js
options: {
  versioned: {
    only: ['title', 'body'],          // ... or `except: ['viewCount']`
    events: ['update', 'destroy'],    // creates are not worth a row here
  },
}
```

`only` and `except` are exclusive, and anything henri cannot carry out
fails the boot naming the model and the key
(`HENRI_VERSION_INVALID_OPTION`) rather than versioning something other
than what you wrote down.

## What is never stored

A version table holds values, so what it must **not** hold is a rule rather
than a habit. In this order:

1. **A field the model left out** (`only` / `except`) is not stored and not
   even named.
2. **`password` is never stored**, on any model, whatever
   `filterParameters` says. It is named as changed and its values are not
   kept.
3. **A field marked `encrypted`** is stored as its
   [envelope](/guides/encryption/) and never as its plaintext, on both
   sides of the change. henri writes the envelope with the field's own
   context, so it opens exactly where the row's does — it is a re-wrap
   rather than a byte copy, which is why a deterministic field gives the
   same bytes and a randomised one does not.
4. **A name `config.filterParameters` matches** (the same substring test
   your logs use) is not stored. A token in a version table is a live
   token.

A field whose values are not kept appears in `changes` as `null` rather
than a masked string:

```json
{ "title": ["The old headline", "The new headline"], "password": null }
```

That is deliberate. A mask is a value, and `restore()` would write it into
the column.

### Personal fields are stored, and here is the argument

A field marked `personal` **is** stored, values and all. Dropping them
would have been the version that looks safer: it would also have emptied
the history of exactly the models worth versioning — who changed this
person's address, and to what — which is the question the feature exists to
answer.

So henri does not pretend a version is not personal data. It makes it
_reachable_, which is the part that can be checked:

- `henri privacy:erase` reaches these rows (below);
- `henri privacy:export` hands a person the history held about them,
  alongside the records themselves;
- the retention sweep prunes them (`versions.keep`, below).

If a particular column is one you would rather not keep a history of, name
it in `except`.

## Reading it back

From a record, from the model, or from the command line:

```js
const history = await henri.versions.of(article);
const lately = await henri.versions.list({
  event: 'destroy',
  model: 'Article',
});
const mine = await henri.versions.list({ actor: user.externalId });
const during = await henri.versions.list({ requestId: req.id });
```

```bash
henri versions Article                      # the latest changes
henri versions Article 018f2a41-...         # the history of one record
henri versions --actor=018f0a11-... --json  # what one person changed
```

## `reify` and `restore`

They are the two halves and the difference is the whole design:

```js
const { attributes, complete, missing } = await henri.versions.reify(version);
```

**`reify` reads.** It answers the record as it was immediately after that
version was written, and it touches nothing. It folds **backwards** — from
the live record, undoing every version newer than the one you asked for.
Backwards, because the live row is the one thing that is certainly
complete: folding forwards from the create would look simpler and answer a
record that never existed the first time a version was pruned, or the first
time a model was versioned after its rows already existed. A destroyed
record folds from the snapshot of its `destroy` instead.

Because it is a read, it may be partial and says so: `complete` is false
and `missing` names the fields whose values were not kept.

```js
const { record, created } = await henri.versions.restore(version);
```

**`restore` writes.** It reifies and puts that back — an update on a record
that still exists, an insert under the **same `externalId`** on one that
was destroyed, so every url, link and foreign key that named it still names
it. And it **refuses an inexact reconstruction**
(`HENRI_VERSION_INCOMPLETE`) unless you pass `{ force: true }`: a read that
is missing a field lets you see the gap, and a write that is missing one
would silently change the record to something it never was.

A restore is a change like any other, so it is itself recorded.

```bash
henri versions:show <id>              # what it was, without touching it
henri versions:restore <id>           # write it back
henri versions:restore <id> --force   # ... even if a field kept no values
```

## Mass updates, and why they are refused

This is where a version table lies to you if you let it.
`Model.update(where, attrs)` runs the hooks **once and without instances**,
so a naive implementation records nothing for a hundred changed rows. A
history that silently misses changes reads as evidence and is not, so henri
refuses:

```js
await Article.update({ published: false }, { archived: true });
// HENRI_VERSION_MASS_WRITE: Article keeps versions, so Article.update()
// over a condition is refused ...
```

Recording one entry per row was the other option, and it was declined
twice over: it turns an update into a full read of every matching row — a
cost nobody wrote down — and the read and the update are not one statement,
so a row that changed in between would be recorded with a diff that never
happened.

The refusal names the two ways through, and both are decisions rather than
silences:

```js
// Loop, and each record is versioned
for (const article of await Article.find({ published: false })) {
  await article.update({ archived: true });
}

// ... or say out loud that this write is not to be versioned
await Article.update(
  { published: false },
  { archived: true },
  {
    versions: false,
  }
);
```

On a Sequelize store, `{ individualHooks: true }` is honoured as its own
answer: Sequelize loads the rows and runs the instance hooks, which is
exactly what a version needs. A **mass create** is never refused, because a
create has no before state: the records it answers are the whole of what a
version would hold, so nothing is lost.

henri's own sweeps say `{ versions: false }` deliberately. An erasure
writing a version would hold the very values the erasure removed.

## Erasure

`henri privacy:erase` reaches the version table, and what it does there
follows what it did to the record. `config.versions.onErase`:

- **`follow`** (the default). A record the erasure **deleted** takes its
  versions with it — nothing they describe exists any more. A record that
  **survives** (anonymized, orphaned) keeps its history, and the _values_
  of the erased fields are taken out of it in place. That is the only
  answer that leaves an article's edit history intact and its author's old
  name gone.
- **`delete`**. Every version of every record the erasure touched goes.
- **`retain`**. They are left alone, and the receipt says so. This is the
  one for a history a regulator requires: an omission that is written down
  is a decision, an omission that is silent is a leak.

In every case the person stops being an **actor**: a version they wrote on
somebody else's record keeps the change and forgets who made it.

The receipt carries what happened, so `henri privacy:erase --json` shows it
alongside the records.

## Retention

A version holds old values, so it has its own retention:

```json
{ "versions": { "keep": "2y" } }
```

Unset (the default) keeps them for as long as your application does, and
the boot line says which it is. The [retention sweep](/guides/retention/)
is what prunes them, so `henri retention:sweep --yes` takes the old ones
away along with everything else.

## Tenants

If the application is [multi-tenant](/guides/multi-tenancy/), every version
carries the tenant of the record it is about, and `henri.versions` is scoped
exactly the way a tenanted model is.

**The tenant is read off the record, not off the scope.** A version describes a
record, and whose record it is is written on the record — so a sweep that runs
`henri.tenancy.unscoped()` over every customer still writes rows that name the
right one. A model with no `options.tenant` is shared and its versions name no
tenant, which is the correct answer rather than a gap.

**A read is narrowed, and a read with no tenant is refused.** Inside a tenant,
`list()`, `count()`, `of()` and `get()` answer that tenant's rows and the rows
of no tenant; outside one, with tenancy on, they raise `HENRI_TENANT_REQUIRED`
rather than handing back every customer's old values. That is
`HENRI_POLICY_SCOPE_REQUIRED`'s instinct again: a table nobody narrowed is
everybody's rows. `henri.tenancy.unscoped()` is the one way past, and it is what
an operator report says out loud.

```js
// a history page: already inside the tenant of the request
const history = await henri.versions.of(invoice);

// a cross-tenant report: says so
const lately = await henri.tenancy.unscoped(() =>
  henri.versions.list({ limit: 100 })
);
```

A version of another tenant's record answers `null` from `get()` rather than a
refusal — `Model.findById()`'s own answer, because "it is there but not yours"
is the oracle a 404 exists to close.

**A restore that creates is refused across the boundary.** `restore()` on a
record that still exists is an update, and the model layer already only found
this tenant's row. On a record that is **gone** it creates one, and a create is
stamped with the tenant in scope — so restoring somebody else's version would
materialize their old values as your row, under their identifier. That is
`HENRI_VERSION_CROSS_TENANT`, and `henri.tenancy.unscoped()` is how a record is
deliberately moved.

The three commands run across every tenant, because an operator at a shell holds
the database and means all of them; `--tenant` narrows them to one, and
`versions:show` and `versions:restore` run **as the tenant the row names**,
which is what makes them work at all on a tenanted model:

```bash
henri versions Invoice                    # every tenant
henri versions Invoice --tenant acme      # one
henri versions:show <id>                  # reified as the tenant of the row
henri versions:restore <id> --tenant acme
```

### The column, and an upgrade

`tenant` is a column on `henri_versions` and arrives the way the queue's own
late columns do: an idempotent `ALTER` inside the install, **tolerated**, with
the store asking the table rather than trusting the statement ran. For most
people that is the next deploy and nothing else.

- An application that is **not multi-tenant is not affected at all**: nothing is
  stamped, nothing is narrowed, and the insert names the columns that are there.
- An application with `config.tenancy` on whose table cannot hold the column
  **fails the boot** with `HENRI_VERSION_TENANT_UNINSTALLED`. A history nothing
  can scope is worse than one that refuses to start: with every row null, a read
  narrowed to a tenant is every tenant's rows.

  ```sql
  ALTER TABLE henri_versions ADD COLUMN tenant VARCHAR(190) NULL;
  ```

- **The rows written before the column are null**, and a null row is nobody's —
  which means every tenant's listing shows them. That is deliberate: null is
  also what a shared model's history looks like, and hiding those rows from
  everybody would lose it. If that matters, backfill them once from the records
  they name, which is the only place the answer exists:

  ```sql
  UPDATE henri_versions AS v
     SET tenant = (SELECT i.tenant_id FROM invoices AS i
                    WHERE i.external_id = v.record)
   WHERE v.model = 'Invoice' AND v.tenant IS NULL;
  ```

  A row whose record has since been deleted cannot be backfilled, and
  `versions:restore` refuses it rather than guessing.

- On MongoDB there is nothing to upgrade: a document simply has no such field.

## Where the rows live

One table henri owns (`henri_versions`), reached through the store adapter
or the MongoDB collection and never through a model — the way the queue and
the access trail own theirs. It works on sqlite, PostgreSQL, MySQL, SQL
Server and MongoDB.

```json
{
  "versions": {
    "keep": "2y",
    "onErase": "follow",
    "store": "default",
    "table": "henri_versions"
  }
}
```

None of those keys turns versioning on. A model does.

On a Drizzle store the table is created through raw SQL, so drizzle-kit
would otherwise offer to drop it; `Drizzle#reservedTables()` is what stops
that, and it reads `versions.table` from your configuration.

## What this is not

- **Not an audit log of reads.** Nothing is recorded when a record is
  looked at. That is [the access trail](/guides/trail/), and it is a
  different table with different rules.
- **Not a branch, a merge or a draft.** A version is what one change did.
  Reconstructing an old state is `reify`, and writing it back is a new
  change like any other.
- **Not a way to undo a schema change.** A version holds the columns the
  model had when it was written; a column that has since been dropped
  cannot be restored into a table that has no room for it.
- **Not free.** Every write on a versioned model costs an insert, and a
  single-row update that has no instance in hand (a `findByIdAndUpdate`, a
  MongoDB `findOneAndUpdate`) costs a read as well. That is the honest
  price of a history, and it is paid only by the models that asked.
