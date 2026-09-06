# Change Log

## 1.2.0

### Minor Changes

- [#387](https://github.com/usehenri/henri/pull/387) [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b) Thanks [@reel](https://github.com/reel)! - Drizzle is henri's SQL data layer: `henri new` defaults to it, and `@usehenri/postgresql` and `@usehenri/mysql` are it
  
  **This is a breaking change.** It rewrites what an existing store does rather than adding to it, and there is no compatibility switch. It is here rather than in a 2.0 because henri has no installed base to protect; if you have an application on `@usehenri/postgresql` or `@usehenri/mysql`, read the second half of this.
  
  **`henri new` scaffolds a drizzle store on sqlite.** `file:.henri/app.db`, `:memory:` under `NODE_ENV=test`, `@usehenri/drizzle` and `better-sqlite3` in the dependencies. This is Rails' default: nothing to start on the first run, a file the `.gitignore` already covers, migrations from the first day, and a database that is a real one on the last. The zero-config MongoDB store is `henri new --adapter disk`, one flag away and otherwise unchanged. `--adapter` now takes `drizzle` (the default), `postgresql`, `mysql`, `mssql`, `mongoose` and `disk`, and `--dialect sqlite|postgres|mysql` works on its own now that drizzle is the default adapter.
  
  The first run costs nothing extra: `better-sqlite3` 13 ships its compiled addon for darwin, linux, linuxmusl and win32 on arm64 and x64, so the scaffold lists it as `better-sqlite3: false` under `allowBuilds` — pnpm skips a `node-gyp rebuild` that needs a C++ toolchain and produces nothing that gets loaded. The Dockerfile of a sqlite application installs no toolchain either, and says instead that the database file lives inside the container unless a volume is mounted over it.
  
  **`@usehenri/postgresql` and `@usehenri/mysql` are `@usehenri/drizzle` with the dialect and the driver chosen.** The package names, the `--adapter postgresql` and `--adapter mysql` flags and the `"adapter": "postgresql"` store value are unchanged; the ORM behind them is not. The name means "henri's PostgreSQL adapter", and henri's PostgreSQL adapter is Drizzle. A store on one of them now has generated, versioned migrations (`henri db:generate`, `db:migrate`, `db:push`, `db:status`), needs no `dialect` key, and needs no driver in the application: `pg` and `mysql2` ship with the adapter package. `"adapter": "mariadb"` is `@usehenri/mysql` and follows.
  
  What that costs an application already on one of them: the global is the drizzle model, not a Sequelize `ModelStatic`. `findAll`, `findOne`, `findByPk`, `create`, `count`, `destroy`, `instance.update()` and `instance.destroy()` mean the same thing; `Model.scope()`, `findAndCountAll()`, `bulkCreate()`, `upsert()`, `increment()`, the association mixins and `instance.previous()` are gone and throw. Tables and columns are named the drizzle way (`tasks`, `created_at`, not `Tasks`, `createdAt`), so a database built by `sequelize.sync()` is not the one this adapter looks for. `website/src/content/docs/upgrading.md` has the list and the order to work through it.
  
  **The spellings that would have silently meant something else are refused.** This is the part that matters even if you never wrote a line of Sequelize. `Model.update(values, { where })` is Sequelize's argument order and the opposite of this adapter's: read as written it updates the rows matching the _values_ and sets a column called `where`, which answered "1 row updated" and changed nothing. It now raises the new `HENRI_MODEL_INVALID_QUERY`. So does a condition keyed by Sequelize's `Op` symbols (`Object.keys()` cannot see a symbol, so the condition narrowed nothing and the query answered every row), an empty operator object under a field, and `instance.get({ plain: true })`. An option the adapter does not read — `attributes`, `fields`, `raw`, `transaction`, `individualHooks`, `lock`, `plain` — raises the new `HENRI_MODEL_UNKNOWN_OPTION` instead of being dropped, because a dropped `fields` is a mass assignment somebody thought they had bounded. A model file's `options` takes `timestamps`, `paranoid`, `externalId`, `personal` and `retention`; one declaring `indexes`, `scopes`, `defaultScope`, `hooks`, `tableName`, `underscored` or `freezeTableName` fails the boot naming the key and what to write instead, rather than starting an application whose author believes it has an index it does not have.
  
  **`@usehenri/sequelize` is the SQL Server story, and only that.** Drizzle has no SQL Server dialect — drizzle-orm 0.45 ships pg, mysql, sqlite, singlestore and gel; drizzle-kit 0.31 generates for postgresql, mysql, sqlite, turso, singlestore and gel — so Sequelize is how henri reaches one, `@usehenri/mssql` is built on it, and neither is going anywhere. Everything an mssql store does differently from every other SQL store (no migrations, `sequelize.sync()` in development, nothing in production, `henri db:status` for the drift) follows from that one fact, and the documentation now says so rather than describing four equal SQL adapters.

- [#341](https://github.com/usehenri/henri/pull/341) [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f) Thanks [@reel](https://github.com/reel)! - Every record gets a public uuid, and the numeric id stops leaving the server.
  
  **This is a breaking change for an existing application: urls change, JSON payloads change, and a database migration is required.** The [upgrading guide](https://usehenri.io/upgrading/) has the migration for each adapter.
  
  The primary key is unchanged — a `bigint` on SQL, an `ObjectId` on MongoDB — and it is still what the foreign keys, the joins and the indexes are made of. What changes is that it is now internal. Alongside it every model carries `externalId`: a uuid in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database itself, generated on the insert when the caller brings none. It is the only identifier that leaves the server, so nothing outside can see or guess a sequential number: `/tasks/42` becomes `/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`, a serialized record has `externalId` and no `id` (no `_id` on MongoDB), and `_links`, the `Location` header of a `201`, the path helpers, the view options and `publicUser()` all carry the uuid.
  
  The values are UUID version 7 (RFC 9562), time ordered: the column is unique, indexed and written on every insert, and a version 4 uuid would land in a different page of the b-tree every time where a version 7 appends to the right edge like the bigint it hides. `crypto.randomUUID()` only makes version 4, so the adapters generate their own; a uuid supplied by the caller is accepted whatever its version.
  
  `Model.findById()` takes either identifier, so a controller keeps handing it `req.params.id`: a uuid is 36 characters with four dashes, and neither a number nor a 24 character `ObjectId` can look like one. `findByIdAndUpdate()`, `findByIdAndDelete()` and, on the Sequelize adapters, `findByPk()` take both too, and `findById()` is new on the Sequelize adapters.
  
  Nothing about associations changes: `belongsTo`, `hasMany`, `include()` and `populate()` still work on the primary key, and a foreign key column still holds a number.
  
  `options: { externalId: false }` opts a model out, and it then behaves exactly as it did before.

- [#315](https://github.com/usehenri/henri/pull/315) [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc) Thanks [@reel](https://github.com/reel)! - Rails ergonomics for models and the database: seeds, timestamps by default, soft deletes, `paginate()` and one validation error shape.
  
  **Behaviour change: timestamps are on by default.** Every model now gets `createdAt` and `updatedAt`, like every Rails table; `options: { timestamps: false }` opts out. Before this, the Mongoose (`disk`, `mongoose`) and Drizzle adapters added them only with `options: { timestamps: true }` — the Sequelize adapters (`mysql`, `postgresql`, `mssql`) already added them by default, so nothing changes there. On MongoDB there is nothing to do; on Drizzle the models gain two `NOT NULL` columns, so a production database needs a migration (`henri db:generate`, then `henri db:migrate`) before deploying. `henri generate model` no longer writes `options: { timestamps: true }`. See the [upgrading guide](https://usehenri.io/upgrading/#timestamps-are-on-by-default).
  
  **`henri db:seed` and `db/seeds.js`** (Rails' `db/seeds.rb`). Boots the models only — no views, no workers — requires `db/seeds.js` and awaits what it exports, with the models and the henri instance available. It works on every adapter, unlike the migration commands of `henri db`. `--file=<path>` runs another file, `--json` prints the result and the usual `{ error: { command, message, hint, code, exitCode } }` envelope, and a missing seed file is a usage error reported before anything boots. `henri new` scaffolds the file with the idempotent `find or create` idiom commented out.
  
  **Soft deletes with `options: { paranoid: true }`** (Rails' `acts_as_paranoid`), on every adapter: deleting stamps `deletedAt`, queries hide the stamped records, `{ force: true }` really deletes and `restore()` brings a record back. Mongoose gets a schema plugin (query middleware plus replacements for `deleteOne`, `deleteMany`, `findOneAndDelete`, `findByIdAndDelete` and `doc.deleteOne()`), Sequelize uses its own `paranoid`, and Drizzle honours the scope in relations, `count()`, `update()` and `paginate()` and adds `withDeleted()`/`onlyDeleted()`.
  
  **`Model.paginate({ page, perPage })`** on every adapter, answering `{ records, page, perPage, total, pages }`: `await Task.paginate(req.pagination())` replaces a find and a count, and everything else in the object is the adapter's own query (`where`, `sort`/`order`, `include`, `select`, ...). On Drizzle relations paginate too: `Task.where({ done: false }).paginate({ page: 2 })`.
  
  **`henri.model.errors(error)`** turns a Mongoose, Sequelize or Drizzle validation failure — a duplicate key included — into `{ field: message }`, and answers `null` for anything else so a controller can rethrow. An error with no field of its own is filed under `base`.
  
  The controllers written by `henri generate scaffold` and `crud` use `Model.paginate(req.pagination())` and `henri.model.errors()`, so a generated index is one query and a generated 422 has the same body on every store. Regenerate them with `--force` to pick both up.

- [#378](https://github.com/usehenri/henri/pull/378) [`8a8e3b3`](https://github.com/usehenri/henri/commit/8a8e3b33d7967b81f66633aa25c3075318f01d60) Thanks [@reel](https://github.com/reel)! - A Sequelize store stops changing the production schema by itself, and `henri db:status` reads it back
  
  Until now every SQL boot ran `sequelize.sync()`, in every environment. In development that is the point; in production it was DDL applied at boot, from whatever the models happened to say, with nobody reviewing it — and because `sync()` only creates what is missing and never alters what exists, it also hid every table that was already wrong.
  
  A production boot now changes nothing. It compares the database with the models instead and warns about each difference. A store that wants the old behaviour asks for it with `"sync": true`, which `henri audit` reports as `schema.autosync`. Development is unchanged, and so is the drizzle adapter, which already refused to push in production.
  
  `henri db:status` now answers on a Sequelize store (`mysql`, `postgresql`, `mssql`), which is the one `db:` command they can honestly serve: it reports a missing table, a missing column, a column whose type or nullability differs, a missing index, and a column that is in the database and in no model. `--sql` writes the DDL that would close the difference, for you to read and run — henri applies none of it and never writes a `DROP`. `--json` carries `clean` and the differences, so a deploy can check that production matches the code. On sqlite a column change is reported without a statement, because sqlite has no `ALTER COLUMN`.
  
  The Sequelize adapters still have no migrations and are not getting any: generated, versioned migrations are the drizzle adapter's, and the upgrade guide now documents the path from a `sync()`-built database to drizzle migrations without dropping it. `henri db:generate`, `db:migrate` and `db:push` on a Sequelize store answer the new `HENRI_CLI_MIGRATIONS_UNSUPPORTED` and point there. `henri doctor` gained `schema.migrations-ignored` and `schema.migrations-pending`.

### Patch Changes

- Updated dependencies [[`1e23664`](https://github.com/usehenri/henri/commit/1e23664829bd1a356de28f404cfb21c9ae211388), [`7fd13f6`](https://github.com/usehenri/henri/commit/7fd13f631b75f7aa152b73046b50c6902ae3ca93), [`1c0dfe8`](https://github.com/usehenri/henri/commit/1c0dfe84a98eff2122512256c4f42ec7ccde4212), [`43d267f`](https://github.com/usehenri/henri/commit/43d267f0f9d192b2c01e89c3925b7daf5000041b), [`89dda62`](https://github.com/usehenri/henri/commit/89dda62da456a0a55600e79cfb65ce89f11258e2), [`d9f3be4`](https://github.com/usehenri/henri/commit/d9f3be49c5929d929a220220bf6e72fdcb135595), [`c44f025`](https://github.com/usehenri/henri/commit/c44f025acec3d5bbbb57e2310d02184a1053a10d), [`67cfb20`](https://github.com/usehenri/henri/commit/67cfb200ea0e0b31bacf2af183db6467b0fa011d), [`e661f98`](https://github.com/usehenri/henri/commit/e661f98fe8f8acce15aa10ce2dc320c5a2cb006f), [`ba97ea9`](https://github.com/usehenri/henri/commit/ba97ea968f0b34cd67b7a3e803ecd34543b8aaaf), [`dd2731d`](https://github.com/usehenri/henri/commit/dd2731d6a20fd96aa1be1aeb5e6ec0155001326b), [`b7038ce`](https://github.com/usehenri/henri/commit/b7038ceaa430f4a0b9eaf7e983fc2844421bf636), [`a2e1ec2`](https://github.com/usehenri/henri/commit/a2e1ec29df52462f12ebaae9bfbc1ad4f427b27f), [`afead74`](https://github.com/usehenri/henri/commit/afead7489498ed42e1893a25123ea772cac2ca09), [`3501939`](https://github.com/usehenri/henri/commit/3501939c0e73ed5be4dee6730657c9213168b3c1), [`a4ecba5`](https://github.com/usehenri/henri/commit/a4ecba50c663f4d5c741adbb6cd9bc0eefe0e5cc), [`ada4794`](https://github.com/usehenri/henri/commit/ada4794204a72cf6e4bfe691a08933df92dd7ff4), [`41470bf`](https://github.com/usehenri/henri/commit/41470bf378d83ca3d35d00e8c31796fea5eb15e0)]:
  - @usehenri/drizzle@1.2.0

## 1.1.0

### Minor Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Store adapters share one contract and understand the henri model format.
  
  - `findUserByEmail(email)`, `findUserById(id)`, `userId(user)` and `toPlain(user)` on every adapter, so core no longer runs Mongoose queries against SQL stores.
  - `getSessionConnector(session)` is async and returns a ready store: the SQL session table is created before the first request, and the Mongoose store reuses the mongoose driver client instead of opening a second one. `express-session` is a peer dependency of `@usehenri/sequelize` and `@usehenri/mongoose`.
  - `normalizeSchema()` in `@usehenri/sequelize`: string types (`string`, `text`, `number`, `integer`, `float`, `boolean`, `date`, `json`, `uuid`), `required`, `default`, `enum`, `unique` and `index` map to Sequelize attributes and throw on unknown keys; the Mongoose adapter maps the same names. `types.js` in both packages documents the map.
  - User model: `email` is unique, lowercased, trimmed and validated; `password` is hashed on bulk and query updates too and is no longer selected by default (`scope('withPassword')` / `select('+password')`); `roles` is dropped from mass-assigned creates and updates unless the operation passes `{ unsafe: true }`, and `user.setRoles(roles)` / `User.setRoles(id, roles)` change it. On SQL, `roles` is a JSON column where the dialect supports it (TEXT with a JSON getter on mssql).
  - Model files may export `associate(models)`, called once every model exists (before `sync()` on SQL). Adapters expose `ping()`, `transaction(fn)` and, on SQL, `query(sql, params)`.
  - mysql, postgresql and mssql are thin dialect packages over `@usehenri/sequelize` (`createConnector()` hook, `stop()` then `start()` works, `mariadb://` rewrite, Sequelize `logging` defaults to `debug('henri:sequelize')`, credentials redacted from debug output). A missing `url` throws instead of leaving a broken adapter; `host`, `port`, `database`, `username`, `password` are accepted instead of `url`.
  - Mongoose: `serverSelectionTimeoutMS` defaults to 10s so a bad url fails fast.
  - Disk: data lives under `<cwd>/.henri/data` (`path` and `dbName` are configurable, a warning is logged in production); the `md5` dependency is gone.

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).
- Updated dependencies [[`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e)]:
  - @usehenri/sequelize@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies []:
  - @usehenri/sequelize@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @usehenri/sequelize@1.0.1

## 1.0.0

### Major Changes

- [#283](https://github.com/usehenri/henri/pull/283) [`67f4b1a`](https://github.com/usehenri/henri/commit/67f4b1afe32f1820ed775b836062b3bb1b3da840) Thanks [@reel](https://github.com/reel)! - Revive henri on a current toolchain. This is a breaking release.
  
  - Node.js 22 or newer is required.
  - `@usehenri/core`: Express 5, Apollo Server 5 with `@graphql-tools` (`henri.graphql.run()` returns `{ data, errors }`, Apollo error classes are `GraphQLError` subclasses), bcryptjs instead of native bcrypt, passport 0.7 (`req.logout` takes a callback), `henri.server.stop()` closes the server. Model globals are also written to `.henri/globals.json`.
  - `@usehenri/mongoose` and `@usehenri/disk`: Mongoose 9, connect-mongo 6, mongodb-memory-server 11. The disk store is a local MongoDB with on-disk persistence outside test mode.
  - `@usehenri/sequelize`, `@usehenri/mysql`, `@usehenri/postgresql`, `@usehenri/mssql`: Sequelize 6 latest with mysql2 3, pg 8 and tedious 20. The user model overload uses valid Sequelize options (`allowNull`, a `TEXT` roles column with a JSON getter/setter, `hasRole`, re-hash on `beforeUpdate`) and `start()` waits for `sync()`.
  - `@usehenri/react`: Next.js 16 (Turbopack) and React 19. `withHenri` exposes `HenriContext` and `useHenri()` instead of legacy context; forms get `useForm()` and `react-quill-new`. `next` is a peer dependency: apps must depend on `next`, `react` and `react-dom`. The `inferno` and `preact` renderers are gone; `config/next.js` can extend the Next.js config and `config/webpack.js` switches the bundler to webpack.
  - `@usehenri/cli` and `henri`: Node 22 check, prettier 3, `@inquirer/prompts`; `henri new` scaffolds a React 19 app with `next.config.js`, `jsconfig.json`, an ESLint flat config and a `pnpm-workspace.yaml` allowing the build scripts pnpm 10+ blocks.
  - `@usehenri/testing` and `@usehenri/websocket` load again; `@usehenri/mailer` is no longer published (the mailer lives in core).

### Patch Changes

- Updated dependencies [[`67f4b1a`](https://github.com/usehenri/henri/commit/67f4b1afe32f1820ed775b836062b3bb1b3da840)]:
  - @usehenri/sequelize@1.0.0

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/mysql





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)

**Note:** Version bump only for package @usehenri/mysql





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/mysql





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/mysql





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/mysql





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package @usehenri/mysql





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)

**Note:** Version bump only for package @usehenri/mysql





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package @usehenri/mysql





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/mysql





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/mysql





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package @usehenri/mysql





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)

**Note:** Version bump only for package @usehenri/mysql





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/mysql





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

**Note:** Version bump only for package @usehenri/mysql





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/mysql





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package @usehenri/mysql





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

**Note:** Version bump only for package @usehenri/mysql





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Features

* **user:** session storage per database provider, closes [#34](https://github.com/usehenri/henri/issues/34) ([50d5831](https://github.com/usehenri/henri/commit/50d5831))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.20.1"></a>
## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)


### Bug Fixes

* **view:** seems like yarn workspaces broke next packages resolution. i don't get it. ([073d40a](https://github.com/usehenri/henri/commit/073d40a))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **mssql:** using sequelize with tedious (mssql) ([0b47556](https://github.com/usehenri/henri/commit/0b47556))
* **mysql:** using sequelize with mysql2 (mysql, mariadb) ([06dc7f8](https://github.com/usehenri/henri/commit/06dc7f8))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)




**Note:** Version bump only for package @usehenri/mysql

<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Features

* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))
* **mysql:** add mysql support ([3c11e4f](https://github.com/usehenri/henri/commit/3c11e4f))
