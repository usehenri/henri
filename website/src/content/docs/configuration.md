---
title: Configuration
description: The config directory, environments, stores, secrets and renderer.
sidebar:
  order: 2
---

Configuration is a JSON file in the `config` directory. henri loads the file matching your `NODE_ENV` and falls back to `default.json`, so you can have `default.json`, `production.json`, `test.json` and so on.

```json
{
  "stores": {
    "default": {
      "adapter": "mongoose",
      "url": "mongodb://user:pass@mongoserver.com:10914/henri-test"
    },
    "dev": {
      "adapter": "disk"
    }
  },
  "secret": "25bb9ed0b0c44cc3549f1a09fc082a1aa3ec91fbd4ce9a090b",
  "renderer": "react"
}
```

The file is validated on boot: a syntax error is reported with its line and column instead of a stack trace.

## Keys

| Key            | Default       | Description                                                                                                        |
| -------------- | ------------- | ------------------------------------------------------------------------------------------------------------------ |
| `port`         | `3000`        | Port to listen on. In development a busy port is replaced by the next free one.                                    |
| `host`         | see below     | Interface to listen on. `127.0.0.1` outside production, `0.0.0.0` in production; `HENRI_HOST` overrides it.        |
| `cors`         | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options.  |
| `renderer`     | `template`    | View engine: `react` or `template` (Handlebars). See [Views](/guides/views/).                                      |
| `experimental` |               | Opt-in to unmaintained renderers, ex: `{ "vue": true }`.                                                           |
| `stores`       |               | Named database stores. Models pick one with their `store` key, or use `default`. See [Models](/guides/models/).    |
| `secret`       |               | Session and JWT secret. Required as soon as you have a user model; `HENRI_SECRET` can provide it.                  |
| `user`         | `User`        | Name of the model that represents users (login, roles, password hashing), or an object. See [Users](#users).       |
| `baseRole`     |               | Role given to every new user.                                                                                      |
| `trustProxy`   | `true`        | Express `trust proxy` setting: `X-Forwarded-*` headers from a reverse proxy are honoured. Set `false` without one. |
| `csrf`         | `true`        | Set to `false` to disable the CSRF protection described in [Users](#users).                                        |
| `graphql`      | `/_henri/gql` | Path of the GraphQL endpoint. See [GraphQL](/guides/graphql/).                                                     |
| `mail`         |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                 |

## Environment and `.env`

On boot henri reads `.env` in the application directory (`KEY=value` lines, `#` comments; variables already set in the environment win) and applies these overrides:

| Variable       | Effect                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `HENRI_SECRET` | Provides or replaces `secret`, so the secret can stay out of `config`. |
| `HENRI_HOST`   | Replaces `host` (what `henri server --host` sets).                     |

## Users

Naming a user model adds `email`, `password` (hashed with bcrypt) and `roles` to it and mounts:

- `POST /login`, taking `email` and `password` as JSON or as a form. API clients get `{ user }` back, browsers are redirected to `afterLogin`. On failure: `401` (JSON) or a redirect to `<loginPath>?error=invalid`.
- `POST /logout`, which destroys the session and answers `{ ok: true }` or redirects to `/`. `GET /logout` is deprecated and does nothing.
- A session cookie, `henri.sid` (httpOnly, `SameSite=Lax`, `Secure` in production, 30 days), stored in the database of the user model.
- A CSRF token in the `henri.csrf` cookie. `POST`, `PUT`, `PATCH` and `DELETE` requests that carry a session must send it back in the `X-CSRF-Token` header or a `_csrf` field, otherwise they get a `403`. The React `fetch()` and `hydrate()` helpers do it for you; requests authenticated with a JWT bearer token are exempt.

`user` also accepts an object:

```json
{
  "user": {
    "model": "User",
    "public": ["name", "avatar"],
    "loginPath": "/login",
    "afterLogin": "/",
    "sessionMaxAge": 2592000000
  }
}
```

`public` lists the fields, besides `id`, `email` and `roles`, that views and JSON answers may see: `henri.user.publicUser(user)` builds that object and nothing else on the user document leaves the server. `loginPath` is where browsers are sent when a route denies them (default `/login`), `afterLogin` where they land after a form login and `sessionMaxAge` the session lifetime in milliseconds.

## Reading the configuration in your code

The configuration is frozen and exposed on the global `henri` object:

```js
henri.config.get('stores.default.adapter'); // throws if the key is missing
henri.config.get('mail', true); // returns false instead of throwing
henri.config.has('baseRole');
```
