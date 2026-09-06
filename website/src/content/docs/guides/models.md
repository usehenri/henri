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
  options: {}, // timestamps: false, paranoid: true, and the ORM's own options
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

| Key                 | Description                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`            | The fields, in the format below.                                                                                                         |
| `options`           | `timestamps`, `paranoid` and `personal` (below), plus anything the ORM takes: handed to `new mongoose.Schema()` or `sequelize.define()`. |
| `store`             | The store to use, `default` when omitted. The boot fails when the store is not configured.                                               |
| `name`              | Collection name (Mongoose) or `tableName` (Sequelize).                                                                                   |
| `graphql`           | `{ types, resolvers }` merged into the application schema; needs `@usehenri/graphql`. See [GraphQL](/guides/graphql/).                   |
| `associate(models)` | Called once every model of the store exists, with the models keyed by global name. Declare relations there.                              |

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

The keys above and the nine field types are declared in `@usehenri/core`: a `/** @type {import('@usehenri/core').ModelFile} */` line, which `henri generate model` writes, is enough for an editor to complete them. The model itself is the ORM's, and stays untyped — see [Types](/reference/types/).

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

| Key        | Description                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `required` | `required: true` (Mongoose) or `allowNull: false` (Sequelize).                                                |
| `default`  | Default value. `Date.now` becomes `NOW` on SQL.                                                               |
| `enum`     | Allowed values. An `ENUM` column on MySQL, MariaDB and PostgreSQL, an `isIn` validation elsewhere.            |
| `unique`   | Unique index or constraint.                                                                                   |
| `index`    | `index: true` adds an index on the field.                                                                     |
| `personal` | This field is about a person: masked in the logs, exported and erased. See [Personal data](/guides/privacy/). |

What the adapters do with anything else differs:

- **Mongoose** passes every other key and type through, so `{ type: 'ObjectId', ref: 'Post' }`, `[String]`, nested objects, `lowercase`, `trim`, `match`, `select`, `validate` and the JavaScript constructors (`String`, `Number`, `Date`) all work. It also understands the Sequelize spellings `allowNull: false` and `defaultValue`.
- **Sequelize** accepts its own attribute options (`allowNull`, `defaultValue`, `validate`, `field`, `primaryKey`, `autoIncrement`, `references`, `onDelete`, `onUpdate`, `comment`, `get`, `set`, `values`, ...), its data types (`type: DataTypes.STRING(50)` or the uppercase name as a string, `'STRING'`), the JavaScript constructors (`Object` and `Array` become `JSON`, `Buffer` a `BLOB`), and stores nested objects and arrays as `JSON`. Any other key throws at boot with the list of supported keys, so a typo never becomes a silently ignored option. A field with a known key but no `type` is an error too.

`@usehenri/mongoose/types` and `@usehenri/sequelize/types` export the map above if you need the ORM types themselves.

## Timestamps

Every model has `createdAt` and `updatedAt`, like every Rails table. They are written on create, `updatedAt` again on every update, and they are never mass-assigned: `Model.create(req.permit(...))` cannot set them. Opt out per model:

```js
module.exports = {
  options: { timestamps: false },
  schema: { body: { type: 'text' } },
};
```

This changed in henri 1.2: before it, only `options: { timestamps: true }` added them on the Mongoose and Drizzle adapters (Sequelize already added them by default). See [Upgrading](/upgrading/#timestamps-are-on-by-default).

## Identifiers

Every record has two identifiers, and only one of them is public.

The primary key is what it has always been: a `bigint` on SQL, an `ObjectId` on MongoDB. It is what the foreign keys, the joins and the indexes are made of, and it stays on the server. Alongside it, every model carries `externalId`: a uuid, stored in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database itself, generated on the insert when the caller brings none.

`externalId` is the only identifier that leaves the server. Routes, hypermedia links, path helpers, the `Location` header of a `201` and the data a page receives all carry it; `toJSON()` drops the primary key, so a numeric id never reaches a browser and nobody can count up from `/tasks/1` to see how many tasks there are, or guess the next one.

```js
const task = await Task.create({ name: 'Ship it' });

