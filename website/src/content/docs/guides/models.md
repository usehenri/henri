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
  validates: {
    name: { minLength: 2, maxLength: 120 },
  },
};
```

| Key                 | Description                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`            | The fields, in the format below.                                                                                                                                                                                                                                                                                                                 |
| `validates`         | What must be true of a record, keyed by field. Checked on every write path of every adapter — see [Validations](#validations).                                                                                                                                                                                                                   |
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

| Key          | Description                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`   | The field has to hold something, on every write path of every adapter ([Validations](#validations)); the column is `NOT NULL` as well, where the store has columns.                                      |
| `default`    | Default value. `Date.now` becomes `NOW` on SQL.                                                                                                                                                          |
| `enum`       | The values accepted, refused by henri before the write ([Validations](#validations)); still an `ENUM` column on MySQL, MariaDB and PostgreSQL underneath.                                                |
| `predicates` | The methods an `enum` generates: `false` for none, a name to prefix them with. See [Enums](#enums-predicates-scopes-and-the-list).                                                                       |
| `unique`     | Unique index or constraint.                                                                                                                                                                              |
| `index`      | `index: true` adds an index on the field.                                                                                                                                                                |
| `precision`  | A `decimal` only: the total number of digits, 19 by default and 38 at most — the widest every dialect henri writes carries. See [Exact numbers](#exact-numbers).                                         |
| `scale`      | A `decimal` only: the digits after the point, 4 by default. A value with more of them is refused, not rounded.                                                                                           |
| `personal`   | This field is about a person: masked in the logs, exported and erased. See [Personal data](/guides/privacy/).                                                                                            |
| `encrypted`  | The column holds ciphertext and the model the string. `true` is randomised (not queryable), `{ deterministic: true }` keeps an equality and a `unique`. See [Encrypted attributes](/guides/encryption/). |

What the adapters do with anything else differs:

- **Mongoose** passes every other key and type through, so `{ type: 'ObjectId', ref: 'Post' }`, `[String]`, nested objects, `lowercase`, `trim`, `match`, `select`, `validate` and the JavaScript constructors (`String`, `Number`, `Date`) all work. It also understands the Sequelize spellings `allowNull: false` and `defaultValue`.
- **Sequelize** (`mssql` only) accepts its own attribute options (`allowNull`, `defaultValue`, `validate`, `field`, `primaryKey`, `autoIncrement`, `references`, `onDelete`, `onUpdate`, `comment`, `get`, `set`, `values`, ...), its data types (`type: DataTypes.STRING(50)` or the uppercase name as a string, `'STRING'`), the JavaScript constructors (`Object` and `Array` become `JSON`, `Buffer` a `BLOB`), and stores nested objects and arrays as `JSON`. Any other key throws at boot with the list of supported keys, so a typo never becomes a silently ignored option. A field with a known key but no `type` is an error too.

Those extra keys are the adapter's, not henri's: what they do — and which writes they run on — is that ORM's business, and a model file that leans on them stops moving between stores. [Validations](#validations) below is the portable place for the same thing.

`@usehenri/drizzle/types`, `@usehenri/mongoose/types` and `@usehenri/sequelize/types` export the map above if you need the column or ORM types themselves.

## Validations

A model says what must be true of its records in a `validates` block, keyed by field:

```js
// app/models/Post.js
module.exports = {
  schema: {
    title: { type: 'string', required: true },
    slug: { type: 'string', unique: true },
    views: { type: 'integer', default: 0 },
    status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
    body: { type: 'text' },
  },

  validates: {
    title: { minLength: 3, maxLength: 120 },
    slug: { pattern: /^[a-z0-9-]+$/ },
    views: { min: 0 },
    status: {
      validate: (value, post) =>
        value !== 'live' || Boolean(post.body) || 'needs a body first',
    },
  },
};
```

| Key                      | Description                                                                                                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `required`               | The field has to hold something. Absent, `null` and a string of nothing but spaces are all missing — Rails' `presence`.                                                                  |
| `enum`                   | The values accepted.                                                                                                                                                                     |
| `min`, `max`             | The bounds of a number. On a `decimal` or a `bigint` they may be written out as strings, the way those values are.                                                                       |
| `minLength`, `maxLength` | The bounds of a string's length.                                                                                                                                                         |
| `pattern`                | A regular expression a string has to match.                                                                                                                                              |
| `validate`               | A function of the value. `true` (or nothing) passes; `false` is `is invalid`; a string is the message. A second parameter is the record — see [below](#a-rule-that-asks-for-the-record). |

It is the vocabulary a controller's [`params` block](/guides/controllers/#params-what-an-action-accepts) uses, and it means the same thing here. There is no `type` key: the schema next door already says it, and that is what decides which constraints apply — `min` on a `string`, `maxLength` on an `integer` or a rule for a field the schema has no column for all fail the boot naming the model and the field (`HENRI_MODEL_VALIDATION_INVALID`) rather than being ignored.

### The schema's `required` and `enum` are the same rules

They always were the schema's, and now they are checked in the same place, so those two mean one thing on every adapter and on every write path — no `validates` block needed. That is a change: they used to mean three things.

|                              | Mongoose            | Sequelize (`mssql`)                                                                               | Drizzle             |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------- | ------------------- |
| `create`, `save`             | checked             | checked                                                                                           | checked             |
| `instance.update`            | checked             | checked                                                                                           | checked             |
| mass `update` / `updateMany` | **wrote past both** | checked                                                                                           | checked             |
| bulk insert                  | checked             | **wrote past both**                                                                               | checked             |
| what a bad `enum` answered   | a `ValidationError` | a `ValidationError` on sqlite, a **database error** (so a 500, not a 422) on PostgreSQL and MySQL | a `ValidationError` |

Every cell is checked now, with the same sentence in all of them. The column is still whatever the adapter writes — `NOT NULL`, a native `ENUM` on PostgreSQL and MySQL — and it stays there as the backstop for anything that reaches the database another way. henri simply refuses first, so what a person sees does not depend on the dialect.

### Where this belongs, and where `params` belongs

They are not the same boundary and neither replaces the other:

- A controller's `params` block and `req.permit()` check **what arrives**. They are about a request: they coerce a query string into the type the action declared, they drop what was not asked for, and they answer 422 before the action runs.
- `validates` checks **what is written**. A record is written by a job, a seed, `henri console`, a webhook delivery and a factory as often as by a request, and none of those has a `req`.

Declare the shape of the request in the controller and the truth about the record in the model. A rule that needs two fields, or the record it is changing, is a model rule; a rule about a page number is not.

### A rule that asks for the record

A `validate` that declares a second parameter is asking for the record it is about, the way [a policy rule that declares a record parameter](/guides/policies/) is. It is given the record **as it will be once the write lands**, so a rule reads the value written next to it in the same call and not the stale one.

A mass write has no records to give it. Rather than call it with nothing and record a pass it never made, henri refuses that write (`HENRI_MODEL_VALIDATION_MASS_WRITE`) and the message names the loop to write instead:

```js
for (const post of await Post.find({ status: 'draft' })) {
  await post.update({ status: 'live' });
}
```

The refusal is measured against the fields the write actually names, so a mass update that does not touch the validated field goes through, and so does a soft delete. A rule that only reads its value takes one parameter and never refuses anything.

### What a record holds after a refused write

`record.update(attrs)` sets the attributes and saves them, and only the second half can fail. So the obvious question is what the record in your hand holds once it has:

```js
try {
  await post.update(req.permit('title', 'views'));
} catch (error) {
  // post.views — the value the store just refused, or the one it holds?
}
```

**It holds the values it had before the call.** A write the store refused puts back every attribute it set, on all three adapters, so the record a controller still has after a 422 is the record as it is stored — safe to render, to log, and to write to again.

That last one is the reason. Before this rule, the refused value stayed on the record and the _next_ `update()` was measured against it, so a second write naming a different field entirely was refused for a field it never named — and on the Sequelize path it was not refused at all, because Sequelize narrows the statement to the fields the call named, so the row kept the old value while the record went on saying the refused one. A record that cannot be written to again and a record that lies, from the same line of code.

A refusal here means what [`henri.model.errors()`](#validation-errors) means: a rule of `validates`, the schema's own `required` or `enum`, and the unique index — the database's refusal is put back the same way, because a single-row `INSERT` or `UPDATE` is refused whole and there is no half-written row for the record to disagree with. Anything else — a hook of yours that throws, a connection that drops — is not a refusal and puts nothing back; that matters for an `afterUpdate` hook in particular, because by then the row has moved and the record should say so.

Three things this deliberately is not:

- **It is not a reload.** Nothing is read back, a refusal costs no query, and what goes back on the record is what the record held. A row another process moved in the meantime is exactly as stale as it was before the call.
- **It is not the value you asked for.** `post.views` after the refusal is what is stored. What the person typed is still in the `req.permit()` result you passed in, which is where a form repopulates from.
- **It is not `set()` + `save()`.** Those are two steps because you wrote two, and the values stay on the record between them on purpose — it is the way to keep what a person typed on the record itself:

  ```js
  post.set(req.permit('title', 'views'));

  try {
    await post.save();
  } catch (error) {
    // post.views is what they typed, and the form can be built from it
  }
  ```

On a `mongoose` or `disk` store, `record.update()` is henri's own: Mongoose removed `Document.prototype.update` in version 7, and `set()` then `save()` was the only spelling. It is back, it means the same thing it means on the other two, and it is what the generated controllers write.

### What henri does not check

- **`unique` is not a validation, and henri does not pretend otherwise.** A `SELECT` before an `INSERT` answers a question about a moment that has already passed: two requests both find nothing and both write. The unique index is what actually holds, so the database refuses the second one and `henri.model.errors()` turns that refusal into `{ field: 'must be unique' }` — [the same shape](#validation-errors) as everything above. What you give up is the message arriving before the round trip; what you get is a guarantee rather than a near-miss.
- **A write no hook of the ORM reaches is refused, not skipped** (`HENRI_MODEL_VALIDATION_UNCHECKED_WRITE`). Mongoose runs no middleware for the operations inside a `bulkWrite`, Sequelize runs none for `increment` and `decrement`, and an update operator that describes a change rather than a value (`$inc`, `$push`) has nothing to measure until the server has applied it. None of the three exists on all three adapters, so none of them is part of what a `validates` block means. Read the record, change it and save it.
- **Cross-record rules are yours.** "No two posts published the same day" is a query, and a query in a validator is a race with a nicer message.

## Enums: predicates, scopes and the list

A column that declares an `enum` already says what it may hold, so henri spells it back as methods rather than making every application write the strings out by hand:

```js
// app/models/Post.js
module.exports = {
  schema: {
    title: { type: 'string', required: true },
    status: { type: 'string', enum: ['draft', 'in_review', 'live'] },
  },
};
```

gives you three things, on every adapter:

| What                | Where        | Answers                                                               |
| ------------------- | ------------ | --------------------------------------------------------------------- |
| `post.isDraft()`    | every record | `true` when the column holds that value                               |
| `Post.draft()`      | the model    | **the condition** `{ status: 'draft' }`, narrowed by what it is given |
| `Post.enums.status` | the model    | `['draft', 'in_review', 'live']`, frozen                              |

```js
if (post.isLive()) { … }

// every live post, however this adapter spells a list
await Post.find(Post.live());              // mongoose
await Post.where(Post.live());             // drizzle
await Post.findAll({ where: Post.live() }); // sequelize
```

The predicate is the one with no substitute: `post.status === 'darft'` is silently false for the life of the application, while `post.isDarft()` is a `TypeError` the first time it runs. Writing a wrong value is already refused — that is what [the `enum` rule](#validations) does, on every adapter and every write path — so it is the _comparison_ that needed the method.

### A scope is a condition, not a query

`Post.live()` answers a condition. It is not a Rails relation, because henri has three query builders and [wraps none of them](#querying): a method that answered records would have to be a Mongoose `Query` on one adapter, a promise on another and a Drizzle `Relation` on the third. A condition is the one value all three read the same way — and the one that composes:

```js
index: async (req, res) => {
  const { order, where } = await req.filters();
  const { records, page, perPage, total } = await Post.paginate({
    ...req.pagination(),
    order,
    where: Post.live(where),
  });

  return res.collection(records, { page, perPage, total });
},
```

`where` there is already `policy.scope(user)` intersected with what the client asked for ([Filtering](/guides/filtering/)), and the scope goes _under_ it: an `and` spelled for the adapter, never a merge of keys, so **a scope narrows a list and can never widen it** — the same promise a filter makes. Two conditions on the same column both hold. Anything that is not a plain object is refused (`HENRI_MODEL_ENUM_UNMERGEABLE`) rather than dropped.

The list is what a `<select>`, a seed and a test want, and it is also how you reach a scope whose value is in a variable:

```js
for (const state of Post.enums.status) {
  counts[state] = await Post.count(Post[state]());
}
```

Never index a model with a string that came from a request: `Post[req.query.state]()` is a method of the model, not a scope. That is what [`filters`](/guides/filtering/) is for.

### A predicate is on the record, and a page has none

`isDraft()` is a method of a record, so it is gone by the time the record is JSON — a React or Inertia page receives the column and compares it itself. The value list crosses over, so a page that has to compare gets the strings from one place:

```jsx
// pass the list, not a hand-written copy of it
res.render('/posts', { data: { states: Post.enums.status, posts } });
```

This is what a scaffolded page already does: `henri generate scaffold` writes a `new` and an `edit` action that send `Post.enums`, and a form whose `<select>` maps over the list it was given. Regenerate the pages of a model that grew an `enum` (`--force`) to pick it up.

### The names

`draft` gives `isDraft` and `draft`. `in_review`, `in-review`, `IN_REVIEW` and `InReview` all give `inReview`: the value is split on everything that is not a letter or a digit and at every lower-to-upper boundary, then camel cased. Two values of one model that come out the same name are refused, because they would be the same method.

A value that is not a name at all — `2fa`, `''` — gets no predicate and no scope. It is still in `Post.enums`, still validated and still queryable; there is simply no method for it.

### When a name is already taken

A generated name that already exists is a **boot failure** naming the model, the field, the value and who owns the name (`HENRI_MODEL_ENUM_NAME_TAKEN`). Skipping it silently is the worse answer: `Post.find` would go on answering records to a caller who asked for a condition, and `ticket.isNew()` would call a boolean.

The two namespaces are not equally crowded. Only eight names shaped like `is<Name>` exist across the three ORMs, and exactly one of them is a value a real model writes: **`new`**, whose `isNew` is how Mongoose and the Drizzle model tell an insert from an update. The model's own namespace is the crowded one — `find`, `create`, `update`, `count`, `exists`, `build`, `all`, `first`, `last`, `where`, and `name` and `length`, which every function has.

`new` is also a value nobody can rename once it is in a database, so the field says what it wants:

```js
// ticket.isStatusNew(), Ticket.statusNew()
status: { type: 'string', enum: ['new', 'open'], predicates: 'status' },

// no methods for this column; Ticket.enums.status is still the list
status: { type: 'string', enum: ['new', 'open'], predicates: false },
```

The check covers the names henri puts on a model on **every** adapter, not only the one you are running, so a model that boots on sqlite boots on MongoDB. What it does not cover is an association: `associate()` runs after the models are built, so a `hasMany` named after an enum value wins. In practice they do not collide — an association is a plural noun and a state is an adjective.

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
| SQL Server (`mssql`)                   | refused at boot            | `BIGINT`                   |

sqlite has neither an exact decimal nor a 64-bit integer its driver hands back whole (better-sqlite3 reads `9223372036854775807` back as `9223372036854776000`), so the drizzle adapter keeps the digits in a `text` column, which round-trips the value exactly. A comparison is a different question from a value, and text answers it wrongly — `'9.99' > '10'` lexicographically — so **a comparison and an order** are the one thing that goes through a cast: `CAST(col AS INTEGER)` for a `bigint`, which sqlite carries on 64 bits and is therefore exact, and `CAST(col AS REAL)` for a `decimal`, which is a double and is the one approximation henri ships for these types — accurate to about sixteen significant digits, the same answer PostgreSQL gives for every value a person writes down. An equality is not cast at all: the stored text is canonical, so `=` is exact.

`@usehenri/sequelize` **refuses both types on sqlite** at boot, naming the model and the field ([`HENRI_MODEL_TYPE_UNSUPPORTED`](/reference/errors/#henri_model_type_unsupported)), and points at `@usehenri/drizzle`: it reads a sqlite `DECIMAL` through a double and loses the digits of a `BIGINT` past 2^53, and it has no seam to store the value as text and cast for a comparison the way the drizzle adapter does. It is a corner `henri new` cannot produce — sqlite goes to Drizzle, and Sequelize is reachable only under [`mssql`](#mssql-1) — and the adapter says so rather than reading a value back changed.

`@usehenri/mssql` **refuses `decimal`** at boot for the same reason one type narrower, and this one is measured against a real SQL Server: the `tedious` driver reads every `DECIMAL` and `NUMERIC` as `value / Math.pow(10, scale)`, so the column comes back a JavaScript double however it was declared. `DECIMAL(12, 2)` `-2.50` reads back as `-2.5` and `DECIMAL(38, 10)` `12345678901234567890.1234567891` reads back as `12345678901234567000`. There is no driver option for it and no parser above it — Sequelize's mssql parser store is handed the number `tedious` already made — so the digits are gone before henri sees them, and refusing is the only thing that is not a lie. **`bigint` is exact on SQL Server**: `tedious` hands a `BIGINT` back as a string, and the suite writes and reads the two ends of the signed 64-bit range. An amount on an mssql store therefore goes in a `bigint` of its smallest unit — cents — and is formatted in the application.

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

## Slugs

`/articles/how-we-ship` rather than `/articles/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`. A model asks for a name in its options:

```js
// app/models/Article.js
module.exports = {
  options: { slug: 'title', timestamps: true },
  schema: {
    body: { type: 'text' },
    title: { type: 'string', required: true },
  },
};
```

and henri adds a `slug` column -- unique, indexed, `NOT NULL` -- fills it on the insert, resolves it in `findById()` and prints it in every url that names the record.

```js
const article = await Article.create({ title: 'How we ship' });

article.slug; // 'how-we-ship-k3f9pq'
article.externalId; // '0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11'
article.id; // 42, on the server
```

`henri generate scaffold Article title:string! body:text --slug title` writes the declaration, the controller and the pages together, and a generator run over a model that already has one reads it back -- so nothing is hand-wired.

### Where a slug appears, and where it does not

A slug is a **third** identifier, and the rule that keeps it from spending what the other two buy is two lines long:

- it appears in the record's own `slug` field, and in the **url** of that record -- `_links`, the path helpers, the `Location` of a `201`;
- it appears **nowhere else**. A foreign key is still published as the `externalId` of the row it names, never as that row's slug; the versions table, the access trail, the flags actor and the erasure receipts all keep reading `externalId`.

So the uuid is what an API client stores and what henri writes down; the slug is what a person reads and types. A record answers to both, and both are public: this is a second **name**, not a second identity.

```json
{
  "_links": { "self": { "href": "/articles/how-we-ship-k3f9pq" } },
  "externalId": "0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11",
  "slug": "how-we-ship-k3f9pq",
  "title": "How we ship"
}
```

### The lookup, and why it cannot reach a primary key

`findById()` grew one branch:

```js
await Article.findById('how-we-ship-k3f9pq'); // the record, by name
await Article.findById(article.externalId); // the record, as before
await Article.findById(42); // null
await Article.findById('42'); // null
await Article.findById('no-such-article'); // null
```

A uuid resolves the `externalId`, exactly as before. Anything else resolves the **slug column** -- a `WHERE slug = ?`, not a fallthrough -- and that is the end of it. `findById('42')` asks the slug column for `'42'`; it does not ask the primary key anything, so it cannot say whether row 42 exists. If some record's slug really is `42`, that record comes back, and that is a public fact about a public name rather than the number.

A model with a name takes the whole non-uuid space with it, [`externalIds.lookup: "any"`](/configuration/#the-externalids-object) included: on such a model the primary key belongs to `findByKey()` alone. `findBySlug()` is the explicit half, the way `findByExternalId()` is, and `findByIdAndUpdate()`/`findByIdAndDelete()` reach exactly the rows `findById()` reaches.

A slug shaped like a uuid would take the first branch and quietly name nothing, so henri refuses one.

### Two articles called "Getting started"

That is the normal case, not the edge one, and henri answers it without a `SELECT` before the `INSERT` -- the same position it takes on `unique` in [validations](#validations): a check before a write answers a question about a moment that has passed.

**`suffix: true`, the default.** The slug is the folded title plus a six character discriminator taken from the record's own `externalId`: `getting-started-k3f9pq`. Unique because the uuid is, stable because the uuid never changes, and free because nothing is read. The cost, said out loud: every url carries six extra characters even when nothing would have collided.

**`suffix: false`.** The slug is exactly the folded title: `getting-started`. The **unique index is what holds**, so the second "Getting started" is refused by the database and `henri.model.errors()` turns that into `{ slug: 'must be unique' }`, the same sentence any other unique column gives. The cost is that refusal, and it lands on a title its author had every reason to think was fine -- so this is the choice to make when the source is something a person already keeps unique, like a product code.

```js
options: { slug: { from: 'title', suffix: false } },
```

Neither is scoped. A slug is unique across the table, not per tenant or per parent: a scope is a composite index henri would have to write into a migration it does not own.

### When the title changes

By default, nothing happens. `on: 'create'` is the default and it is the honest one: the slug is generated once, and the url minted the day the record was written keeps working forever, whatever the title becomes. An identifier that follows a display string is an identifier that has stopped being one.

`on: 'change'` regenerates whenever the source field is written, **and the old url stops working that instant**. henri keeps no history of slugs: `friendly_id` puts every retired one in a table and answers a `301` from it, which is a table on four adapters, a redirect, a retention rule and a reach for the erasure -- and it is not here. Until it is, `on: 'change'` means the old url 404s.

A mass update naming the source field on such a model is refused (`HENRI_MODEL_SLUG_MASS_WRITE`), because one hook runs for the whole write with no records in it, so either every row would get the same slug or none would get a new one:

```js
// refused
await Article.update({ author: 'ada' }, { title: 'One name for all' });

// what to write instead
for (const article of await Article.find({ author: 'ada' })) {
  await article.update({ title: 'One name for all' });
}
```

It is the answer `HENRI_MODEL_VALIDATION_MASS_WRITE` and `HENRI_VERSION_MASS_WRITE` already give to the same shape of problem. A model whose slug is generated once has nothing to regenerate, and its mass updates are untouched.

### A title that is not in English

henri lowercases the title, decomposes it (NFKD) and keeps `a-z0-9`. `Café Crème` becomes `cafe-creme` with no transliteration table at all, because Unicode already knows that `é` is `e` with a mark on it.

What Unicode does not decompose is a short list of Latin letters that are letters in their own right, and those get a line each -- eleven of them: `æ ð đ ħ ı ł ø œ ß þ ŧ`. So `Straße in Köln` is `strasse-in-koln` and `Łódź` is `lodz`. **That is the whole table**, and it is deliberately not the first entry of one per script: a Japanese, Chinese, Arabic, Hebrew, Greek or Cyrillic title has no ASCII to fold to, and shipping the tables that would invent some is how a framework ends up choosing romanizations on a reader's behalf.

So a title in one of those scripts folds to nothing, and that has two real answers rather than a shrug:

- with `suffix: true` the record still gets a slug -- the discriminator alone, `k3f9pq` -- so the write never fails and the url always works. With `suffix: false` there is nothing to fall back to and the write is refused (`HENRI_MODEL_SLUG_EMPTY`), naming the field and what it held;
- **a slug the application writes itself always wins, and may be in any script**:

```js
await Article.create({ slug: 'こんにちは', title: 'Hello' });
// GET /articles/%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF
```

Every browser shows that as `こんにちは` in the address bar. So henri makes neither choice for you: its generator folds to ASCII and ships no romanization, and an application that wants its own script in the url writes the slug and gets it, byte for byte.

`req.permit()` decides whether a request may set one -- the generated controller does not list `slug`, so by default nothing outside can.

### What a slug may be

A supplied slug is measured against a list of the structural characters rather than a definition of a letter, because henri is not the one deciding what counts as a word. It is refused when it:

- is empty, or longer than the column;
- holds a space, a control character, or one of the seventeen that end a path segment, start a query, escape an encoding or name a directory (`"`, `#`, `%`, `/`, `:`, `?`, `@`, `[`, `\`, `]`, `^`, `{`, `|`, `}`, `<`, `>` and the backtick);
- is `.` or `..`, or a path henri already mounts -- `new`, because `resources articles` puts `GET /articles/new` ahead of `GET /articles/:id`. A `collection` route of your own is a segment henri cannot know when the slug is written, so add it: `reserved: ['search']`;
- is shaped like a public identifier.

The message is a `{ slug: '...' }` a controller answers `422` with, like any other validation failure. henri lowercases and trims what it stores.

### The declaration

| Key         | Default    | What it says                                                                                                                |
| ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `from`      | --         | The field the name is built from: a `string` or a `text`, never an `encrypted` one. `slug: 'title'` is the shorthand for it |
| `on`        | `'create'` | `'create'` generates it once; `'change'` follows the source and retires the old url                                         |
| `suffix`    | `true`     | Append the six character discriminator                                                                                      |
| `reserved`  | `[]`       | Words a slug may not take, on top of henri's own                                                                            |
| `maxLength` | `80`       | How long the folded source may be, before the discriminator                                                                 |

A declaration henri cannot carry out fails the boot naming the model (`HENRI_MODEL_SLUG_DECLARATION_INVALID`): a `from` the schema does not declare, one that is not text, an `encrypted` one, one marked `personal: { expose: false }` -- both of those are fields henri keeps off every answer, and a slug is in every url -- a schema that declares a `slug` field of its own next to it, or an unknown key.

### Slugs and personal data

A slug is public, by construction: it is in the url, in the browser history, in the proxy logs. So `/authors/ada-lovelace` is a decision to publish that name, and it is one henri lets you make -- a field marked `personal: true` may name a record -- but not one it makes quietly:

- a field marked `personal: { expose: false }` cannot be a `from` at all, because that mark says the value never leaves the server;
- `henri privacy:erase` anonymizes the columns it was told about and **does not rewrite the slug**, because the slug is an identifier and rewriting it would 404 every url that ever pointed at the record. A model whose records are about a person and whose name is built from them wants `slug` off the person's own field -- a title, a reference, a number -- rather than an erasure that only half happened.

### What is not here

No history table, so no `301` from a retired slug -- see above. No scoped uniqueness. No slug on the user model by default. No route that resolves a slug across models, and no redirect engine: a url is a route, and the router is where routes are.

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

writes `app/models/Post.js` with one field per `name:type` argument (`string` when the type is omitted, `!` marks it required) and refuses unknown types. One setting follows the type, `:enum=draft,in_review,live`, and it is there because it is the mark the generated pages read back:

```bash
henri generate scaffold Post title:string! status:string:enum=draft,in_review,live
```

writes the column, the [predicates and the scopes](#enums-predicates-scopes-and-the-list) that come with it, and a form whose `status` field is a `<select>` of those values rather than a text input. Everything else a column can say — a `default`, `unique`, `index`, a `personal` mark — is written in the model file, which is where the generators read it: a `henri generate scaffold` or `crud` run over a model that already exists follows what that file says. `henri generate scaffold` and `crud` start with the same model and add the controller, routes and views; see the [CLI reference](/reference/cli/#generators).

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

What [a validation](#validations) refuses, and what the ORM refuses on its own, arrive in one shape. The three reject an invalid write differently: a Mongoose `ValidationError` keyed by path, a Sequelize `SequelizeValidationError` holding an array, a Drizzle `ValidationError`, a MongoDB duplicate key or a `SequelizeUniqueConstraintError`. `henri.model.errors(error)` turns any of them into `{ field: message }`, and answers `null` for anything that is not a validation failure, so a controller can answer a 422 and let the rest bubble up:

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
await henri.model.stores.default.describe(); // what the database holds
```

`describe()` is the one that reads the database back rather than the model files, which is why it is worth knowing about: the physical table name, the real column names (the `externalId` a model declares is `external_id` in every SQL store henri writes), the type the dialect chose, the nullability, the defaults, the values of an enum where the dialect keeps them, every index that exists, and the names of the tables no model claims. It reads and never writes, and `henri db:schema` prints it. On a `mongoose` store the answer says `enforced: false` and `read: "models"`: the collections and the indexes come from the server and are real, the fields are henri's own declaration, and MongoDB holds no document to them.

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
henri db:schema                          # what the database holds: tables, columns, types, indexes
henri db:generate --name=add-priority    # writes db/migrations/0001_add_priority.sql from the models
henri db:migrate                         # applies the pending migrations
henri db:rollback                        # undoes the last one (--step=<n> for more)
henri db:push                            # makes the database match the models, no migration (development)
henri db:schema:dump                     # writes db/schema.sql from the database
henri db:schema:load                     # creates that schema in an empty database
```

`db:status` and `db:schema` are two questions of the same database and neither is computed from the other: `db:status` says what is _wrong_ and says nothing when the answer is "nothing", `db:schema` says what is _there_. `db:schema` is the only one of the two a `mongoose` store can answer.

In development the boot pushes the schema unless the store sets `"sync": false`; in production the boot applies the pending migrations when the store sets `"migrate": true` and warns about them otherwise. `henri db:push` refuses statements that lose data unless `--force` is passed; every command accepts `--store=<name>` and `--json`. `henri db:seed` is the exception: it runs [`db/seeds.js`](#seeds) on any adapter.

#### Migration safety

drizzle-kit writes the difference between the models and the last snapshot,
and it will happily write a statement that takes a production database down.
henri reads the generated SQL back -- the SQL, not the model diff, because the
SQL is what runs -- and says which statements are the ones that bite.

Where that lands depends on who is standing there:

- **`henri db:generate` warns.** Generating is a development act, the
  developer is right there, and the migration they just wrote is the thing
  they are still deciding about. It always writes the file.
- **A production `henri db:migrate` refuses**, and so does a production boot
  with `"migrate": true` on the store, because that is the one place nobody is
  watching (`HENRI_MIGRATION_UNREVIEWED`). Nothing is applied -- not even the
  safe migrations queued ahead of the one it stopped on, because applying half
  of a deploy's schema change is its own outage.
- **`henri db:status` and `henri doctor` report** every pending migration that
  would be refused, so somebody finds out before the deploy rather than during
  it.

##### What it checks, and where each one bites

The classic set, with the dialect answers measured against a real
PostgreSQL 17, MySQL 8.4 and SQLite 3.53 rather than assumed
(`packages/drizzle/__tests__/engines.spec.js` is where they are pinned):

| Check             | sqlite | postgres | mysql | What runs into                                                                               |
| ----------------- | ------ | -------- | ----- | -------------------------------------------------------------------------------------------- |
| `table.drop`      | yes    | yes      | yes   | The deploy window, not the lock: the old process is still reading it.                        |
| `column.drop`     | yes    | yes      | yes   | The same. Instant on postgres and on MySQL 8, which is not the problem.                      |
| `table.rename`    | yes    | yes      | yes   | Worse than a drop: the old code and the new code both break.                                 |
| `column.rename`   | yes    | yes      | yes   | The same.                                                                                    |
| `column.not-null` | yes    | yes      | yes   | Not the same failure on each: see below.                                                     |
| `column.type`     | yes    | yes      | yes   | A table rewrite under a lock on postgres and mysql; on sqlite, a copy.                       |
| `index.build`     | --     | yes      | --    | A postgres problem alone: see below.                                                         |
| `table.recreate`  | yes    | --       | --    | sqlite's answer to `ALTER COLUMN`, which copies the table.                                   |
| `data.unbounded`  | yes    | yes      | yes   | A `DELETE` or an `UPDATE` with no `WHERE`, which drizzle-kit never writes and a person does. |

Two of those are worth spelling out, because the dialects genuinely disagree.

**A `NOT NULL` column with no default does not fail the same way.** sqlite
(`Cannot add a NOT NULL column with default value NULL`) and postgres
(`23502`) refuse the statement outright as soon as the table has one row, so
the migration fails and the deploy stops. MySQL 8.4 **accepts it**, under
`STRICT_TRANS_TABLES`, and writes an empty string into every existing row of a
`varchar` and a zero into every `int`, without a warning. The loud failure is
the kind one; the safe path on all three is the same, which is to add the
column nullable, backfill it, and add the constraint in a later migration.

**Building an index is a postgres problem.** `CREATE INDEX` holds a
`ShareLock` there, so every `INSERT`, `UPDATE` and `DELETE` on the table waits
for the build. MySQL 8 builds a secondary index online -- it accepts
`ALGORITHM=INPLACE, LOCK=NONE`, which it only does when concurrent writes are
really allowed -- and sqlite has no concurrent form at all. henri reports it on
postgres and stays quiet on the other two, because a check whose message
cannot name a safe path is a check people turn off.

The safe path on postgres has a catch worth knowing, and henri's message says
it: `CREATE INDEX CONCURRENTLY` **cannot go in the migration file**. drizzle
applies every pending migration inside one transaction, and postgres refuses
`CONCURRENTLY` in a transaction block (`25001`). So build the index against the
database yourself, outside the migration, and `henri db:generate` will see that
it is already there.

##### How the SQL is read

By walking it, not by matching it. A regular expression over a whole file
would be both slow and, worse, wrong: `INSERT INTO notes (body) VALUES ('run
DROP COLUMN before the deploy')` is a safe statement that contains the text of
a dangerous one, and refusing it is worse than not checking at all. So henri
scans the file once, character by character, and knows the four things that are
not code: line and block comments (nested on postgres, flat elsewhere), string
literals with their `''` escape plus mysql's backslashes, mysql's
`"double quoted"` strings, postgres's `E'...'` and `$tag$ dollar quoting $tag$`,
quoted identifiers in all three flavours, and the `--> statement-breakpoint`
line drizzle-kit writes. **A string literal's content is thrown away** by the
scanner rather than skipped over, so nothing downstream can read one as SQL
even by accident.

Two rules exist only to keep a false refusal from happening, because a false
refusal is what gets a checker turned off:

- **A table created by the same migration has no rows**, so nothing done to it
  is reported. Without this, every first migration would warn about the indexes
  it creates beside its tables.
- **sqlite's table rebuild is one finding, not two.** sqlite has no
  `ALTER COLUMN`, and drizzle-kit's answer is to create `__new_tasks`, copy
  every row into it, `DROP TABLE tasks` and rename. Read one statement at a
  time that is a dropped table and a renamed table; read as a migration it is
  one table being rebuilt, and that is what `table.recreate` says. The pattern
  is recognized by its shape -- a table created here, later renamed onto a
  table dropped here -- and not by drizzle-kit's `__new_` prefix.

##### Approving one

The way through is a token in the configuration, the way
[`config.retention.approved`](/guides/retention/) works:

```bash
henri db:status      # prints the token of every pending migration it found something in
```

```json
{
  "migrations": {
    "approved": ["0002_drop_email:9f3c1a2b4d5e"]
  }
}
```

The digest covers **what was found**, not the file: reformatting the migration
or adding a comment leaves the token alone, and another `DROP COLUMN` edited in
afterwards makes a new one, so the approval goes stale exactly when the thing
approved changes. It is a plain digest and not a keyed one, deliberately -- a
token is committed and travels to production, where `config.secret` does not.

A flag on the command would have been the other answer, and it is the worse
one: `henri db:migrate --force` in a deploy script is written once and then
turns the check off for **every future migration**, silently, which is the
failure this feature exists to prevent. A token names one migration and expires
with it. For the operator who cannot redeploy the configuration, the
environment already reaches it, and says so at boot:

```bash
HENRI_CONFIG_JSON__migrations='{"approved":["0002_drop_email:9f3c1a2b4d5e"]}' henri db:migrate
```

`"migrations": { "approve": false }` turns the gate off wholesale for an
application whose review lives somewhere else. That is a configuration rather
than a flag, so it is visible in the repository, and `henri audit` reports it
in a production configuration (`migrations.unreviewed`).

##### What it does not check

It reads what is in the file. A migration that is safe on its own and
catastrophic next to the deploy it ships with is not something a file can
show, and henri does not guess: the deploy order is yours. It also does not
count rows -- `db:rollback` does that, because it knows exactly which rows an
inverse would remove, and a forward migration does not. And a MySQL executable
comment (`/*!40101 ... */`) is read as a comment, so a statement hidden in one
is not seen; drizzle-kit writes none, and treating it as code would mean
refusing statements that will not run on the server in front of you.

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

**A unique column is a named constraint here, and only here.** SQL Server names an inline `UNIQUE` itself -- `UQ__Articles__32DD1E4C507CA19A` -- and Sequelize then cannot tell which column a violation was about: it looks the constraint name up among the ones it computed itself, misses, and reports the constraint name where the column belongs. So a duplicate slug used to answer `{ UQ__Articles__32DD1E4C507CA19A: 'UQ__Articles__32DD1E4C507CA19A must be unique' }` instead of the `{ slug: 'must be unique' }` [every other store answers](#validation-errors). henri writes `CONSTRAINT [Article_slug_unique] UNIQUE ([slug])` instead, which is what makes that lookup hit. It covers the columns a model declares and the ones henri adds (`externalId`, `slug`, `email`), it is the same name in every database, and it changes nothing on the other three dialects, which report the column on their own.

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
