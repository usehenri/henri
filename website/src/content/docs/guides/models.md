---
title: Models
description: Define models under app/models and pick a database adapter.
sidebar:
  order: 1
---

Add models under `app/models`. They are autoloaded and exposed globally, so `User`, `Task` or `Artwork` are available everywhere in your application, like in Rails.

henri uses [Mongoose](https://mongoosejs.com/) for MongoDB and [Sequelize](https://sequelize.org/) for SQL databases. The disk adapter is a local MongoDB instance managed for you, so a model written for it moves to a real MongoDB server without changes.

You can generate models from the command line:

```bash
henri g model modelname name:string! age:number notes:string birthday:date!
```

```js
// app/models/User.js

// A model named User is overloaded with email, password and roles.
// Passwords are hashed before create and update.

module.exports = {
  store: 'dev', // a store name from your configuration
  name: 'user_collection', // collection or table name, defaults to 'users'
  schema: {
    firstName: { type: 'string' },
    lastName: String,
    tasks: {},
  },
};
```

```js
// app/models/Tasks.js

module.exports = {
  store: 'default',
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      validations: {
        isIn: ['urgent', 'high', 'medium', 'low'],
      },
      defaultsTo: 'low',
    },
  },
};
```

The `schema` and `options` keys are handed to the adapter as is, so anything Mongoose or Sequelize accepts is valid there.

## The user model

When a model matches the configured `user` name (`User` by default), henri adds `email`, `password` and `roles` to its schema, hashes the password on save with bcrypt, and registers:

- `POST /login` (local strategy, `email` + `password`) and `GET /logout`
- a session store backed by the same database
- a JWT strategy reading `Authorization: Bearer <token>`
- `user.hasRole(roles)` for [route protection](/guides/routes/#roles)

`henri.user.encrypt(password)` and `henri.user.compare(password, hash)` are available if you need them directly.

## Adapters

Each adapter is a separate package. Install the ones you use in your project.

### Disk

A MongoDB instance started for you by [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server), persisted in a temporary directory keyed on your project path. Zero configuration, no server to install. Not for production.

```bash
pnpm add @usehenri/disk
```

```json
{ "stores": { "default": { "adapter": "disk" } } }
```

### MongoDB

```bash
pnpm add @usehenri/mongoose
```

```json
{
  "stores": {
    "default": {
      "adapter": "mongoose",
      "url": "mongodb://localhost:27017/myapp",
      "opts": {}
    }
  }
}
```

`opts` is passed to `mongoose.connect()`.

### MySQL and MariaDB

```bash
pnpm add @usehenri/mysql
```

```json
{
  "stores": {
    "default": {
      "adapter": "mysql",
      "url": "mysql://user:password@localhost:3306/myapp"
    }
  }
}
```

Use `"adapter": "mariadb"` with a `mariadb://` URL for MariaDB; the same package handles both.

### PostgreSQL

```bash
pnpm add @usehenri/postgresql
```

```json
{
  "stores": {
    "default": {
      "adapter": "postgresql",
      "url": "postgres://user:password@localhost:5432/myapp"
    }
  }
}
```

### MSSQL

```bash
pnpm add @usehenri/mssql
```

```json
{
  "stores": {
    "default": {
      "adapter": "mssql",
      "url": "mssql://user:password@localhost:1433/myapp"
    }
  }
}
```

For the SQL adapters, every other key in the store (`pool`, `logging`, `dialectOptions`, ...) is forwarded to Sequelize.
