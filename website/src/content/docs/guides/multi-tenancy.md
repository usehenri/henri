---
title: Multi-tenancy
description: One column, one ambient tenant, and a refusal when nobody said which -- how henri keeps one customer's rows away from another's, where the tenant of a request comes from, and what is shared anyway.
---

A model says which of its rows belong to whom:

```js
// app/models/Invoice.js
module.exports = {
  options: { tenant: true },
  schema: {
    amount: { type: 'decimal' },
    reference: { required: true, type: 'string' },
  },
};
```

and the application says where the tenant of a request comes from:

```json
{
  "tenancy": {
    "from": { "subdomain": "example.com", "user": "accountId" }
  }
}
```

From then on every query henri builds for an `Invoice` carries the tenant,
every insert is stamped with it, and a read with **no** tenant in scope is
refused rather than answered with everybody's rows.

```js
// app/controllers/invoices.js
module.exports = {
  // acme.example.com sees acme's invoices. There is no `where` to write and
  // no `where` to forget
  index: async (req, res) => res.collection(await Invoice.find()),
};
```

## The decision, and what the other two cost

There are three ways to be multi-tenant and they are not variations of one
thing.

1. **A column on every row**, scoped by a condition the framework adds.
2. **A schema, or a database, per tenant**, chosen per request.
3. **A process per tenant**, which is a deployment and not a framework
   feature at all.

henri does the first, and the reason is the model layer rather than a
preference. henri's models are one contract over three ORMs on five
databases, and a per-tenant schema is not one thing across them: on
PostgreSQL it is a `search_path`, on MySQL a database name, on MongoDB a
connection, on sqlite a file. Every one of those is a _connection_ decision,
and a henri store opens one pool at boot — so option 2 means a pool per
tenant, a migration run per tenant, and a `henri db:migrate` whose blast
radius is the number of customers you have. The column also rhymes with what
henri already had: `policy.scope(user)` is already "the list is what the
policy says it is", `options.paranoid` already adds a condition to every read
henri builds, and `@usehenri/webhooks` already gives every endpoint an
`owner` that an `emit` filters by.

**What option 2 buys, and this does not**, is a boundary the database itself
enforces. A missed condition here is a leak; there, it is a permission error.
Reach for it when a regulator, a customer contract or a residency rule asks
for separation the application cannot be trusted to implement — and expect to
own the connection routing, the migration fan-out and the backup story
yourself, because henri will not help with any of it. Option 3 is a compose
file and henri has nothing to add: one process, one `DATABASE_URL`, one
tenant, and none of this page applies.

There is no switch that does all three. henri's habit everywhere else is one
considered answer plus a documented seam, and this is the same.

## A tenant is a scope, not a permission

Read this one twice, because everything else follows from it.

Narrowing to a tenant **only ever removes rows**. It grants nothing. What a
person may do with the rows that are left is the policies' question and stays
the policies' question, exactly the way `req.filters()` intersects a client's
condition with `policy.scope(user)` and can therefore narrow a list and never
widen one.

That is what makes it safe for an anonymous visitor to arrive on
`acme.example.com`: they get acme's rows, filtered by a policy that has never
heard of tenants — which, for an anonymous visitor, is usually nothing at
all. Tenancy is not a replacement for `app/policies`. It is a floor under
them.

## Turning it on

Two things, and they are separate on purpose.

**`config.tenancy`** says the application is multi-tenant, and where the
tenant of a request comes from. Its absence — the default — means none of
this exists: no column is added to any model, no condition is compiled, no
middleware is mounted and there is no boot line.

| key       | default    | what it says                                              |
| --------- | ---------- | --------------------------------------------------------- |
| `column`  | `tenantId` | the column henri adds to a model that says `tenant: true` |
| `from`    | see below  | where the tenant of a request comes from                  |
| `require` | `false`    | refuse a request whose tenant nothing could decide        |
| `status`  | `404`      | what a request naming somebody else's tenant answers      |

**`options: { tenant: ... }`** on a model says its rows belong to one
customer. `true` is the column `tenancy.column` names, which henri adds and
indexes; a string names a column the model already declares, which is how a
tenant can be an ordinary foreign key:

```js
// app/models/Ticket.js
module.exports = {
  options: { tenant: 'accountId' },
  schema: {
    // A column of its own, with everything a column of its own gets: a
    // `ref` publishes it as the account's externalId on the way out
    accountId: { index: true, ref: 'Account', type: 'string' },
    subject: { type: 'string' },
  },
};
```