task.id; // 42, on the server
task.externalId; // '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'
JSON.stringify(task); // {"name":"Ship it","externalId":"0199a5c1-...", ...}
```

The values are [UUID version 7](https://www.rfc-editor.org/rfc/rfc9562): the first 48 bits are the Unix time in milliseconds, so the values a busy table writes are close to each other and the unique index appends to its right edge instead of scattering writes over the whole b-tree the way a version 4 uuid does. Any uuid you supply yourself is accepted (and lowercased), whatever its version.

### Looking a record up

`Model.findById()` takes either identifier, so a controller hands it `req.params.id` and does not care which one is in the url:

```js
await Task.findById('0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'); // the public id
await Task.findById(42); // the primary key
await Task.findById('42'); // the primary key, as a string
```

The two can never be confused: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one. `findByIdAndUpdate()`, `findByIdAndDelete()` and, on the Sequelize adapters, `findByPk()` take both as well.

Because both work, `/tasks/42` still answers as long as somebody types it. A controller that must refuse the internal id looks the record up on the column instead:

```js
const task = await Task.findOne({ externalId: req.params.id });
```

### The column, and opting out

```js
// app/models/Task.js
module.exports = {
  // This model keeps behaving exactly as it did: no externalId, and its
  // primary key is serialized the way it used to be
  options: { externalId: false },
  schema: { name: { type: 'string', required: true } },
};
```

Nothing else changes when a model opts out: it is the one escape hatch, for a lookup table or a legacy table you do not own.

The foreign keys are unaffected. `belongsTo` and `hasMany` keep pointing at the primary key, `include()` and `populate()` are unchanged, and a `taskId` column still holds a number. What a page or an API client sees of an association is the associated record with its own `externalId`.

## Soft deletes

`options: { paranoid: true }` is Rails' `acts_as_paranoid` (and Sequelize's own name for it): deleting a record stamps `deletedAt` instead of removing the row, and every query hides the stamped records.

```js
// app/models/Task.js
module.exports = {
  options: { paranoid: true },
  schema: { name: { type: 'string', required: true } },
};
```

```js
await task.destroy(); // deletedAt = now, the row stays
await Task.count(); // does not count it
await Task.findById(task.externalId); // null
```

The spelling of the rest follows the adapter, because the API is the adapter's own:

| Operation                | Mongoose (`disk`, `mongoose`)                                           | Sequelize (`mysql`, `postgresql`, `mssql`)                     | Drizzle                                        |
| ------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Soft delete              | `deleteOne()`, `deleteMany()`, `findByIdAndDelete()`, `doc.deleteOne()` | `destroy()`                                                    | `destroy()`, `Model.destroy(where)`            |
| Include the deleted ones | `Model.withDeleted()`, `{ withDeleted: true }`                          | `{ paranoid: false }`                                          | `Model.withDeleted()`, `{ withDeleted: true }` |
| The deleted ones only    | `Model.onlyDeleted()`                                                   | `{ where: { deletedAt: { [Op.ne]: null } }, paranoid: false }` | `Model.onlyDeleted()`                          |
| Undelete                 | `doc.restore()`, `Model.restore(filter)`                                | `doc.restore()`, `Model.restore({ where })`                    | `doc.restore()`, `Model.restore(where)`        |
| Really delete            | `{ force: true }`                                                       | `{ force: true }`                                              | `{ force: true }`                              |

```js
// Mongoose
await Task.withDeleted().countDocuments();
await Task.findByIdAndDelete(id, { force: true });

// Sequelize
await Task.findAll({ paranoid: false });
await task.destroy({ force: true });

// Drizzle
await Task.withDeleted().count();
await Task.destroy({ id }, { force: true });
```

Three things to know before turning it on: a soft deleted row still holds its `unique` values, so creating a record with the same email as a deleted one fails; eager loaded associations are not filtered, so a `populate()` or an `include()` can still surface a deleted record through its parent; and on Mongoose an aggregation pipeline sees everything, because it does not go through the query middleware.

On Mongoose the behaviour is a schema plugin: it adds the `deletedAt` path, a query middleware that adds `deletedAt: null` to reads and updates, and replacements for `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete` and `doc.deleteOne()`. On Sequelize it is Sequelize's own `paranoid`, which needs `timestamps` (on by default). On Drizzle it is part of the model layer, so relations, `count()`, `update()` and `paginate()` all honour it.

## Generating a model

```bash
henri generate model Post title:string! body:text published:boolean views:integer
```

writes `app/models/Post.js` with one field per `name:type` argument (`string` when the type is omitted, `!` marks it required) and refuses unknown types. `henri generate scaffold` and `crud` start with the same model and add the controller, routes and views; see the [CLI reference](/reference/cli/#generators).

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

// Drizzle (drizzle), which also answers to the two sets of names above
await Task.where({ done: false }).order('createdAt desc');
await Task.findById(id);
await Task.create(req.permit('name', 'category'));
```

