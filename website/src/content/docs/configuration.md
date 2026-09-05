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

| Key        | Default       | Description                                                                                                     |
| ---------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `port`     | `3000`        | Port to listen on. In development a busy port is replaced by the next free one.                                 |
| `renderer` | `template`    | View engine: `react`, `template` (Handlebars) or `vue`. See [Views](/guides/views/).                            |
| `stores`   |               | Named database stores. Models pick one with their `store` key, or use `default`. See [Models](/guides/models/). |
| `secret`   |               | Session and JWT secret. Required as soon as you have a user model.                                              |
| `user`     | `User`        | Name of the model that represents users (login, roles, password hashing).                                       |
| `baseRole` |               | Role given to every new user.                                                                                   |
| `graphql`  | `/_henri/gql` | Path of the GraphQL endpoint. See [GraphQL](/guides/graphql/).                                                  |
| `mail`     |               | Nodemailer transport options, or `"test"` for an Ethereal test account. See [Mail](/guides/mail/).              |

## Reading the configuration in your code

The configuration is frozen and exposed on the global `henri` object:

```js
henri.config.get('stores.default.adapter'); // throws if the key is missing
henri.config.get('mail', true); // returns false instead of throwing
henri.config.has('baseRole');
```
