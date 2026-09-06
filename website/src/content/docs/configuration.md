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
  "renderer": "react",
  "user": "user",
  "baseRole": "guest"
}
```

The file is parsed on boot: a syntax error is reported with its line, and the boot stops when no file can be loaded. The loaded object is frozen.

Every key below is declared in `@usehenri/core`, so an editor completes them as you type. `henri.config.get()` and a hand-built configuration object take the same shape, `import('@usehenri/core').Configuration` — see [Types](/reference/types/).

## Keys

| Key                | Default       | Description                                                                                                                                    |
| ------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`             | `3000`        | Port to listen on. In development a busy port is replaced by the next free one; under `NODE_ENV=test` the kernel assigns one.                  |
| `host`             | see below     | Interface to bind: `127.0.0.1` outside production, `0.0.0.0` in production. `HENRI_HOST` (what `henri server --host` sets) wins over the file. |
| `cors`             | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options.                              |
| `renderer`         | `template`    | View engine: `react`, `inertia` or `template` (Handlebars). `henri new` writes `react`. See [Views](/guides/views/).                           |
| `inertia`          |               | Options of the Inertia renderer: `ssr`, `id`, `entry`, `ssrEntry`, `template`. See [Views](/guides/views/#inertia).                            |
| `experimental`     |               | Opt-in to unmaintained renderers: `{ "vue": true }`.                                                                                           |
| `stores`           |               | Named database stores, see below. A model picks one with its `store` key or uses `default`.                                                    |
| `secret`           |               | Session and token secret. Required as soon as a user model exists; usually provided by `HENRI_SECRET`.                                         |
| `user`             | `user`        | Name of the user model, or an object (below). See [Users](/guides/users/).                                                                     |
| `baseRole`         |               | Role, or list of roles, given to every new user.                                                                                               |
| `trustProxy`       | `true`        | Express `trust proxy` setting: `X-Forwarded-*` headers from a reverse proxy are honoured. Set `false` without one.                             |
| `csrf`             | `true`        | `false` disables the [CSRF protection](/guides/users/#csrf).                                                                                   |
| `graphql`          | `/_henri/gql` | Path of the GraphQL endpoint. See [GraphQL](/guides/graphql/).                                                                                 |
| `mail`             |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                                             |
| `mailers`          |               | Defaults of the [mailers](/guides/mail/): `from`, `layout` and `previews`, see below.                                                          |
| `api`              |               | Pagination, strict HAL and idempotency settings of the [JSON API](/guides/api/), see below.                                                    |
| `rateLimit`        | `600`/min     | Global, authentication and shared-store rate limits, see below. `false` disables them.                                                         |
| `helmet`           | on            | Options merged over henri's [helmet](https://helmetjs.github.io/) defaults; `false` disables it.                                               |
| `filterParameters` | see below     | Parameter names masked in the logs.                                                                                                            |
| `bodyLimit`        | `1mb`         | Maximum size of a JSON or form body.                                                                                                           |
| `requestTimeout`   | `30000`       | Milliseconds before a running request is answered `503`; `false` disables it.                                                                  |

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
| `path`, `dbName`, `port`                           | disk          | Data directory, relative to the application (`.henri/data`), database name (`henri`), and the port mongod listens on (one derived from the process id, between 20000 and 26999, so parallel boots never collide).        |
| `logging`, `pool`, `dialectOptions`, ...           | SQL           | Every other key is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace.                                                                                                                  |
| `dialect`                                          | drizzle       | `sqlite`, `postgres` or `mysql`; the app installs the driver (`better-sqlite3`, `pg` or `mysql2`).                                                                                                                       |
| `sync`, `migrate`                                  | drizzle       | `sync: false` stops the development boot from pushing the schema; `migrate: true` applies `db/migrations` on a production boot. On mysql a push only creates the missing tables (see [Models](/guides/models/#drizzle)). |

See [Models](/guides/models/#adapters) for each adapter.

## JSON API

The keys of the [JSON API](/guides/api/), all optional:

| Key                                   | Default                                            | Description                                                                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api.perPage`, `api.maxPerPage`       | `25`, `100`                                        | Page size read by `req.pagination()` and its upper bound.                                                                                                                                    |
| `api.strict`                          | `false`                                            | Refuse (500) a JSON answer without `_links` on a `resources`/`crud` route instead of logging it.                                                                                             |
| `api.idempotency`                     | `{ "ttl": 86400000, "store": null }`               | How long answers are kept for `Idempotency-Key` replays and the module exporting a shared `{ get, set, delete }` store; `false` disables the feature.                                        |
| `rateLimit.windowMs`, `rateLimit.max` | `60000`, `600`                                     | The global limit per user or ip, not enforced in development.                                                                                                                                |
| `rateLimit.auth`                      | `{ "windowMs": 60000, "max": 10 }`                 | The limit on `POST` to the login and register-style paths (`paths` overrides the list); `false` disables it.                                                                                 |
| `rateLimit.store`                     |                                                    | Module exporting an express-rate-limit `Store` (or a `(henri, { name }) => store` factory) shared between processes.                                                                         |
| `helmet`                              |                                                    | Options merged over henri's defaults (a development CSP that allows hot reloading, no HSTS outside production, `upgrade-insecure-requests` only on https requests); `false` disables helmet. |
| `filterParameters`                    | `["password", "token", "secret", "authorization"]` | Substrings of the parameter names masked in everything `henri.pen` prints.                                                                                                                   |
| `bodyLimit`                           | `"1mb"`                                            | Passed to the JSON and urlencoded body parsers.                                                                                                                                              |
| `requestTimeout`                      | `30000`                                            | Milliseconds before a `503`; `false` disables the timeout.                                                                                                                                   |

## Environment and `.env`

On boot henri reads `.env` in the application directory (`KEY=value` lines, optional `export`, quotes stripped, `#` comments; variables already set in the environment win), then applies what the environment says over the file it loaded. Every key is reachable, so a container image needs no configuration file written at start time: the committed `config/production.json` describes the application and the environment carries what changes between deployments.

### Precedence

Lowest first, one story for every variable:

1. the configuration file: `config/<NODE_ENV>.json`, or `config/default.json` when it does not exist (the two are never merged);
2. the named shorthands, in the table below;
3. `HENRI_CONFIG__<key>`, which names the key it sets and wins over everything.

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

**The type comes from the file, henri never guesses it.** When the configuration already has a value at that path, the variable is read as its type: a number for `port`, `true`/`false` for a boolean, JSON for an object. A path the file does not have is a string — a connection string stays a connection string even when it looks like a number. `HENRI_CONFIG_JSON__<key>` parses the value as JSON in every case, which is how you set a nested object, an array, or a key no file declares.

A value that does not fit its key fails the boot, naming the variable and the type it expected. A variable set to nothing fails too (`HENRI_CONFIG__port is set but empty: give it a value or unset it`): a missing variable is simply not an override and never becomes an empty string. The value itself is never part of an error message — it may be a secret.

### What the boot prints

Every key the environment provided is printed, so nobody debugs a value they cannot see:

```
config ✏ from the environment => secret = [FILTERED] => HENRI_SECRET
config ✏ from the environment => stores.default.url = postgres://henri:[FILTERED]@db:5432/app => DATABASE_URL
config ✏ from the environment => port = 8080 => HENRI_CONFIG__port
```

A key whose name matches `filterParameters` (`password`, `token`, `secret`, `authorization` by default) is masked, and so is the password of a connection string, which no filter list would ever name. `henri.config.fromEnv` holds the same list as `{ key, variable }` pairs — the paths and the variable names, never the values.

## The `user` object

`user` is the name of the model to treat as the user model. It also accepts an object:

```json
{
  "user": {
    "model": "user",
    "public": ["name", "avatar"],
    "loginPath": "/login",
    "afterLogin": "/",
    "sessionMaxAge": 2592000000
  }
}
```

`public` lists the fields, besides `id`, `email` and `roles`, that views and JSON answers may see; `loginPath` is where browsers are sent when a route denies them; `afterLogin` where they land after a form login; `sessionMaxAge` the session lifetime in milliseconds (30 days). See [Users](/guides/users/).

## Reading the configuration in your code

The configuration is exposed on the global `henri` object. Keys use dots (and brackets for arrays):

```js
henri.config.get('stores.default.adapter'); // throws if the key is missing
henri.config.get('mail', true); // returns false instead of throwing
henri.config.has('baseRole');
```