Use [`req.permit()`](/guides/controllers/#reqpermitfields) rather than `req.body` when you create or update records.

`henri generate scaffold|crud` reads the adapter of the default store from `config/default.json` and writes the controller against that API, so the sample resource of `henri new --adapter <name>` runs on the store it configured.

### Pagination

`Model.paginate()` is the model half of [`req.pagination()`](/guides/api/#pagination): one call answering the records and the counters [`res.collection()`](/guides/api/#answering-hal) wants, on every adapter.

```js
index: async (req, res) => {
  const { records: tasks, page, perPage, total } = await Task.paginate(
    req.pagination()
  );

  return res.negotiate({
    html: () => res.render('/tasks', { data: { tasks, page, perPage, total } }),
    json: () => res.collection(tasks, { page, perPage, total }),
  });
},
```

It takes `page` and `perPage` (the rest of what `req.pagination()` returns is ignored, so the object can be handed over whole) and answers `{ records, page, perPage, total, pages }` — `pages` is the number of pages, at least 1. A missing or invalid number falls back to page 1 and 25 per page. Every other key is the adapter's own query:

```js
// Mongoose: where, sort, select, populate, lean, withDeleted
await Task.paginate({
  page: 2,
  perPage: 20,
  sort: '-createdAt',
  where: { done: false },
});

// Sequelize: any findAndCountAll option
await Task.paginate({
  include: ['owner'],
  order: [['createdAt', 'DESC']],
  page: 2,
});

// Drizzle: where, order, include, select, withDeleted; relations paginate too
await Task.paginate({ order: '-createdAt', page: 2, where: { done: false } });
await Task.where({ done: false }).order('-createdAt').paginate({ page: 2 });
```

`henri generate scaffold` and `crud` write the first form, so a generated index is one query on any store.

### Validation errors

The three ORMs reject an invalid write differently: a Mongoose `ValidationError` keyed by path, a Sequelize `SequelizeValidationError` holding an array, a Drizzle `ValidationError`, a MongoDB duplicate key or a `SequelizeUniqueConstraintError`. `henri.model.errors(error)` turns any of them into `{ field: message }`, and answers `null` for anything that is not a validation failure, so a controller can answer a 422 and let the rest bubble up:

```js
try {
  post = await Post.create(req.permit('title', 'body'));
} catch (error) {
  const errors = henri.model.errors(error);

  if (!errors) {
    throw error; // not a validation failure: a real error
  }

  return res.boom.badData(error.message, { errors });
}
```

An error with no field of its own (a model-level validation) is filed under `base`, like Rails' `errors[:base]`. The generated controllers use this helper, so a scaffold answers the same 422 body whatever the store.

## Seeds

`db/seeds.js` is Rails' `db/seeds.rb`, and `henri db:seed` runs it. The command boots the models and the user module — no views, no router, no workers — then requires the file and awaits what it exports; a function receives the running henri instance, and the model globals are there as usual. The user module is part of the boot because creating a user hashes its password through `henri.user.encrypt()`, so seeds can write users like any other record.

```js
// db/seeds.js
module.exports = async (henri) => {
  for (const name of ['Write the seeds', 'Ship it']) {
    const existing = await Task.findOne({ name });

    if (!existing) {
      await Task.create({ category: 'medium', name });
    }
  }

  henri.pen.info('seeds', 'tasks are ready');
};
```

Seeds are run again on every machine, after every reset and on every deploy, so write them idempotently: **find, then create**. `henri new` scaffolds the file with that example commented out.

```bash
henri db:seed                       # runs db/seeds.js
henri db:seed --file=db/demo.js     # another file
henri db:seed --production --json   # against the production database
```

It works on every adapter (the migration commands of `henri db` do not: those need [Drizzle](#drizzle)). Failures exit with `1` and, with `--json`, print `{ "error": { command, message, hint, code, exitCode } }` on stderr like every other command.

## The user model

When a model matches the configured `user` name (`user` by default, so `app/models/User.js`), the adapter adds five fields to it, on top of the `externalId` every model gets:

| Field               | Behaviour                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `email`             | Required, unique, trimmed and lowercased on write, validated as an email address.                                                                                                                                                                                                                                                                |
| `password`          | Required. Hashed (argon2id, or bcrypt) before every write, including `updateOne()`, `findByIdAndUpdate()` and bulk operations, and checked against `config.user.password` first. Not selected by default: `User.findOne(query).select('+password')` on Mongoose, `User.scope('withPassword')` on SQL. See [Passwords](/guides/users/#passwords). |
| `roles`             | A list of strings, `config.baseRole` for a new user. Dropped from mass-assigned creates and updates: `User.create(req.body)` cannot grant a role. On SQL it is a `JSON` column (`TEXT` with a JSON getter on MSSQL).                                                                                                                             |
| `confirmedAt`       | When the address was confirmed, `null` until it is. Written by the [confirmation flow](/guides/users/#email-confirmation); never mass-assignable.                                                                                                                                                                                                |
| `passwordChangedAt` | When the password last changed, `null` until it does. Every session opened before it stops resolving to a user, which is how a [reset](/guides/users/#the-password-reset) signs the other devices out.                                                                                                                                           |

and three methods:

```js
await user.hasRole(['admin']); // true when the user owns every role
await user.setRoles(['admin', 'editor']); // replaces the roles and saves
await User.setRoles(id, ['admin']); // same, by id (null when not found)
```

An operation flagged unsafe may write `roles` directly: `doc.save({ unsafe: true })`, `User.create([doc], { unsafe: true })`, `User.updateOne(filter, update, { unsafe: true })`, or `doc.$locals.unsafe = true` before a save (Mongoose).

Server side, `henri.user.findByEmail(email)` (lowercases its argument and returns the instance with its password hash), `henri.user.findById(id)` (without the hash), `henri.user.publicUser(user)`, `henri.user.validatePassword(password)`, `henri.user.encrypt(password)` and `henri.user.compare(password, hash)` work the same on every adapter. Login, sessions, CSRF and roles are described in [Users](/guides/users/).

## Adapters

Each adapter is a package to install in the application; the name in `stores.<name>.adapter` selects it. `henri new <folder> --adapter disk|drizzle|mongoose|mysql|postgresql|mssql` (`--dialect sqlite|postgres|mysql` with `drizzle`) writes the store block, the dependencies and the driver of a new application; `disk` is the default. All of them implement the same contract, documented in the [API reference](/reference/api/#store-adapters), and expose a few helpers on the store object, `henri.model.stores.<name>`:

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

mongod listens on a port derived from the process id, between 20000 and 26999. That is below the ephemeral ports both Linux and macOS hand out, and it is per process, so several stores starting at the same moment — test workers, a suite running beside the application, a monorepo booting more than one application — never fight over the same port. Set `port` to pin one instead, to point a GUI or `mongosh` at the store:

```json
{ "stores": { "default": { "adapter": "disk", "port": 27100 } } }
```

A pinned port is used as given: the boot fails, naming the port, rather than moving the store somewhere the application did not say.

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

An SQL adapter on [Drizzle ORM](https://orm.drizzle.team/) with migrations, for sqlite, PostgreSQL and MySQL. It is the adapter henri intends to make the SQL default; the Sequelize-based ones stay supported. `henri new my-app --adapter drizzle` scaffolds an application on it (sqlite by default, `--dialect postgres` or `--dialect mysql` for the others), or install it in an existing one with the driver of your dialect:

```bash
pnpm add @usehenri/drizzle better-sqlite3   # or pg, or mysql2
```

`better-sqlite3` compiles a native addon, so a pnpm application also needs `better-sqlite3: true` under `allowBuilds` in `pnpm-workspace.yaml` (`henri new` writes it).

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

Validation failures throw a `ValidationError` whose `errors[field].message` is what the generated controllers read, unique violations included. Models can export `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy` and `afterDestroy` hooks, and `associate(models)` declares `belongsTo`, `hasMany` and `hasOne` associations that `include()` loads eagerly. The user model gets the same email, password, roles, `confirmedAt` and `passwordChangedAt` behaviour as the other adapters, and sessions are stored in a `henri_sessions` table.

Migrations live in `db/migrations` in the drizzle-kit layout, and `henri db` drives them like `rails db`:

```bash
henri db:status                          # applied and pending migrations
henri db:generate --name=add-priority    # writes db/migrations/0001_add_priority.sql from the models
henri db:migrate                         # applies the pending migrations
henri db:push                            # makes the database match the models, no migration (development)
```

In development the boot pushes the schema unless the store sets `"sync": false`; in production the boot applies the pending migrations when the store sets `"migrate": true` and warns about them otherwise. `henri db:push` refuses statements that lose data unless `--force` is passed; every command accepts `--store=<name>` and `--json`. `henri db:seed` is the exception: it runs [`db/seeds.js`](#seeds) on any adapter.

On MySQL a push only creates the tables that do not exist yet: drizzle-kit does not alter a MySQL table on a push, so a table whose columns no longer match the model is reported (`the columns of the database and of the schema differ`) and left alone rather than altered or truncated. Change a MySQL schema with `henri db:generate` and `henri db:migrate`, which work on every dialect. sqlite and PostgreSQL push the whole diff.

### SQL adapters

The three SQL packages are thin dialects over `@usehenri/sequelize`. `host`, `port`, `database`, `username` and `password` are accepted instead of `url`; a store with none of them fails the boot. Every other key of the store (`pool`, `dialectOptions`, `logging`, ...) is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace (`henri server --debug=henri:sequelize` prints the queries) and credentials are redacted from that output.

On boot the adapter authenticates, calls the `associate()` exports and runs `sequelize.sync()`: tables are created or extended from the models. There are no migrations.

`options: { paranoid: true }` is Sequelize's own, so `restore()`, `{ paranoid: false }` and `{ force: true }` behave exactly as its documentation describes.
