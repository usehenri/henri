---
title: Models
description: Define models under app/models in one format for every adapter, and pick a database.
sidebar:
  order: 1
---

Models live in `app/models`. Every `.js` file there (subdirectories included) is loaded on boot, registered with its store adapter and exposed as a global named after the file: `app/models/Task.js` is `Task` everywhere in the application, like in Rails. Two files with the same name, whatever the case, stop the boot. The global is the ORM model itself, so you query it with the [Mongoose](https://mongoosejs.com/) API on MongoDB, the [Sequelize](https://sequelize.org/) API on SQL databases, or the adapter's own Rails-like API on the [Drizzle](#drizzle) adapter.

The model ids are also written to `.henri/globals.json` on boot; the scaffolded `eslint.config.js` reads that file so the linter knows the globals.

## A model file

```js
// app/models/Task.js
module.exports = {
  store: 'default', // a store name from your configuration (default: 'default')
  name: 'tasks', // collection or table name (optional, the ORM names it otherwise)
  options: { timestamps: true }, // Mongoose schema options, or Sequelize model options
  schema: {
    name: { type: 'string', required: true },
    category: {
      type: 'string',
      enum: ['urgent', 'high', 'medium', 'low'],
      default: 'low',
    },
    done: { type: 'boolean', default: false },
  },
};
```

| Key                 | Description                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `schema`            | The fields, in the format below.                                                                            |
| `options`           | Handed to `new mongoose.Schema()` or `sequelize.define()` as is.                                            |
| `store`             | The store to use, `default` when omitted. The boot fails when the store is not configured.                  |
| `name`              | Collection name (Mongoose) or `tableName` (Sequelize).                                                      |
| `graphql`           | `{ types, resolvers }` merged into the application schema. See [GraphQL](/guides/graphql/).                 |
| `associate(models)` | Called once every model of the store exists, with the models keyed by global name. Declare relations there. |

```js
// app/models/Comment.js
module.exports = {
  schema: { body: { type: 'text', required: true } },
  associate(models) {
    // Sequelize: models.Comment.belongsTo(models.Post)
    // Mongoose: nothing to do, use { type: 'ObjectId', ref: 'Post' } in the schema
  },
};
```

On SQL, `associate()` runs before `sync()`, so the foreign keys end up in the tables.

## The schema format

A field is `{ type, ...keys }` or a bare type. The type names and the keys below mean the same thing on every adapter, so a model written for the disk adapter moves to MongoDB or PostgreSQL unchanged.

| Type      | Mongoose  | Sequelize |
| --------- | --------- | --------- |
| `string`  | `String`  | `STRING`  |
| `text`    | `String`  | `TEXT`    |
| `number`  | `Number`  | `DOUBLE`  |
| `integer` | `Number`  | `INTEGER` |
| `float`   | `Number`  | `FLOAT`   |
| `boolean` | `Boolean` | `BOOLEAN` |
| `date`    | `Date`    | `DATE`    |
| `json`    | `Mixed`   | `JSON`    |
| `uuid`    | `String`  | `UUID`    |

| Key        | Description                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `required` | `required: true` (Mongoose) or `allowNull: false` (Sequelize).                                     |
| `default`  | Default value. `Date.now` becomes `NOW` on SQL.                                                    |
| `enum`     | Allowed values. An `ENUM` column on MySQL, MariaDB and PostgreSQL, an `isIn` validation elsewhere. |
| `unique`   | Unique index or constraint.                                                                        |
| `index`    | `index: true` adds an index on the field.                                                          |

What the adapters do with anything else differs:

- **Mongoose** passes every other key and type through, so `{ type: 'ObjectId', ref: 'Post' }`, `[String]`, nested objects, `lowercase`, `trim`, `match`, `select`, `validate` and the JavaScript constructors (`String`, `Number`, `Date`) all work. It also understands the Sequelize spellings `allowNull: false` and `defaultValue`.
- **Sequelize** accepts its own attribute options (`allowNull`, `defaultValue`, `validate`, `field`, `primaryKey`, `autoIncrement`, `references`, `onDelete`, `onUpdate`, `comment`, `get`, `set`, `values`, ...), its data types (`type: DataTypes.STRING(50)` or the uppercase name as a string, `'STRING'`), the JavaScript constructors (`Object` and `Array` become `JSON`, `Buffer` a `BLOB`), and stores nested objects and arrays as `JSON`. Any other key throws at boot with the list of supported keys, so a typo never becomes a silently ignored option. A field with a known key but no `type` is an error too.

`@usehenri/mongoose/types` and `@usehenri/sequelize/types` export the map above if you need the ORM types themselves.

## Generating a model

```bash
henri generate model Post title:string! body:text published:boolean views:integer
```

writes `app/models/Post.js` with `timestamps: true`, one field per `name:type` argument (`string` when the type is omitted, `!` marks it required) and refuses unknown types. `henri generate scaffold` and `crud` start with the same model and add the controller, routes and views; see the [CLI reference](/reference/cli/#generators).

## Querying

The global is the ORM model. Nothing is wrapped:

```js
// Mongoose (disk, mongoose)
await Task.find({ done: false }).sort({ createdAt: -1 });
await Task.findById(id);
await Task.create(req.permit('name', 'category'));

// Sequelize (mysql, postgresql, mssql)
await Task.findAll({ where: { done: false } });
await Task.findByPk(id);
await Task.create(req.permit('name', 'category'));
```

Use [`req.permit()`](/guides/controllers/#reqpermitfields) rather than `req.body` when you create or update records.

## The user model

When a model matches the configured `user` name (`user` by default, so `app/models/User.js`), the adapter adds three fields to it:

| Field      | Behaviour                                                                                                                                                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email`    | Required, unique, trimmed and lowercased on write, validated as an email address.                                                                                                                                                         |
| `password` | Required. Hashed with bcrypt before every write, including `updateOne()`, `findByIdAndUpdate()` and bulk operations. Not selected by default: `User.findOne(query).select('+password')` on Mongoose, `User.scope('withPassword')` on SQL. |
| `roles`    | A list of strings, `config.baseRole` for a new user. Dropped from mass-assigned creates and updates: `User.create(req.body)` cannot grant a role. On SQL it is a `JSON` column (`TEXT` with a JSON getter on MSSQL).                      |

and three methods:

```js
await user.hasRole(['admin']); // true when the user owns every role
await user.setRoles(['admin', 'editor']); // replaces the roles and saves
await User.setRoles(id, ['admin']); // same, by id (null when not found)
```

An operation flagged unsafe may write `roles` directly: `doc.save({ unsafe: true })`, `User.create([doc], { unsafe: true })`, `User.updateOne(filter, update, { unsafe: true })`, or `doc.$locals.unsafe = true` before a save (Mongoose).

Server side, `henri.user.findByEmail(email)` (lowercases its argument and returns the instance with its password hash), `henri.user.findById(id)` (without the hash), `henri.user.publicUser(user)`, `henri.user.encrypt(password)` and `henri.user.compare(password, hash)` work the same on every adapter. Login, sessions, CSRF and roles are described in [Users](/guides/users/).

## Adapters

Each adapter is a package to install in the application; the name in `stores.<name>.adapter` selects it. All of them implement the same contract, documented in the [API reference](/reference/api/#store-adapters), and expose a few helpers on the store object, `henri.model.stores.<name>`:

```js
await henri.model.stores.default.ping(); // true when the database answers
await henri.model.stores.default.transaction(async (t) => { ... }); // Sequelize transaction, or Mongoose session (needs a replica set)
await henri.model.stores.default.query('SELECT 1 + ?', [1]); // SQL adapters only
```

Sessions are stored in the database of the user model's store: a `henriSessions` collection on MongoDB, a table created by connect-session-sequelize on SQL (the `session` key of the store configures either).

### Disk

A MongoDB instance started for you by [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server), persisted under `.henri/data` in the application directory (`path` changes it, `dbName` the database name, `henri` by default). Under `NODE_ENV=test` the data stays in memory, so every test run starts empty. Zero configuration, no server to install, a warning in production: it is a development store.

```bash
pnpm add @usehenri/disk
```

```json
{ "stores": { "default": { "adapter": "disk" } } }
```

The first boot downloads the MongoDB binary into `~/.cache/mongodb-binaries`.

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

`host`, `port`, `database`, `username` and `password` are accepted instead of `url`. `opts` is passed to `mongoose.connect()`; `serverSelectionTimeoutMS` and `connectTimeoutMS` default to 10 seconds, so a wrong url fails the boot quickly. A store without `url` or `host` fails the boot.

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

Use `"adapter": "mariadb"` with a `mariadb://` url for MariaDB; the same package (mysql2 driver) handles both.

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

### Drizzle

An SQL adapter on [Drizzle ORM](https://orm.drizzle.team/) with migrations, for sqlite, PostgreSQL and MySQL. It is the adapter henri intends to make the SQL default; the Sequelize-based ones stay supported. Install it with the driver of your dialect:

```bash
pnpm add @usehenri/drizzle better-sqlite3   # or pg, or mysql2
```

```json
{
  "stores": {
    "default": {
      "adapter": "drizzle",
      "dialect": "sqlite",
      "url": "file:.henri/app.db"
    }
  }
}
```

`dialect` is `sqlite`, `postgres` or `mysql`; `url` is a file path for sqlite and a connection string otherwise. The model format above compiles to Drizzle tables: plural snake_case tables, snake_case columns, an `id` primary key, `createdAt`/`updatedAt` with `options.timestamps`. On top of the shared keys, fields accept `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim` and `references`.

The global is not a Mongoose or Sequelize model but the adapter's own, with one API that also answers to the Mongoose and Sequelize names:

```js
const task = await Task.create({ title: 'Ship it' });
const open = await Task.where({ done: false })
  .order('createdAt desc')
  .limit(20);
const withOwner = await Task.where({ id }).include('owner').first();
await task.update({ done: true });
await Task.destroy({ done: true });
await henri.model.stores.default.transaction(async () => {
  /* every query in here joins the transaction */
});
```

Validation failures throw a `ValidationError` whose `errors[field].message` is what the generated controllers read, unique violations included. Models can export `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy` and `afterDestroy` hooks, and `associate(models)` declares `belongsTo`, `hasMany` and `hasOne` associations that `include()` loads eagerly. The user model gets the same email, password and roles behaviour as the other adapters, and sessions are stored in a `henri_sessions` table.

Migrations live in `db/migrations` in the drizzle-kit layout, and `henri db` drives them like `rails db`:

```bash
henri db:status                          # applied and pending migrations
henri db:generate --name=add-priority    # writes db/migrations/0001_add_priority.sql from the models
henri db:migrate                         # applies the pending migrations
henri db:push                            # makes the database match the models, no migration (development)
```

In development the boot pushes the schema unless the store sets `"sync": false`; in production the boot applies the pending migrations when the store sets `"migrate": true` and warns about them otherwise. `henri db:push` refuses statements that lose data unless `--force` is passed; every command accepts `--store=<name>` and `--json`.

### SQL adapters

The three SQL packages are thin dialects over `@usehenri/sequelize`. `host`, `port`, `database`, `username` and `password` are accepted instead of `url`; a store with none of them fails the boot. Every other key of the store (`pool`, `dialectOptions`, `logging`, ...) is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace (`henri server --debug=henri:sequelize` prints the queries) and credentials are redacted from that output.

On boot the adapter authenticates, calls the `associate()` exports and runs `sequelize.sync()`: tables are created or extended from the models. There are no migrations.
