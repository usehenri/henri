# @usehenri/drizzle

## 1.2.0

### Minor Changes

- [#442](https://github.com/usehenri/henri/pull/442) [`792a15a`](https://github.com/usehenri/henri/commit/792a15ade614cf8b920d9197586f9866700d458e) Thanks [@reel](https://github.com/reel)! - A write the store refused puts back every attribute it set.
  
  `record.update(attrs)` sets the attributes and saves them, and only the second half can fail. Until now the set had already happened, so the value the store refused stayed on the record in hand:
  
  ```js
  try {
    await post.update(req.permit('title', 'views'));
  } catch (error) {
    // post.views was the value the database or the validator just refused
    return res.boom.badData(error.message, { errors: henri.model.errors(error) });
  }
  ```
  
  Anything that then rendered, logged or wrote from `post` was working from a value no store ever accepted. The measurement on the three adapters is what settled the fix: the next `update()` on that record was measured against the stale value on Drizzle and Mongoose, so a second write naming a different field entirely was refused for a field it never named — while on Sequelize the same second write **succeeded**, because Sequelize narrows the statement to the fields the call names, so the row kept the old value and the record went on saying the refused one with nothing to say otherwise.
  
  So the rule, and it is the same sentence on `drizzle`, `postgresql`, `mysql`, `mongoose`, `disk` and `mssql`: **a write the store refused leaves the record holding the values it had.** A rule of `validates`, the schema's own `required` or `enum`, and the unique index all put the attributes back — the database's refusal too, because a single-row `INSERT` or `UPDATE` is refused whole and there is no half-written row for the record to disagree with.
  
  What it is not:
  
  - **Not a reload.** Nothing is read back and a refusal costs no query.
  - **Not everything that can go wrong.** A refusal is what `henri.model.errors()` calls one. A hook of yours that throws is not, and that matters for an `afterUpdate` hook in particular: by then the row has moved, and the record keeps the values it now holds.
  - **Not `set()` + `save()`.** Those stay two steps and keep what was set, which is how a form keeps what a person typed.
  
  On a `mongoose` or `disk` store `record.update()` is new: Mongoose removed `Document.prototype.update` in version 7, so henri adds it back with the meaning it has on the other two adapters — the models guide already told applications to write `article.update({ ... })`, and now that call exists everywhere. `henri generate scaffold|crud` writes it into the Mongoose controller in place of `set()` then `save()`.

- [#352](https://github.com/usehenri/henri/pull/352) [`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388) Thanks [@reel](https://github.com/reel)! - Registration, password reset and email confirmation, as part of the framework.
  
  henri mounted sessions, `POST /login` and `POST /logout`, and the store added `email`, `password` and `roles`. Everything after that — creating an account, resetting a password, proving you can read an address — was left to every application, which is exactly where hand-rolled authentication goes wrong: tokens that never expire, resets that leave the thief's session signed in, confirmation links that leak in a `Referer`, and answers that tell an attacker which addresses are registered. Rails 8 generates the whole thing and every Laravel and Adonis starter kit ships it; this is henri's.
  
  Three blocks of `config.user` mount seven endpoints, ahead of the application's routes and on every renderer and every adapter:
  
  ```json
  {
    "user": {
      "signup": { "fields": ["name"] },
      "passwordReset": true,
      "confirmation": { "required": true }
    }
  }
  ```
  
  `POST /signup` creates an account and opens a session; `POST /password/forgot`, `GET /password/reset/:token` and `POST /password/reset` are the reset; `GET /confirm/:token`, `POST /confirm` and `POST /account/email` are the confirmation and the address change. Each answers JSON to API clients and redirects browsers, the way `POST /login` does, and each is also a method on `henri.accounts` for an application that would rather answer them from its own controller. `roles` stays unassignable, the password is still hashed by the store and never selected, and the address is still unique and lowercased.
  
  **The tokens are signed, not stored.** One HMAC over the application secret covers the token's purpose, its expiry and a seed taken from the state the action is about to change — the password hash for a reset, the address and its confirmation date for a confirmation. Performing the action moves the seed, so a link works once, expires on its own, cannot be replayed for another purpose or against another account, and a database leak hands over nothing usable because forging one needs the secret. The other side of that coin, which the configuration guide now says where secrets are rotated: rotating `secret` invalidates every link that has not been used yet.
  
  **A reset signs the other devices out.** It stamps the new `passwordChangedAt` column, and every session opened before that moment stops resolving to a user on its next request — no scan of the session store, no extra read per request. Which matters, because the usual reason someone resets a password is believing that somebody else has it.
  
  **Neither flow says whether an address is registered.** A reset request and a confirmation resend answer `202` with the same body, and henri writes that answer _before_ it looks anything up: the lookup, the token and the mail all run after the response, so the time a client can measure carries nothing either. An address change writes nothing until the link sent to the new address is followed, so an address nobody proved they can read never becomes the address of an account.
  
  The mails come from an `auth` mailer that ships with henri, with its views and its previews, so a fresh application can reset a password before anyone has written a template; an application overrides one view (`app/views/mailers/auth/reset.hbs`) or one action (`app/mailers/auth.js`) and keeps the rest. Delivery goes through `deliverLater()`, so the job queue takes it when there is one and an SMTP timeout never blocks a request.
  
  `henri generate authentication` writes the whole story into an application, in the shape Rails 8 does: the configuration, the user model when there is none, the controller, the five pages for whichever renderer the application uses, the mailer and its views, the routes and a test suite covering the properties rather than the happy path.
  
  A handler that refuses a form and redirects now reaches the next page: what it puts in the flash under `errors` arrives as the `errors` a page already reads, so post/redirect/get carries its messages per field on both renderers. `henri generate authentication` is exposed by the MCP server like the other generators.
  
  The user model gains two nullable date columns on every adapter, `confirmedAt` and `passwordChangedAt`. A Drizzle application needs a migration for them (`henri db:generate`); Mongoose and the Sequelize adapters add them on their own. Turning `confirmation.required` on in an application that already has users means backfilling `confirmedAt` first, or they cannot sign in.

- [#437](https://github.com/usehenri/henri/pull/437) [`d074e8b`](https://github.com/usehenri/henri/commit/d074e8b482582e25f80d8a14b4735e69a2b7821e) Thanks [@reel](https://github.com/reel)! - Job batches: forty jobs, and one that runs when they are all done.
  `henri.jobs.batch({ callback, args, jobs })` enqueues them and seals the batch,
  or takes a function that adds them itself for a list too long to write out. The
  callback is an ordinary job of `app/jobs` and is handed the counts under
  `batch`.
  
  A batch **finishes**, it does not succeed: the callback runs once every job has
  reached a terminal state, `dead` included, so a batch that half failed still
  calls it and `failed` is a number to branch on. It runs **exactly once**, and
  never before the last job is terminal. `total` is written once, when the batch
  is sealed; `done` is advanced by a single `SET done = done + 1` guarded by the
  claim token of the attempt that wrote the outcome, so the counter is never read
  into the process to be written back and it moves for exactly one runner — the
  one whose outcome landed. The callback is then enqueued under a unique key of
  the batch's own, which makes settling idempotent, and the runner's sweep counts
  the rows of a batch nothing else could count (a runner killed between an
  outcome and its count, a job the recovery buried).
  
  An existing queue gains one column and one table, added by the same idempotent
  `henri jobs:install` the boot already runs and tolerated the same way: an
  application that makes no batch is unaffected, and `batch()` on a store that has
  neither is refused (`HENRI_JOB_BATCH_UNINSTALLED`) rather than counting nowhere.
  
  `henri jobs:batches`, `henri jobs:list --batch <id>`, `henri jobs:status` and
  `henri.jobs.batches.*` are how a batch is read back.

- [#358](https://github.com/usehenri/henri/pull/358) [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93) Thanks [@reel](https://github.com/reel)! - Bind every password hash to the row it belongs to, so a hash copied onto another row stops verifying.
  
  A hash is a value, and a value can be moved. Someone who can **write** your database but does not have the pepper cannot forge a hash, so they do the next best thing: they take a hash whose password they know — their own account's — and copy it onto somebody else's row, or onto a row they invented. The pepper never saw this coming, because the key is global: the same key recomputes the same hash wherever the bytes land. The pepper answers "you cannot make a hash"; this answers "you cannot move one".
  
  New hashes fold the record's `externalId` (the uuid v7 every record already carries) into what is hashed, keyed by the pepper, and are stored in the same column behind a `$henri-bound$v=1$` marker. No schema change, no migration, and no extra cost per sign-in: the marker says which of the two preimages to build, so verification hashes exactly once. `@node-rs/argon2` has no `associatedData`, and its `secret` is spoken for by the pepper, so the identity goes into a keyed pre-hash — the shape the pepper already used to give bcrypt a key it does not have.
  
  **Upgrading.** Nothing to do, and nobody is locked out. Every hash you have is unbound and keeps verifying; each is written back bound the next time its owner signs in successfully, the same way a bcrypt hash becomes argon2id. The curve of "how many are bound" is the curve of "who has signed in since the upgrade", so it never finishes on its own: an account that never signs in again stays unbound forever. `config.user.password.binding.allowUnbound: false` ends the migration by refusing whatever is left — count before you set it, `SELECT count(*) FROM users WHERE password NOT LIKE '$henri-bound$%'`.
  
  **Set a pepper.** Without `HENRI_PASSWORD_PEPPER` the binding is unkeyed: it still stops a hash being copied, but someone who can write rows can recompute a bound one for the row they are targeting. And be clear about the residual even with a pepper: an attacker who can write anything can also write `external_id`. Freeing the value they need means damaging the row it came from, because the column is unique, so they cannot silently clone their own account — but this is a defence against relocating a hash, not against a writable database.
  
  **Two API changes.** `henri.user.compare()` now wants the user rather than its hash (`henri.user.compare(password, user)`), because a bound hash cannot be checked without the record it belongs to; handing it a bound hash alone rejects with an error that says so instead of answering "invalid credentials" to a password that is right. And a **mass password write that matches more than one row is refused** with a validation error on `password`: one hash belongs to one record, and writing an unbound one instead would quietly reopen the door. `User.create()`, `user.save()`, `user.update()`, `User.findByIdAndUpdate()`, `User.bulkCreate()`, `insertMany()` and a `Model.update()` whose condition matches one row are all unaffected.
  
  `config.user.password.binding` is `true` (the default), `false`, or `{ enabled, allowUnbound }`. A user model that opted out of `externalId` cannot bind, keeps writing exactly the hashes it wrote before, and henri says so at boot.
  
  **`@usehenri/mongoose` fixes two holes this work uncovered.** `Model.insertMany()` runs no document middleware, so it was writing the password it was given **to the collection in the clear** and keeping whatever `roles` came with it — `insertMany([{ email, password, roles: ['admin'] }])` created an admin with a plaintext password. It now hashes and resets roles like every other create. `Model.bulkWrite()` runs no middleware either and would have done the same; a password written that way is now refused rather than stored in the clear.
  
  **`@usehenri/sequelize`** now honours `passwordsHashed` in `bulkCreate` and in the mass update as it already did on `create` and `save`: `bulkCreate(rows, { passwordsHashed: true })` and `User.update({ password: hash }, { passwordsHashed: true, where })` used to hash the hashes, leaving accounts nobody could sign in to.

- [#433](https://github.com/usehenri/henri/pull/433) [`7cb0b04`](https://github.com/usehenri/henri/commit/7cb0b04b29b61dedaa82fcd1972646fb3765acfc) Thanks [@reel](https://github.com/reel)! - What the database actually holds, for an agent and for a person.
  
  An agent working on a henri application could ask what the routes really are,
  what failed, what was logged and what is in a row -- and could not ask what the
  tables are called. The model files do not know: the physical table name, the
  column a rename produced (`externalId` is `external_id` in every SQL store
  henri writes), the type the dialect chose, an index somebody added by hand and
  a table nothing declares any more all live in the database and in the ORM
  objects of the running process. So SQL was written from `app/models` and
  guessed.
  
  `describe()` is new on the store adapter contract, implemented by
  `@usehenri/drizzle`, `@usehenri/mongoose` and `@usehenri/sequelize`: the real
  tables of every model with their real columns, types, nullability, defaults,
  enum values and indexes, plus the names of the tables no model claims. It reads
  the catalogue -- `describeTable()`/`showIndex()` on Sequelize, `pragma_*`,
  `information_schema` and `pg_*` on drizzle, `listCollections` and
  `collection.indexes()` on Mongoose -- and writes nothing.
  
  MongoDB gets the honest answer rather than the same one: the collections and
  the indexes are real, server-side facts, and the fields are henri's own
  declaration applied by Mongoose in this process, so the answer carries
  `read: "models"`, `enforced: false` and a note saying that a document written
  by anything else can hold any shape at all.
  
  `@usehenri/core` serves it at `GET /_henri/runtime/schema`, on the surface the
  `query` endpoint already lives on and under the same rules: development only,
  loopback only, `X-Henri-Runtime: 1`, and refused outright for anything carrying
  `Origin` or `Sec-Fetch-Site`. A column _name_ is never masked -- naming the
  columns is the point, and `password` is a column an agent has to be able to see
  -- while a column _default_ goes through the same redaction a query row does,
  by the column's own name and by shape. Bounded at 50 tables a store, with
  `?store=` and `?table=` to narrow. A SQL store also carries `drift`, the same
  report `henri db:status` prints, without the DDL: nothing on this surface
  writes.
  
  `henri mcp` exposes it as the `schema` tool, and `henri db:schema
  [--table=<name>] [--store=<name>] [--json]` is the same answer for a person at
  a terminal, with no running server needed. It is the half `henri db:status`
  never answered: `db:status` says what is _wrong_ and says nothing at all when
  the answer is "nothing", `db:schema` says what is _there_ -- and it is the only
  one of the two a `mongoose` store has ever been able to answer.

- [#387](https://github.com/usehenri/henri/pull/387) [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b) Thanks [@reel](https://github.com/reel)! - Drizzle is henri's SQL data layer: `henri new` defaults to it, and `@usehenri/postgresql` and `@usehenri/mysql` are it
  
  **This is a breaking change.** It rewrites what an existing store does rather than adding to it, and there is no compatibility switch. It is here rather than in a 2.0 because henri has no installed base to protect; if you have an application on `@usehenri/postgresql` or `@usehenri/mysql`, read the second half of this.
  
  **`henri new` scaffolds a drizzle store on sqlite.** `file:.henri/app.db`, `:memory:` under `NODE_ENV=test`, `@usehenri/drizzle` and `better-sqlite3` in the dependencies. This is Rails' default: nothing to start on the first run, a file the `.gitignore` already covers, migrations from the first day, and a database that is a real one on the last. The zero-config MongoDB store is `henri new --adapter disk`, one flag away and otherwise unchanged. `--adapter` now takes `drizzle` (the default), `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`, and `--dialect sqlite|postgres|mysql` works on its own now that drizzle is the default adapter.
  
  The first run costs nothing extra: `better-sqlite3` 13 ships its compiled addon for darwin, linux, linuxmusl and win32 on arm64 and x64, so the scaffold lists it as `better-sqlite3: false` under `allowBuilds` — pnpm skips a `node-gyp rebuild` that needs a C++ toolchain and produces nothing that gets loaded. The Dockerfile of a sqlite application installs no toolchain either, and says instead that the database file lives inside the container unless a volume is mounted over it.
  
  **`@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with the dialect and the driver chosen.** The package names, the `--adapter postgresql` and `--adapter mysql` flags and the `"adapter": "postgresql"` store value are unchanged; the ORM behind them is not. The name means "henri's PostgreSQL adapter", and henri's PostgreSQL adapter is Drizzle. A store on one of them now has generated, versioned migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`), needs no `dialect` key, and needs no driver in the application: `pg` and `mysql2` ship with the adapter package. `"adapter": "mariadb"` is `@usehenri/mysql` and follows.
  
  What that costs an application already on one of them: the global is the drizzle model, not a Sequelize `ModelStatic`. `findAll`, `findOne`, `findByPk`, `create`, `count`, `destroy`, `instance.update()` and `instance.destroy()` mean the same thing; `Model.scope()`, `findAndCountAll()`, `bulkCreate()`, `upsert()`, `increment()`, the association mixins and `instance.previous()` are gone and throw. Tables and columns are named the drizzle way (`tasks`, `created_at`, not `Tasks`, `createdAt`), so a database built by `sequelize.sync()` is not the one this adapter looks for. `website/src/content/docs/upgrading.md` has the list and the order to work through it.
  
  **The spellings that would have silently meant something else are refused.** This is the part that matters even if you never wrote a line of Sequelize. `Model.update(values, { where })` is Sequelize's argument order and the opposite of this adapter's: read as written it updates the rows matching the _values_ and sets a column called `where`, which answered "1 row updated" and changed nothing. It now raises the new `HENRI_MODEL_INVALID_QUERY`. So does a condition keyed by Sequelize's `Op` symbols (`Object.keys()` cannot see a symbol, so the condition narrowed nothing and the query answered every row), an empty operator object under a field, and `instance.get({ plain: true })`. An option the adapter does not read — `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `lock`, `plain` — raises the new `HENRI_MODEL_UNKNOWN_OPTION` instead of being dropped, because a dropped `fields` is a mass assignment somebody thought they had bounded. A model file's `options` takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`; one declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead, rather than starting an application whose author believes it has an index it does not have.
  
  **`@usehenri/sequelize` is the SQL Server story, and only that.** Drizzle has no SQL Server dialect — drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel — so Sequelize is how henri reaches one, `@usehenri/mssql` is built on it, and neither is going anywhere. Everything an mssql store does differently from every other SQL store (no migrations, `sequelize.sync()` in development, nothing in production, `henri db:status` for the drift) follows from that one fact, and the documentation now says so rather than describing four equal SQL adapters.

- [#417](https://github.com/usehenri/henri/pull/417) [`d88bf7f`](https://github.com/usehenri/henri/commit/d88bf7fe038a6b58e7bed02ff4c90755f6c0e65e) Thanks [@reel](https://github.com/reel)! - `henri console --sandbox`: a transaction held open for the life of the
  session and rolled back when it ends, so a destructive thing can be tried on
  real data and nothing survives it.
  
  It is offered **only where henri can honour it**. A sandbox needs a model
  call to join the transaction of its async context on its own -- nobody
  threads a transaction handle through what they type at a prompt -- so it is
  `Drizzle#sandbox()`, the new optional method of the adapter contract, which
  covers every drizzle store (`drizzle`, `postgresql`, `mysql`, on sqlite,
  PostgreSQL and MySQL). `mongoose`, `disk` and `mssql` implement nothing:
  a Mongoose write only joins a transaction when the call is handed the
  `session` (and a MongoDB transaction needs a replica set), and Sequelize
  joins by async context only under `Sequelize.useCLS()`, which henri does not
  install. On those the console refuses **before it prints a prompt**, with
  `HENRI_STORE_SANDBOX_UNSUPPORTED` and exit 1, rather than opening a session
  whose writes quietly survive.
  
  Every store is opened, not only the default one, and a store that cannot
  open rolls back the ones that did. `henri console` without the flag is
  unchanged.

- [#385](https://github.com/usehenri/henri/pull/385) [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2) Thanks [@reel](https://github.com/reel)! - Encrypted attributes: a field that is ciphertext in the database and a plain
  string in the model.
  
  ```js
  schema: {
    ssn: { encrypted: true, type: 'string' },
    badge: { encrypted: { deterministic: true }, type: 'string', unique: true },
  }
  ```
  
  The three adapters honour it. `person.ssn` is the string it always was; the
  column holds `henri:v1:r:<key id>:<base64url>` — AES-256-GCM, with the model,
  the field and the scheme authenticated with the value, so a ciphertext only
  opens where it was written.
  
  The key is `config.encryption.keys`, never `config.secret`. Its home is the
  encrypted credentials of the environment (`henri credentials:edit`) or
  `HENRI_ENCRYPTION_KEYS`; `henri audit` reports a key found in a `config/*.json`
  and nothing henri prints ever holds key material — only the eight character key
  id.
  
  `encrypted: true` is randomised, so nothing can query it and henri refuses
  rather than matching nothing; `{ deterministic: true }` keeps an equality and a
  `unique`, and gives away which rows share a value. Only `string` and `text` may
  be encrypted, a `string` column becomes `text` (randomised) or `varchar(700)`
  (deterministic), and the fields henri itself queries — `email`, `password`,
  `roles` on the user model — cannot be marked.
  
  Rotation ships with it. `keys` is a list: every key decrypts, the first one
  encrypts, so adding one in front is a deploy. `henri encryption:status` counts
  what the columns hold by key id without opening a value, and
  `henri encryption:rotate` rewrites everything under the key that writes —
  soft-deleted rows included, `updatedAt` untouched, and never overwriting a value
  it could not read back. A backfill of a table that is already full is the same
  command, with `config.encryption.readPlaintext` on for the length of the
  migration.
  
  A value that will not decrypt throws, with a different code for a key that is
  missing, bytes that were changed and a column still in the clear;
  `henri.encryption.tolerate(fn)` is the one way past it, and it is what
  `henri privacy:export` and `henri privacy:erase` run inside so that a lost key
  costs a `null` and a line in the document rather than the whole request. A field
  marked `encrypted` is `personal` unless the model says otherwise, so it is
  masked in the logs, exported and erased.
  
  See the guide: https://usehenri.io/guides/encryption/

- [#427](https://github.com/usehenri/henri/pull/427) [`a93d6cc`](https://github.com/usehenri/henri/commit/a93d6cc39b33b261089e91f3e757b54fefc9fe15) Thanks [@reel](https://github.com/reel)! - Enum predicates, scopes and the list of values.
  
  A column that declares an `enum` already says what it may hold, so henri
  spells it back as methods rather than making every application write the
  strings out by hand:
  
  ```js
  // app/models/Post.js
  schema: {
    status: { type: 'string', enum: ['draft', 'in_review', 'live'] },
  }
  ```
  
  gives, on every adapter:
  
  - `post.isDraft()` on every record;
  - `Post.live()` on the model, answering **a condition** — `{ status: 'live' }`
    — intersected with whatever it is given;
  - `Post.enums.status`, the frozen list of values.
  
  The predicate is the one with no substitute: `post.status === 'darft'` is
  silently false for the life of the application, while `post.isDarft()` is a
  `TypeError` the first time it runs. Writing a wrong value was already
  refused on every adapter and every write path by the `enum` rule, so it is
  the comparison that needed the method — which is also why **Rails' bang
  (`post.archived!`) is not here**: `await post.update({ status: 'archived' })`
  is already one call that says what it does, and a method named after a
  transition invites a state machine henri would not be honouring.
  
  A scope answers a condition rather than records because henri has three
  query builders and wraps none of them: a condition is the value all three
  read identically, and the one that composes. It goes **under**
  `policy.scope(user)` and the client's filters with an `and` spelled for the
  adapter — `Post.paginate({ ...req.pagination(), where: Post.live(where) })`
  — so a scope narrows a list and can never widen it.
  
  `in_review`, `in-review`, `IN_REVIEW` and `InReview` all give `inReview`. A
  value that is not a name (`2fa`) gets no method and stays in the list. A
  generated name that is already a method of the model or of a record is a
  **boot failure** naming it (`HENRI_MODEL_ENUM_NAME_TAKEN`) rather than a
  silent shadow — `new` gives `isNew`, which is how Mongoose and the drizzle
  model tell an insert from an update — and the field is where the way out
  is written: `predicates: 'status'` prefixes both halves
  (`isStatusNew()`, `Post.statusNew()`) and `predicates: false` generates
  nothing and keeps the list. The check covers the names henri puts on a
  model on every adapter, so a model that boots on one store boots on the
  next.

- [#370](https://github.com/usehenri/henri/pull/370) [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595) Thanks [@reel](https://github.com/reel)! - Every failure henri raises now has a stable code.
  
  Rust prints `E0382`, TypeScript `TS2345`, Next.js a link to a page. henri had
  four names, all in the command line — `USAGE`, `FAILED`, `NOT_A_PROJECT`,
  `NEEDS_TTY` — and its runtime failures had none at all: a boot that stopped, a
  model that would not load, a store that refused a schema key, a view engine
  that was missing, all of them a message and nothing else. A message gets
  reworded; a code does not.
  
  Ninety-one of them, in one namespace across core, the adapters, the queue, the
  view engines, the command line and `henri mcp`:
  
  ```
  HENRI_MODEL_UNKNOWN_TYPE
  HENRI_BOOT_CIRCULAR_DEPENDENCY
  HENRI_STORE_URL_MISSING
  HENRI_VIEW_INERTIA_UNAVAILABLE
  ```
  
  `HENRI_` makes the whole code unique enough to search the web with, the area
  says which part of the framework raised it, and the reason reads without a
  lookup — the shape of node's own `ERR_*` codes, and of the four names the
  command line already had.
  
  The code reaches you wherever the failure does. In the boot log:
  
  ```
  view ✏  HENRI_VIEW_UNKNOWN_RENDERER => Unable to load 'reactt' renderer...
  ```
  
  In the error body of the JSON API, next to what it already answered with:
  
  ```json
  {
    "statusCode": 500,
    "error": "Internal Server Error",
    "code": "HENRI_STORE_NOT_STARTED",
    "message": "Internal Server Error"
  }
  ```
  
  In the terminal and in `--json`, where a boot failure now keeps the code of
  what actually went wrong instead of collapsing into `FAILED`:
  
  ```
  $ henri server
    henri server failed [HENRI_CONFIG_ENV_TYPE]: HENRI_CONFIG__port is not a number, and "port" is one in the configuration
  
  $ henri server --json
  {"error":{"code":"HENRI_CONFIG_ENV_TYPE","command":"server","exitCode":1,"hint":null,"message":"..."}}
  ```
  
  And in the answers of `henri mcp`, so an agent branches on the code rather
  than on the wording.
  
  The catalogue is `packages/core/error-codes.json`: one entry per code with
  what it means, what usually causes it and how to fix it, published as
  [the error code reference](https://usehenri.io/reference/errors/). It is data,
  and a test compares it with the source and with the page — every code raised
  has an entry, every entry is raised somewhere, no two mean the same thing.
  
  `config.errors.url` turns a code into a link. It is a template holding
  `{code}` (`"https://example.com/e/{code}"`), unset by default: henri ships no
  address, and nothing prints a link until you give it one.
  
  **Breaking**: the `code` of `henri <command> --json` now names the failure
  rather than the exit status. `USAGE` is `HENRI_CLI_USAGE`, `FAILED`
  `HENRI_CLI_FAILED`, `NOT_A_PROJECT` `HENRI_CLI_NOT_A_PROJECT`, `NEEDS_TTY`
  `HENRI_CLI_NEEDS_TTY`, `CONFIG_INVALID` `HENRI_CONFIG_INVALID`; a command may
  now answer something finer still. The `exitCode`, and the exit status itself,
  are unchanged: a script branching on `0`, `1`, `2`, `3` or `4` keeps working.
  The codes of `@usehenri/jobs` (`UNKNOWN_JOB`, `BAD_ARGUMENTS`, `TIMEOUT`, ...)
  and of `henri mcp` (`NO_SERVER`, `UNREACHABLE`, ...) moved into the same
  namespace for the same reason.

- [#410](https://github.com/usehenri/henri/pull/410) [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d) Thanks [@reel](https://github.com/reel)! - **`decimal` and `bigint` are henri types.** The vocabulary had no exact
  number: a model asking for `DECIMAL` got a `double` and one asking for
  `BIGINT` got a 32-bit `integer`, so money was binary floating point on the
  default adapter and a large identifier was a column that refused every
  insert past 2,147,483,647.
  
  `decimal` takes a `precision` (total digits, 19 by default, 38 at most --
  what every dialect henri writes carries) and a `scale` (digits after the
  point, 4 by default). `bigint` is a signed 64-bit integer and takes
  neither. Per dialect: `numeric(p, s)`/`bigint` on PostgreSQL,
  `decimal(p, s)`/`bigint` on MySQL, `Decimal128`/BSON `BigInt` on MongoDB,
  `BIGINT` on SQL Server (which takes no `decimal`, below), and `text` on
  sqlite, which has neither an exact decimal nor a 64-bit integer better-sqlite3 hands back
  whole. The stored value is exact everywhere; on sqlite a comparison and an
  order go through a cast, `INTEGER` for a `bigint` (exact, sqlite carries
  64 bits) and `REAL` for a `decimal` -- the one approximation, and the guide
  says so.
  
  **A value of either type is an exact decimal string in JavaScript**, on all
  three adapters: `'19.99'`, `'9223372036854775807'`. Not a `number`, which
  is what the column choice exists to avoid; not a `BigInt`, which
  `JSON.stringify` throws on and henri serializes records in a dozen places;
  not an object, which needs a dependency and survives JSON no better.
  node-postgres, mysql2 and `Decimal128.toString()` already hand back
  strings, so it is the shortest path rather than a conversion. On the way in
  henri takes a string, a `number` (through its shortest round-tripping
  representation, so `19.99` is `'19.99'`) or a `BigInt`. The validators, the
  JSON serialization, the HAL payloads, the OpenAPI description (a `string`
  with a `pattern`, because a JSON number is a double), the GraphQL
  derivation (`String`, because a `Float` would undo it), the query compiler,
  the `params` declarations and the version diffs all agree on that.
  
  **A value the column would have changed is refused rather than rounded**:
  more decimal places than the scale, more digits than the precision, a
  `bigint` outside the 64-bit range, and a JavaScript number that is not a
  safe integer. `0.1 + 0.2` fails validation instead of landing in the
  column. henri does not round money.
  
  **The compatibility spellings point at the real types now.** In a drizzle
  model `DECIMAL`, `NUMERIC` and `BIGINT` resolve to the exact types instead
  of a double and a 32-bit integer; in a sequelize model
  `DataTypes.DECIMAL(10, 2)` is read as the henri decimal and gets the same
  string boundary. Three things are refused at boot instead of downgraded,
  each naming the model and the field (`HENRI_MODEL_TYPE_UNSUPPORTED`): either
  type on a sqlite store served by `@usehenri/sequelize`, whose driver reads
  both through a JavaScript number; and a bare `DataTypes.DECIMAL`, which
  MySQL makes `DECIMAL(10, 0)`. `decimal` on an `@usehenri/mssql` store is a
  third, for the first reason: `tedious` reads every `DECIMAL` as
  `value / Math.pow(10, scale)`, so the column comes back a double. A
  `bigint` there is exact -- that driver hands one back as a string -- so an
  amount on SQL Server goes in a `bigint` of cents.
  
  `henri generate model thing price:decimal` writes `precision: 12, scale: 2`,
  because the default is rarely what money wants.

- [#376](https://github.com/usehenri/henri/pull/376) [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f) Thanks [@reel](https://github.com/reel)! - The public identifier goes all the way: a foreign key travels as one, and a
  primary key stops resolving
  
  1.2 gave every record an `externalId` and took its own primary key out of
  what leaves the server. Two holes were left, and both are closed here.
  
  **A foreign key is the `externalId` of the row it names.** A proposal that
  belongs to a speaker answered `speakerId: 4812` -- another row's sequential
  id -- so enumeration survived one relation away. `res.render()`,
  `res.resource()` and `res.collection()` now replace every _declared_ foreign
  key on the way out, and a key that names no row is `null`, never the number.
  henri reads what the model said (`belongsTo()`, `references: { model }`,
  Mongoose's `ref`) and never a field name; a Mongoose `refPath`, a `ref` given
  as a function and a column that points at a row without saying so are left
  alone, and the guide says so. The cost is bounded: one call covers a whole
  answer, an eager-loaded association is used when its primary key matches the
  key it is standing in for, and the rest is one statement per target model
  rather than one per record.
  
  **`Model.findById()` takes the public identifier and nothing else.**
  `GET /tasks/4812` used to answer next to the uuid, so guessing a number still
  worked and the uuid bought nothing. A primary key now gets the same `null` an
  unknown uuid gets -- the controller answers its own 404, and nothing in the
  answer says which of the two it was. `findByIdAndUpdate()` and
  `findByIdAndDelete()` refuse the same values.
  
  **`findByKey()` is the new lookup for a primary key**, on all three adapters,
  for the server-side code that legitimately holds one; `findByExternalId()` is
  the explicit other half. `findByPk()` is an alias of `findByKey()` on the
  Sequelize adapters and on Drizzle, and no longer accepts a uuid. It fails
  closed: a value the key column cannot hold answers `null` instead of a
  database error. henri's own session and token lookups take either identifier,
  so signing in and staying signed in are unaffected.
  
  **`henri.model.publish()`** is the same gate, exposed: a controller that
  presents its records hands `res.resource()` a plain object, and a plain
  object carries no model, so publish first and present second.
  
  `config.externalIds` (`lookup`, `references`) restores either behaviour for
  an application that cannot move yet, and `henri audit` reports both
  (`externalIds.lookup-any`, `externalIds.references-disabled`, ASVS V4.2.1).
  A model with `options: { externalId: false }` is unaffected by any of it, and
  so is a foreign key pointing at one.
  
  Upgrading: change `Model.findById(record.id)` to `Model.findByKey(record.id)`
  wherever the value came from the database. `Model.findById(req.params.id)`
  needs no change -- that is the case this is for.

- [#434](https://github.com/usehenri/henri/pull/434) [`2625067`](https://github.com/usehenri/henri/commit/26250673d91ab70ad024739d02b647754f75267d) Thanks [@reel](https://github.com/reel)! - Per-job concurrency limits. `henri jobs --concurrency` bounds a runner; a job
  now bounds itself across every runner: `concurrency: 1` for one at a time,
  `concurrency: { limit: 3, key: 'tenantId' }` for three per key, and `group` for
  several jobs sharing one bound. The permit is taken before the work, from a
  table the queue owns whose primary key is the bound — the one primitive that
  means the same thing on PostgreSQL, MySQL, MSSQL, sqlite and MongoDB, which an
  in-claim `COUNT(*)` does not. The claim statement keeps its shape and an
  application with no limited job sends the one it always sent.
  
  An existing queue gains one column, added by the same idempotent
  `henri jobs:install` the boot already runs. It is tolerated: an application
  with no limited job is unaffected whether it applied or not, and one that
  declares a limit whose table cannot hold it refuses to start
  (`HENRI_JOB_LIMIT_UNINSTALLED`) rather than running unbounded. A job already in
  the queue when the limit was declared is bounded too.
  
  `henri jobs:status` and `henri.jobs.limits()` report what was asked for and
  which slots are held. The guide says why henri mounts no dashboard, and what
  to build one from.

- [#375](https://github.com/usehenri/henri/pull/375) [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b) Thanks [@reel](https://github.com/reel)! - Personal data: mark a field in the model, and henri does the rest
  
  A model now says which of its fields are about a person, in the schema, next
  to the type: `name: { personal: true, type: 'string' }`. Four things follow
  from the mark.
  
  - **The logs.** Every personal field name is masked in what `pen` prints and
    in the errors and log lines `henri mcp` records — matched exactly, next to
    the substring filters of `config.filterParameters`. **The email address of
    the user model is personal, so it is masked from now on**, in every log line
    of every application.
  - **What leaves the server.** `personal: { expose: false }` drops a field from
    every answer henri builds — `res.render()`, `res.resource()`,
    `res.collection()` and the public user — everywhere, at every depth. Nothing
    else changes: a field marked `personal: true` is sent exactly as it was
    before, because dropping `email` by default would break every application.
    `res.render(view, { data, include: ['phone'] })` is how the person's own
    page gets one back, and `config.privacy.expose: false` flips the default for
    applications that want the strict reading.
  - **`henri privacy:export <who>`** hands a person everything the application
    holds about them: their own record and every record of every model linked to
    them, soft-deleted rows included.
  - **`henri privacy:erase <who>`** removes them. A soft delete is never an
    erasure and a soft-deleted row is erased like any other; the records that
    reference the person survive while the person is anonymized in place
    (`options: { personal: { onErase: 'anonymize' | 'delete' | 'orphan' |
  'retain' } }`); the plan is refused before anything is written when it cannot
    be carried out; and every erasure leaves a receipt naming what it touched,
    with an HMAC of the identity rather than the identity.
  
  `henri privacy` prints the map the way `henri routes` prints the routes,
  `henri.privacy` is the same thing from the application (a "download my data"
  and a "delete my account" button are three lines), `henri audit` reports a
  field that is plainly about a person and carries no mark
  (`privacy.unmarked`, ASVS V8.3.4), and `config.privacy` holds `expose`,
  `onErase` and `receipts`.
  
  The three adapters accept the key and keep it out of the column, so a marked
  model generates exactly the schema it did before.

- [#426](https://github.com/usehenri/henri/pull/426) [`ab52e18`](https://github.com/usehenri/henri/commit/ab52e187c420dfe381f03ed51c5c141fda525acb) Thanks [@reel](https://github.com/reel)! - Migration safety: a generated migration is read back before it runs
  
  `henri db:generate` writes what drizzle-kit computed, and drizzle-kit will
  happily write a statement that takes a production database down. henri now
  scans the generated SQL -- the SQL, not the model diff, because the SQL is
  what runs -- and reports a dropped or renamed column or table, a `NOT NULL`
  column with no default, a type change, an index build and a `DELETE` or
  `UPDATE` with no `WHERE`.
  
  `db:generate` warns and writes the file anyway: generating is a development
  act and the developer is right there. A **production** `henri db:migrate`
  refuses (`HENRI_MIGRATION_UNREVIEWED`) until the migration's token is in
  `config.migrations.approved`, and applies nothing at all, not even the safe
  migrations queued ahead of it; a production boot with `"migrate": true` on the
  store goes through the same call. `henri db:status` and `henri doctor`
  (`schema.unreviewed`) report what the deploy is going to refuse, before the
  deploy.
  
  Which checks bite is measured per dialect rather than ported from a
  Postgres-shaped list. An index build is a postgres problem alone -- it holds a
  `ShareLock` there, while MySQL 8 accepts `ALGORITHM=INPLACE, LOCK=NONE` and
  sqlite has no concurrent form to point at. A `NOT NULL` column with no default
  does not even fail the same way: sqlite and postgres refuse the statement once
  the table has a row, and MySQL 8.4 accepts it and writes an empty string or a
  zero into every existing row without a warning. `CONCURRENTLY` is named as the
  fix and is explicitly _not_ told to go in the migration file, because drizzle
  applies every pending migration inside one transaction and postgres refuses
  `CONCURRENTLY` in a transaction block.
  
  The escape is a token in the configuration, the way `config.retention.approved`
  works, rather than a flag: `henri db:migrate --force` in a deploy script would
  be written once and then turn the check off for every future migration, while a
  token names one migration and goes stale when its findings change.
  `"migrations": { "approve": false }` is the blanket way out and `henri audit`
  reports it in a production configuration (`migrations.unreviewed`).
  
  The SQL is read by a scanner that walks it rather than a regular expression
  that matches it: comments, string literals (whose content it throws away
  rather than skips over), postgres dollar quoting and each dialect's identifier
  quotes are lexed, so a migration that only _mentions_ `DROP COLUMN` inside a
  string is not a finding. Two rules exist to keep a false refusal from
  happening -- a table created by the same migration has no rows, and sqlite's
  copy-and-rename table rebuild is recognized by its shape and reported once as
  what it is.
  
  New configuration: `migrations.approve` and `migrations.approved`.

- [#420](https://github.com/usehenri/henri/pull/420) [`b7b56e1`](https://github.com/usehenri/henri/commit/b7b56e190ae774abc0096fe2aebaf91f823115af) Thanks [@reel](https://github.com/reel)! - Model validations that mean the same thing on all three adapters.
  
  A model says what must be true of its records in a `validates` block, keyed by field, in the vocabulary a controller's `params` block already uses:
  
  ```js
  // app/models/Post.js
  module.exports = {
    schema: {
      title: { type: 'string', required: true },
      slug: { type: 'string', unique: true },
      status: { type: 'string', enum: ['draft', 'live'], default: 'draft' },
      body: { type: 'text' },
    },
  
    validates: {
      title: { minLength: 3, maxLength: 120 },
      slug: { pattern: /^[a-z0-9-]+$/ },
      status: {
        validate: (value, post) =>
          value !== 'live' || Boolean(post.body) || 'needs a body first',
      },
    },
  };
  ```
  
  `required`, `enum`, `min`, `max`, `minLength`, `maxLength`, `pattern` and `validate` — no `type`, because the schema next door already says it, and that is what decides which constraints apply. A rule henri cannot carry out fails the boot naming the model and the field (`HENRI_MODEL_VALIDATION_INVALID`) rather than being ignored.
  
  It runs where the writes are, not where each ORM happens to look. **The schema's own `required` and `enum` are the same rules**, so this changes what an application that declares no `validates` at all already does:
  
  - **Mongoose** ran its validators on `save()`, `create()` and `insertMany()` and on nothing else. `updateOne`, `updateMany` and `findOneAndUpdate` wrote a `null` over a required field and a value outside an `enum` straight into the document. They are checked now.
  - **Sequelize** skipped `bulkCreate` (its `validate` defaults to `false`), so a value outside an `enum` was written. It is checked now, and Sequelize's own validation is turned on for that call too.
  - **Sequelize on PostgreSQL and MySQL** has a native `ENUM` column and had no JavaScript check at all, so the _server_ refused the value with a `SequelizeDatabaseError` — which `henri.model.errors()` answers `null` for, so an application answered **500** where the same model file answered 422 on sqlite. henri refuses first now, and the answer is the same 422 on every dialect.
  - The message is henri's on all three: `must be one of draft, live`, `is required`, `must be at most 120 characters`. A `required` field holding nothing but spaces is missing, which is what Mongoose and Drizzle already said and Sequelize did not.
  
  The failure is the shape applications already read: `henri.model.errors(error)` answers `{ field: message }`, and nothing about the 422 changes.
  
  Two things are refused rather than quietly skipped. A `validate` that declares a second parameter is asking for the record, the way a policy rule does — a mass write has none, so a mass write naming that field is refused with the loop to write instead (`HENRI_MODEL_VALIDATION_MASS_WRITE`). And a write no hook of the ORM reaches — Mongoose's `bulkWrite`, Sequelize's `increment`/`decrement`, an update operator like `$inc` — is refused on a validated field (`HENRI_MODEL_VALIDATION_UNCHECKED_WRITE`) instead of letting the declaration stop being true. `unique` stays what it is: an index the database enforces, because a check before an insert is a race, and `henri.model.errors()` already turns the duplicate into `{ field: 'must be unique' }`.
  
  A `validate` function in the schema of a Sequelize store now fails the boot pointing at `validates`: Sequelize reads its own `validate` as an object of named validators, so a function there did nothing, while the same line on the other two adapters ran.

- [#406](https://github.com/usehenri/henri/pull/406) [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636) Thanks [@reel](https://github.com/reel)! - Model versions: the history of a record, kept row by row.
  
  A model asks, and nothing else changes:
  
  ```js
  options: {
    versioned: true;
  }
  ```
  
  From then on every create, update and delete of that model writes one row into a table henri owns (`henri_versions`): when, the model, the record's **`externalId`** — never its primary key — the event, the attributes that moved as old to new, the actor and the request id.
  
  ```
  $ henri versions Article
  
    2026-03-04T10:12:44.918Z  update   Article 018f2a41-…-7000-…
      01a077c7-…  actor 018f0a11-…  request 4f2c…
      title: The old headline -> The new headline
      published: false -> true
  ```
  
  **Off costs nothing, and off is the default.** No model saying `versioned` means no table created, no hook registered on any model, no middleware mounted and no boot line — the same bargain the call log makes. `config.versions` says only where the table lives and how long a row is kept; it turns nothing on.
  
  **This is not the access trail, and the difference is the point.** The trail records field _names_, counts and digests and **refuses a value**. A version exists to hold the values: without the old value there is no reconstructing the record, and without that this would be a worse trail. The trail answers _who saw this record_, the call log answers _what did this request do_, and a version answers _what did this record used to say_. None of the three substitutes for another.
  
  **What a row holds per event** follows one rule. A `create` holds every stored field as `[null, value]` — the new side already _is_ the record. An `update` holds the fields that moved, and **a soft delete is one of these**: the row is still in the table with `deletedAt` set, so the diff describes it exactly. Only a `destroy` — the row leaving the database — carries a `snapshot`, and that is the whole reason snapshots exist: a diff describes a change _to something_, and after a real delete there is no something left to fold back from.
  
  **The actor and the request id are the join, and nothing carries them.** `base/request-id.js` already keeps the request id in an `AsyncLocalStorage`, and the module puts the signed-in person on the same store, so `record.save()` four calls deep in a service is recorded against whoever is signed in. Outside a request henri says so rather than guessing — `actor` is null, `source` is `system` — and `henri.versions.acting({ actor, source }, fn)` is how a job, a console session or a seed says better.
  
  **It holds values, so it inherits the privacy machinery rather than sidestepping it.** In order: a field the model left out (`only` / `except`) is not stored and not named; **`password` is never stored** on any model, whatever `filterParameters` says; a field marked `encrypted` is stored as its **envelope**, written with the field's own context so it opens where the row's does, and never as its plaintext; and a name `filterParameters` matches is not stored. A change with no values is `null` rather than a masked string, because a mask is a value a restore would write into the column.
  
  A field marked `personal` **is** stored, and the guide argues it: dropping it would empty the history of exactly the models worth versioning — who changed this person's address, and to what. What makes that safe is that the rows are reachable. `henri privacy:erase` reaches them (`versions.onErase`: `follow` takes the versions of a deleted record away and empties the erased values out of the versions of a record that survives; `delete` takes them all; `retain` leaves them and says so in the receipt, and in every case the person stops being an actor), `henri privacy:export` hands a person the history held about them, and the retention sweep prunes them (`versions.keep`).
  
  **`reify` reads and `restore` writes**, which is the difference between them. `reify()` answers the record as it was immediately after a version, touching nothing, by folding **backwards** from the live record — backwards because the live row is the one thing certainly complete, and folding forwards from the create would answer a record that never existed the first time a version was pruned. It may be partial and says so. `restore()` puts that back — an update on a record that still exists, an insert under the same `externalId` on one that was destroyed, so every link that named it still does — and **refuses an inexact reconstruction** (`HENRI_VERSION_INCOMPLETE`) unless forced, because a read that is missing a field lets you see the gap and a write that is missing one would silently change the record.
  
  **A mass write on a versioned model is refused** (`HENRI_VERSION_MASS_WRITE`). `Model.update(where, attrs)` runs the hooks once and without instances, so recording nothing for a hundred changed rows would make the history lie, and a history that silently misses changes reads as evidence and is not. Recording one entry per row was the other option and it was declined twice over: it turns an update into a full read of every matching row, and the read and the update are not one statement, so a row that changed in between would be recorded with a diff that never happened. The refusal names the loop that replaces it, `{ versions: false }` is the way through and is a decision rather than a silence, and Sequelize's `{ individualHooks: true }` is honoured as its own answer. A mass **create** is never refused: it has no before state, so nothing is lost.
  
  `henri versions`, `henri versions:show` and `henri versions:restore` read it back with `--json` like everything else, the codes are the `version` area of the catalogue, and the guide is [Model versions](https://usehenri.io/guides/versions/).

- [#422](https://github.com/usehenri/henri/pull/422) [`762062a`](https://github.com/usehenri/henri/commit/762062aadc450d49b1a2d15524f9d579ab4f60e7) Thanks [@reel](https://github.com/reel)! - Multi-tenancy: one column, one ambient tenant, and a refusal when nobody said which.
  
  henri had one tenant-shaped thing — every webhook endpoint carries an `owner`, and an `emit` without one reaches the endpoints that have none — and nothing else. An application serving two customers wrote the `where` itself, on every query, forever.
  
  There are three ways to be multi-tenant and they are not variations of one thing: a column on every row, a schema per tenant, or a process per tenant. **henri does the first**, and the reason is the model layer rather than a preference — a per-tenant schema is a `search_path` on PostgreSQL, a database name on MySQL, a connection on MongoDB and a file on sqlite, all of which are _connection_ decisions, and a henri store opens one pool at boot. What that buys and this does not is a boundary the database itself enforces; the guide says so, and says who should reach for it instead.
  
  Two declarations, and they are separate. A model says its rows belong to one customer:
  
  ```js
  // app/models/Invoice.js
  module.exports = { options: { tenant: true }, schema: { ... } };
  ```
  
  and the application says where the tenant of a request comes from:
  
  ```json
  { "tenancy": { "from": { "subdomain": "example.com", "user": "accountId" } } }
  ```
  
  From then on every query henri builds for an `Invoice` carries the condition — `find`, `findOne`, `count`, `paginate`, `exists`, `pluck`, an eager loaded association, a mass update, a mass delete, a soft delete, a restore, and `instance.save()`, which never builds a query at all — and every insert is stamped. `findById` answers `null` for another tenant's identifier, which is the 404 it already answers for one that does not exist.
  
  **The default is the refusal, and that is the feature.** A tenanted model touched with _no_ tenant in scope raises `HENRI_TENANT_REQUIRED` rather than falling back to every tenant's rows — the instinct `HENRI_POLICY_SCOPE_REQUIRED` already has, one layer down. A write naming another tenant is `HENRI_TENANT_CROSS_WRITE` rather than a row that quietly appears in somebody else's list. What Mongoose and Sequelize cannot narrow at all — an aggregation pipeline, a `bulkWrite`, an `increment` — is `HENRI_TENANT_UNSCOPABLE` rather than an unscoped answer. There is one way past, and it is an async context and not a setting: `henri.tenancy.unscoped(fn)`, the shape of `henri.encryption.tolerate()`.
  
  **The tenant of a request is decided in one place and is visible.** `req.tenant` is the value and `req.tenantSource` says how it was reached — `req.localeSource`'s precedent — over a fixed order: `explicit` (`req.setTenant()`), then the signed-in user's own column, then the subdomain, then a header from a proxy the application listed. Everything a client can name sits _below_ the user's own record, and when the two disagree the request is refused (`HENRI_TENANT_MISMATCH`, 404 by default) rather than served from either: for a signed-in person a client-named tenant is a confirmation, never an election. `POST /login` asks the same question again once passport has authenticated, so signing in on the wrong subdomain opens no session at all. A tenant header with no `from` naming its proxies **fails the boot**, the rule `config.calls.address` already follows, and a `from` covering everything is a high `henri audit` finding.
  
  A tenant is a **scope and not a permission**: narrowing only ever removes rows, and what a person may do with the ones that are left stays `app/policies`' question.
  
  Around the edges: the idempotency keys are now scoped by tenant (the key is the client's, and one load balancer can present one address for two customers); `henri.webhooks.emit()` defaults its `owner` to the tenant in scope; `henri audit` gained `tenancy.header-from-any` and `tenancy.unmarked-model`; and the user model **cannot** be marked `tenant` — a sign-in reads it before any request has a tenant, so scoping it would answer "no such account" to everybody, and henri fails the boot saying so.
  
  The guide is [Multi-tenancy](https://usehenri.io/guides/multi-tenancy/), which also holds the table of what each henri-owned table does about tenants — including the two that are honestly shared for now: the queue row carries no tenant (it rides in the job's arguments, and forgetting it is a loud refusal rather than a leak) and neither does a version row.

- [#341](https://github.com/usehenri/henri/pull/341) [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f) Thanks [@reel](https://github.com/reel)! - Every record gets a public uuid, and the numeric id stops leaving the server.
  
  **This is a breaking change for an existing application: urls change, JSON payloads change, and a database migration is required.** The [upgrading guide](https://usehenri.io/upgrading/) has the migration for each adapter.
  
  The primary key is unchanged — a `bigint` on SQL, an `ObjectId` on MongoDB — and it is still what the foreign keys, the joins and the indexes are made of. What changes is that it is now internal. Alongside it every model carries `externalId`: a uuid in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database itself, generated on the insert when the caller brings none. It is the only identifier that leaves the server, so nothing outside can see or guess a sequential number: `/tasks/42` becomes `/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`, a serialized record has `externalId` and no `id` (no `_id` on MongoDB), and `_links`, the `Location` header of a `201`, the path helpers, the view options and `publicUser()` all carry the uuid.
  
  The values are UUID version 7 (RFC 9562), time ordered: the column is unique, indexed and written on every insert, and a version 4 uuid would land in a different page of the b-tree every time where a version 7 appends to the right edge like the bigint it hides. `crypto.randomUUID()` only makes version 4, so the adapters generate their own; a uuid supplied by the caller is accepted whatever its version.
  
  `Model.findById()` takes either identifier, so a controller keeps handing it `req.params.id`: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one. `findByIdAndUpdate()`, `findByIdAndDelete()` and, on the Sequelize adapters, `findByPk()` take both too, and `findById()` is new on the Sequelize adapters.
  
  Nothing about associations changes: `belongsTo`, `hasMany`, `include()` and `populate()` still work on the primary key, and a foreign key column still holds a number.
  
  `options: { externalId: false }` opts a model out, and it then behaves exactly as it did before.

- [#411](https://github.com/usehenri/henri/pull/411) [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09) Thanks [@reel](https://github.com/reel)! - An adapter that says what it ran, and the N+1 detection that follows from it.
  
  `bullet` is the most-installed development tool in the Rails world after the linters, and henri had nothing like it. It had `include()`, a guide that told you to use it, and no way to find out when you had not. The reason nobody outside henri could write that check either was more basic: **no adapter emitted anything when it ran a query**, so there was nothing to listen to.
  
  So there are two halves, in that order. `henri.queries` is the seam — every adapter reports every model call — and the N+1 detector is a listener on it, on in development and in test, off in production.
  
  ```
  warn  queries  GET /proposals/:id  Track.findById ran 24 times at
                 app/controllers/ProposalsController.js:41 (18.3ms) --
                 load them together: one Track.find({ id: [...] }) for the
                 whole set, or include('track') on the query that fetched
                 the parents
  ```
  
  **The seam is at the model call, not the statement**, and that is the decision everything else follows from. It is the only level at which henri can give _advice_ — a driver instrumentation can already tell you forty statements ran, and `@opentelemetry/instrumentation-pg` does that better than henri would; only henri knows they were forty `Proposal.findById` calls and that one `Proposal.find({ id: [...] })` replaces them. It is also the only level whose number you can act on: `paginate()` is two statements and one decision, and on MySQL so is an insert, because the dialect has no `RETURNING`.
  
  And it is the level that matches what is actually wrong. Measuring the adapters rather than assuming: **`include()` on Drizzle compiles to a single correlated json subquery**, so the classic Rails lazy-association N+1 does not exist there at all. A detector written to `bullet`'s mental model would walk a Drizzle application, find nothing, and report success. What remains — a loop issuing one `find`/`findById` per record where one call for the set would do — is a count of model calls. So, said plainly everywhere because a person reading "40 queries" assumes the other thing: **the threshold counts model calls, never statements.**
  
  **An event carries names and numbers, and no SQL.** `{ at, store, adapter, dialect, model, operation, method, keys, shape, duration, rows, requestId, source, callsite }`. At the model call there is no statement to carry, which is the happy half; the unhappy half is why it would have been refused anyway. **Sequelize's query generator interpolates values into the text it runs** — `findAll({ where: { name: 'ada' } })` reaches the driver as `WHERE "name" = 'ada'`, on the ordinary path — while Drizzle parameterizes and Mongoose has no statement at all. A `sql` field would have been safe on two adapters and a copy of your rows on the third, which is worse than no field because it is the leak nobody would look for. `keys` is column **names**, which is the rule the access trail already established: a field name is schema, a field value is personal data.
  
  `callsite` is one frame, the first belonging to the application's own files. `bullet`'s value was never that it counted queries; it is that it names the line.
  
  **The join is the request id and there is only one.** The same `AsyncLocalStorage` the call log keys its rows by, every `pen` line carries, and a span carries as `henri.request_id`. There is no trace id, and **telemetry deliberately does not consume this seam**: statements stay the driver's own instrumentation to trace, `adapter.query()` keeps its span and gains an event, and no model call ever becomes a span. `base/telemetry.js` was amended to say where that line now sits.
  
  A finding goes to the log (one warning per request, at the end, when the count is final), to `X-Henri-Queries` in development, and — with `queries.detect.raise` — to a thrown `HENRI_QUERIES_N_PLUS_ONE` at the moment the threshold is crossed, so the stack names the call that went one too far. That last one is the CI gate, the way `Bullet.raise = true` is in a Rails suite. It does **not** go to `henri.reporter`: an N+1 is a slow answer, not a failure, and an application that wired Sentry to page someone should not be paged for a slow page. `henri audit` reports `queries.detect.raise` left on in a production configuration.
  
  Each adapter maps its own layer. Drizzle and Sequelize wrap their statics, because both answer promises, plus Drizzle's `Relation.prototype` once per process for the lazy `where().toArray()` path. Mongoose uses schema middleware instead, because `Model.find()` answers a lazy chainable `Query` and wrapping it would have executed it early and turned every `find().sort()` in every henri application into a promise; the cost is that an operation that fans out (`populate`) reports once per operation rather than once per model call, which the guide says out loud.
  
  **Off costs nothing**, the way the call log and telemetry mean it: no hook registered on any adapter, no middleware mounted, nothing allocated per query, and no flag tested on a hot path. Measured on Drizzle over in-memory sqlite — the harshest framing, since the call itself is only 26µs — the default adds 9.2µs per model call, two thirds of which is capturing the call site (`"callsites": false` drops it). Against a real database that is a fraction of a percent, and it is still off in production by default.
  
  `config.queries` is the whole configuration: absent means on outside production, `false` is off everywhere, `{ "enabled": true }` is the production opt-in. The guide is [N+1 detection](https://usehenri.io/guides/queries/).

- [#315](https://github.com/usehenri/henri/pull/315) [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc) Thanks [@reel](https://github.com/reel)! - Rails ergonomics for models and the database: seeds, timestamps by default, soft deletes, `paginate()` and one validation error shape.
  
  **Behaviour change: timestamps are on by default.** Every model now gets `createdAt` and `updatedAt`, like every Rails table; `options: { timestamps: false }` opts out. Before this, the Mongoose (`disk`, `mongoose`) and Drizzle adapters added them only with `options: { timestamps: true }` — the Sequelize adapters (`mysql`, `postgresql`, `mssql`) already added them by default, so nothing changes there. On MongoDB there is nothing to do; on Drizzle the models gain two `NOT NULL` columns, so a production database needs a migration (`henri db:generate`, then `henri db:migrate`) before deploying. `henri generate model` no longer writes `options: { timestamps: true }`. See the [upgrading guide](https://usehenri.io/upgrading/#timestamps-are-on-by-default).
  
  **`henri db:seed` and `db/seeds.js`** (Rails' `db/seeds.rb`). Boots the models only — no views, no workers — requires `db/seeds.js` and awaits what it exports, with the models and the henri instance available. It works on every adapter, unlike the migration commands of `henri db`. `--file=<path>` runs another file, `--json` prints the result and the usual `{ error: { command, message, hint, code, exitCode } }` envelope, and a missing seed file is a usage error reported before anything boots. `henri new` scaffolds the file with the idempotent `find or create` idiom commented out.
  
  **Soft deletes with `options: { paranoid: true }`** (Rails' `acts_as_paranoid`), on every adapter: deleting stamps `deletedAt`, queries hide the stamped records, `{ force: true }` really deletes and `restore()` brings a record back. Mongoose gets a schema plugin (query middleware plus replacements for `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete` and `doc.deleteOne()`), Sequelize uses its own `paranoid`, and Drizzle honours the scope in relations, `count()`, `update()` and `paginate()` and adds `withDeleted()`/`onlyDeleted()`.
  
  **`Model.paginate({ page, perPage })`** on every adapter, answering `{ records, page, perPage, total, pages }`: `await Task.paginate(req.pagination())` replaces a find and a count, and everything else in the object is the adapter's own query (`where`, `sort`/`order`, `include`, `select`, ...). On Drizzle relations paginate too: `Task.where({ done: false }).paginate({ page: 2 })`.
  
  **`henri.model.errors(error)`** turns a Mongoose, Sequelize or Drizzle validation failure — a duplicate key included — into `{ field: message }`, and answers `null` for anything else so a controller can rethrow. An error with no field of its own is filed under `base`.
  
  The controllers written by `henri generate scaffold` and `crud` use `Model.paginate(req.pagination())` and `henri.model.errors()`, so a generated index is one query and a generated 422 has the same body on every store. Regenerate them with `--force` to pick both up.

- [#396](https://github.com/usehenri/henri/pull/396) [`ada4794`](https://github.com/usehenri/henri/commit/ada4794204a72cf6e4bfe691a08933df92dd7ff4) Thanks [@reel](https://github.com/reel)! - `henri db:rollback` and `db/schema.sql`
  
  Two things Rails has that the migration story here did not: undoing the last migration, and one file saying what the database actually looks like.
  
  ```bash
  henri db:rollback              # the last migration
  henri db:rollback --step=2     # the last two, newest first
  henri db:schema:dump           # writes db/schema.sql from the database
  henri db:schema:load           # creates that schema in an empty database
  ```
  
  **Rolling back.** drizzle-kit generates forward-only SQL, so there is no `down` — and the three ways to get one are not equally honest. A hand-written `down.sql` puts the inverse of a computed diff on the person least able to check it, and rots silently because nothing runs it until the day it matters. Writing one at `db:generate` time freezes that same inverse, in a folder that invites hand-edits (drizzle-kit's own answer to a rename is "edit the generated SQL"), so it goes wrong in the direction nobody looks. henri does neither: it computes the inverse **when you ask for it**, by handing drizzle-kit the two snapshots `db/migrations/meta` already holds in the other order. Nothing new is stored, nothing can go stale, and what runs is the inverse of the schema `db:status` believes in.
  
  It refuses three things rather than lying about them:
  
  - **A migration that removed a table or a column** (`HENRI_MIGRATION_IRREVERSIBLE`). Its inverse would recreate them empty, and an empty column is not the column that was dropped. There is no flag for this one: undoing a destructive migration is a restore from a backup, and henri will not pretend otherwise.
  - **A migration whose `.sql` changed since it was applied** (`HENRI_MIGRATION_EDITED`). The database records the sha256 of the file it ran; when the file on disk hashes to something else, henri does not know what ran and will not guess.
  - **A rollback that would drop rows that are there** (`HENRI_MIGRATION_DESTRUCTIVE`). Not "a statement that matches `DROP`" — the tables and columns the inverse removes are counted first. Undoing the migration you applied a minute ago on a database nothing was written into is quiet; one that would take 412 rows away says so and needs `--force`, the way `db:push` already does.
  
  Rolling back moves the database, not the folder: the `.sql` and its snapshot stay where they are, `db:status` reports the migration pending again, and `db:migrate` applies it again.
  
  **The dump.** `db/schema.sql` is read from the **database**, not from the migration chain. A dump built from the chain agrees with the chain by construction: it is a second copy of files already in the repository, and it can never catch the `ALTER` somebody ran by hand or the `db:push` that was never turned into a migration — which are the two reasons to read a dump at all. The cost is that it is written where a database is reachable, and it is not hidden.
  
  Two runs against the same schema give the same bytes: tables ordered by name, indexes and foreign keys by their statements, columns in the position the database keeps them. MySQL is read through `information_schema` rather than `SHOW CREATE TABLE`, which prints the `AUTO_INCREMENT` counter and would move the file on every insert. The header names the migration the database was at, so the dump and `db:status` cannot disagree.
  
  Loading it is supported. `db:schema:load` creates everything the dump describes and records the migrations through the one it names as applied, leaving anything newer pending — which is how a test database is built without replaying the chain. It refuses a table it would create that already exists (`HENRI_MIGRATION_DATABASE_NOT_EMPTY`) and never empties a database to get its way, so it has no `--force`; a table the dump says nothing about is left alone.
  
  An `mssql` store answers neither (it is on Sequelize, it has no migration history for a dump to name, and `db:status` reads it back instead), and a `mongoose` one has no schema to write down. Both say so with `HENRI_CLI_MIGRATIONS_UNSUPPORTED` rather than doing half of it.
  
  Also fixed: `henri db:generate` recorded a migration as applied on MySQL whenever the push it checks against had no statements — which on MySQL is also what a drifted table looks like, since drizzle-kit does not alter one there. A drifted table is now part of that answer, so the history stops claiming a migration ran that did not.

- [#424](https://github.com/usehenri/henri/pull/424) [`0d2ebc3`](https://github.com/usehenri/henri/commit/0d2ebc344bfcd80533ef900638083e4c105407bb) Thanks [@reel](https://github.com/reel)! - Slugs: `/articles/how-we-ship` rather than the uuid.
  
  A model asks for a name in its options and henri does the rest — a unique, indexed, `NOT NULL` `slug` column, filled on the insert, resolved by `findById()` and printed in every url that names the record:
  
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
  
  `henri generate scaffold Article title:string! --slug title` writes the declaration, the controller and the pages together, and a generator run over a model that already has one reads it back, so nothing needs hand-wiring.
  
  **A slug is a third identifier, and it stays in its lane.** It appears in the record's own `slug` field and in the **url** of that record — `_links`, the path helpers, the `Location` of a `201` — and nowhere else. A foreign key is still published as the `externalId` of the row it names, and the versions table, the access trail, the flags actor and the erasure receipts all keep reading `externalId`. The uuid is what an API client stores; the slug is what a person reads.
  
  **A lookup cannot be talked into a primary key.** `findById()` resolves a uuid against `externalId` as before, and anything else against the **slug column** — a `WHERE slug = ?`, not a fallthrough — and that is the end of it. `findById('42')` asks the slug column for `'42'`; it cannot say whether row 42 exists, and the `null` it answers is the same `null` an unknown name gets. A model with a slug takes the whole non-uuid space with it, `externalIds.lookup: "any"` included, so the primary key is `findByKey()`'s alone. A slug shaped like a uuid is refused, so the two identifier spaces never overlap. `findBySlug()` is the explicit half.
  
  **Two articles called "Getting started" is the normal case**, and henri answers it without a `SELECT` before the `INSERT` — the same position it takes on `unique` in validations. By default the slug carries a six character discriminator taken from the record's own `externalId` (`getting-started-k3f9pq`): unique because the uuid is, stable because the uuid never changes, and free because nothing is read. The cost is those six characters in every url. `slug: { from: 'title', suffix: false }` gives the bare `getting-started` instead, and then the **unique index is what holds**: the second one is refused by the database as `{ slug: 'must be unique' }`.
  
  **A slug does not move.** `on: 'create'` is the default, so the url minted the day the record was written keeps working whatever the title becomes. `on: 'change'` follows the source, and the old url **stops working that instant** — henri keeps no history of slugs and answers no `301`. On such a model a mass update naming the source field is refused (`HENRI_MODEL_SLUG_MASS_WRITE`) with the loop to write instead, because one hook runs for the whole write and every row would get the same name.
  
  **Unicode without a transliteration table.** The title is lowercased, decomposed (NFKD) and reduced to `a-z0-9`, so `Café Crème` is `cafe-creme` — that is `String#normalize`, not a table. Eleven Latin letters Unicode does not decompose get a line each (`æ ð đ ħ ı ł ø œ ß þ ŧ`), so `Straße` is `strasse` and `Łódź` is `lodz`, and that is the whole of it: a Japanese, Chinese, Arabic, Hebrew, Greek or Cyrillic title folds to nothing, deliberately. With the discriminator on, such a record still gets a working url; with `suffix: false` the write is refused (`HENRI_MODEL_SLUG_EMPTY`) rather than writing an empty name. And **a slug the application writes itself always wins and may be in any script** — `slug: 'こんにちは'` is stored, matched and carried percent-encoded — so the choice between folding and percent-encoding is the application's, not henri's.
  
  A supplied slug is measured against the characters that would stop it being one path segment (a space, a control character, and the seventeen that end a segment, start a query, escape an encoding or name a directory), plus `.`, `..` and the paths henri already mounts (`new`; `reserved` adds your own). Nothing in the slugifier is a regular expression: it walks the code points once, with the length bound applied as it goes, because a title arrives through `req.permit()`.
  
  A declaration henri cannot carry out fails the boot naming the model (`HENRI_MODEL_SLUG_DECLARATION_INVALID`). `henri openapi` describes the path parameter as the slug and drops the `uuid` format for that model, and `henri generate agents` lists the mark.

### Patch Changes

- [#397](https://github.com/usehenri/henri/pull/397) [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212) Thanks [@reel](https://github.com/reel)! - Call logs, inbound and outbound: `henri.calls`.
  
  Two records joined by the request id henri already threads through everything — the call an application answered, and every call it made because of it — so that "what happened during request `X`" is one question with one answer:
  
  ```bash
  henri calls 018f5c2e-1f2a-7c31-9f0a-2b7c1d3e4f56
  ```
  
  ```
    2026-09-06T14:22:31.004Z  <- 201        84ms  POST   /orders
    2026-09-06T14:22:31.019Z  -> 200        41ms  POST   https://api.billing.test/v1/charges
                                service billing
    2026-09-06T14:22:31.062Z  -> 200        12ms  POST   https://hooks.example.test/orders
                                service webhooks
  ```
  
  Both directions live in one table henri owns (`henri_calls`, a `direction` column), reached through the store adapter's `query()` or a MongoDB collection the way the access trail reaches its own. One table rather than two because the join is the whole point: one `SELECT` on one index instead of two reads and a merge.
  
  **It is the deliberate opposite of the access trail, and the guide says so in its first paragraph.** The trail records field _names_, counts and digests and refuses a value; it is hash-chained evidence kept for a year. A call log holds **values** — the body that came in, the body that went out — because one that does not is a slower copy of the web server's access log. It is a debugging instrument: sampled, capped, kept for thirty days, and never evidence of anything. Neither substitutes for the other.
  
  Four bounds keep it from being a denial of service, and each of them is a decision rather than a default:
  
  - **Off unless configured.** No `config.calls`, no table, no middleware, no allocation. When it is on, the middleware is mounted right after the request id and before everything else, so a request refused by the rate limit, the body parser or the CSRF check — exactly the one worth having — is in the log.
  - **The write never blocks the answer.** A finished call goes onto a bounded buffer and the response goes out; a timer writes with one multi-row `INSERT`. A flush that fails is reported once and dropped rather than retried, because a call log that can fail a request turns a database hiccup into an outage. What the buffer drops is counted, and `henri calls:stats` says so.
  - **The payload is capped before it is stored** (`calls.maxBody`, 8kb, with a truncation marker), and only a body henri can _walk_ is stored at all — a plain object or an array is redacted key by key, a string, a buffer or an HTML page is a size and a shape. That is why the response body is taken from `res.json(value)` rather than off the socket.
  - **What one client can cause is bounded twice.** `calls.sample` bounds the steady state proportionally; `calls.maxPerSecond` is an absolute per-process ceiling, because one percent of a million requests a second is still ten thousand rows a second. The sampling decision is a hash of the request id **seeded with `config.secret`**: a hash so the inbound call and every outbound call it caused agree in every process without carrying state, and seeded because the request id comes from a header a client chooses. `calls.always` keeps the failures sampling dropped, without their bodies.
  
  It holds values, so the redaction is the feature. Everything stored goes through the redactor of `config.filterParameters` and the `personal` marks, at every depth, and on top of that `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-csrf-token`, `x-api-key` and `webhook-signature` are masked whatever the configuration says, a url loses its userinfo, and the person is their `externalId` and never an address.
  
  `calls.keep` (30 days) is pruned by the retention sweep, and **where the dialect has range partitions it drops periods instead of rows**: `calls.partition: "day"` on PostgreSQL and MySQL makes the sweep a metadata operation whatever the table held, which is the difference between a sweep that works at ten million rows and one that times out. There is always a catch-all partition, so no row is ever refused for want of one. sqlite, SQL Server and MongoDB have no ranges and get a bounded delete loop; asking them to partition fails the boot rather than being ignored.
  
  henri wraps nobody's HTTP client: `henri.calls.track()` and `henri.calls.outbound()` are the seam, two lines around whatever an application already uses. The calls henri makes itself are populated without anything to write — every mail send, and every webhook delivery attempt, whose request id is stamped into the delivery job at `emit()` time so a delivery three retries later still joins the request that caused it.
  
  `henri calls [<request-id>]`, `henri calls:stats` and `henri calls:sweep --yes` are the commands, `config.calls` is the configuration, and the guide is [Call logs](https://usehenri.io/guides/calls/).

- [#414](https://github.com/usehenri/henri/pull/414) [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d) Thanks [@reel](https://github.com/reel)! - Failures say what to do next, not only what happened.
  
  Every failure henri raises on its own behalf already carried a code, and `error-codes.json` already held the best writing in the project: one entry per code with what it means, what usually causes it and **how to fix it**. That "how to fix it" reached a website page and nothing else. Meanwhile a good number of the messages a person actually reads — the boot log, the terminal, a JSON error body — said what happened and stopped.
  
  **The catalogue's fix is now the hint.** A coded failure that carries no hint of its own reaches the command line (`henri <command>`, and `--json`'s `hint`) and `henri mcp` with the catalogue's next step attached. One hundred and ninety-three instructions that used to live on a page a person had to find are now printed where the failure is.
  
  **The messages themselves name the next action.** A missing boot dependency says which module to register and where; a dependency above the boot ceiling says to lower the runlevel or run the whole application, and that `henri analyze` prints the levels; a cycle says to drop one declaration or turn a `needs` into an `after`. A module that is not shaped like one says what to write (`extend @usehenri/core/module`, `async init()`, a unique `name`). An unknown store adapter lists the adapters instead of "check your configuration file"; a model with no store names the file, the configuration key and the stores that do exist. A development `404` says `henri routes` prints the table. The model field errors of all three adapters name the model, and the incomplete ones show the field written correctly.
  
  **Seven request-time failures henri owns had no code at all**, so a client saw a status and a sentence and no stable name to look up:
  
  | Failure                                                   | Code                                |
  | --------------------------------------------------------- | ----------------------------------- |
  | A CSRF token that does not match                          | `HENRI_USER_CSRF_INVALID`           |
  | An unsafe request from an origin this application refuses | `HENRI_USER_CSRF_ORIGIN_REFUSED`    |
  | More requests than the rate limit allows                  | `HENRI_API_RATE_LIMITED`            |
  | An `Idempotency-Key` that is not shaped like one          | `HENRI_API_IDEMPOTENCY_KEY_INVALID` |
  | A key reused for a different request                      | `HENRI_API_IDEMPOTENCY_KEY_REUSED`  |
  | A key another request is still holding                    | `HENRI_API_IDEMPOTENCY_IN_PROGRESS` |
  | A guarded request the shared store could not count        | `HENRI_STORE_SHARED_UNAVAILABLE`    |
  
  Each one's message now names what to do about it, and `HENRI_POLICY_SCOPE_REQUIRED` is the eighth: `henri.policies.scope()` on a policy that declares none threw a bare `TypeError`. **A refused policy deliberately gets no code**: it answers 404 by default so it is not an oracle, and a distinct code in that body would be one.
  
  `henri.encryption.modelOf()` was raising `HENRI_ENCRYPTION_NO_KEY` for a model that is not loaded, which is neither what happened nor what to do; it raises `HENRI_ARGUMENT_UNKNOWN_TARGET`, the code whose entry already described exactly this. `config.shared`, `config.policies` and `config.cache` now raise `HENRI_CONFIG_INVALID` like `config.csrf` already did, rather than an uncoded `TypeError`.
  
  **And the instructions have to be true.** A "how to fix it" naming a command that does not exist sends a person down a path that ends nowhere — one entry named `henri credentials:init`, which henri has never had. `src/__tests__/error-codes.spec.js` now checks, for every entry: every `` `henri …` `` it prints is a real command, read from `packages/cli` itself (the `commands` of its package.json, the `COMMANDS` a group's script exports, the generators of `generate.js`) rather than from a copy; every configuration key it names is one `base/config-schema.js` declares, `stores.default.url` matching the record it is declared as; and every `fix` is present and says something the `what` did not.

- [#413](https://github.com/usehenri/henri/pull/413) [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf) Thanks [@reel](https://github.com/reel)! - Signing in with somebody else's identity provider, and the merge rule that decides who ends up owning the account.
  
  `omniauth` is the second biggest thing in Rails authentication and nothing has replaced it, but the strategy was never the work: passport has one for every provider. The work is the part a framework alone can do — an identity table beside the user model, a callback that lives inside the CSRF, session and lockout machinery henri already owns, and a rule for what happens when a provider hands over an address that already belongs to somebody here. That last one is what applications get wrong, and getting it wrong hands a password account to whoever can obtain an ID token for its address.
  
  ```json
  {
    "user": {
      "identities": {
        "providers": {
          "acme": {
            "authorizationUrl": "https://acme.example/oauth/authorize",
            "tokenUrl": "https://acme.example/oauth/token",
            "userinfoUrl": "https://acme.example/oauth/userinfo",
            "clientId": "...",
            "clientSecret": "...",
            "scope": ["openid", "email"]
          }
        }
      }
    }
  }
  ```
  
  henri ships **no provider list and no provider secrets**. There is no `github` in the source and nothing to fill in for one: an application names its providers, and the client secret belongs in the encrypted credentials (`henri credentials:edit`) or in the environment — `henri audit` reports one written in a `config/*.json` the way it already reports an encryption key there.
  
  **The merge rule refuses.** A callback whose verified address already belongs to an account answers `exists`, opens no session, writes nothing, and tells the person to sign in the way they already do and then link the provider from their account. Linking automatically on `email_verified` is the wrong answer three times over: it lets a stranger change which credentials open an account, it collapses that account's security to the weakest provider it can be linked from, and `email_verified` is a provider's belief about a mailbox rather than a statement about who owns an account in your database — and half the providers do not send it at all, so reading "absent" as "verified" builds the takeover by accident. The third possibility, _link only when the session already belongs to that user_, is right and is not a setting because it is the **flow**: a callback started from a signed-in session is a link, always, and it is the only automatic link henri makes. `merge: "verified"` exists for the single-tenant application whose provider is its own corporate identity provider; it needs that provider marked `trusted`, and `henri audit` reports the pair.
  
  **An address the provider did not verify decides nothing.** It is never matched against an account and never creates one, and the refusal is written **before the user table is read**, so an address that has an account and one that has none are the same answer at the same price — the property the account flows already keep. A person who is already linked signs in whatever the address says, because the credential is the subject the provider issues and never the address, which is also why two providers claiming one address are two rows rather than a merge.
  
  The endpoints go inside the machinery rather than beside it. `POST /auth/:provider` leaves through the double-submit CSRF token and the origin check, which this one route asks for itself even when the visitor holds no session cookie — the middleware waives the check there, because there is normally no session for a third-party page to ride on, and a visitor about to sign in is exactly the person who has none (`GET` answers `405`, so a third-party page cannot start an authentication in a visitor's browser); `GET /auth/:provider/callback` comes back to a `state` minted per attempt, kept in the session, single use and expiring, with PKCE S256 whose verifier never leaves the server; the session identifier is new before the person is in it; and the per-account lockout of `POST /login` is checked and cleared here too, so a provider is not a way around it — but a failed callback is never _counted_, because there is nothing to guess at a callback and counting would only hand somebody a way to lock an address out. `POST /auth/:provider/unlink` refuses to take away the last way into an account.
  
  `henri_identities` is a table henri owns the way the queue and the access trail own theirs — raw SQL through the adapter or a MongoDB collection, never a model — because **a row is a credential**: whoever can write one can sign in as whoever it points at, and a model would put `provider` and `subject` behind an application's own mass assignment, scaffold and routes. A row records what it is allowed to imply (`signin`, or `verify` for a provider that identifies a person and never opens a session on its own) and how it came to be (`signup`, `session` or `verified`), and both are read from the row rather than from the configuration, so changing a provider never promotes what was linked under the old rule. `henri privacy:export` lists a person's providers without the subject, and `henri privacy:erase` deletes the rows rather than anonymizing them, because an anonymized credential still opens the account.
  
  henri never parses an `id_token`: the profile is what `userinfoUrl` answers to a request henri makes with the access token, which is the same claims over a channel that is already authenticated and none of the JWKS, key rotation and algorithm confusion. And henri is a client, never an OAuth _provider_ — that is a different product.
  
  `henri generate authentication` writes the sign-in buttons and an account page for linking and unlinking, both rendered from whatever the configuration names, so an application with no provider gets no button and a sentence saying where a provider goes.

- [#443](https://github.com/usehenri/henri/pull/443) [`0a8bb41`](https://github.com/usehenri/henri/commit/0a8bb415d352cd75b12d07e591c8ec7c16774a99) Thanks [@reel](https://github.com/reel)! - MariaDB is exercised, and what does not work there is written down
  
  `@usehenri/mysql` has said it serves MariaDB since the first release and nothing had ever run against one. It runs now: `HENRI_TEST_MARIADB_URL` points the SQL suites at a MariaDB server the way `HENRI_TEST_MYSQL_URL` points them at MySQL (`pnpm test:sql:mariadb`, a `mariadb` service in `compose.yaml`), and `packages/drizzle/__tests__/mariadb.spec.js` asserts what that server does differently. Measured on MariaDB 10.11.19 and 11.8.9, which behave identically here, against MySQL 8.4.
  
  **Two things do not work on MariaDB, and neither is henri's.** Both are in the models guide now, with what to do instead.
  
  - **`include()` is a syntax error.** drizzle-orm 0.45's MySQL dialect eager loads with `LEFT JOIN LATERAL (...) ON TRUE`, and MariaDB has no `LATERAL` derived tables in any version. `include`, and the `embeds` that read through the same path, raise 1064 from the server. henri writes none of that SQL and has no seam to write it differently, so load the association with a second query.
  - **`henri db:push` cannot read the schema back**, which takes the development boot with it. drizzle-kit 0.31 introspects before it pushes and its check-constraint pass reads the wrong column name out of its own query — dead code on MySQL 8, which has no check constraints there, and live on MariaDB, where `JSON` is `LONGTEXT` with a `CHECK (json_valid(...))` next to it and the user model's `roles` is a `json` column. The first push of an empty database works and every one after it fails. Set `"sync": false` on the store and use `henri db:generate` then `henri db:migrate`, which do work, as do `db:schema:dump`, `db:schema:load`, `db:status` and `describe()`.
  
  **Three fixes came out of measuring it.**
  
  `henri db:push` no longer dies without a word. drizzle-kit renders its own progress and, when the task behind it rejects, hands the error to a renderer that prints a spinner and then calls `process.exit(1)` — so a schema it could not read took `henri db:push`, the development boot or a test worker down with exit code 1 and nothing to read. `Migrations#plan()` now runs it guarded: the exit is caught and raised as the new `HENRI_MIGRATION_PUSH_FAILED`, on every dialect.
  
  `henri db:generate` writes the migration even when it cannot read the database back afterwards. Recording a migration as already applied is bookkeeping for a database that was pushed to the same schema; the file is written before that, so a plan that fails now leaves the migration pending — the safe answer, and the one `henri db:migrate` acts on — with a warning naming what happened, instead of failing the command that had already written the file.
  
  `henri db:schema:dump` is correct on MariaDB. `information_schema.COLUMNS.COLUMN_DEFAULT` is a **value** on MySQL and an SQL **expression** on MariaDB: the four letters `NULL` where there is no default, `'hi'` already quoted, `current_timestamp(3)` with nothing in `EXTRA`. henri read it MySQL's way, so a dump taken from MariaDB gave every nullable column `DEFAULT 'NULL'` — a four letter string on a `varchar`, and a statement the server refuses on a `datetime`. It reads the server now.
  
  And on the Sequelize side, `henri db:status` stops reporting a drift that can never close. `Drift#report()` asks the server what it is (`SELECT VERSION()`) rather than trusting the dialect of the connection, because MariaDB is reached through the MySQL dialect and mysql2; a `json` column there is a `LONGTEXT`, which used to be reported as `LONGTEXT instead of JSON` with an `ALTER TABLE ... CHANGE ... JSON` the server accepts and which changes nothing. `report().dialect` is `mariadb` on a MariaDB server.

- [#446](https://github.com/usehenri/henri/pull/446) [`0370287`](https://github.com/usehenri/henri/commit/03702876f60d36f1cf6be29e258accef3be0cab4) Thanks [@reel](https://github.com/reel)! - One place says what a drizzle instance is built with.
  
  A drizzle store builds its database twice, not once. `start()` builds it, and `getSessionConnector()` builds it again on a store with no user model: drizzle bakes the schema into the instance, so the sessions table added afterwards needs a new one. Both named the arguments themselves, three hundred lines apart, and nothing compared them — so anything the first construction were given (a logger, a cache, an instrumentation hook) would be dropped by the second, in an application with sessions and nowhere else.
  
  Nothing is passed today beyond the client and the schema, so nothing was being lost. This is the hardening: `Drizzle#buildDatabase()` is now the only expression that constructs one, both callers go through it, and a test builds the store both ways and compares what each construction was handed — the arity, the client, and every argument past the schema, which is where an option would go. The schema is the one thing allowed to differ, and only by the table the second construction exists to add.
  
  Transactions were checked rather than assumed, on all three dialects of drizzle-orm 0.45: better-sqlite3 hands the transaction the session it already has, and mysql2 and node-postgres build a fresh session for the pooled connection from `this.options`. So transaction traffic inherits whatever the construction was given, and there is no third site.

- [#313](https://github.com/usehenri/henri/pull/313) [`3501939`](https://github.com/usehenri/henri/commit/3501939c0e73ed5be4dee6730657c9213168b3c1) Thanks [@reel](https://github.com/reel)! - Fix the adapter on live PostgreSQL and MySQL servers, now that the suites run against both.
  
  A unique violation answers a `ValidationError` again: drizzle-orm reports the failures of its asynchronous drivers wrapped in a `DrizzleQueryError`, so the dialects unwrap the cause before reading the constraint, and the MySQL constraint name is kept.
  
  A push on MySQL (`henri db:push` and the development boot) creates the tables that are missing instead of doing nothing: drizzle-kit answers the data loss of a MySQL push but never the DDL it would run. A table whose columns drifted from the model is reported — run `henri db:generate` then `henri db:migrate` for it — and the tables drizzle-kit suggests truncating are left alone.

- [#381](https://github.com/usehenri/henri/pull/381) [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0) Thanks [@reel](https://github.com/reel)! - Retention, and the access trail.
  
  A model now says how long it keeps its records, in its options:
  
  ```js
  options: {
    retention: { action: 'anonymize', after: '2y', from: 'decidedAt' },
  },
  ```
  
  `action` is one of the three verbs henri already had -- `delete`,
  `soft-delete` (only on a `paranoid` model) and `anonymize` (exactly what an
  erasure writes) -- and `from` is the date column the clock starts on, which
  is rarely `createdAt`. A record whose `from` is null never ages out and is
  counted separately. A model with more than one class of records writes a
  list of named rules with a `where` each.
  
  `henri.retention.sweep()` enforces them and needs nothing installed:
  `henri retention:sweep --yes` is what a cron line runs, and with
  `@usehenri/jobs` installed `config.retention.schedule` registers the
  recurring `henri/retention` job. The boot says which of the two it is, by
  name, so a rule nothing applies is never silent.
  
  Two things stand between a wrong rule and a deleted table: a rule writes
  nothing until its token is in `config.retention.approved` (a line in the
  configuration, so a person, a diff and a review), and
  `config.retention.batch` bounds one run. `henri retention:sweep` without
  `--yes` plans, counts and prints, and writes nothing. Every sweep leaves a
  receipt in `config.retention.receipts`.
  
  `config.trail` turns on the access trail: an append-only, hash-chained
  record of who read or changed personal data, in a table henri owns. It
  records the export, the erasure, every retention sweep and -- with
  `trail.reads` -- the answers henri serializes; `henri.trail.record()` is how
  an application adds its own. It holds field names, counts, public
  identifiers and digests, and refuses anything else
  (`HENRI_TRAIL_VALUE_REFUSED`). `henri trail`, `henri trail:about <who>` (which
  answers from an address whose digest is all that is stored) and
  `henri trail:verify` read it back.
  
  `henri.jobs.recur(name, entry)` is the seam a framework module uses to ask
  for a schedule the configuration did not write; an entry the application
  declared under the same name still wins.
  
  The drizzle adapter no longer offers to drop the tables henri owns
  (`henri_jobs`, `henri_jobs_schedules`, `henri_trail`): a push that obeyed
  would have taken an application's job history or its audit trail with it.

## 1.1.0

### Minor Changes

- [#305](https://github.com/usehenri/henri/pull/305) [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4) Thanks [@reel](https://github.com/reel)! - New `@usehenri/drizzle` store adapter on Drizzle ORM: sqlite (better-sqlite3), postgres (pg) and mysql (mysql2) behind one Rails-like model API. An app selects it with `"stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } }` and installs the driver it needs.
  
  - Models compile the henri model format (`string|text|number|integer|float|boolean|date|json|uuid`, `required`, `default`, `enum`, `unique`, `index`, plus `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim`, `references`) into Drizzle tables per dialect: plural snake_case tables, snake_case columns, `id` primary keys, `createdAt`/`updatedAt` with `options.timestamps`, pg enum types and mysql enums.
  - Model API: `create`, `find`, `findOne`, `findById`, `all`, `count`, `exists`, `pluck`, `update`, `destroy`, `findByIdAndUpdate`, `findByIdAndDelete`, `findOneAndUpdate`, `findOneAndDelete` and their Mongoose and Sequelize aliases; lazy chains `where().order().limit().offset().include().withHidden().first()/last()/count()`; instances with `save`, `update`, `destroy`, `reload`, `changed`, `toJSON`; `ValidationError` with `errors[field].message` (the shape the generated controllers read), unique violations included; `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy` hooks; `belongsTo`, `hasMany`, `hasOne` in `associate(models)` with eager loading through `include()`; `adapter.transaction(fn)` with implicit joining.
  - User model: `email` unique, lowercased, trimmed and validated; `password` hashed on create and on every update that sets it, never selected by default; `roles` JSON, dropped from mass assignment unless `{ unsafe: true }`, `user.hasRole()`, `user.setRoles()`, `User.setRoles(id, roles)`.
  - Sessions: an express-session store on a `henri_sessions` table (get/set/destroy/touch/all/clear/length, expiry with the cookie, periodic sweep).
  - Migrations in `db/migrations` (drizzle-kit layout): `henri db:generate`, `henri db:migrate`, `henri db:push`, `henri db:status` (`henri db <command>` works too). Development boots push the schema unless the store sets `"sync": false`; production boots apply the migrations with `"migrate": true` and warn about pending ones otherwise.
  - Core accepts `"adapter": "drizzle"`.
