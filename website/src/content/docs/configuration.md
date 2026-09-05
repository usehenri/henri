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

| Key            | Default       | Description                                                                                                       |
| -------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `port`         | `3000`        | Port to listen on. In development a busy port is replaced by the next free one.                                   |
| `host`         | see below     | Interface to listen on. `127.0.0.1` outside production, `0.0.0.0` in production; `HENRI_HOST` overrides it.       |
| `cors`         | off           | `true` enables [cors](https://github.com/expressjs/cors) with its defaults; an object is passed to it as options. |
| `renderer`     | `template`    | View engine: `react` or `template` (Handlebars). See [Views](/guides/views/).                                     |
| `experimental` |               | Opt-in to unmaintained renderers, ex: `{ "vue": true }`.                                                          |
| `stores`       |               | Named database stores. Models pick one with their `store` key, or use `default`. See [Models](/guides/models/).   |
| `secret`       |               | Session and JWT secret. Required as soon as you have a user model.                                                |
| `user`         | `User`        | Name of the model that represents users (login, roles, password hashing).                                         |
| `baseRole`     |               | Role given to every new user.                                                                                     |
| `graphql`      | `/_henri/gql` | Path of the GraphQL endpoint. See [GraphQL](/guides/graphql/).                                                    |
| `mail`         |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).                |

## Environment and `.env`

On boot henri reads `.env` in the application directory (`KEY=value` lines, `#` comments; variables already set in the environment win) and applies these overrides:

| Variable       | Effect                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| `HENRI_SECRET` | Provides or replaces `secret`, so the secret can stay out of `config`. |
| `HENRI_HOST`   | Replaces `host` (what `henri server --host` sets).                     |

## Reading the configuration in your code

The configuration is frozen and exposed on the global `henri` object:

```js
henri.config.get('stores.default.adapter'); // throws if the key is missing
henri.config.get('mail', true); // returns false instead of throwing
henri.config.has('baseRole');
```
