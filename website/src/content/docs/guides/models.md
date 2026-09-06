---
title: Models
description: Define models under app/models in one format for every adapter, and pick a database.
sidebar:
  order: 1
---

Models live in `app/models`. Every `.js` file there (subdirectories included) is loaded on boot, registered with its store adapter and exposed as a global named after the file: `app/models/Task.js` is `Task` everywhere in the application, like in Rails. Two files with the same name, whatever the case, stop the boot. The global is the ORM model itself, so you query it with the [Drizzle](#drizzle) adapter's own Rails-like API on sqlite, PostgreSQL and MySQL, the [Mongoose](https://mongoosejs.com/) API on MongoDB, and the [Sequelize](https://sequelize.org/) API on SQL Server.

The model ids are also written to `.henri/globals.json` on boot; the scaffolded `eslint.config.js` reads that file so the linter knows the globals.

## A model file

```js
// app/models/Task.js
module.exports = {
  store: 'default', // a store name from your configuration (default: 'default')
  name: 'tasks', // collection or table name (optional, the ORM names it otherwise)
  options: {}, // timestamps: false, paranoid: true, externalId, personal, retention, versioned
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

| Key                 | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`            | The fields, in the format below.                                                                                                                                                                                                                                                                                                                 |
| `options`           | `timestamps`, `paranoid`, `personal`, `retention`, `versioned` ([Model versions](/guides/versions/)) and `externalId` (below). A drizzle store takes those and refuses any other key at boot, naming what to write instead; Mongoose and an mssql store also pass what they do not recognize to `new mongoose.Schema()` or `sequelize.define()`. |
| `store`             | The store to use, `default` when omitted. The boot fails when the store is not configured.                                                                                                                                                                                                                                                       |
| `name`              | Collection name (Mongoose), table name (Drizzle) or `tableName` (Sequelize).                                                                                                                                                                                                                                                                     |
| `graphql`           | `{ types, resolvers }` merged into the application schema; needs `@usehenri/graphql`. See [GraphQL](/guides/graphql/).                                                                                                                                                                                                                           |
| `associate(models)` | Called once every model of the store exists, with the models keyed by global name. Declare relations there.                                                                                                                                                                                                                                      |

```js
// app/models/Comment.js
module.exports = {
  schema: { body: { type: 'text', required: true } },
  associate(models) {
    // Drizzle and Sequelize: models.Comment.belongsTo(models.Post)
    // Mongoose: nothing to do, use { type: 'ObjectId', ref: 'Post' } in the schema
  },
};
```

On SQL, `associate()` runs before the schema is brought up, so the foreign keys end up in the tables.

The keys above and the eleven field types are declared in `@usehenri/core`: a `/** @type {import('@usehenri/core').ModelFile} */` line, which `henri generate model` writes, is enough for an editor to complete them. The model itself is the ORM's, and stays untyped — see [Types](/reference/types/).

## The schema format

A field is `{ type, ...keys }` or a bare type. The type names and the keys below mean the same thing on every adapter, so a model written for the disk adapter moves to MongoDB or PostgreSQL unchanged.

| Type      | Drizzle (postgres)         | Drizzle (mysql) | Drizzle (sqlite)        | Mongoose     | Sequelize (mssql) |
| --------- | -------------------------- | --------------- | ----------------------- | ------------ | ----------------- |
| `string`  | `varchar(255)`             | `varchar(255)`  | `text`                  | `String`     | `STRING`          |
| `text`    | `text`                     | `text`          | `text`                  | `String`     | `TEXT`            |
| `number`  | `double precision`         | `double`        | `real`                  | `Number`     | `DOUBLE`          |
| `integer` | `integer`                  | `int`           | `integer`               | `Number`     | `INTEGER`         |
| `float`   | `real`                     | `float`         | `real`                  | `Number`     | `FLOAT`           |
| `decimal` | `numeric(p, s)`            | `decimal(p, s)` | `text` (the digits)     | `Decimal128` | `DECIMAL(p, s)`   |
| `bigint`  | `bigint`                   | `bigint`        | `text` (the digits)     | `BigInt`     | `BIGINT`          |
| `boolean` | `boolean`                  | `boolean`       | `integer` (`0`/`1`)     | `Boolean`    | `BOOLEAN`         |
| `date`    | `timestamp with time zone` | `datetime(3)`   | `integer` (ms of epoch) | `Date`       | `DATE`            |
| `json`    | `jsonb`                    | `json`          | `text` (JSON)           | `Mixed`      | `JSON`            |
| `uuid`    | `uuid`                     | `varchar(36)`   | `text`                  | `String`     | `UUID`            |

`decimal` and `bigint` are the two whose value a JavaScript number cannot carry, so they cross into JavaScript as exact decimal strings on every adapter. See [Exact numbers](#exact-numbers).

| Key         | Description                                                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`  | `required: true` (Mongoose) or `allowNull: false` (Drizzle, Sequelize).                                                                                                                                  |
| `default`   | Default value. `Date.now` becomes `NOW` on SQL.                                                                                                                                                          |
| `enum`      | Allowed values. An `ENUM` column on MySQL, MariaDB and PostgreSQL, an `isIn` validation elsewhere.                                                                                                       |
| `unique`    | Unique index or constraint.                                                                                                                                                                              |
| `index`     | `index: true` adds an index on the field.                                                                                                                                                                |
| `precision` | A `decimal` only: the total number of digits, 19 by default and 38 at most — the widest every dialect henri writes carries. See [Exact numbers](#exact-numbers).                                         |
| `scale`     | A `decimal` only: the digits after the point, 4 by default. A value with more of them is refused, not rounded.                                                                                           |
| `personal`  | This field is about a person: masked in the logs, exported and erased. See [Personal data](/guides/privacy/).                                                                                            |
| `encrypted` | The column holds ciphertext and the model the string. `true` is randomised (not queryable), `{ deterministic: true }` keeps an equality and a `unique`. See [Encrypted attributes](/guides/encryption/). |

What the adapters do with anything else differs:

- **Mongoose** passes every other key and type through, so `{ type: 'ObjectId', ref: 'Post' }`, `[String]`, nested objects, `lowercase`, `trim`, `match`, `select`, `validate` and the JavaScript constructors (`String`, `Number`, `Date`) all work. It also understands the Sequelize spellings `allowNull: false` and `defaultValue`.
- **Sequelize** (`mssql` only) accepts its own attribute options (`allowNull`, `defaultValue`, `validate`, `field`, `primaryKey`, `autoIncrement`, `references`, `onDelete`, `onUpdate`, `comment`, `get`, `set`, `values`, ...), its data types (`type: DataTypes.STRING(50)` or the uppercase name as a string, `'STRING'`), the JavaScript constructors (`Object` and `Array` become `JSON`, `Buffer` a `BLOB`), and stores nested objects and arrays as `JSON`. Any other key throws at boot with the list of supported keys, so a typo never becomes a silently ignored option. A field with a known key but no `type` is an error too.

`@usehenri/drizzle/types`, `@usehenri/mongoose/types` and `@usehenri/sequelize/types` export the map above if you need the column or ORM types themselves.

## Exact numbers

Two of the types hold a value a JavaScript number cannot: `decimal`, an exact number with a `precision` (total digits) and a `scale` (digits after the point), and `bigint`, a signed 64-bit integer. Money is the reason the first one exists — a `number` column is a double, and a double answers `1.0000000000000007` for a hundred cents — and an identifier that comes from somewhere else is the reason for the second, because `9223372036854775807` read through a double is `9223372036854776000`.

```js
// app/models/Invoice.js
module.exports = {
  schema: {
    // Money: two digits after the point
    amount: { type: 'decimal', precision: 12, scale: 2 },
    // The defaults, 19 digits with 4 after the point: a unit price wants
    // more than money does
    rate: { type: 'decimal' },
    // What the accounting system calls it, past where an `integer` stopped
    reference: { type: 'bigint', unique: true },
  },
};
```

`precision` is 19 by default and 38 at most, which is the widest every dialect henri writes carries; `scale` is 4 and cannot be more than the precision. A `bigint` takes neither: declaring a `precision` or a `scale` on one fails the boot.

### The value is a string

A value of either type crosses into JavaScript as an exact decimal **string**, on every adapter: `'19.99'`, `'-1'`, `'9223372036854775807'`. Never a `number`, never a `BigInt`, never an object of henri's own.

```js
const invoice = await Invoice.create({
  amount: 19.99,
  reference: '90071992547409911',
});

invoice.amount; // '19.99'
invoice.reference; // '90071992547409911'
JSON.stringify(invoice); // {"amount":"19.99","reference":"90071992547409911", ...}
```

There are four reasons, and they are the same four everywhere the value travels:

- `JSON.stringify` throws on a `BigInt`, and henri serializes records in a dozen places — `res.render()`, `res.resource()`, `res.collection()`, the cache, the call log, a version diff, the trail, a job payload, GraphQL. One escaping into any of them is a `TypeError` raised deep inside express, after the controller returned.
- A decimal object needs a dependency and would not survive JSON either.
- It is the shortest path rather than a conversion: node-postgres hands `numeric` and `int8` back as strings, mysql2 hands `DECIMAL` back as a string, and `Decimal128.toString()` is exact. Turning any of those into a number is the step that loses the value.
- A string is exact, JSON-safe and identical on the three adapters, which is what makes one model file mean one thing everywhere.

**henri ships no arithmetic.** An application that adds two prices picks its own library and hands henri back a string.

On the way in, a string (a decimal literal, exponent form included), a JavaScript `number` and — for a `bigint` — a `BigInt` are all accepted. A number goes through `String(value)`, the shortest representation that round-trips, so the literal a person typed survives: `19.99` is `'19.99'`.

### What is refused rather than rounded

Each of these is a value the database would have quietly changed:

- more decimal places than the `scale`, counted after the trailing zeros, which are not information: `'19.9900'` is fine at scale 2 and `'19.999'` is not;
- more digits before the point than `precision - scale`;
- a `bigint` outside `-9223372036854775808 .. 9223372036854775807`;
- a JavaScript number that is not a safe integer where a whole number was asked for (`2 ** 60` is refused, and the message says to pass it as a string).

So `0.1 + 0.2` arrives as `0.30000000000000004` and fails validation instead of landing in the column: **henri does not round money**, because rounding is the application's to do and it is the application that knows which way.

`min` and `max` mean what they always did on an exact field, and they are compared digit by digit rather than through a double, so a bound past what a double holds can be written down. (Mongoose has a `min` and a `max` of its own and drops both on a `Decimal128` without a word, so henri carries them itself there.) The keys that measure text — `minLength`, `maxLength`, `match`, `trim`, `lowercase` and `length` — fail the boot on an exact field, naming it: the value is a string, so they would only count its digits.

### On each store

| Store                                  | `decimal`                  | `bigint`                   |
| -------------------------------------- | -------------------------- | -------------------------- |
| PostgreSQL (`drizzle`, `postgresql`)   | `numeric(p, s)`            | `bigint`                   |
| MySQL and MariaDB (`drizzle`, `mysql`) | `decimal(p, s)`            | `bigint`                   |
| sqlite (`drizzle`)                     | `text`, holding the digits | `text`, holding the digits |
| MongoDB (`disk`, `mongoose`)           | `Decimal128`               | a BSON 64-bit integer      |
| SQL Server (`mssql`)                   | `DECIMAL(p, s)`            | `BIGINT`                   |

sqlite has neither an exact decimal nor a 64-bit integer its driver hands back whole (better-sqlite3 reads `9223372036854775807` back as `9223372036854776000`), so the drizzle adapter keeps the digits in a `text` column, which round-trips the value exactly. A comparison is a different question from a value, and text answers it wrongly — `'9.99' > '10'` lexicographically — so **a comparison and an order** are the one thing that goes through a cast: `CAST(col AS INTEGER)` for a `bigint`, which sqlite carries on 64 bits and is therefore exact, and `CAST(col AS REAL)` for a `decimal`, which is a double and is the one approximation henri ships for these types — accurate to about sixteen significant digits, the same answer PostgreSQL gives for every value a person writes down. An equality is not cast at all: the stored text is canonical, so `=` is exact.

`@usehenri/sequelize` **refuses both types on sqlite** at boot, naming the model and the field ([`HENRI_MODEL_TYPE_UNSUPPORTED`](/reference/errors/#henri_model_type_unsupported)), and points at `@usehenri/drizzle`: it reads a sqlite `DECIMAL` through a double and loses the digits of a `BIGINT` past 2^53, and it has no seam to store the value as text and cast for a comparison the way the drizzle adapter does. It is a corner `henri new` cannot produce — sqlite goes to Drizzle, and Sequelize is reachable only under [`mssql`](#mssql-1) — and the adapter says so rather than reading a value back changed.

### The Sequelize spellings

A model written for Sequelize keeps its data type names on a drizzle store, and the two that used to be downgrades point at the real types now: `DECIMAL` and `NUMERIC` are `decimal` (they were `number`, a double) and `BIGINT` is `bigint` (it was `integer`, 32 bits). On an `mssql` store, `DataTypes.DECIMAL(10, 2)` is read as `{ type: 'decimal', precision: 10, scale: 2 }` and gets the same string boundary. A **bare `DataTypes.DECIMAL`** is refused there, because MySQL makes it `DECIMAL(10, 0)` — whole units, so money loses its cents. Write `{ type: 'decimal', precision: 12, scale: 2 }` and henri writes the same column on every dialect.

Elsewhere: an exact field is a `String` in [GraphQL](/guides/graphql/#what-each-type-becomes), a string with a `pattern` in the [OpenAPI document](/guides/openapi/), and a `decimal` or `bigint` rule in a controller's [`params`](/guides/controllers/#params-what-an-action-accepts) block.

## Timestamps

Every model has `createdAt` and `updatedAt`, like every Rails table. They are written on create, `updatedAt` again on every update, and they are never mass-assigned: `Model.create(req.permit(...))` cannot set them. Opt out per model:

```js
module.exports = {
  options: { timestamps: false },
  schema: { body: { type: 'text' } },
};
```

This changed in henri 1.2: before it, only `options: { timestamps: true }` added them on the Mongoose and Drizzle adapters (the mssql one already added them by default). See [Upgrading](/upgrading/#timestamps-are-on-by-default).

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

`Model.findById()` takes the public identifier, and only the public identifier. A primary key answers `null`:

```js
await Task.findById('0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'); // the record
await Task.findById(42); // null
await Task.findById('42'); // null
await Task.findById('0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c99'); // null
```

That `null` is what makes `/tasks/42` a 404 in an application whose controller was already written to answer one, and it is the _same_ `null` an unknown uuid gets: nothing in the answer distinguishes "no such row" from "not that kind of identifier", because a 404 that says which one it was is a lookup oracle. `findByIdAndUpdate()` and `findByIdAndDelete()` refuse the same values, so neither is the door `findById()` stopped being.

Server-side code that legitimately holds a primary key -- the row you just wrote, a join you just made, the subject of a session -- calls `findByKey()`:

```js
const task = await Task.findByKey(42); // the record
const task = await Task.findByKey(created.id); // the row you just wrote
await Task.findByKey('0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'); // null
```

`findByExternalId()` is the other half, explicitly. On every SQL adapter, `findByPk()` is an alias of `findByKey()`.

The two identifiers can never be confused: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one.

:::caution[Upgrading from 1.2]
`findById()` used to take both. Anywhere your code hands it a value it read
from the database -- `Model.findById(record.id)` -- change it to
`findByKey()`; anywhere it hands it `req.params.id`, leave it alone, that is
the case this is for. [`externalIds.lookup: "any"`](/configuration/#the-externalids-object)
restores the old behaviour wholesale for an application whose links already
carry numbers, and `henri audit` reports it.
:::

### Foreign keys

A record hid its own primary key from the start. It hid somebody else's from 1.3: a foreign key leaves as the `externalId` of the row it names.

```js
const proposal = await Proposal.findById(req.params.id);

proposal.speakerId; // 4812, on the server
JSON.stringify(await henri.model.publish(proposal));
// {"externalId":"0199a5c1-...","speakerId":"0199a4f2-...", ...}
```

henri only does this for a foreign key the model **declared**, and it never reads a field name to decide:

| Adapter   | What makes a field a foreign key                                                       |
| --------- | -------------------------------------------------------------------------------------- |
| Sequelize | `belongsTo()` in `associate(models)`, or `references: { model: 'Event' }` on the field |
| Drizzle   | `belongsTo()` in `associate(models)`, or `references: { model: 'Event' }` on the field |
| Mongoose  | `ref: 'User'` on the path, or on the entries of an array of them                       |

What henri **cannot know, and therefore does not guess**:

- a column holding an id and saying nothing (`ownerId: { type: 'string' }`) is an opaque string, whatever it is called;
- a Mongoose `refPath`, or a `ref` given as a function: the target collection is named per document, and resolving it against the wrong one would publish the identifier of an unrelated row;
- a polymorphic pair (`subjectType` + `subjectId`): two undeclared columns, as far as every ORM here is concerned;
- a plain object that never was a record -- a `.lean()` query, a row from `adapter.query()`, an object a controller built by hand -- because it carries no model. Its internal ids are still removed; its foreign keys are yours.

A key that names no row is `null`, never the number: an answer that cannot be resolved fails closed.

The cost is bounded. One call covers a whole answer -- `res.render()`'s payload, `res.resource()`'s record, `res.collection()`'s entire page -- and it takes what an eager-loaded association already holds (checking that the loaded record really is the row the key names) before asking for the rest in **one statement per target model**, with the keys deduplicated inside it.

Measured on the showcase against PostgreSQL, on a page of 25 proposals carrying 75 foreign keys across three models:

| The answer                                                                 | Statements                                         |
| -------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /proposals?per_page=25` with `include: ['event', 'speaker', 'track']` | 3 for the whole request, none of them a resolution |
| The same 25 records published with nothing included                        | 3, one per target model                            |
| The naive shape, one lookup per key                                        | 75                                                 |

### Presenting a record

A controller that builds a new object out of its records hands `res.resource()` a plain object, and a plain object carries no model. Publish first, present second:

```js
const published = await henri.model.publish(records);

return res.collection(published.map(present), { subject: records });
```

`henri.model.publish()` is the same gate `res.render()`, `res.resource()` and `res.collection()` run on their way out, with the same batching.

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

Nothing changes for a model that opted out, in either direction: its records have no `externalId`, so their `id` is left where it always was; its `findById()` still takes the primary key, because there is no other identifier to prefer; and a foreign key _pointing at_ it stays the number it is, because the row it names has nothing else to give.

In the database, the foreign keys are unaffected. `belongsTo` and `hasMany` keep pointing at the primary key, `include()` and `populate()` are unchanged, and a `taskId` column still holds a number: only what leaves the server changes. A form that posts one back posts the `externalId`, and `findById()` on the target is what turns it into the key the column wants.

[`externalIds`](/configuration/#the-externalids-object) holds both switches, and `henri audit` reports either of them turned off.

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

| Operation                | Mongoose (`disk`, `mongoose`)                                           | Sequelize (`mssql`)                                            | Drizzle (`drizzle`, `postgresql`, `mysql`)     |
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

// Sequelize (mssql)
await Task.findAll({ paranoid: false });
await task.destroy({ force: true });

// Drizzle
await Task.withDeleted().count();
await Task.destroy({ id }, { force: true });
```

Three things to know before turning it on: a soft deleted row still holds its `unique` values, so creating a record with the same email as a deleted one fails; eager loaded associations are not filtered, so a `populate()` or an `include()` can still surface a deleted record through its parent; and on Mongoose an aggregation pipeline sees everything, because it does not go through the query middleware.

On Mongoose the behaviour is a schema plugin: it adds the `deletedAt` path, a query middleware that adds `deletedAt: null` to reads and updates, and replacements for `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete` and `doc.deleteOne()`. On the mssql store it is Sequelize's own `paranoid`, which needs `timestamps` (on by default). On Drizzle it is part of the model layer, so relations, `count()`, `update()` and `paginate()` all honour it.

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

// Sequelize (mssql)
await Task.findAll({ where: { done: false } });
await Task.findByPk(id);
await Task.create(req.permit('name', 'category'));

// Drizzle (drizzle, postgresql, mysql), which answers to some of the names above
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

// Sequelize (mssql): any findAndCountAll option
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

Each adapter is a package to install in the application; the name in `stores.<name>.adapter` selects it. `henri new <folder> --adapter drizzle|disk|mongoose|postgresql|mysql|mssql` (`--dialect sqlite|postgres|mysql` with `drizzle`) writes the store block, the dependencies and the driver of a new application; `drizzle` on sqlite is the default. All of them implement the same contract, documented in the [API reference](/reference/api/#store-adapters), and expose a few helpers on the store object, `henri.model.stores.<name>`:

```js
await henri.model.stores.default.ping(); // true when the database answers
await henri.model.stores.default.transaction(async (t) => { ... }); // SQL transaction, or Mongoose session (needs a replica set)
await henri.model.stores.default.query('SELECT 1 + ?', [1]); // SQL adapters only
```

Sessions are stored in the database of the user model's store: a `henriSessions` collection on MongoDB, a `henri_sessions` table on a drizzle store, a table created by connect-session-sequelize on an mssql one (the `session` key of the store configures any of them).

**Which one.** Two of the four SQL databases henri reaches are the same package under two names, so the choice is smaller than the list looks:

| The database   | The adapter                                                 | The ORM   |
| -------------- | ----------------------------------------------------------- | --------- |
| sqlite         | `drizzle` with `"dialect": "sqlite"`                        | Drizzle   |
| PostgreSQL     | `postgresql`, or `drizzle` with `"dialect": "postgres"`     | Drizzle   |
| MySQL, MariaDB | `mysql` / `mariadb`, or `drizzle` with `"dialect": "mysql"` | Drizzle   |
| SQL Server     | `mssql`                                                     | Sequelize |
| MongoDB        | `mongoose`, or `disk` for a local one                       | Mongoose  |

Drizzle is henri's SQL data layer: it has the migrations, and `@usehenri/postgresql` and `@usehenri/mysql` are that adapter with the dialect and the driver already chosen. Sequelize is behind `mssql` alone, and the reason is narrow: Drizzle has no SQL Server dialect (drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel), so it is how henri reaches one. Everything an mssql store does differently from the rest -- no migrations, `henri db:status` instead -- follows from that.

### Drizzle

henri's SQL data layer: [Drizzle ORM](https://orm.drizzle.team/) with generated, versioned migrations, on sqlite, PostgreSQL and MySQL. `henri new my-app` scaffolds an application on it, sqlite by default -- nothing to start, a file under `.henri/`, and a database that deploys as it is. `--dialect postgres` or `--dialect mysql` picks another one, and `--adapter postgresql` and `--adapter mysql` are the same adapter with the dialect and the driver chosen for you ([below](#postgresql)).

To add it to an existing application, install it with the driver of your dialect:

```bash
pnpm add @usehenri/drizzle better-sqlite3   # or pg, or mysql2
```

`better-sqlite3` ships the compiled addon in its own tarball, for darwin, linux, linuxmusl and win32 on arm64 and x64, so there is nothing to build and no toolchain to install. It still carries a `binding.gyp`, which pnpm 11 refuses to meet without an answer, so a pnpm application lists `better-sqlite3: false` under `allowBuilds` in `pnpm-workspace.yaml` — skip the build, use the binary (`henri new` writes it). A platform with no prebuild flips it to `true` and builds, which needs python3, make and a C++ compiler.

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

The global is not a Mongoose or Sequelize model but the adapter's own, with one API that also answers to some of the Mongoose and Sequelize names:

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

#### What it refuses

It answers to the Mongoose and Sequelize names where they mean the same thing, and refuses them where they do not, rather than running something else.

- **`Model.update(values, { where })`** is Sequelize's argument order and the opposite of this one. Read as written it means "update every row matching `values`, and set a column called `where`": the wrong rows, no error, and a count that says it worked. It is refused with `HENRI_MODEL_INVALID_QUERY`. This adapter takes `update(where, attrs)`.
- **An option this adapter does not read** -- `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `plain`, `lock` -- is refused with `HENRI_MODEL_UNKNOWN_OPTION` rather than dropped. A dropped `fields` is a mass assignment somebody thought they had bounded; a dropped `transaction` is a write outside the transaction it was written into.
- **A condition keyed by Sequelize's `Op` symbols** narrows nothing here, because `Object.keys()` does not see a symbol. It would answer every row, so it is refused. So is an empty condition object under a field (`{ name: {} }`), for the same reason. The operators this adapter reads are `eq`, `ne`, `not`, `gt`, `gte`, `lt`, `lte`, `in`, `nin`, `notIn`, `like`, `notLike`, `ilike` and `between`.
- **`instance.get({ plain: true })`** reads as an attribute named by an object. `toObject()` is the whole record as a plain object.
- **A model file's `options`** takes `timestamps`, `paranoid`, `externalId`, `personal`, `retention` and `versioned`. One declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead -- a model whose author believes it has an index it does not have is worse than one that will not start. (`hooks` and the table name are top level keys of the model file, not options.)

Validation failures throw a `ValidationError` whose `errors[field].message` is what the generated controllers read, unique violations included. Models can export `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy` and `afterDestroy` hooks, and `associate(models)` declares `belongsTo`, `hasMany` and `hasOne` associations that `include()` loads eagerly. The user model gets the same email, password, roles, `confirmedAt` and `passwordChangedAt` behaviour as the other adapters, and sessions are stored in a `henri_sessions` table.

Migrations live in `db/migrations` in the drizzle-kit layout, and `henri db` drives them like `rails db`:

```bash
henri db:status                          # applied and pending migrations
henri db:generate --name=add-priority    # writes db/migrations/0001_add_priority.sql from the models
henri db:migrate                         # applies the pending migrations
henri db:rollback                        # undoes the last one (--step=<n> for more)
henri db:push                            # makes the database match the models, no migration (development)
henri db:schema:dump                     # writes db/schema.sql from the database
henri db:schema:load                     # creates that schema in an empty database
```

In development the boot pushes the schema unless the store sets `"sync": false`; in production the boot applies the pending migrations when the store sets `"migrate": true` and warns about them otherwise. `henri db:push` refuses statements that lose data unless `--force` is passed; every command accepts `--store=<name>` and `--json`. `henri db:seed` is the exception: it runs [`db/seeds.js`](#seeds) on any adapter.

#### Rolling back

drizzle-kit generates forward-only SQL: a migration has no `down`. henri does
not ask you to write one, and does not write one at `db:generate` time either.
The inverse is computed when you roll back, by handing drizzle-kit the two
snapshots `db/migrations/meta` already holds in the other order -- so nothing
is stored that could go stale, and what runs is the inverse of the schema
`henri db:status` believes in.

```bash
henri db:rollback              # the last migration
henri db:rollback --step=2     # the last two, newest first
henri db:rollback --force      # and yes, drop the rows it names
```

Rolling back moves the database, not `db/migrations`: the `.sql` and its
snapshot stay where they are, `db:status` reports the migration pending again,
and `db:migrate` applies it again.

It refuses three things, because a rollback that quietly does something else
is worse than no rollback at all:

- **A migration that removed a table or a column** (`HENRI_MIGRATION_IRREVERSIBLE`).
  Its inverse would recreate them empty, and an empty column is not the column
  that was dropped. There is no flag for this one: undoing a destructive
  migration is a restore from a backup, and henri will not pretend otherwise.
- **A migration whose `.sql` changed since it was applied** (`HENRI_MIGRATION_EDITED`).
  The database records the sha256 of the file it ran; when the file on disk
  hashes to something else, henri does not know what ran and will not guess.
- **A rollback that would drop rows that are there** (`HENRI_MIGRATION_DESTRUCTIVE`).
  Not "a statement that matches `DROP`": the tables and columns the inverse
  removes are counted first. Undoing the migration you applied a minute ago on
  a database nothing was written into needs no flag; one that would take 412
  rows away says so and needs `--force`, the way `db:push` does.

Every dialect commits DDL differently -- MySQL commits each statement on its
own -- so a rollback of several migrations applies them one at a time and
removes each one's row only once its statements ran. A failure half way
through leaves the database and `db:status` agreeing about what really
happened.

#### The schema dump

`henri db:schema:dump` writes `db/schema.sql`: the shape of the database as
one file, the way Rails' `db/schema.rb` is. What a new developer loads instead
of replaying every migration, and what a reviewer reads to see what the
database actually looks like.

It is **read from the database**, not from the migration chain. A dump built
from the chain would agree with the chain by construction -- it would be a
second copy of files already in the repository, and it could never be the
thing that catches an `ALTER` somebody ran by hand or a `henri db:push` that
was never turned into a migration. The cost is that a dump is written where a
database is reachable: a developer's machine, or a CI job with a service
container, never a checkout alone.

Two runs against the same schema produce the same bytes. Tables are ordered by
name, types, indexes and foreign keys by their statements, and columns by the
position the database keeps them in -- the order a `SELECT *` answers in.
Nothing carries a timestamp, a row count or a sequence value; MySQL is read
through `information_schema` rather than `SHOW CREATE TABLE`, which prints the
table's `AUTO_INCREMENT` counter and would move the file on every insert.

The header names the migration the database was at, so the dump and
`henri db:status` cannot disagree:

```sql
-- henri schema dump
--
-- The shape of the database, not its data. Written by
-- "henri db:schema:dump" and read by "henri db:schema:load"; it is
-- generated, so change the schema with a migration and dump again.
--
-- dialect: postgres
-- migration: 0003_speakers
```

**Loading it is supported.** `henri db:schema:load` creates everything the
dump describes and records the migrations up to the one it names as applied,
leaving anything newer pending for `henri db:migrate` -- which is how a test
database is built without replaying the chain:

```bash
NODE_ENV=test henri db:drop && NODE_ENV=test henri db:create
NODE_ENV=test henri db:schema:load
```

A load refuses a table it is about to create that already exists
(`HENRI_MIGRATION_DATABASE_NOT_EMPTY`), and never empties a database to get
its way: `henri db:drop` and `henri db:create` are the commands that do that,
and there is no `--force` here. A table the dump says nothing about -- one
another tool owns in the same database -- is left alone rather than being in
the way.

The dump describes tables, columns with their types, defaults and
nullability, primary keys, unique and check constraints, indexes, foreign
keys, and the enum types and plain sequences of PostgreSQL. It does not
describe views, triggers, stored routines, grants, partitions, extensions, or
any data: a database that uses more than the first list is not fully described
by its dump. The tables henri owns without a model -- the job queue's, the
access trail's, the webhook endpoints', drizzle's own record of what it
applied -- are left out, because they are not the application's schema and the
code that owns them creates them. `henri_sessions` is in, because it is part
of the store's schema.

An `mssql` store answers neither command: it is on Sequelize, it has no
migration history for a dump to name, and `henri db:status` is what reads it
back instead. A `mongoose` store has no schema of its own to write down. Both
exit with `1` and `HENRI_CLI_MIGRATIONS_UNSUPPORTED`.

#### Pushing to MySQL

On MySQL a push only creates the tables that do not exist yet: drizzle-kit does not alter a MySQL table on a push, so a table whose columns no longer match the model is reported (`the columns of the database and of the schema differ`) and left alone rather than altered or truncated. Change a MySQL schema with `henri db:generate` and `henri db:migrate`, which work on every dialect. sqlite and PostgreSQL push the whole diff.

### PostgreSQL

`@usehenri/drizzle` with the dialect and the `pg` driver chosen, so an application installs one package and declares no driver, and the store needs no `dialect` key.

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

Everything under [Drizzle](#drizzle) is true of it: the model API, the schema format, `db/migrations` and the `henri db:` commands. `henri new my-app --adapter postgresql` scaffolds it.

### MySQL and MariaDB

`@usehenri/drizzle` with the dialect and the `mysql2` driver chosen, the same way `@usehenri/postgresql` is.

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

Use `"adapter": "mariadb"` with a `mariadb://` url for MariaDB; the same package handles both. Everything under [Drizzle](#drizzle) is true of it, including [what drizzle-kit will not alter on a MySQL push](#drizzle).

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

### MSSQL

The one adapter on [Sequelize](https://sequelize.org/), and the only way henri reaches SQL Server: Drizzle has no SQL Server dialect. drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel cores, and drizzle-kit 0.31 generates migrations for postgresql, mysql, sqlite, turso, singlestore and gel -- there is no mssql in either. That is the whole reason `@usehenri/sequelize` is still here, and it is not going anywhere while it stays true.

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

`host`, `port`, `database`, `username` and `password` are accepted instead of `url`; a store with none of them fails the boot. Every other key of the store (`pool`, `dialectOptions`, `logging`, ...) is forwarded to Sequelize. `logging` defaults to the `henri:sequelize` debug namespace (`henri server --debug=henri:sequelize` prints the queries) and credentials are redacted from that output.

The global is a real Sequelize model, so `findAll`, `findByPk`, `Model.scope()`, `Op` in a where, `options: { indexes, scopes, hooks }` and the rest of that documentation apply, and `options: { paranoid: true }` is Sequelize's own, so `restore()`, `{ paranoid: false }` and `{ force: true }` behave exactly as it describes. None of that is true of the other SQL adapters, which are Drizzle.

#### The schema of an mssql store

This adapter has no migrations, and henri does not pretend otherwise: `sequelize.sync()` creates the tables that are **missing** and never alters a table that already exists. That is enough in development and it is not a way to change a live database, so henri is explicit about where each half applies.

**In development** the boot syncs, unless the store sets `"sync": false`.

**In production** the boot changes nothing. It reads the database back instead, compares it with the models and warns about every difference it finds. A store that really wants the old behaviour asks for it with `"sync": true`, and `henri audit` reports that as [`schema.autosync`](/guides/security/): it is DDL applied at boot, from whatever the models happen to say, with nobody reviewing it.

**`henri db:status`** is the same comparison on demand, and the one command of the `db:` family this store answers. `db:generate`, `db:migrate`, `db:rollback`, `db:push`, `db:schema:dump` and `db:schema:load` all exit with `1` and [`HENRI_CLI_MIGRATIONS_UNSUPPORTED`](/reference/errors/#henri_cli_migrations_unsupported) here, saying so rather than doing half of it: there is no migration history to roll back, and no migration for a dump to name.

```bash
henri db:status              # what the database and the models disagree about
henri db:status --sql        # the DDL that would close it, for you to review
henri db:status --json       # `clean: false` and the differences, for CI
```

It reports a missing table, a missing column, a column whose type or nullability differs, a missing index, and a column that is in the database and in no model. It never writes a `DROP`: a column henri does not recognize may hold the only copy of something, and only you can know. Everything it writes is DDL for **you** to read and run; henri applies none of it.

```
  Store default (mssql), compared with the models

  3 difference(s):
    tasks.priority: the column is missing
    tasks.name: the database has TEXT instead of VARCHAR(255)
    tasks.legacy_note: the column is in the database and in no model

  henri does not change this schema for you: run it again with --sql
  for the DDL that would close the difference.
```

`henri db:generate`, `db:migrate` and `db:push` answer `HENRI_CLI_MIGRATIONS_UNSUPPORTED` on this store and point at the [drizzle adapter](#drizzle), which is where generated, reviewable, versioned migrations live.