A named column the schema does not declare fails the boot
(`HENRI_TENANT_UNKNOWN_COLUMN`), rather than leaving a table nobody scoped.

**A model that says nothing is shared** by every tenant. That is right for a
`Plan`, a `Country` or a `Currency`, and it is a leak for anything a customer
wrote — so henri does not guess, and `henri audit` prints the list once an
application is multi-tenant (`tenancy.unmarked-model`). The point of that
finding is not that it is wrong; it is that somebody read the list.

The tenant itself is an **opaque identifier** and henri never interprets it:
at most 190 characters, starting with a letter or a digit. Whether it holds
an account's `externalId`, a slug or a customer number is the application's
business — the same position `policy.scope()`'s return value and a webhook
endpoint's `owner` already take.

## Where the tenant comes from

In one place, and visibly. `req.tenant` is the value and `req.tenantSource`
is _how it was decided_ — the way `req.localeSource` and the call log's
`ip_source` already say how their answer was reached rather than only what it
was. The order is fixed in code, and a source is on when it is configured:

| source      | what it reads                                      |
| ----------- | -------------------------------------------------- |
| `explicit`  | `req.setTenant()`, or `henri.tenancy.run()`        |
| `user`      | the column `tenancy.from.user` names on `req.user` |
| `subdomain` | the label in front of `tenancy.from.subdomain`     |
| `header`    | `tenancy.from.header.name`, from a listed proxy    |

The middleware runs **immediately after passport** and before the router, so
an action, a `before` hook, a policy and every model call underneath them all
see the same answer.

### The user's own record is second, and that is the whole argument

Everything a client can name sits _below_ the signed-in user's own record,
and when the two disagree the request is **refused** rather than served from
either (`HENRI_TENANT_MISMATCH`, a 404 by default):

```
GET https://globex.example.com/invoices     signed in as an acme user
-> 404
```

For a signed-in person a client-named tenant is a **confirmation, never an
election**. A tenant a request can pick freely is an authorization bug with
extra steps, and the reason to refuse rather than quietly prefer the user's
own is that a link which serves acme's data under globex's branding is how a
boundary stops being one.

A sign-in is the one moment the middleware cannot see, because passport puts
the user on the request after it ran — so `POST /login` asks the same
question again once the credentials check out. Signing in on the wrong
subdomain opens **no session at all**, rather than one that dies on its next
request.

### The header, and why it needs a `from`

```json
{
  "tenancy": {
    "from": {
      "header": { "name": "x-tenant", "from": ["10.0.0.0/8"] }
    }
  }
}
```

Any client can send a header, so henri believes a named one only from a proxy
the application listed — the rule `config.calls.address` already follows. A
header with no `from` **fails the boot**
(`HENRI_TENANT_HEADER_UNVERIFIABLE`), and a `from` covering everything
(`0.0.0.0/0`) is a high `henri audit` finding, because it means a client
chooses which tenant its own request is served as.

### The path prefix is deliberately not a source

`/acme/invoices` is not on that list, and it is the same refusal
[i18n](/guides/i18n/) makes for the same reason: henri's route table is the
source of both the url and the helper that prints it, so a tenant in the path
is a change to every route helper of the application rather than one more
rule here. An application that wants it mounts the prefix itself and calls
`req.setTenant()`, which is the `explicit` source and is cross-checked
against the user's own record exactly like the other two.

## The default is the refusal

This is the part worth understanding before you ship.

When a model belongs to a tenant and **nothing in scope says which**, henri
does not fall back to "all of them". It raises `HENRI_TENANT_REQUIRED` and
names the model:

```
Invoice.find() is a tenant's (options.tenant on Invoice) and nothing in
scope says which tenant. henri does not read a tenanted table without a
condition, because no condition is every tenant's rows.
```

That is `HENRI_POLICY_SCOPE_REQUIRED`'s instinct — a policy without a `scope`
throws rather than quietly meaning "everything" — applied one layer down. It
is what makes a job, a seed, a console session and a forgotten `await` fail
loudly instead of reading somebody else's rows.

A write that **names another tenant** is refused too
(`HENRI_TENANT_CROSS_WRITE`). Moving a row between tenants is one of the very
few mistakes no later request notices — the row simply appears in somebody
else's list — so henri refuses rather than obeying.

