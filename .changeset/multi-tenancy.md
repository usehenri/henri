---
'@usehenri/core': minor
'@usehenri/drizzle': minor
'@usehenri/mongoose': minor
'@usehenri/sequelize': minor
'@usehenri/webhooks': minor
'@usehenri/cli': minor
---

Multi-tenancy: one column, one ambient tenant, and a refusal when nobody said which.

henri had one tenant-shaped thing — every webhook endpoint carries an `owner`, and an `emit` without one reaches the endpoints that have none — and nothing else. An application serving two customers wrote the `where` itself, on every query, forever.

There are three ways to be multi-tenant and they are not variations of one thing: a column on every row, a schema per tenant, or a process per tenant. **henri does the first**, and the reason is the model layer rather than a preference — a per-tenant schema is a `search_path` on PostgreSQL, a database name on MySQL, a connection on MongoDB and a file on sqlite, all of which are _connection_ decisions, and a henri store opens one pool at boot. What that buys and this does not is a boundary the database itself enforces; the guide says so, and says who should reach for it instead.

Two declarations, and they are separate. A model says its rows belong to one customer:

```js
// app/models/Invoice.js
module.exports = { options: { tenant: true }, schema: { ... } };
```

and the application says where the tenant of a request comes from:

```json
{ "tenancy": { "from": { "subdomain": "example.com", "user": "accountId" } } }
```

From then on every query henri builds for an `Invoice` carries the condition — `find`, `findOne`, `count`, `paginate`, `exists`, `pluck`, an eager loaded association, a mass update, a mass delete, a soft delete, a restore, and `instance.save()`, which never builds a query at all — and every insert is stamped. `findById` answers `null` for another tenant's identifier, which is the 404 it already answers for one that does not exist.

**The default is the refusal, and that is the feature.** A tenanted model touched with _no_ tenant in scope raises `HENRI_TENANT_REQUIRED` rather than falling back to every tenant's rows — the instinct `HENRI_POLICY_SCOPE_REQUIRED` already has, one layer down. A write naming another tenant is `HENRI_TENANT_CROSS_WRITE` rather than a row that quietly appears in somebody else's list. What Mongoose and Sequelize cannot narrow at all — an aggregation pipeline, a `bulkWrite`, an `increment` — is `HENRI_TENANT_UNSCOPABLE` rather than an unscoped answer. There is one way past, and it is an async context and not a setting: `henri.tenancy.unscoped(fn)`, the shape of `henri.encryption.tolerate()`.

**The tenant of a request is decided in one place and is visible.** `req.tenant` is the value and `req.tenantSource` says how it was reached — `req.localeSource`'s precedent — over a fixed order: `explicit` (`req.setTenant()`), then the signed-in user's own column, then the subdomain, then a header from a proxy the application listed. Everything a client can name sits _below_ the user's own record, and when the two disagree the request is refused (`HENRI_TENANT_MISMATCH`, 404 by default) rather than served from either: for a signed-in person a client-named tenant is a confirmation, never an election. `POST /login` asks the same question again once passport has authenticated, so signing in on the wrong subdomain opens no session at all. A tenant header with no `from` naming its proxies **fails the boot**, the rule `config.calls.address` already follows, and a `from` covering everything is a high `henri audit` finding.

A tenant is a **scope and not a permission**: narrowing only ever removes rows, and what a person may do with the ones that are left stays `app/policies`' question.

Around the edges: the idempotency keys are now scoped by tenant (the key is the client's, and one load balancer can present one address for two customers); `henri.webhooks.emit()` defaults its `owner` to the tenant in scope; `henri audit` gained `tenancy.header-from-any` and `tenancy.unmarked-model`; and the user model **cannot** be marked `tenant` — a sign-in reads it before any request has a tenant, so scoping it would answer "no such account" to everybody, and henri fails the boot saying so.

The guide is [Multi-tenancy](https://usehenri.io/guides/multi-tenancy/), which also holds the table of what each henri-owned table does about tenants — including the two that are honestly shared for now: the queue row carries no tenant (it rides in the job's arguments, and forgetting it is a loud refusal rather than a leak) and neither does a version row.
