# @usehenri/drizzle

## 1.2.0

### Minor Changes

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

- [#358](https://github.com/usehenri/henri/pull/358) [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93) Thanks [@reel](https://github.com/reel)! - Bind every password hash to the row it belongs to, so a hash copied onto another row stops verifying.
  
  A hash is a value, and a value can be moved. Someone who can **write** your database but does not have the pepper cannot forge a hash, so they do the next best thing: they take a hash whose password they know — their own account's — and copy it onto somebody else's row, or onto a row they invented. The pepper never saw this coming, because the key is global: the same key recomputes the same hash wherever the bytes land. The pepper answers "you cannot make a hash"; this answers "you cannot move one".
  
  New hashes fold the record's `externalId` (the uuid v7 every record already carries) into what is hashed, keyed by the pepper, and are stored in the same column behind a `$henri-bound$v=1$` marker. No schema change, no migration, and no extra cost per sign-in: the marker says which of the two preimages to build, so verification hashes exactly once. `@node-rs/argon2` has no `associatedData`, and its `secret` is spoken for by the pepper, so the identity goes into a keyed pre-hash — the shape the pepper already used to give bcrypt a key it does not have.
  
  **Upgrading.** Nothing to do, and nobody is locked out. Every hash you have is unbound and keeps verifying; each is written back bound the next time its owner signs in successfully, the same way a bcrypt hash becomes argon2id. The curve of "how many are bound" is the curve of "who has signed in since the upgrade", so it never finishes on its own: an account that never signs in again stays unbound forever. `config.user.password.binding.allowUnbound: false` ends the migration by refusing whatever is left — count before you set it, `SELECT count(*) FROM users WHERE password NOT LIKE '$henri-bound$%'`.
  
  **Set a pepper.** Without `HENRI_PASSWORD_PEPPER` the binding is unkeyed: it still stops a hash being copied, but someone who can write rows can recompute a bound one for the row they are targeting. And be clear about the residual even with a pepper: an attacker who can write anything can also write `external_id`. Freeing the value they need means damaging the row it came from, because the column is unique, so they cannot silently clone their own account — but this is a defence against relocating a hash, not against a writable database.
  
  **Two API changes.** `henri.user.compare()` now wants the user rather than its hash (`henri.user.compare(password, user)`), because a bound hash cannot be checked without the record it belongs to; handing it a bound hash alone rejects with an error that says so instead of answering "invalid credentials" to a password that is right. And a **mass password write that matches more than one row is refused** with a validation error on `password`: one hash belongs to one record, and writing an unbound one instead would quietly reopen the door. `User.create()`, `user.save()`, `user.update()`, `User.findByIdAndUpdate()`, `User.bulkCreate()`, `insertMany()` and a `Model.update()` whose condition matches one row are all unaffected.
  
  `config.user.password.binding` is `true` (the default), `false`, or `{ enabled, allowUnbound }`. A user model that opted out of `externalId` cannot bind, keeps writing exactly the hashes it wrote before, and henri says so at boot.
  
  **`@usehenri/mongoose` fixes two holes this work uncovered.** `Model.insertMany()` runs no document middleware, so it was writing the password it was given **to the collection in the clear** and keeping whatever `roles` came with it — `insertMany([{ email, password, roles: ['admin'] }])` created an admin with a plaintext password. It now hashes and resets roles like every other create. `Model.bulkWrite()` runs no middleware either and would have done the same; a password written that way is now refused rather than stored in the clear.
  
  **`@usehenri/sequelize`** now honours `passwordsHashed` in `bulkCreate` and in the mass update as it already did on `create` and `save`: `bulkCreate(rows, { passwordsHashed: true })` and `User.update({ password: hash }, { passwordsHashed: true, where })` used to hash the hashes, leaving accounts nobody could sign in to.

- [#387](https://github.com/usehenri/henri/pull/387) [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b) Thanks [@reel](https://github.com/reel)! - Drizzle is henri's SQL data layer: `henri new` defaults to it, and `@usehenri/postgresql` and `@usehenri/mysql` are it
  
  **This is a breaking change.** It rewrites what an existing store does rather than adding to it, and there is no compatibility switch. It is here rather than in a 2.0 because henri has no installed base to protect; if you have an application on `@usehenri/postgresql` or `@usehenri/mysql`, read the second half of this.
  
  **`henri new` scaffolds a drizzle store on sqlite.** `file:.henri/app.db`, `:memory:` under `NODE_ENV=test`, `@usehenri/drizzle` and `better-sqlite3` in the dependencies. This is Rails' default: nothing to start on the first run, a file the `.gitignore` already covers, migrations from the first day, and a database that is a real one on the last. The zero-config MongoDB store is `henri new --adapter disk`, one flag away and otherwise unchanged. `--adapter` now takes `drizzle` (the default), `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`, and `--dialect sqlite|postgres|mysql` works on its own now that drizzle is the default adapter.
  
  The first run costs nothing extra: `better-sqlite3` 13 ships its compiled addon for darwin, linux, linuxmusl and win32 on arm64 and x64, so the scaffold lists it as `better-sqlite3: false` under `allowBuilds` — pnpm skips a `node-gyp rebuild` that needs a C++ toolchain and produces nothing that gets loaded. The Dockerfile of a sqlite application installs no toolchain either, and says instead that the database file lives inside the container unless a volume is mounted over it.
  
  **`@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with the dialect and the driver chosen.** The package names, the `--adapter postgresql` and `--adapter mysql` flags and the `"adapter": "postgresql"` store value are unchanged; the ORM behind them is not. The name means "henri's PostgreSQL adapter", and henri's PostgreSQL adapter is Drizzle. A store on one of them now has generated, versioned migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`), needs no `dialect` key, and needs no driver in the application: `pg` and `mysql2` ship with the adapter package. `"adapter": "mariadb"` is `@usehenri/mysql` and follows.
  
  What that costs an application already on one of them: the global is the drizzle model, not a Sequelize `ModelStatic`. `findAll`, `findOne`, `findByPk`, `create`, `count`, `destroy`, `instance.update()` and `instance.destroy()` mean the same thing; `Model.scope()`, `findAndCountAll()`, `bulkCreate()`, `upsert()`, `increment()`, the association mixins and `instance.previous()` are gone and throw. Tables and columns are named the drizzle way (`tasks`, `created_at`, not `Tasks`, `createdAt`), so a database built by `sequelize.sync()` is not the one this adapter looks for. `website/src/content/docs/upgrading.md` has the list and the order to work through it.
  
  **The spellings that would have silently meant something else are refused.** This is the part that matters even if you never wrote a line of Sequelize. `Model.update(values, { where })` is Sequelize's argument order and the opposite of this adapter's: read as written it updates the rows matching the _values_ and sets a column called `where`, which answered "1 row updated" and changed nothing. It now raises the new `HENRI_MODEL_INVALID_QUERY`. So does a condition keyed by Sequelize's `Op` symbols (`Object.keys()` cannot see a symbol, so the condition narrowed nothing and the query answered every row), an empty operator object under a field, and `instance.get({ plain: true })`. An option the adapter does not read — `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `lock`, `plain` — raises the new `HENRI_MODEL_UNKNOWN_OPTION` instead of being dropped, because a dropped `fields` is a mass assignment somebody thought they had bounded. A model file's `options` takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`; one declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead, rather than starting an application whose author believes it has an index it does not have.
  
  **`@usehenri/sequelize` is the SQL Server story, and only that.** Drizzle has no SQL Server dialect — drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel — so Sequelize is how henri reaches one, `@usehenri/mssql` is built on it, and neither is going anywhere. Everything an mssql store does differently from every other SQL store (no migrations, `sequelize.sync()` in development, nothing in production, `henri db:status` for the drift) follows from that one fact, and the documentation now says so rather than describing four equal SQL adapters.

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
  `DECIMAL(p, s)`/`BIGINT` on SQL Server, and `text` on sqlite, which has
  neither an exact decimal nor a 64-bit integer better-sqlite3 hands back
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
  string boundary. Two things are refused at boot instead of downgraded, both
  naming the model and the field (`HENRI_MODEL_TYPE_UNSUPPORTED`): either
  type on a sqlite store served by `@usehenri/sequelize`, whose driver reads
  both through a JavaScript number; and a bare `DataTypes.DECIMAL`, which
  MySQL makes `DECIMAL(10, 0)`.
  
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
