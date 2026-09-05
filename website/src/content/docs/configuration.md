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

## Keys

| Key            | Default       | Description                                                                                                                                    |
| -------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`         | `3000`        | Port to listen on. In development a busy port is replaced by the next free one.                                                                |
| `host`         | see below     | Interface to bind: `127.0.0.1` outside production, `0.0.0.0` in production. `HENRI_HOST` (what `henri server --host` sets) wins over the file. |
| `cors`         | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options.                              |
| `renderer`     | `template`    | View engine: `react`, `inertia` or `template` (Handlebars). `henri new` writes `react`. See [Views](/guides/views/).                           |
| `inertia`      |               | Options of the Inertia renderer: `ssr`, `id`, `entry`, `ssrEntry`, `template`. See [Views](/guides/views/#inertia).                            |
| `experimental` |               | Opt-in to unmaintained renderers: `{ "vue": true }`.                                                                                           |
| `stores`       |               | Named database stores, see below. A model picks one with its `store` key or uses `default`.                                                    |
| `secret`       |               | Session and token secret. Required as soon as a user model exists; usually provided by `HENRI_SECRET`.                                         |
| `user`         | `user`        | Name of the user model, or an object (below). See [Users](/guides/users/).                                                                     |
| `baseRole`     |               | Role, or list of roles, given to every new user.                                                                                               |
| `trustProxy`   | `true`        | Express `trust proxy` setting: `X-Forwarded-*` headers from a reverse proxy are honoured. Set `false` without one.                             |
| `csrf`         | `true`        | `false` disables the [CSRF protection](/guides/users/#csrf).                                                                                   |
| `graphql`      | `/_henri/gql` | Path of the GraphQL endpoint. See [GraphQL](/guides/graphql/).                                                                                 |
| `mail`         |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                                             |

## Stores

Each entry of `stores` names an adapter and how to reach its database. The adapter package (`@usehenri/<adapter>`) must be installed in the application.

| Key                                                | Adapters      | Description                                                                                                                     |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`                                          | all           | `disk`, `mongoose`, `mysql`, `mariadb`, `postgresql`, `mssql` or `drizzle`.                                                     |
| `url`                                              | mongoose, SQL | Connection string. Required unless `host` is given (`mariadb://` is accepted by the mysql adapter).                             |
| `host`, `port`, `database`, `username`, `password` | mongoose, SQL | Alternative to `url`. On mongoose, `host` may also be a full `mongodb://` url.                                                  |
| `opts`                                             | mongoose      | Options passed to `mongoose.connect()`; henri sets `connectTimeoutMS` and `serverSelectionTimeoutMS` to 10 seconds.             |
| `session`                                          | mongoose, SQL | Options of the session store (connect-mongo, whose collection is `henriSessions`, or connect-session-sequelize).                |
| `path`, `dbName`                                   | disk          | Data directory, relative to the application (`.henri/data`), and database name (`henri`).                                       |
| `logging`, `pool`, `dialectOptions`, ...           | SQL           | Every other key is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace.                         |
| `dialect`                                          | drizzle       | `sqlite`, `postgres` or `mysql`; the app installs the driver (`better-sqlite3`, `pg` or `mysql2`).                              |
| `sync`, `migrate`                                  | drizzle       | `sync: false` stops the development boot from pushing the schema; `migrate: true` applies `db/migrations` on a production boot. |

See [Models](/guides/models/#adapters) for each adapter.

## Environment and `.env`

On boot henri reads `.env` in the application directory (`KEY=value` lines, optional `export`, quotes stripped, `#` comments; variables already set in the environment win) and applies these overrides:

| Variable       | Effect                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `HENRI_SECRET` | Provides or replaces `secret`, so the secret can stay out of `config`. |
| `HENRI_HOST`   | Replaces `host` (what `henri server --host` sets).                     |
| `NODE_ENV`     | Selects the configuration file. `henri server --production` sets it.   |

Nothing else in the configuration is expanded from the environment: for a container, write `config/production.json` at start time (the repository's `docker/entrypoint.sh` does exactly that).

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
