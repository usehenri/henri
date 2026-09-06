---
title: Configuration
description: The config directory, environments, .env, stores and the other keys.
sidebar:
  order: 2
---

Configuration is JSON in the `config` directory. henri loads `config/<NODE_ENV>.json` and falls back to `config/default.json`; with `NODE_ENV` unset it looks for `config/dev.json` first. A typical application commits `default.json` and adds `production.json` or `test.json` for the keys that differ.

```json
{
  "stores": {
    "default": {
      "adapter": "drizzle",
      "dialect": "sqlite",
      "url": "file:.henri/app.db"
    },
    "reporting": {
      "adapter": "postgresql",
      "url": "postgres://localhost:5432/myapp_reporting"
    }
  },
  "renderer": "inertia",
  "user": "user",
  "baseRole": "guest"
}
```

The file is parsed on boot: a syntax error is reported with its line, and the boot stops when no file can be loaded. The loaded object is frozen, then [checked against henri's schema](#validation) before any other module starts.

Every key below is declared in `@usehenri/core`, so an editor completes them as you type. `henri.config.get()` and a hand-built configuration object take the same shape, `import('@usehenri/core').Configuration` — see [Types](/reference/types/).

## Keys

| Key                | Default       | Description                                                                                                                                                             |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`             | `3000`        | Port to listen on. In development a busy port is replaced by the next free one; under `NODE_ENV=test` the kernel assigns one.                                           |
| `host`             | see below     | Interface to bind: `127.0.0.1` outside production, `0.0.0.0` in production. `HENRI_HOST` (what `henri server --host` sets) wins over the file.                          |
| `cors`             | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options.                                                       |
| `renderer`         | `template`    | View engine: `inertia`, `react` or `template` (Handlebars), whatever the case. `henri new` writes `inertia`. See [Views](/guides/views/).                               |
| `inertia`          |               | Options of the Inertia renderer: `ssr`, `id`, `entry`, `ssrEntry`, `template`. See [Views](/guides/views/#inertia).                                                     |
| `experimental`     |               | Opt-in to unmaintained renderers: `{ "vue": true }`.                                                                                                                    |
| `stores`           |               | Named database stores, see below. A model picks one with its `store` key or uses `default`.                                                                             |
| `secret`           |               | Session and token secret. Required as soon as a user model exists; usually provided by `HENRI_SECRET`.                                                                  |
| `url`              | the local url | Canonical address of the application (`https://example.com`), used for the links inside the mails henri sends. Set it in production.                                    |
| `user`             | `user`        | Name of the user model, or an object (below). See [Users](/guides/users/).                                                                                              |
| `baseRole`         |               | Role, or list of roles, given to every new user.                                                                                                                        |
| `externalIds`      |               | What henri does with the internal identifier of a record: which one a lookup takes, and what a foreign key serializes as, below.                                        |
| `policies`         |               | Record-level authorization: what a refusal answers and whether an unasked policy is reported, see below. See [Policies](/guides/policies/).                             |
| `trustProxy`       | `true`        | Express `trust proxy`: `true`, a hop count or a list of addresses; `X-Forwarded-*` headers are honoured. Set `false` without a proxy.                                   |
| `csrf`             | `true`        | `false` disables the [CSRF protection](/guides/users/#csrf); an object configures the origin check, below.                                                              |
| `graphql`          | `/_henri/gql` | Path of the GraphQL endpoint, or an object with its limits and access rules, below; needs `@usehenri/graphql`. See [GraphQL](/guides/graphql/).                         |
| `mail`             |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                                                                      |
| `mailers`          |               | Defaults of the [mailers](/guides/mail/): `from`, `layout` and `previews`, see below.                                                                                   |
| `api`              |               | Pagination, strict HAL and idempotency settings of the [JSON API](/guides/api/), see below.                                                                             |
| `jobs`             |               | Settings of the [job queue](/guides/jobs/), see below; needs `@usehenri/jobs`. The queue also loads when `app/jobs` holds a file.                                       |
| `rateLimit`        | `600`/min     | Global, authentication and shared-store rate limits, see below. `false` disables them, `true` keeps the defaults.                                                       |
| `shared`           |               | The backend the rate limit, the sign-in lockout and the idempotency keys count in, so two processes share one set, see below.                                           |
| `cache`            | on            | `henri.cache`: how long an entry lives, how much of it is kept and where, see below. `false` turns the cache off.                                                       |
| `helmet`           | on            | Options merged over henri's [helmet](https://helmetjs.github.io/) defaults; `false` disables it.                                                                        |
| `csp`              | off           | Content Security Policy settings henri owns beside `helmet`: `nonce`, see below. See [Security](/guides/security/#content-security-policy).                             |
| `filterParameters` | see below     | Parameter names masked in the logs; `false` masks everything but `encryption`.                                                                                          |
| `logs`             | `auto`        | What a log line looks like: `format` is `pretty`, `json` or `auto` — json in production, the pretty lines everywhere else. See [Logs](/guides/logs/).                   |
| `telemetry`        | see below     | OpenTelemetry spans and metrics: `enabled`, `metrics`, `propagate`, `spans`, see below. On when `@opentelemetry/api` is installed. See [Telemetry](/guides/telemetry/). |
| `encryption`       |               | The keys that open the fields the models marked `encrypted`, see below. See [Encrypted attributes](/guides/encryption/).                                                |
| `privacy`          |               | What henri does with the fields the models marked `personal`, see below. See [Personal data](/guides/privacy/).                                                         |
| `retention`        |               | What runs the retention sweep and what it may do, see below. How long a model keeps its records is said in the model. See [Retention](/guides/retention/).              |
| `trail`            | off           | The append-only record of who read or changed personal data, see below. See [The access trail](/guides/trail/).                                                         |
| `calls`            | off           | The calls the application answered and the calls it made, joined by the request id, see below. See [Call logs](/guides/calls/).                                         |
| `versions`         | `{}`          | Where the history of the models that say `versioned` is kept, and for how long. It turns nothing on: a model does. See [Model versions](/guides/versions/).             |
| `bodyLimit`        | `1mb`         | Maximum size of a JSON or form body.                                                                                                                                    |
| `uploads`          |               | File uploads: where they go, the limits and the accepted types, see below; needs `@usehenri/uploads`. `false` accepts no file.                                          |
| `requestTimeout`   | `30000`       | Milliseconds before a running request is answered `503`; `false` disables it.                                                                                           |
| `shutdown`         |               | What a `SIGTERM` does before the modules stop: `delay`, `drain` and `signals`, see below.                                                                               |
| `errors`           |               | What henri does with the code of a failure: `url`, a template holding `{code}`. See [Error codes](/reference/errors/).                                                  |
| `webhooks`         |               | Settings of the [outbound webhooks](/guides/webhooks/), see below; needs `@usehenri/webhooks`, which delivers through the queue.                                        |

## The `externalIds` object

Every record carries an `externalId` -- a UUID v7 -- and the numeric primary
key stays on the server. This key holds the two decisions that follow from
that, and both defaults are the safe ones.

| Key          | Default      | Description                                                                                                                                                                                                                     |
| ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lookup`     | `'external'` | Which identifier `Model.findById()` resolves. The default takes the `externalId` and nothing else, so `GET /proposals/4812` answers the same 404 an unknown uuid answers. `'any'` restores the primary key lookup of henri 1.2. |
| `references` | `true`       | Replace a declared foreign key with the `externalId` of the row it names, on the way out. `false` sends the number the database holds, so a record carries another row's primary key.                                           |

```json
{
  "externalIds": { "lookup": "external", "references": true }
}
```

`findByKey()` always takes the primary key, whatever `lookup` says: it is
the lookup for server-side code that legitimately holds one (the subject of
a session, a row you just joined), and `findById()` is the one that takes
what arrived from outside. A model that opted out with
`options: { externalId: false }` is unaffected by either key.

Turning either of them off is reported by [`henri audit`](/guides/security/).
See [Models](/guides/models/#identifiers) for what a foreign key has
to declare before henri can translate it.

## The `policies` object

What henri does with the answer of a policy in `app/policies`. The key is
never what turns policies on -- writing the file is -- and it is only about
the two decisions an application may reasonably differ on. See
[Policies](/guides/policies/).

| Key      | Default | Description                                                                                                                                                                                                  |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status` | `404`   | What a refusal answers a signed-in user: `404` says nothing about whether the record exists, `403` says it is there and off limits. An anonymous visitor always gets a `401` (the login page, in a browser). |
| `verify` | `true`  | Report a route that declared a policy henri could not answer without the record, whose action then answered without ever asking. `false` turns the line off.                                                 |

```json
{
  "policies": { "status": 403, "verify": true }
}
```

## The `mailers` object

Defaults for the mailers in `app/mailers`. Every key is optional.

| Key        | Default    | Description                                                                                                                                                                                                                    |
| ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `from`     |            | Sender used by every message that does not set one (the mailer's own `defaults.from` wins over it).                                                                                                                            |
| `layout`   | `"mailer"` | Name of the layout in `app/views/mailers/layouts`. `false` renders the views without a layout.                                                                                                                                 |
| `previews` | `true`     | `false` turns the development preview routes off. Nothing turns them on outside development: they only exist when `NODE_ENV` is neither `production` nor `test`, and only answer requests from the machine running the server. |

```json
{
  "mailers": {
    "from": "Acme <no-reply@acme.com>",
    "layout": "mailer"
  }
}
```

## Stores

Each entry of `stores` names an adapter and how to reach its database. The adapter package (`@usehenri/<adapter>`) must be installed in the application.

`drizzle`, `postgresql`, `mysql` and `mariadb` are all `@usehenri/drizzle`: the last three are that adapter with the dialect and the driver chosen, so a store on one of them needs no `dialect` key and the application declares no driver. `mssql` is the one adapter on Sequelize, because Drizzle has no SQL Server dialect.

| Key                                                | Adapters      | Description                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`                                          | all           | `drizzle`, `postgresql`, `mysql`, `mariadb`, `mssql`, `mongoose` or `disk`.                                                                                                                                                                                                                                                                                     |
| `url`                                              | mongoose, SQL | Connection string. Required unless `host` is given (`mariadb://` is accepted by the mysql adapter).                                                                                                                                                                                                                                                             |
| `host`, `port`, `database`, `username`, `password` | mongoose, SQL | Alternative to `url`. On mongoose, `host` may also be a full `mongodb://` url.                                                                                                                                                                                                                                                                                  |
| `opts`                                             | mongoose      | Options passed to `mongoose.connect()`; henri sets `connectTimeoutMS` and `serverSelectionTimeoutMS` to 10 seconds.                                                                                                                                                                                                                                             |
| `session`                                          | mongoose, SQL | Options of the session store (connect-mongo, whose collection is `henriSessions`; the `henri_sessions` table on drizzle; connect-session-sequelize on mssql).                                                                                                                                                                                                   |
| `sessions`                                         | drizzle       | `true` creates the session table even when the application has no user model.                                                                                                                                                                                                                                                                                   |
| `path`, `dbName`, `port`                           | disk          | Data directory, relative to the application (`.henri/data`), database name (`henri`), and the port mongod listens on (one derived from the process id, between 20000 and 26999, so parallel boots never collide).                                                                                                                                               |
| `logging`, `pool`, `dialectOptions`, ...           | mssql         | Every other key is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace. A drizzle store takes `pool` (the driver's options) and nothing else.                                                                                                                                                                                   |
| `dialect`                                          | drizzle       | `sqlite`, `postgres` or `mysql`; the app installs the driver (`better-sqlite3`, `pg` or `mysql2`). The `postgresql`, `mysql` and `mariadb` adapters fix it and ignore this key.                                                                                                                                                                                 |
| `sync`, `migrate`                                  | SQL           | `sync: false` stops the development boot from bringing the schema up. On an mssql store, a production boot never does, and `sync: true` is what asks it to create the tables that are missing. `migrate: true` (drizzle) applies `db/migrations` on a production boot; on mysql a push only creates the missing tables (see [Models](/guides/models/#drizzle)). |

See [Models](/guides/models/#adapters) for each adapter.

## JSON API

The keys of the [JSON API](/guides/api/), all optional:

| Key                             | Default                              | Description                                                                                                                                           |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.perPage`, `api.maxPerPage` | `25`, `100`                          | Page size read by `req.pagination()` and its upper bound.                                                                                             |
| `api.strict`                    | `false`                              | Refuse (500) a JSON answer without `_links` on a `resources`/`crud` route instead of logging it.                                                      |
| `api.idempotency`               | `{ "ttl": 86400000, "store": null }` | How long answers are kept for `Idempotency-Key` replays and the module exporting a shared `{ get, set, delete }` store; `false` disables the feature. |

## Rate limits

`rateLimit` is `false` to lift every limit, `true` for the defaults, or an object. Nothing is enforced in development.

| Key                                   | Default                            | Description                                                                                                          |
| ------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `rateLimit.windowMs`, `rateLimit.max` | `60000`, `600`                     | The global limit per user or ip. `limit` is accepted as an alias of `max`, the name express-rate-limit 8 uses.       |
| `rateLimit.auth`                      | `{ "windowMs": 60000, "max": 10 }` | The limit on `POST` to the login and register-style paths (`paths` overrides the list); `false` disables it.         |
| `rateLimit.store`                     |                                    | Module exporting an express-rate-limit `Store` (or a `(henri, { name }) => store` factory) shared between processes. |

## The `shared` object

Three guards keep a number per key: the rate limit, the [sign-in lockout](#userlockout) and the [idempotency keys](/guides/api/#idempotency). Each accepts a store of its own, and each of them is kept in the process's memory when nothing names one — so an application running two processes silently gets two of everything: a rate limit that is twice what it says, a lockout an attacker escapes by being routed elsewhere, and an idempotency key that stops being idempotent.

`shared` is the one place to say where they are counted instead:

```json
{
  "shared": {
    "adapter": "redis",
    "url": "redis://127.0.0.1:6379",
    "prefix": "lineup:",
    "onError": "closed"
  }
}
```

```bash
pnpm add @usehenri/redis
```

| Key       | Default    | Description                                                                                                                                                                   |
| --------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adapter` |            | Required. An adapter name — `redis` resolves `@usehenri/redis` from the application — or the module id of a backend of your own.                                              |
| `url`     |            | Connection string (`redis://`, `rediss://` for TLS). Set it with `HENRI_CONFIG__shared__url`, not in `config/`: it carries a password.                                        |
| `prefix`  | `"henri:"` | What every key is prefixed with. Two applications sharing one server need one prefix each.                                                                                    |
| `onError` | `"closed"` | What a guarded request does when the backend does not answer: `closed` refuses it with a `503` and a `Retry-After`, `open` serves it uncounted. The keys are always `closed`. |
| `enabled` | `true`     | `false` keeps the block and counts in this process again, which is what `HENRI_CONFIG__shared__enabled=false` is for.                                                         |

Anything else in the block reaches the driver, so `db`, `tls`, `password`, `sentinels` and the rest of [ioredis](https://github.com/redis/ioredis)' options work.

The three per-feature keys still work and still win, key by key: `rateLimit.store`, `user.lockout.store` and `api.idempotency.store` name a module of their own for whoever wants one backend for the limiter and another for the keys.

### When the backend is down

It will be, at some point, and the right answer is not the same for all three:

- **the limiter and the lockout follow `onError`.** `closed` is the default: a guard that cannot count is not a guard, so the request is refused with a `503` and a `Retry-After: 1`. A deployment that would rather stay up than stay counted says `open`, which serves the request uncounted.
- **the idempotency keys are always closed**, whatever `onError` says. Serving a mutating request whose first answer cannot be read is the one thing `Idempotency-Key` exists to prevent, so there is no second answer to offer and no switch pretending there is.

Either way it is said out loud: every fallthrough is logged, at most once every ten seconds per feature so that a long outage does not become the log. A backend that is unreachable at boot does not fail the boot — the driver keeps reconnecting, `GET /readyz` answers `503` with `"shared": { "ok": false }` so the process leaves the load balancer, and the requests meanwhile follow `onError`.

### Sessions stay in the database

`shared` does not touch the sessions. They go through the store adapter (`connect-mongo`, the drizzle session table, or `connect-session-sequelize` on mssql), which every process already reads and writes, so they were never one of the counters this closes. Moving them would trade a store that is durable for one that is faster and empties on a restart, and would make signing in depend on Redis being up — a real trade, and one a deployment makes for itself with `express-session`, not one henri makes for it.

## The `cache` object

`henri.cache` is there in every application, with nothing to configure: this process's memory, bounded, with a five minute default lifetime. Naming a backend in [`shared`](#the-shared-object) moves it there — one block for the counters and the cache both — and `cache` is what tunes it. See [Caching](/guides/caching/).

```json
{
  "cache": {
    "ttl": "5m",
    "maxEntries": 1000,
    "maxSize": "32mb",
    "maxEntrySize": "256kb"
  }
}
```

| Key            | Default   | Description                                                                                                                                                                                 |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ttl`          | `"5m"`    | How long an entry lives when a call does not say. Every entry has one: there is no way to keep a value forever, by accident or on purpose.                                                  |
| `maxEntries`   | `1000`    | Entries the memory backend may hold; the least recently used goes first. Nothing to do with a shared backend, which has its own memory policy.                                              |
| `maxSize`      | `"32mb"`  | Everything the memory backend may hold, encoded. It evicts to stay under this and under `maxEntries`, so the cache cannot become a leak.                                                    |
| `maxEntrySize` | `"256kb"` | What one value may weigh, encoded, on any backend. A bigger one is not cached: `set` answers `false`, it is logged once, nothing is truncated, and the entry it was replacing is forgotten. |
| `store`        |           | Module exporting a `{ get, set, delete }` store (or a `(henri, { name }) => store` factory) for whoever wants the cache somewhere the counters are not. Wins over `shared`.                 |
| `enabled`      | `true`    | `false` keeps the block and turns the cache off: every `fetch` then runs its function, which is what `HENRI_CONFIG__cache__enabled=false` is for.                                           |

`false` in place of the object does the same as `enabled: false`.

A cache is a correctness hazard, not only a speed feature, so two things are said out loud rather than left to be discovered:

- **A backend that is down is a miss**, whatever `shared.onError` says. The counters block because a guard that cannot count is not a guard; the cache holds no truth, so refusing a request over a copy would turn an optimization into an outage. Every fallthrough is logged, at most once every ten seconds.
- **henri invalidates nothing.** No model callback, no query cache, no route. A value stays until its TTL runs out or something calls `henri.cache.delete()` — and with the memory backend that delete reaches one process, which is the reason a deployment running several of them wants `shared`.

## Headers, logs and limits

| Key                | Default                                            | Description                                                                                                                                                                                                                                                             |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helmet`           |                                                    | Options merged over henri's defaults (a development CSP that allows hot reloading, no HSTS outside production, `upgrade-insecure-requests` only on https requests), plus `permissionsPolicy` (a `Permissions-Policy` value, or `false`); `false` disables helmet.       |
| `csp.nonce`        | `false`                                            | `true` gives every response a nonce, names it in `script-src` and takes `'unsafe-inline'` out of that directive. See [Content Security Policy](/guides/security/#content-security-policy).                                                                              |
| `filterParameters` | `["password", "token", "secret", "authorization"]` | Substrings of the parameter names masked in everything `henri.pen` prints; `false` masks everything but `encryption`, whose name is masked whatever this says, since the list replaces the defaults and the key that opens the encrypted columns must not depend on it. |
| `logs.format`      | `"auto"`                                           | `"auto"` writes json in production and the pretty lines everywhere else; `"json"` and `"pretty"` say it outright. One object per line, with the module, the level and the request id as fields. See [Logs and error reporting](/guides/logs/).                          |
| `bodyLimit`        | `"1mb"`                                            | Passed to the JSON and urlencoded body parsers; a string (`"1mb"`) or a number of bytes.                                                                                                                                                                                |
| `requestTimeout`   | `30000`                                            | Milliseconds before a `503`; `false` disables the timeout.                                                                                                                                                                                                              |

## The `telemetry` object

OpenTelemetry spans and metrics. henri ships **no SDK, no exporter and no
sampler**: `@opentelemetry/api` is a peer dependency the application
installs, next to whichever pipeline the deployment already runs. See
[Telemetry](/guides/telemetry/).

Leave the key out and telemetry follows the package: on when
`@opentelemetry/api` resolves from the application, off when it does not,
and an application without it pays nothing -- the middleware is not mounted,
the adapter is not wrapped and no instrument is created.

```json
{
  "telemetry": {
    "metrics": true,
    "propagate": true,
    "spans": ["http", "jobs", "stores"]
  }
}
```

| Key         | Default | Description                                                                                                                                                                                                                  |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enabled`   |         | Absent means on when `@opentelemetry/api` is installed and off when it is not. `true` says the application requires it, and a boot without the package then fails with `HENRI_TELEMETRY_UNAVAILABLE` instead of going quiet. |
| `metrics`   | `true`  | Register the instruments: the request duration, the queue depth and its claim latency, and the cache counters. `false` leaves the spans.                                                                                     |
| `propagate` | `true`  | Write `traceparent` onto the requests henri makes for the application -- a webhook delivery. An incoming `traceparent` is always honoured, whatever this says.                                                               |
| `spans`     | `"all"` | Which boundaries get a span: `"all"`, `false` for none, or a list of `boot`, `http`, `jobs`, `mail`, `stores`, `views` and `webhooks`.                                                                                       |

`"telemetry": false` instruments nothing and never even looks for the
package.

## The `encryption` object

The keys that open the fields the models marked `encrypted`. Which fields
those are is said in the models themselves; see
[Encrypted attributes](/guides/encryption/).

The keys are secrets, and this is the one configuration object that must
never be written in `config/*.json`, which is committed. Their home is the
encrypted credentials of the environment (`henri credentials:edit`), whose
values are merged into the configuration key by key, or
`HENRI_ENCRYPTION_KEYS` -- comma separated, primary first. `henri audit`
reports a key found in a configuration file.

```json
{
  "encryption": {
    "keys": [
      "a2f1...64 hex characters",
      "the previous key, until it is rotated out"
    ],
    "readPlaintext": false
  }
}
```

| Key             | Default | Description                                                                                                                                                                                                            |
| --------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keys`          |         | The key, or the keys with the one that writes first, each 64 hexadecimal characters (`openssl rand -hex 32`). Every key decrypts, only the first encrypts: that is what makes a rotation a deploy and not a migration. |
| `readPlaintext` | `false` | Whether a column declared encrypted may answer with a value that is not encrypted. `true` is what makes a backfill possible on a table that is already full; take it out once `henri encryption:status` is clean.      |

## The `privacy` object

What henri does with the fields the models marked `personal`. Which fields
those are is said in the models themselves; see
[Personal data](/guides/privacy/).

```json
{
  "privacy": {
    "expose": true,
    "onErase": "anonymize",
    "receipts": "privacy"
  }
}
```

| Key        | Default       | Description                                                                                                                                                                                       |
| ---------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expose`   | `true`        | Whether a personal field may leave the server in an answer henri builds. `false` drops every one of them unless the field says `personal: { expose: true }`.                                      |
| `onErase`  | `"anonymize"` | What happens to the records of an erased person, for the models that do not say it themselves: `anonymize`, `delete`, `orphan` or `retain`.                                                       |
| `receipts` | `"privacy"`   | The directory `henri privacy:erase` writes its receipt to -- the proof that it ran, holding an HMAC of the identity rather than the identity. `false` keeps none beyond what the command printed. |

## The `retention` object

How long a model keeps its records is said in the model
(`options: { retention }`); this is what runs the sweep and what it is
allowed to do. See [Retention](/guides/retention/).

```json
{
  "retention": {
    "approve": true,
    "approved": ["Proposal:drafts:9f3c1a2b4d5e"],
    "batch": 1000,
    "receipts": "privacy",
    "schedule": "0 3 * * *"
  }
}
```

| Key        | Default     | Description                                                                                                                                                                    |
| ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `approve`  | `true`      | Whether a rule has to be approved before it writes anything. An unapproved rule is planned, counted and reported, and writes nothing. `false` makes the deployment the review. |
| `approved` | `[]`        | The tokens of the approved rules. `henri retention` prints one per rule; a rule whose `after`, `from`, `action` or `where` changes gets a new token and is pending again.      |
| `batch`    | `1000`      | How many records one rule may take in one sweep. What is left over is reported as `remaining` and taken by the next run. `false` lifts the bound.                              |
| `receipts` | `"privacy"` | The directory a sweep writes its receipt to. `false` keeps none beyond what the command printed.                                                                               |
| `schedule` | off         | A cron expression (`"0 3 * * *"`) or an interval (`"1d"`) the `henri/retention` job runs on; needs `@usehenri/jobs`. Without it, run `henri retention:sweep --yes` from cron.  |

## The `trail` object

The append-only record of who read or changed personal data. It is off until
this key says otherwise, and off means no table is created and no statement
is issued. See [The access trail](/guides/trail/).

```json
{
  "trail": {
    "keep": "1y",
    "reads": "personal",
    "store": "default",
    "table": "henri_trail"
  }
}
```

| Key     | Default         | Description                                                                                                                                                                               |
| ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep`  | `"1y"`          | How long an entry is kept. A trail of who touched personal data is itself personal data, so it has its own retention; `false` keeps them forever, which is a decision to make on purpose. |
| `reads` | off             | `"personal"` records the answers carrying a model with a personal field, `"all"` every answer henri serializes, `false` none. Every recorded read costs a round trip and an insert.       |
| `store` | `"default"`     | Which of `stores` the table lives in.                                                                                                                                                     |
| `table` | `"henri_trail"` | The table henri creates at boot and only ever `INSERT`s into and `SELECT`s from.                                                                                                          |

## The `calls` object

The calls the application answered and the calls it made, joined by the
request id. It is off until this key says otherwise, and off means no table
is created and no middleware is mounted. It holds **values**, which the
access trail deliberately does not: read [Call logs](/guides/calls/) before
turning it on.

```json
{
  "calls": {
    "address": { "header": "cf-connecting-ip", "from": ["10.0.0.0/8"] },
    "keep": "30d",
    "sample": 0.05,
    "maxPerSecond": 100,
    "maxBody": "8kb",
    "partition": "day",
    "always": ["error"],
    "ignore": ["/assets"],
    "store": "default",
    "table": "henri_calls"
  }
}
```

| Key               | Default         | Description                                                                                                                                                                                    |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address`         | `{}`            | What is recorded about the client's address: `{ anonymize, header, from }`, or `false` for none. See [the client's address](/guides/calls/#the-clients-address).                               |
| `keep`            | `"30d"`         | How long a row is kept. The retention sweep prunes them; `false` keeps them forever, which on this table is a decision to make on purpose.                                                     |
| `sample`          | `1`             | The share of requests recorded, from `0` to `1`. The decision is a hash of the request id seeded with `secret`, so the inbound call and every outbound call it caused agree, in every process. |
| `maxPerSecond`    | `100`           | The absolute per-process ceiling on rows a second, or `false` for none. Sampling is proportional and a burst is not, so this is what a spike runs into.                                        |
| `always`          | `["error"]`     | The outcomes sampling never drops: `"error"`, `"client-error"`, `"aborted"`. They are recorded without their bodies.                                                                           |
| `maxBody`         | `"8kb"`         | How much of a body is stored before it is cut and marked truncated. `false` stores no body.                                                                                                    |
| `bodies`          | `true`          | `false` keeps the timings, the statuses and the headers and captures no body at all.                                                                                                           |
| `partition`       | off             | `"day"` or `"month"` on PostgreSQL and MySQL: the sweep then drops a partition instead of deleting rows. Anything else fails the boot with `HENRI_CALLS_PARTITION_UNSUPPORTED`.                |
| `partitionsAhead` | `7`             | How many periods are kept ready in front of the clock.                                                                                                                                         |
| `inbound`         | `true`          | `false` stops henri mounting the middleware at all.                                                                                                                                            |
| `outbound`        | `true`          | `false` makes `henri.calls.track()` and `henri.calls.outbound()` no-ops.                                                                                                                       |
| `ignore`          | `[]`            | Path prefixes that are never recorded. The health probes never are, whatever this says.                                                                                                        |
| `buffer`          | `1000`          | How many rows may wait to be written. Past it a row is dropped and counted rather than queued forever.                                                                                         |
| `batch`           | `500`           | How many buffered rows trigger a flush before the timer does.                                                                                                                                  |
| `flush`           | `1000`          | How often the buffer is written, in milliseconds.                                                                                                                                              |
| `sweep`           | `5000`          | How many rows one pass of the delete path takes at a time.                                                                                                                                     |
| `store`           | `"default"`     | Which of `stores` the table lives in.                                                                                                                                                          |
| `table`           | `"henri_calls"` | The table henri creates at boot. Changing `partition` afterwards needs a migration of your own.                                                                                                |

## The `versions` object

Where the history of the models that say `options: { versioned: true }` is
kept, and how long it is kept for. **This key turns nothing on**: a model
does, and an application with no versioned model creates no table and pays
nothing whatever this says. See [Model versions](/guides/versions/).

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

| Key       | Default            | Description                                                                                                                                                                                                                                                                                  |
| --------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `keep`    | off                | How long a version is kept, pruned by the retention sweep. Unset keeps it for as long as the application does. A version holds the old values of a record, personal ones included, so setting this is a decision worth making on purpose.                                                    |
| `onErase` | `"follow"`         | What `henri privacy:erase` does to the versions of the records it touched. `"follow"` takes the versions of a deleted record away and empties the erased values out of the versions of a record that survives; `"delete"` takes them all; `"retain"` leaves them and says so in the receipt. |
| `store`   | `"default"`        | Which of `stores` the table lives in.                                                                                                                                                                                                                                                        |
| `table`   | `"henri_versions"` | The table henri creates on the first boot where a model says `versioned`.                                                                                                                                                                                                                    |

## Uploads

`uploads` is read by [`@usehenri/uploads`](/guides/uploads/), which the application installs; without the package nothing parses a multipart body. `false` accepts no file. Every key is optional, and every limit is enforced by the parser as it reads rather than checked once the file is on disk.

| Key                         | Default             | Description                                                                                                                                               |
| --------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uploads.storage`           | `"local"`           | `"local"` for the disk, or the module id of a `HenriStorage` resolved from the application.                                                               |
| `uploads.root`              | `"storage/uploads"` | Where the local storage keeps files, relative to the application. It must be outside `app/views/public`, which `express.static` serves.                   |
| `uploads.maxFileSize`       | `"10mb"`            | Largest single file; `false` removes the bound.                                                                                                           |
| `uploads.maxTotalSize`      | `"25mb"`            | Largest multipart body, all parts together. Checked against `Content-Length` before the parser is built, then counted as the bytes arrive.                |
| `uploads.maxFiles`          | `10`                | How many files one request may carry.                                                                                                                     |
| `uploads.maxFields`         | `100`               | How many non-file fields one request may carry.                                                                                                           |
| `uploads.maxFieldNameSize`  | `100`               | Longest field name, in bytes.                                                                                                                             |
| `uploads.maxFieldSize`      | `bodyLimit`         | Largest non-file part. It defaults to [`bodyLimit`](#headers-logs-and-limits) so one text field costs the same whichever encoding a form was posted with. |
| `uploads.maxFilenameLength` | `255`               | How much of the original name is kept as metadata. The stored name is generated, so this never bounds a path.                                             |
| `uploads.allow`             |                     | Media types that may be kept (`"image/png"`, `"image/*"`), matched against what the bytes say. Without it every type is accepted.                         |
| `uploads.sniff`             | `true`              | Decide the type from the first bytes. `false` trusts the `Content-Type` the client sent, which is not evidence; `henri audit` reports it.                 |
| `uploads.paths`             |                     | Path prefixes a multipart body is read under (`["/artworks"]`). Without it, any route that takes a body may receive one.                                  |

```json
{
  "uploads": {
    "allow": ["image/png", "image/jpeg", "application/pdf"],
    "maxFileSize": "5mb",
    "maxFiles": 3,
    "paths": ["/artworks"]
  }
}
```

## Shutdown

`SIGINT` and `SIGTERM` drain the server before the modules stop: readiness answers `503`, the port closes, the requests in flight finish, and only then does `henri.stop()` run. See [Health checks](/guides/api/#health-checks).

| Key                | Default | Description                                                                                                                                                                                            |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shutdown.delay`   | `0`     | Milliseconds between readiness turning `503` and the port closing. A proxy that only polls `/readyz` wants a couple of its intervals here; a platform that stops routing before the signal needs none. |
| `shutdown.drain`   | `10000` | Milliseconds the requests in flight get once the port is closed. What is still open then has its socket destroyed, with a line in the log saying how many.                                             |
| `shutdown.signals` | `true`  | Whether henri installs the `SIGINT` and `SIGTERM` handlers. `false` leaves the signals alone; call `henri.server.shutdown('SIGTERM')` from your own handler.                                           |

Keep `delay + drain` under the termination grace period of your platform (30 seconds on Kubernetes), so the process leaves before it is killed.

## Environment and `.env`

On boot henri reads `.env` in the application directory (`KEY=value` lines, optional `export`, quotes stripped, `#` comments; variables already set in the environment win), then applies what the environment says over the file it loaded. Every key is reachable, so a container image needs no configuration file written at start time: the committed `config/production.json` describes the application and the environment carries what changes between deployments.

### Precedence

Lowest first, one story for every variable:

1. the configuration file: `config/<NODE_ENV>.json`, or `config/default.json` when it does not exist (the two are never merged);
2. the [encrypted credentials](#encrypted-credentials) of that environment, when the application has some;
3. the named shorthands, in the table below;
4. `HENRI_CONFIG__<key>`, which names the key it sets and wins over everything.

Nothing is applied twice and nothing is merged into a value: the last writer of a key replaces it.

### The shorthands

| Variable       | Sets                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `HENRI_SECRET` | `secret`, so the secret stays out of `config`.                       |
| `HENRI_HOST`   | `host` (what `henri server --host` sets).                            |
| `DATABASE_URL` | `stores.default.url`, the connection string of the default store.    |
| `NODE_ENV`     | Selects the configuration file. `henri server --production` sets it. |

`DATABASE_URL` carries no `HENRI_` prefix on purpose: it is the name Heroku, Render, Fly, Railway, Neon and Supabase already set for you, and the one Rails has read for a decade. A prefixed alias would mean writing `HENRI_DATABASE_URL=$DATABASE_URL` in every deployment, which is the papercut this removes. There is one name, not both.

It applies only when the configuration already declares a `stores.default`: a url does not say which adapter to load, so the file stays the place where the store is declared. When it does not, the boot prints `DATABASE_URL => ignored: the configuration has no "stores.default"` and moves on. A store other than the default is reached by its path, below.

An empty shorthand (`DATABASE_URL=`) is treated as unset.

### Any other key

`HENRI_CONFIG__<key>` sets one configuration key. `__` separates the path segments, since a shell variable name cannot hold a dot:

```bash
HENRI_CONFIG__port=8080
HENRI_CONFIG__baseRole=member
HENRI_CONFIG__stores__reporting__url=postgres://user:pw@warehouse/reports
HENRI_CONFIG__user__afterLogin=/dashboard
HENRI_CONFIG_JSON__rateLimit='{"windowMs":60000,"max":100}'
```

The segments are the configuration keys **verbatim**, so their case matters: `HENRI_CONFIG__baseRole`, never `HENRI_CONFIG__BASEROLE`.

**The type comes from the file, then from the schema; henri never guesses it.** When the configuration already has a value at that path, the variable is read as its type: a number for `port`, `true`/`false` for a boolean, JSON for an object. When it does not, the type is the one [the schema](#validation) declares for that key, so `HENRI_CONFIG__port=8080` is the number `8080` in an application whose file never names a port. A key henri does not own and the file does not have is a string — a connection string stays a connection string even when it looks like a number. `HENRI_CONFIG_JSON__<key>` parses the value as JSON in every case, which is how you set a nested object, an array, or a key no file declares.

A value that does not fit its key fails the boot, naming the variable and the type it expected. A variable set to nothing fails too (`HENRI_CONFIG__port is set but empty: give it a value or unset it`): a missing variable is simply not an override and never becomes an empty string. The value itself is never part of an error message — it may be a secret.

### What the boot prints

Every key the environment provided is printed, so nobody debugs a value they cannot see:

```
config ✏ from the environment => secret = [FILTERED] => HENRI_SECRET
config ✏ from the environment => stores.default.url = postgres://henri:[FILTERED]@db:5432/app => DATABASE_URL
config ✏ from the environment => port = 8080 => HENRI_CONFIG__port
```

A key whose name matches `filterParameters` (`password`, `token`, `secret`, `authorization` by default) is masked, and so is the password of a connection string, which no filter list would ever name, and anything named `encryption` whatever the list says. The match is the same substring rule as everywhere else in the logs, so a key the defaults do not cover — `mail.auth.pass`, an `apiKey` — belongs in `filterParameters` if it is to be masked here too. `henri.config.fromEnv` holds the same list as `{ key, variable }` pairs — the paths and the variable names, never the values.

## Encrypted credentials

Rails' `credentials:edit`, in henri. `config/credentials/<env>.json.enc` holds the secrets of one environment, encrypted, and is **committed with the application**; the key that opens it never is. A deployment then carries one secret instead of twenty, and adding a secret to staging is a commit rather than a round of environment variables.

```bash
henri credentials:edit                     # the development environment
henri credentials:edit --env production    # creates the key and the file
henri credentials:show --env production --json   # the key paths, no values
henri credentials:rotate --env production        # a new key, same values
```

`edit` decrypts into a file only you can read, opens `EDITOR` (or `VISUAL`) on it, and encrypts what comes back when the editor closes. The plaintext is removed on every exit path, including an editor that fails and an interrupted process, and what you save must be a JSON object or the credentials are left as they were.

**JSON, not YAML.** henri's configuration is JSON, and the decrypted object is applied over it key by key, so the two files are written the same way and henri needs no parser it does not already have.

```json
{
  "secret": "a4f1...",
  "mail": { "auth": { "user": "postmaster@example.com", "pass": "..." } }
}
```

**The key** is `HENRI_CREDENTIALS_KEY`, or `config/credentials/<env>.key` (64 hexadecimal characters, what `openssl rand -hex 32` prints). The variable wins. `henri new` ignores `config/credentials/*.key` from the first commit, `henri credentials:edit` adds the line when it generates a key, and `henri doctor` reports a key that is not ignored or that reached the git index. When the file exists and no key can be found, the boot stops with `config/credentials/production.json.enc needs a key: set HENRI_CREDENTIALS_KEY, or put it back in config/credentials/production.key` — never a silent boot without secrets.

**Rotating the key** is `henri credentials:rotate`: the file is re-encrypted under a fresh key and the values are untouched, which is what to run when a key may have leaked. The current key has to open the file first and the new file is read back before the new key is stored, so a rotation cannot lose the contents. The new key is written to `config/credentials/<env>.key`, or printed once when `HENRI_CREDENTIALS_KEY` held the old one, because a deployment that deliberately has no key file should not be given one. Everything holding the old key needs the new one before its next boot.

**The cipher is AES-256-GCM**, from node's own crypto. The envelope is one line, `henri:v1:<iv>:<tag>:<ciphertext>`, all base64, and the environment name is authenticated along with the content: a modified file, a wrong key, and a `production.json.enc` renamed to `staging.json.enc` all fail loudly instead of decrypting to nonsense. No error message quotes the file, the key or a decrypted value.

**Where it sits in the precedence**: over the configuration file, under the environment. The credentials are committed with the application, like the configuration files, and the environment is the deployment, so a container can still override with `DATABASE_URL` or `HENRI_CONFIG__<key>`. Each leaf of the decrypted object replaces that one key, so `{ "mail": { "auth": { "pass": "x" } } }` leaves the rest of `mail` alone, and the values are then read like any other configuration:

```js
henri.config.get('mail.auth.pass');
```

The boot prints the paths the credentials provided and where the key came from — the names only, since every value in that file is a secret:

```
config ✏ from the credentials => secret, mail.auth.pass => key: HENRI_CREDENTIALS_KEY
```

`henri.config.fromCredentials` holds the same paths.

**Rotating `secret`** — in the credentials or in `HENRI_SECRET` — signs every session out, because the session cookies are signed with it. It also invalidates every password reset and email confirmation link that has not been used yet: those links carry a token signed with the same secret rather than a row in a table (see [Users](/guides/users/#the-tokens)). Neither is a reason not to rotate it; both are a reason to expect the support mail, and to rotate at a quiet hour.

## The `jobs` object

Everything the [job queue](/guides/jobs/) reads, all of it optional. The queue is `@usehenri/jobs`, which the application installs itself; the key is validated either way, and read by the package. It only loads when this key is there or when `app/jobs` holds a file.

```json
{
  "jobs": {
    "store": "default",
    "concurrency": 5,
    "maxAttempts": 5,
    "backoff": { "base": "5s", "factor": 4, "max": "1h", "jitter": 0.15 },
    "recurring": {
      "nightly-cleanup": { "job": "cleanup", "cron": "0 3 * * *" },
      "refresh-stats": {
        "job": "stats/refresh",
        "every": "15m",
        "queue": "low"
      }
    }
  }
}
```

| Key             | Default      | Description                                                                                                                                  |
| --------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`         | `default`    | Which store of `stores` holds the queue.                                                                                                     |
| `priority`      | `0`          | Priority of a job that names none; the higher, the sooner it is claimed.                                                                     |
| `table`         | `henri_jobs` | Table (or collection) name; the schedules live in `<table>_schedules`. Letters, digits and underscores only.                                 |
| `queue`         | `default`    | Queue of a job that names none.                                                                                                              |
| `queues`        | all          | Queues a runner takes from when `henri jobs` is given no `--queue`.                                                                          |
| `concurrency`   | `5`          | How many jobs one runner performs at once.                                                                                                   |
| `maxAttempts`   | `5`          | Attempts before a job goes to the dead letter queue.                                                                                         |
| `timeout`       | none         | How long one attempt may take, for jobs that set none.                                                                                       |
| `backoff`       | see above    | Wait before the next attempt: `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter` (0 to 1).                                   |
| `pollInterval`  | `1s`         | How often a runner looks for work when the queue is empty (never under 50ms).                                                                |
| `stuckAfter`    | `5m`         | Without a heartbeat for that long, a `running` job is taken to belong to a dead runner and put back. Keep it above the longest `timeout`.    |
| `keepCompleted` | `1d`         | How long finished jobs are kept before a runner prunes them. `0` keeps them forever.                                                         |
| `maxArgsBytes`  | `524288`     | Size limit of the serialized arguments of one job; over it the enqueue fails instead of storing a truncated payload.                         |
| `mailQueue`     | `mailers`    | Queue of the messages [`deliverLater()`](/guides/mail/#delivering-later) hands over.                                                         |
| `install`       | `true`       | Create the tables at boot. Set `false` in production and run `henri jobs:install` in the deploy.                                             |
| `recurring`     | `{}`         | Schedules, by name: `job` (defaults to the name), `cron` **or** `every`, and optionally `args`, `queue` and `priority`. Cron is read in UTC. |

Every duration is a number of milliseconds or a string: `'250ms'`, `'30s'`, `'5m'`, `'2h'`, `'1d'`, `'1w'`.

## The `webhooks` object

Everything [outbound webhooks](/guides/webhooks/) read, all of it optional. The package is `@usehenri/webhooks`, which the application installs itself; the key is validated either way. Deliveries are jobs, so the queue has to be there too.

```json
{
  "webhooks": {
    "store": "default",
    "queue": "webhooks",
    "maxAttempts": 8,
    "timeout": "10s",
    "backoff": { "base": "10s", "factor": 3, "max": "6h", "jitter": 0.2 }
  }
}
```

| Key            | Default          | Description                                                                                                                                                                     |
| -------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`        | `default`        | Which store of `stores` holds the endpoints.                                                                                                                                    |
| `table`        | `henri_webhooks` | Table (or collection) name. Letters, digits and underscores only.                                                                                                               |
| `install`      | `true`           | Create the table at boot. Set `false` in production and run `henri webhooks:install` in the deploy.                                                                             |
| `queue`        | `webhooks`       | The queue the deliveries go to, so a slow receiver never delays the rest of the work.                                                                                           |
| `maxAttempts`  | `8`              | Attempts before a delivery goes to the dead letter queue. Eight of the default backoff is about three days.                                                                     |
| `timeout`      | `10s`            | How long one delivery may take, resolution, connection and answer included.                                                                                                     |
| `backoff`      | see above        | Wait before the next attempt: `base × factor^(attempt − 1)`, capped at `max`, spread by `jitter` (0 to 1).                                                                      |
| `maxFanout`    | `1000`           | How many deliveries one `emit()` may enqueue before it refuses rather than writing them inside a request.                                                                       |
| `allowPrivate` | `false`          | `true` lets a delivery reach a loopback, private or link-local address. That is what a webhook url is normally refused for: **development only**, and `henri audit` reports it. |
| `allowHttp`    | `false`          | `true` lets a delivery go to a plaintext `http` url, payload and signature in the clear. **Development only**, and `henri audit` reports it.                                    |

Every duration is a number of milliseconds or a string: `'250ms'`, `'30s'`, `'5m'`, `'2h'`, `'1d'`, `'1w'`.

## The `user` object

`user` is the name of the model to treat as the user model. It also accepts an object:

```json
{
  "user": {
    "model": "user",
    "public": ["name", "avatar"],
    "loginPath": "/login",
    "afterLogin": "/",
    "sessionMaxAge": 2592000000,
    "password": { "minLength": 12 },
    "lockout": { "max": 10, "windowMs": 900000 }
  }
}
```

`public` lists the fields, besides `externalId`, `email` and `roles`, that views and JSON answers may see; `loginPath` is where browsers are sent when a route denies them; `afterLogin` where they land after a form login; `sessionMaxAge` the session lifetime in milliseconds (30 days). See [Users](/guides/users/).

### `user.password`

How passwords are checked and hashed. See [Passwords](/guides/users/#passwords).

| Key                     | Default | Description                                                                                                                                                                         |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `password.minLength`    | `12`    | Shortest password accepted. Never below `8`. Checked when a password is set, never when one is verified.                                                                            |
| `password.maxBytes`     | `72`    | Longest, in bytes: bcrypt ignores everything past 72 and henri will not truncate silently.                                                                                          |
| `password.algorithm`    | `auto`  | `auto` (argon2id when `@node-rs/argon2` resolves, bcrypt otherwise), `argon2id` (fails the boot when it does not) or `bcrypt`.                                                      |
| `password.bcryptRounds` | `12`    | bcrypt work factor. Never below `10`.                                                                                                                                               |
| `password.memoryCost`   | `19456` | argon2id memory in kibibytes.                                                                                                                                                       |
| `password.timeCost`     | `2`     | argon2id iterations.                                                                                                                                                                |
| `password.parallelism`  | `1`     | argon2id lanes.                                                                                                                                                                     |
| `password.pepper`       | off     | A server-side key mixed into every hash, its own, never `config.secret`. `HENRI_PASSWORD_PEPPER` sets it. **Losing it makes every password unverifiable.**                          |
| `password.binding`      | on      | Binds a hash to the `externalId` of its row, so one copied onto another row stops verifying. `{ enabled, allowUnbound }`; see [Bound hashes](/guides/users/#bound-password-hashes). |

### `user.lockout`

The per-account sign-in lockout; `false` turns it off. See [Sign-in lockout](/guides/users/#sign-in-lockout).

| Key                | Default  | Description                                                                                 |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `lockout.max`      | `10`     | Failed attempts one account may receive per window, whoever sends them.                     |
| `lockout.windowMs` | `900000` | The window, 15 minutes.                                                                     |
| `lockout.store`    | memory   | An express-rate-limit store shared between processes; in memory and per process by default. |

## The `csrf` object

`csrf` is `true`, `false` (no protection at all) or an object. See [CSRF](/guides/users/#csrf).

| Key                   | Default              | Description                                                                                                                            |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `csrf.origin`         | `true`               | Verify `Sec-Fetch-Site` and `Origin` alongside the token. `false` keeps the token check alone.                                         |
| `csrf.trustedOrigins` | `config.cors.origin` | Other origins allowed to send an unsafe request with a session cookie. Whatever `cors` already allows is trusted without repeating it. |

## The `graphql` object

`graphql` is the endpoint path, or an object. See [GraphQL](/guides/graphql/#guarding-the-endpoint).

| Key                     | Default       | Description                                                                    |
| ----------------------- | ------------- | ------------------------------------------------------------------------------ |
| `graphql.endpoint`      | `/_henri/gql` | Path of the endpoint.                                                          |
| `graphql.authenticated` | `false`       | Anonymous requests get `401`.                                                  |
| `graphql.roles`         | `[]`          | Roles required; missing one is `403`. Implies `authenticated`.                 |
| `graphql.loopbackOnly`  | `false`       | Anything but the loopback interface gets `404`.                                |
| `graphql.introspection` | outside prod  | Schema introspection.                                                          |
| `graphql.maxAliases`    | `15`          | Most aliases one query may use; `false` lifts the limit.                       |
| `graphql.maxComplexity` | `1000`        | Most fields one query may select, fragments expanded; `false` lifts the limit. |
| `graphql.maxDepth`      | `10`          | Deepest query accepted; `false` lifts the limit.                               |
| `graphql.maxTokens`     | `5000`        | Most tokens one document may hold; `false` lifts the limit.                    |

## Validation

Every key above is declared in a schema (`@usehenri/core`, `src/base/config-schema.js`) with the type it accepts. On boot, once the file has loaded and the credentials and the environment have been applied over it, the whole configuration goes through that schema — **before any other module starts**, so a wrong value fails on the first line of the boot rather than three modules in, where the message would name the reader instead of the mistake.

**Every problem is reported, not the first one.** Somebody fixing a configuration file should not discover its faults one boot at a time.

**A value henri cannot use fails the boot**, naming the key, what was expected, what arrived, and where the value came from — the file, the credentials, or the variable:

```
config ✖ "port" must be a port number between 1 and 65535, but it is the string "eight thousand" => from config/production.json
config ✖ "stores.default.adapter" must be one of disk, drizzle, mariadb, mongoose, mssql, mysql, postgresql, but it is the string "redis" => from HENRI_CONFIG__stores__default__adapter
config ✖ "secret" must be a string, but it is a number => from the credentials (config/credentials/production.json.enc)
```

The source matters: `port must be a number` is unhelpful when the culprit is an environment variable three deployments away. A value the [filters](#headers-logs-and-limits) name, and anything the credentials provided, is printed as its type alone; the password of a connection string is always masked.

`henri server` exits `1` and `henri server --json` prints the same thing as `{ "error": { "code": "HENRI_CONFIG_INVALID", "message", "hint", "problems": [...] } }`, where each problem is `{ key, level, message, expected, received, source, hint }`. See [Error codes](/reference/errors/).

**An unknown key is a warning, never a failure.** An application may carry keys of its own — `henri.config.get()` is how it reads them — so henri says it ignores the key and boots:

```
config ⚠ "appName" is not a henri configuration key => from config/default.json
```

**Unless it is a near miss of one henri owns**, which is the mistake actually being made:

```
config ⚠ "renderers" is not a henri configuration key: did you mean "renderer"? => from config/default.json
```

Inside a store this is the only unknown-key warning there is: everything a store adapter does not declare is forwarded to the driver (`logging`, `pool`, `dialectOptions`), so only `adaptor` or `urls` are worth a word.

**`henri doctor` runs the same schema over every `config/*.json`**, without booting and without a database, which is the fastest way to find a broken configuration — and the one a coding agent reaches for:

```bash
henri doctor
henri doctor --json    # problems as { check, level, code, message, file, hint }
```

The checks are `config.invalid` (an error), `config.adapter` (an unknown store adapter) and `config.unknown` (a warning). Being a file check, it sees neither the environment nor the credentials; the boot does.

Two more read one file against the others, which the schema cannot: `config.store`, when `jobs.store`, `webhooks.store` or `trail.store` names a store that is not in the same file, and `deps.declared`, when a store adapter one environment configures is in no `package.json` — an environment file replaces `default.json` whole, so each one has to hold together on its own, and the one that does not is usually `production.json`.

### The account flows

Three more keys mount registration, the password reset and the address confirmation. Each is `true` for the defaults, `false` (or absent) to leave the endpoints unmounted, or an object of settings; `henri generate authentication` writes them along with the pages.

```json
{
  "user": {
    "model": "user",
    "signup": { "fields": ["name"], "after": "/" },
    "passwordReset": { "expiresIn": "1h" },
    "confirmation": { "required": true }
  }
}
```

| Key                            | Default          | Description                                                                                    |
| ------------------------------ | ---------------- | ---------------------------------------------------------------------------------------------- |
| `signup.path`                  | `/signup`        | Where `POST` creates an account.                                                               |
| `signup.fields`                | `[]`             | Attributes a signup form may set besides `email` and `password`. `roles` is never one of them. |
| `signup.after`                 | `/`              | Where a browser lands after a successful signup.                                               |
| `signup.login`                 | `true`           | Open a session for the new account.                                                            |
| `passwordReset.path`           | `/password`      | Prefix of `<path>/forgot`, `<path>/reset/:token` and `<path>/reset`.                           |
| `passwordReset.expiresIn`      | `1h`             | How long a reset link stays valid. Milliseconds, or `'1h'`, `'30m'`, `'3d'`.                   |
| `passwordReset.after`          | `/`              | Where a browser lands once the password changed.                                               |
| `passwordReset.login`          | `true`           | Sign the account in after the reset.                                                           |
| `confirmation.path`            | `/confirm`       | `GET <path>/:token` confirms, `POST <path>` mails the link again.                              |
| `confirmation.emailPath`       | `/account/email` | Where a signed-in account asks to change its address.                                          |
| `confirmation.expiresIn`       | `3d`             | How long a confirmation link stays valid.                                                      |
| `confirmation.after`           | `/`              | Where a browser lands once the address is confirmed.                                           |
| `confirmation.required`        | `false`          | Keep unconfirmed accounts from opening a session.                                              |
| `confirmation.requirePassword` | `true`           | Ask for the current password before mailing an address change.                                 |

The links these flows mail carry signed tokens rather than stored ones, so **rotating `secret` invalidates every link that has not been used yet** (and every session, which is signed with the same secret). See [Users](/guides/users/#the-tokens).

## Reading the configuration in your code

The configuration is exposed on the global `henri` object. Keys use dots (and brackets for arrays):

```js
henri.config.get('stores.default.adapter'); // throws if the key is missing
henri.config.get('mail', true); // returns false instead of throwing
henri.config.has('baseRole');
```