### `unscoped()` is the one way past

Not a setting. An async context, the shape `henri.encryption.tolerate()` and
`henri.versions.acting()` already have, so that it covers exactly the call it
wraps and nothing running next to it:

```js
// A report that counts every customer, and says so
const total = await henri.tenancy.unscoped(() => Invoice.count());
```

Use it for a migration, a `db/seeds.js`, an operator report, an admin console
session. Do not use it to get a request working: a request that needed it has
a resolution problem, and the refusal is where you find that out.

## A job has no request

`henri.jobs` performs work later, in another process, where there is no
subdomain, no session and no `req.user`. So the queue row carries the tenant,
henri stamps it on the enqueue and the runner enters it before it calls
`perform()`:

```js
// in the controller, inside a request that resolved to `acme`
await henri.jobs.perform('invoice-reminder', {
  invoiceId: invoice.externalId,
});
```

```js
// app/jobs/invoice-reminder.js
module.exports = {
  // Nothing to put back: the runner is already inside `acme`
  perform: async ({ invoiceId }) => {
    const invoice = await Invoice.findById(invoiceId);

    await henri.mailers.billing.reminder(invoice).deliverLater();
  },
};
```

**Null is not every tenant.** A job whose row names none — one enqueued from a
script, a [recurring](/guides/jobs/#recurring-jobs) occurrence, one enqueued
with `tenant: null`, or one that was in the queue before the column existed —
enters no scope, and the refusal fires on its first tenanted model call exactly
as it did. That is the safe half: **forgetting is loud rather than silent**, and
a job that means every tenant says `henri.tenancy.unscoped()` itself.

Naming a tenant on the enqueue wins; naming a _different_ one while a tenant is
in scope is refused (`HENRI_TENANT_CROSS_WRITE`), because a job stamped with
somebody else's tenant is performed in somebody else's data with arguments that
came from this one. A fan-out says so:

```js
await henri.tenancy.unscoped(async () => {
  for (const tenant of accounts) {
    await henri.jobs.perform('nightly-report', null, { tenant });
  }
});
```

`henri jobs:list --tenant acme`, `jobs:dead`, `jobs:retry --all` and
`jobs:discard --all` all take it, and `jobs:show` and every `--json` answer
carry it. The **claim** is deliberately not narrowed: a runner performs every
tenant's work, and a runner per customer is a scheduling feature rather than
this one. The details, including the upgrade, are in the
[jobs guide](/guides/jobs/#tenants).

The one line is still what a `henri runner` script, a `henri console` session
and a recurring sweep use:

```
henri runner "henri.tenancy.run('acme', () => Invoice.count())"
```

Two footguns worth naming. `henri.tenancy.run()` opens an async context, so
the work has to _start_ inside it — `run(tenant, async () => { ... })` is
right and so is `run(tenant, () => Model.find())`, because henri starts a
returned promise before the context closes. What does not work is stashing a
query builder and awaiting it much later somewhere else; that gets the
refusal, which is the correct answer. And the context does not survive an
event emitter you registered outside it.

## What crosses the boundary anyway

The tables henri owns are the interesting cases, and the honest answer is
different for each of them.

| table                             | per tenant?                     |
| --------------------------------- | ------------------------------- |
| your models with `options.tenant` | **per tenant**, by the column   |
| your models without one           | **shared**, deliberately        |
| `henri_identities` (sign-in)      | shared, and it has to be        |
| `henri_webhooks` (endpoints)      | per tenant, by `owner`          |
| `henri_trail` (the access trail)  | shared                          |
| `henri_calls` (the call log)      | shared                          |
| `henri_versions` (model history)  | per tenant, by the record's own |
| `henri_jobs` (the queue)          | per tenant, by `tenant`         |
| the feature flag store            | shared                          |
| the idempotency keys              | per tenant                      |
| the rate limit and the lockout    | shared                          |
| the session store                 | shared                          |

**The identity table is shared, and it has to be.** `(provider, subject)` is
unique across the whole application, because one Google account is one
person. If it were per tenant, the same human could hold two accounts with
the same verified credential and the merge rule would have nothing to say
about it. The consequence to know: **henri's user is one row, in one tenant.**
A person who belongs to two customers needs two accounts today, or a
membership model of the application's own with `req.setTenant()` deciding
between them. henri's own user lookups — sign-in, the session deserialize,
the password-reset and confirmation flows — are all global for the same
reason, and marking the user model `tenant: true` **fails the boot** with a
message saying so: a scoped `findUserByEmail` would answer "no such account"
to everybody, because a sign-in happens before any request has a tenant.

**The webhook endpoints were already per tenant.** `@usehenri/webhooks` has
given every endpoint an `owner` since it shipped, and `henri.tenancy` is now
what fills it in: an `emit()` inside a tenant reaches that tenant's endpoints
without the caller repeating it. Naming an `owner` explicitly still wins, and
`owner: null` still means the endpoints that belong to nobody, which is what
a platform-wide event is.

**The queue row carries the tenant, and the runner enters it.**
`henri.jobs.perform()` stamps the tenant of the request or job it was called
from, `henri jobs:list --tenant` narrows a listing, and a runner opens
`henri.tenancy.run()` around `perform()` — which turns a whole class of jobs
that had to remember a first line into ordinary correct code. A row with no
tenant enters none, deliberately.

**The versions are per tenant, by the record's own column.** A version names the
tenant of the record it describes — read off the record, so a sweep running
across every customer still writes the right one — and `henri.versions` is
narrowed and refused exactly the way a tenanted model is: a listing with no
tenant in scope raises `HENRI_TENANT_REQUIRED` rather than answering with
everybody's old values. The sharp edge is `restore()`: restoring a record that
no longer exists **creates** it, and a create is stamped with the tenant in
scope, so restoring another tenant's version is `HENRI_VERSION_CROSS_TENANT`
rather than that record appearing here. Rows written before the column arrived
name no tenant and are therefore visible in every tenant's listing; the
[versions guide](/guides/versions/#tenants) has the backfill.

**The trail and the call log are shared, and that is safe** — for a reason
worth stating rather than assuming. Both are operator records, not
application data: nothing serves them over HTTP, `henri trail` and
`henri calls` are command-line tools run by whoever holds the database, and
the trail is a single hash chain whose `seq` is what makes an edit
detectable. Splitting either per tenant would give you N chains to verify and
N sweeps to run, for a boundary that already exists — the operator can read
every tenant's rows anyway. **The leak to be aware of** is the other
direction: if you build an admin page over `henri.trail.list()` or
`henri.calls.list()`, you are building a cross-tenant view, and scoping it is
your job.

**The feature flags are shared, and this one you have to work with.** A flag
is a deploy-time switch, its state lives in `config.shared` or a file, and
`henri.flags.enabled(name, actor)` takes an _actor_ rather than a tenant. A
per-tenant rollout is a `group` gate the application writes, or a percentage
whose actor is the tenant identifier rather than the user:

```js
if (await henri.flags.enabled('new-billing', req.tenant)) {
  // ...
}
```

Nothing about that is automatic, and `henri flags:on new-billing` is still
on for everybody.

**The idempotency keys are per tenant**, and this one is a correctness fix
rather than a nicety: the key is chosen by the client, and the scope it is
stored under is what keeps two clients sending `Idempotency-Key: 1` from
replaying each other's answer. Two of the three fallbacks in that scope are
not tenant-specific — an anonymous request is keyed by its address, and one
load balancer can present the same address for two customers — so the tenant
now goes in front of all three.

**The rate limit and the sign-in lockout are shared**, keyed by address or by
account as they always were. A per-tenant quota is a different feature (it
wants a plan, a burst allowance and a way to tell a customer they hit it),
and keying the _global_ limit by tenant would make a tenant's own traffic
count against nobody else — which is not what a defence against a flood is
for. `config.rateLimit.store` and a middleware of the application's own are
where a per-customer quota goes.

## henri's own sweeps run across every tenant

`henri privacy:export`, `henri privacy:erase` and `henri retention:sweep` walk
the models with `henri.tenancy.unscoped()`, and each for its own reason.

An **erasure** and an **export** are about a _person_, and the records held
about that person are wherever they are; a walk narrowed to whatever tenant
happened to be in scope would answer a person's request with part of their data
and write a receipt saying it was all of it. A **retention rule** is the
application's policy about a _table_ — `after: '90d'` on `Ticket` means every
ticket — and a sweep narrowed to one customer would delete their records and
write a receipt saying the rule ran.

There is no tenant in scope on a cron line anyway, so the alternative was never
a narrower sweep: it was `HENRI_TENANT_REQUIRED` on the first rule.

A per-tenant retention period is a different feature, and it is yours: a rule
with a `where` of its own, or a job that calls `sweep({ only })` inside
`henri.tenancy.run()`.

## What henri cannot narrow, and refuses instead

Three kinds of call have nowhere to put a condition. henri refuses them on a
tenanted model rather than running them across every tenant
(`HENRI_TENANT_UNSCOPABLE`):

- **`Model.aggregate()`** on MongoDB — a pipeline runs no query middleware.
  Put the `$match` in yourself, or say `unscoped()`.
- **`Model.bulkWrite()`** on MongoDB, and
  **`Model.increment()`/`decrement()`** on Sequelize — no hook fires for
  either. One scoped update per record is the answer.
- **`estimatedDocumentCount()`** — it counts a collection rather than a
  filter. `countDocuments()` is scoped.

And one that is **not** refused, because henri cannot see it:

- **`adapter.query()`**, raw SQL. henri does not parse statements, so a raw
  query reaches every tenant's rows. `henri.tenancy.current()` is what you
  interpolate, and the guide would rather say this plainly than pretend
  otherwise.

## Reading it back

```js
henri.tenancy.current(); // 'acme', or null
henri.tenancy.source(); // 'subdomain'
henri.tenancy.map(); // { Invoice: 'tenantId', Ticket: 'accountId' }
henri.tenancy.require('the nightly sweep'); // the tenant, or a refusal
```

and in a request:

```js
req.tenant; // 'acme'
req.tenantSource; // 'user'
req.setTenant('acme'); // the explicit source; cross-checked like the rest
```

## Testing it

The property to write down is negative, and it is the one worth more than the
feature: **tenant A cannot read or write tenant B's rows.** Write it over the
paths people actually forget — a `count`, a `paginate`, a mass update, an
eager loaded association, an `instance.save()` — rather than over the happy
path:

```js
const { create } = require('@usehenri/testing');

test('an index never crosses the boundary', async () => {
  await henri.tenancy.run('acme', () => create('invoice'));
  await henri.tenancy.run('globex', () => create('invoice'));

  const { body } = await request()
    .get('/invoices')
    .set('Host', 'acme.example.com')
    .expect(200);

  expect(body._embedded.invoices).toHaveLength(1);
});

test('a job with no tenant refuses rather than reading everything', async () => {
  await expect(Invoice.count()).rejects.toMatchObject({
    code: 'HENRI_TENANT_REQUIRED',
  });
});

test('a job carries the tenant it was enqueued in', async () => {
  const job = await henri.tenancy.run('acme', () =>
    henri.jobs.perform('invoice-reminder', { invoiceId: 'x' })
  );

  expect(job.tenant).toBe('acme');
});
```

That second one is the test that catches a regression in this feature, so it
is worth having even though it asserts a failure.

## What was left

Written down rather than discovered:

- **No runner per tenant.** The claim is not narrowed by tenant and
  `henri jobs --tenant` does not exist: one customer's backlog getting a runner
  of its own is a scheduling feature with a fairness question attached (what
  happens to the tenants no runner names?), and it is not this one.
- **No per-tenant retention or prune.** `versions.keep`, `jobs.keepCompleted`,
  `calls.keep` and `trail.keep` are one number for the whole application, and
  the sweeps run across every tenant. A per-customer period is a rule with a
  `where` of its own, or a job of yours.
- **No backfill of the rows the upgrade left behind.** A queue row and a version
  row written before their `tenant` column existed name none, and henri does not
  guess: a job's tenant is not recoverable at all, and a version's is a `UPDATE`
  from the records it names that only you can write. The
  [versions guide](/guides/versions/#the-column-and-an-upgrade) has it.
- **No `henri tenants` command.** There is no list of tenants, because henri
  holds none: a tenant is a string in a column, and what the set of them is
  belongs to the application's own `Account` model.
- **The models are not exercised on MSSQL.** The rest of
  `@usehenri/sequelize` runs against a real SQL Server now
  (`pnpm test:sql:mssql`), and the queue's `tenant` column is proved there
  along with everything else in that project — but the tenancy wiring of
  the models is written and reviewed and has no suite of its own to point
  at it; those proofs are on Drizzle (sqlite offline, PostgreSQL and MySQL
  under `pnpm test:sql:live`) and on MongoDB.
- **No per-tenant connection, schema or key.** That is option 2, and this
  page said why.
