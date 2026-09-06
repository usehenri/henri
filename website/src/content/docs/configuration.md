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
      "adapter": "mongoose",
      "url": "mongodb://localhost:27017/myapp"
    },
    "scratch": {
      "adapter": "disk"
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

| Key                | Default       | Description                                                                                                                                     |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`             | `3000`        | Port to listen on. In development a busy port is replaced by the next free one; under `NODE_ENV=test` the kernel assigns one.                   |
| `host`             | see below     | Interface to bind: `127.0.0.1` outside production, `0.0.0.0` in production. `HENRI_HOST` (what `henri server --host` sets) wins over the file.  |
| `cors`             | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options.                               |
| `renderer`         | `template`    | View engine: `inertia`, `react` or `template` (Handlebars), whatever the case. `henri new` writes `inertia`. See [Views](/guides/views/).       |
| `inertia`          |               | Options of the Inertia renderer: `ssr`, `id`, `entry`, `ssrEntry`, `template`. See [Views](/guides/views/#inertia).                             |
| `experimental`     |               | Opt-in to unmaintained renderers: `{ "vue": true }`.                                                                                            |
| `stores`           |               | Named database stores, see below. A model picks one with its `store` key or uses `default`.                                                     |
| `secret`           |               | Session and token secret. Required as soon as a user model exists; usually provided by `HENRI_SECRET`.                                          |
| `url`              | the local url | Canonical address of the application (`https://example.com`), used for the links inside the mails henri sends. Set it in production.           |
| `user`             | `user`        | Name of the user model, or an object (below). See [Users](/guides/users/).                                                                      |
| `baseRole`         |               | Role, or list of roles, given to every new user.                                                                                                |
| `trustProxy`       | `true`        | Express `trust proxy`: `true`, a hop count or a list of addresses; `X-Forwarded-*` headers are honoured. Set `false` without a proxy.           |
| `csrf`             | `true`        | `false` disables the [CSRF protection](/guides/users/#csrf); an object configures the origin check, below.                                      |
| `graphql`          | `/_henri/gql` | Path of the GraphQL endpoint, or an object with its limits and access rules, below; needs `@usehenri/graphql`. See [GraphQL](/guides/graphql/). |
| `mail`             |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                                              |
| `mailers`          |               | Defaults of the [mailers](/guides/mail/): `from`, `layout` and `previews`, see below.                                                           |
| `api`              |               | Pagination, strict HAL and idempotency settings of the [JSON API](/guides/api/), see below.                                                     |
| `jobs`             |               | Settings of the [job queue](/guides/jobs/), see below. The queue also loads when `app/jobs` holds a file.                                       |
| `rateLimit`        | `600`/min     | Global, authentication and shared-store rate limits, see below. `false` disables them, `true` keeps the defaults.                               |
| `helmet`           | on            | Options merged over henri's [helmet](https://helmetjs.github.io/) defaults; `false` disables it.                                                |
| `filterParameters` | see below     | Parameter names masked in the logs; `false` masks nothing.                                                                                      |
| `bodyLimit`        | `1mb`         | Maximum size of a JSON or form body.                                                                                                            |
| `requestTimeout`   | `30000`       | Milliseconds before a running request is answered `503`; `false` disables it.                                                                   |

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

| Key                                                | Adapters      | Description                                                                                                                                                                                                              |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `adapter`                                          | all           | `disk`, `mongoose`, `mysql`, `mariadb`, `postgresql`, `mssql` or `drizzle`.                                                                                                                                              |
| `url`                                              | mongoose, SQL | Connection string. Required unless `host` is given (`mariadb://` is accepted by the mysql adapter).                                                                                                                      |
| `host`, `port`, `database`, `username`, `password` | mongoose, SQL | Alternative to `url`. On mongoose, `host` may also be a full `mongodb://` url.                                                                                                                                           |
| `opts`                                             | mongoose      | Options passed to `mongoose.connect()`; henri sets `connectTimeoutMS` and `serverSelectionTimeoutMS` to 10 seconds.                                                                                                      |
| `session`                                          | mongoose, SQL | Options of the session store (connect-mongo, whose collection is `henriSessions`, or connect-session-sequelize).                                                                                                         |
| `sessions`                                         | drizzle       | `true` creates the session table even when the application has no user model.                                                                                                                                            |
| `path`, `dbName`, `port`                           | disk          | Data directory, relative to the application (`.henri/data`), database name (`henri`), and the port mongod listens on (one derived from the process id, between 20000 and 26999, so parallel boots never collide).        |
| `logging`, `pool`, `dialectOptions`, ...           | SQL           | Every other key is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace.                                                                                                                  |
| `dialect`                                          | drizzle       | `sqlite`, `postgres` or `mysql`; the app installs the driver (`better-sqlite3`, `pg` or `mysql2`).                                                                                                                       |
| `sync`, `migrate`                                  | drizzle       | `sync: false` stops the development boot from pushing the schema; `migrate: true` applies `db/migrations` on a production boot. On mysql a push only creates the missing tables (see [Models](/guides/models/#drizzle)). |

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

## Headers, logs and limits

| Key                | Default                                            | Description                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `helmet`           |                                                    | Options merged over henri's defaults (a development CSP that allows hot reloading, no HSTS outside production, `upgrade-insecure-requests` only on https requests), plus `permissionsPolicy` (a `Permissions-Policy` value, or `false`); `false` disables helmet. |
| `filterParameters` | `["password", "token", "secret", "authorization"]` | Substrings of the parameter names masked in everything `henri.pen` prints; `false` masks nothing.                                                                                                                                                                 |
| `bodyLimit`        | `"1mb"`                                            | Passed to the JSON and urlencoded body parsers; a string (`"1mb"`) or a number of bytes.                                                                                                                                                                          |
| `requestTimeout`   | `30000`                                            | Milliseconds before a `503`; `false` disables the timeout.                                                                                                                                                                                                        |

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

A key whose name matches `filterParameters` (`password`, `token`, `secret`, `authorization` by default) is masked, and so is the password of a connection string, which no filter list would ever name. The match is the same substring rule as everywhere else in the logs, so a key the defaults do not cover — `mail.auth.pass`, an `apiKey` — belongs in `filterParameters` if it is to be masked here too. `henri.config.fromEnv` holds the same list as `{ key, variable }` pairs — the paths and the variable names, never the values.

## Encrypted credentials

Rails' `credentials:edit`, in henri. `config/credentials/<env>.json.enc` holds the secrets of one environment, encrypted, and is **committed with the application**; the key that opens it never is. A deployment then carries one secret instead of twenty, and adding a secret to staging is a commit rather than a round of environment variables.

```bash
henri credentials:edit                     # the development environment
henri credentials:edit --env production    # creates the key and the file
henri credentials:show --env production --json   # the key paths, no values
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

Everything the [job queue](/guides/jobs/) reads, all of it optional. It only loads when this key is there or when `app/jobs` holds a file.

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

| Key                     | Default | Description                                                                                                                                                |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `password.minLength`    | `12`    | Shortest password accepted. Never below `8`. Checked when a password is set, never when one is verified.                                                   |
| `password.maxBytes`     | `72`    | Longest, in bytes: bcrypt ignores everything past 72 and henri will not truncate silently.                                                                 |
| `password.algorithm`    | `auto`  | `auto` (argon2id when `@node-rs/argon2` resolves, bcrypt otherwise), `argon2id` (fails the boot when it does not) or `bcrypt`.                             |
| `password.bcryptRounds` | `12`    | bcrypt work factor. Never below `10`.                                                                                                                      |
| `password.memoryCost`   | `19456` | argon2id memory in kibibytes.                                                                                                                              |
| `password.timeCost`     | `2`     | argon2id iterations.                                                                                                                                       |
| `password.parallelism`  | `1`     | argon2id lanes.                                                                                                                                            |
| `password.pepper`       | off     | A server-side key mixed into every hash, its own, never `config.secret`. `HENRI_PASSWORD_PEPPER` sets it. **Losing it makes every password unverifiable.** |

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

`henri server` exits `1` and `henri server --json` prints the same thing as `{ "error": { "code": "CONFIG_INVALID", "message", "hint", "problems": [...] } }`, where each problem is `{ key, level, message, expected, received, source, hint }`.

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
henri doctor --json    # problems as { check, level, message, file, hint }
```

The checks are `config.invalid` (an error), `config.adapter` (an unknown store adapter) and `config.unknown` (a warning). Being a file check, it sees neither the environment nor the credentials; the boot does.

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
