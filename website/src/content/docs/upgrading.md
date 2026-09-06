---
title: Upgrading
description: From henri 0.37 to 1.x and from 1.1 to 1.2, what breaks and what to change.
sidebar:
  order: 3
---

henri 1.0 (2026) moved the framework to a current toolchain and 1.1 hardened it. Both break an application written for 0.37. The 1.1 to 1.2 changes come first; everything after them is the 0.37 to 1.x list, in the order you will meet it. The per-package details are in the [changelogs](https://github.com/usehenri/henri/releases).

## From 1.1 to 1.2

### Every record has a public uuid, and the numeric id stops leaving the server

This is the change of 1.2 that touches an application everywhere: **urls change, JSON payloads change, and a database migration is required**. Read it before upgrading.

Every model now carries `externalId`, a uuid stored in an `external_id` column that is `NOT NULL` and `UNIQUE` in the database, generated on the insert. It becomes the only identifier that leaves the server: routes, `_links`, the `Location` header of a `201`, the path helpers and the data a page receives all carry it, and `toJSON()` no longer serializes the primary key. The primary key itself does not change: it is still what the foreign keys and the joins are made of, and `belongsTo`, `hasMany`, `include()` and `populate()` are untouched. See [Identifiers](/guides/models/#identifiers).

What breaks:

- **Urls**: `/tasks/42` becomes `/tasks/0199a5c1-1f7e-7a3c-bb0d-2b1a4f6d9c11`. Old links keep working, because `Model.findById()` takes the primary key as well, but nothing hands one out any more. Bookmarks, sitemaps and anything holding an id of yours will need remapping.
- **Payloads**: a serialized record has `externalId` and no `id` (no `_id` on MongoDB). A client reading `body.id` reads `body.externalId` now.
- **The public user**: `henri.user.publicUser(user)` and `req._henri.user` answer `{ externalId, email, roles }` instead of `{ id, email, roles }`.
- **Your own code**: anything building a url or a key from `record.id` uses `record.externalId`. Server side, `record.id` is unchanged and still the right thing for a query, a join or a foreign key.
- **Generated code**: `henri generate scaffold` and `crud` write controllers and pages around `externalId`. Regenerate them with `--force` to pick it up.

The migration:

- **MongoDB (`disk`, `mongoose`)**: the field and its unique index are created on boot. Documents written before the upgrade have no `externalId`, and the unique index counts them as one shared `null`, so backfill them before the second one is written:

  ```js
  // db/seeds.js, or a one-off script run with `henri console`
  const { uuidv7 } = require('@usehenri/mongoose/external-id');

  for await (const doc of Task.find({ externalId: { $exists: false } })) {
    await Task.updateOne({ _id: doc._id }, { $set: { externalId: uuidv7() } });
  }
  ```

- **Drizzle**: `henri db:generate` writes the column and the constraint. On a table that already holds rows the generated `ADD COLUMN ... NOT NULL` fails: split it into the three steps below, which is what the showcase application's `db/migrations/0001_external_id.sql` does. `gen_random_uuid()` is version 4, which is fine for rows that already exist; everything written afterwards gets a version 7 from the adapter.

  ```sql
  ALTER TABLE "tasks" ADD COLUMN "external_id" uuid;--> statement-breakpoint
  UPDATE "tasks" SET "external_id" = gen_random_uuid() WHERE "external_id" IS NULL;--> statement-breakpoint
  ALTER TABLE "tasks" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_external_id_unique" UNIQUE("external_id");
  ```

- **Sequelize (`mysql`, `postgresql`, `mssql`)**: there are no migrations, and `sequelize.sync()` does not alter a table. Add the column yourself with the same three steps (`UUID()` on MySQL and MariaDB, `NEWID()` on MSSQL) before deploying.

A model that must keep its old shape opts out, and then nothing above applies to it:

```js
module.exports = {
  options: { externalId: false },
  schema: { name: { type: 'string' } },
};
```

### `henri new` scaffolds an Inertia application

The default renderer is now `inertia`: `henri new` writes `"renderer": "inertia"` in `config/default.json`, scaffolds `.jsx` pages under `app/views/pages` and builds them with Vite. `henri new --renderer react` still scaffolds the Next.js application, and the React engine is supported: it is frozen on the pages router rather than removed, because the contract that hands a controller's data to a page has no equivalent in the app router. See [Views](/guides/views/).

Nothing changes in an existing application. Its `renderer` key is what the boot reads, and `henri generate scaffold|crud` reads the same key: a React application keeps getting `.js` pages using `withHenri` and `@usehenri/react/forms`, an Inertia one gets `.jsx` pages using `useHenri()` and `<Form>`. There is no migration, and no supported way to convert an application from one engine to the other: the pages are rewritten by hand.

Two things follow from the renderer in the generated code, if you compare a fresh scaffold with yours:

- A failed write answers a browser differently. The React controllers answer a `422` and the forms show it field by field; the Inertia controllers call `res.inertia.errors()` and render the form page again. API clients get the same `422` from both.
- `henri generate test` writes the Inertia page object assertions next to the HAL ones in an Inertia application, and the HAL ones alone in a React one.

### Timestamps are on by default

Every model now gets `createdAt` and `updatedAt`, like every Rails table. Before 1.2 they were added only when the model declared `options: { timestamps: true }` on the Mongoose (`disk`, `mongoose`) and Drizzle adapters; the Sequelize adapters (`mysql`, `postgresql`, `mssql`) already added them by default, so nothing changes there.

What this means for an existing application:

- **MongoDB (`disk`, `mongoose`)**: nothing to do. New and updated documents get the two fields; the documents already stored keep whatever they have, and reading them is unaffected.
- **Drizzle**: the models gain two `NOT NULL` columns, so the schema and the database no longer agree. In development the boot pushes them; in production write the migration with `henri db:generate` and apply it with `henri db:migrate` before deploying. On a table that already holds rows, review the generated statements: a `NOT NULL` column needs a default for the existing rows.
- **Sequelize**: unchanged, `sequelize.sync()` already created them.

Add `options: { timestamps: false }` to any model that should keep its old shape. `options: { timestamps: true }` still works and is now redundant: `henri generate model` no longer writes it.

### The minimum password length moves from 6 to 12

`henri.user.encrypt()` used to refuse anything shorter than 6 characters. It now refuses anything shorter than **12**, and anything longer than 72 bytes (bcrypt's ceiling, past which it silently ignores the rest rather than telling you).

**Nobody is locked out by this.** The policy governs _setting_ a password: signing in never applies it, so an account created with a six character password keeps signing in with it, and its hash is quietly upgraded when it does. What changes is registration and password changes.

What to check before deploying:

- **Your own interface.** If your signup form, its validation, or the copy next to it advertises a shorter minimum, it will start refusing passwords you told people were acceptable. Update the form, or set the minimum you actually want.
- **Seeds and fixtures.** Anything creating a user with a short password (`db/seeds.js`, test helpers) now throws. The showcase application's seeded password moved from `showcase` to `lineup-showcase` for exactly this reason.

`config.user.password.minLength` sets it. It will not go below 8 — the floor every comparable framework sits at:

```json
{ "user": { "password": { "minLength": 8 } } }
```

`henri.user.validatePassword(password)` is the same rule without the hashing, and answers `{ valid, errors: [{ code, message }] }` so a form can say what is wrong. See [Passwords](/guides/users/#passwords).

### Passwords are hashed with argon2id, and old hashes are upgraded on sign-in

New hashes use **argon2id** when `@node-rs/argon2` resolves — it is an `optionalDependency` of `@usehenri/core`, so `pnpm install` picks up a prebuilt binary on every platform Node runs on and skips it silently anywhere it cannot. Where it is missing, bcrypt is used, at **cost 12** instead of 10.

Nothing to do, and nothing to migrate: bcrypt hashes still verify, and each one is written again in the current format the next time its owner signs in successfully. Two things worth knowing:

- **A hash written under argon2id needs argon2id to verify.** If some of your machines have the binding and others do not, they will disagree. Pin `"password": { "algorithm": "bcrypt" }` if you need every deployment to be interchangeable, or `"argon2id"` to fail the boot rather than silently fall back.
- **Cost.** bcrypt at 12 is about four times cost 10 (a quarter second per sign-in with the pure-JS bcrypt henri ships); argon2id at the OWASP parameters is faster than that and uses 19 MiB per hash.

`config.user.password` configures all of it, including an optional [pepper](/guides/users/#the-pepper).

### Sign-in attempts are capped per account

Ten failures against one account inside fifteen minutes and it stops accepting sign-in attempts for the rest of the window, whoever is sending them. This is new: the rate limit only ever counted per address, so a slow attempt spread across many addresses was unbounded.

What to check: anything that signs in repeatedly with the wrong credentials — a health check pointed at `POST /login`, a test suite that asserts many failures for one account — now meets a `429` where it used to get a `401`. Failures are counted for unknown emails too, so the answer is the same whether the account exists or not.

`"lockout": { "max": 20, "windowMs": 300000 }` under `user` retunes it, `"lockout": false` turns it off. The counter is in memory and per process; `store` takes a shared express-rate-limit store. See [Sign-in lockout](/guides/users/#sign-in-lockout).

### CSRF also checks where the request came from

The double-submit token is unchanged. On top of it, an unsafe request carrying a session cookie must now come from an origin this application recognizes: `Sec-Fetch-Site: same-origin` or `none`, or an `Origin` matching the host or listed in `csrf.trustedOrigins`. A sibling subdomain is refused, which is the case the token alone never covered.

What to check:

- **A browser client on another origin that sends cookies.** It needs its origin trusted. Whatever `config.cors.origin` already allows is trusted for you, so an application that configured CORS properly needs no change.
- **A reverse proxy that rewrites the `Host` header** and sets neither `X-Forwarded-Host` nor `X-Forwarded-Proto` will make the computed origin disagree with the browser's. henri reads both when `config.trustProxy` allows it (it is `true` by default); check the setting is right for your setup.

Nothing changes for a client that sends no session cookie, or one authenticated with a bearer token. `"csrf": { "origin": false }` restores the token-only behaviour.

### The GraphQL endpoint has depth, alias and complexity limits

Only applies if a model of yours declares `graphql`, which also means the application now installs `@usehenri/graphql` (below). A query is now refused when it nests more than 10 levels, uses more than 15 aliases, selects more than 1000 fields (fragments expanded) or holds more than 5000 tokens. A page's own query is nowhere near any of these; a generated or machine-built query might be.

Each limit is a key of `config.graphql`, which is now an object as well as a path, and `false` lifts one. The same object adds `authenticated`, `roles` and `loopbackOnly`, because the endpoint has never had a guard of its own. See [Bounding the endpoint](/guides/graphql/#bounding-the-endpoint).

### GraphQL moves to @usehenri/graphql

The GraphQL layer left `@usehenri/core` and lives in [`@usehenri/graphql`](https://www.npmjs.com/package/@usehenri/graphql), which [ships it as a henri module](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package). Core no longer depends on `@apollo/server`, `@as-integrations/express5`, `@graphql-tools/merge`, `@graphql-tools/schema` or `graphql`, and carries no GraphQL code at all: an application that never mounted a schema stops installing them.

**If your models declare a `graphql` key, or your controllers render with `{ graphql }`, install one package:**

```bash
npm install @usehenri/graphql
```

Nothing else changes. `henri.graphql` is the same object with the same `run()`, `endpoint`, `active`, error classes and `toApolloError()`, the endpoint is still `/_henri/gql` (and still configurable with the `graphql` key), and the schema is still built from the models' `graphql` keys.

Without the package henri says so rather than going quiet:

- a model that declares a `graphql` key fails the boot with the install line;
- `res.render(view, { graphql })` fails the request with the install line, instead of rendering a page whose data is missing;
- `henri doctor` reports `deps.declared` when a model declares types or the configuration sets `graphql`;
- `henri.graphql` is `undefined` rather than an object that does nothing, and a page has no `graphql` key among its view options. Code reading it guards with `henri.graphql &&`; the type declarations make it optional, so TypeScript and a JSDoc-annotated file say so too.

### The queue registers itself

Nothing to change unless your application enqueues jobs. `@usehenri/jobs` was already a package of its own, but `@usehenri/core` carried the module that loaded it: an application without the package still had a `henri.jobs`, an inert object whose every method explained what to install. The package [ships the module itself](/reference/under-the-hood/#where-it-goes-a-module-that-arrives-from-a-package) now, the way [`@usehenri/graphql`](#graphql-moves-to-usehenrigraphql) does.

**If your application has `app/jobs` or a `jobs` configuration block, make sure it depends on the package:**

```bash
npm install @usehenri/jobs
```

It probably already does — nothing worked without it. `henri doctor` reports it as a missing dependency when it does not, and `henri jobs` says the same.

Nothing else changes: the queue, the runner, the retries, the dead letter queue, the recurring schedules, the tables and every `henri jobs` command are untouched, and the module still sits at level 4 so a runner binds no port.

What is different is the application that has no queue:

- `henri.jobs` is `undefined` rather than an object that does nothing. Code reading it guards with `henri.jobs &&`; the type declarations make it optional, so TypeScript and a JSDoc-annotated file say so too.
- `deliverLater({ wait })` or `deliverLater({ at })` without the package now fails with the install line instead of sending the mail immediately. `deliverLater()` with nothing to honour is unchanged: it delivers out of band, silently, as documented in [Mail](/guides/mail/#delivering-later).

`henri new` does not add the dependency, and the boot of an application without it says nothing at all.

### New in 1.2

Nothing below breaks anything, they are additions:

- `options: { paranoid: true }` turns deletes into a `deletedAt` stamp on every adapter, and queries hide the stamped records. See [Soft deletes](/guides/models/#soft-deletes).
- `Model.paginate({ page, perPage })` answers `{ records, page, perPage, total, pages }` on every adapter: `await Task.paginate(req.pagination())` replaces a find and a count. See [Pagination](/guides/models/#pagination).
- `henri.model.errors(error)` turns any adapter's validation failure into `{ field: message }`, and answers `null` for anything else. The controllers written by `henri generate scaffold` and `crud` use it and `Model.paginate()`, so regenerate them (`--force`) to pick both up. See [Validation errors](/guides/models/#validation-errors).
- `henri db:seed` runs `db/seeds.js` with the models loaded, on any adapter. `henri new` scaffolds the file. See [Seeds](/guides/models/#seeds).
- `config.user.password.pepper` mixes a server-side key into every hash, so a stolen table cannot be cracked offline. It is off by default, it is its own key rather than `config.secret`, and **losing it makes every peppered password unverifiable**. See [The pepper](/guides/users/#the-pepper).

## Toolchain

- Node.js 22 or newer. The `henri` binary refuses to start on an older version.
- Express 5 (Express 4 in 0.37). Middlewares you register yourself must follow its rules: wildcard routes are written `/{*splat}`, `req.query` is a getter, rejected promises in handlers reach the error handler.
- Next.js 16 with Turbopack and React 19. `next`, `react` and `react-dom` are peer dependencies: add them to the application (`henri new --renderer react` does). The `inferno` and `preact` renderers are gone. The Vue renderer only loads with `"experimental": { "vue": true }` and has not been exercised since Nuxt 2.
- Mongoose 9 and Sequelize 6 with current drivers. Mongoose queries take no callbacks: `Model.update()` and `Model.remove()` are gone, use `updateOne()`, `findByIdAndUpdate()`, `deleteOne()` and `findByIdAndDelete()`.
- Tests run on Vitest, not Jest (see [Testing](/guides/testing/)).

## Project layout

- `config/default.json` is meant to be committed and the secret to live in `.env` as `HENRI_SECRET`, which henri reads on boot. A `secret` in the JSON still works.
- The disk adapter stores its data under `<app>/.henri/data` instead of a temporary directory keyed on the project path. Data is not migrated; add `/.henri` to `.gitignore` (the scaffold does).
- The React renderer needs `app/views/next.config.js` and `app/views/jsconfig.json`; the engine creates them on first boot when they are missing. `config/webpack.js` still works and switches the bundler to webpack; `config/next.js` extends the Next.js configuration under either bundler. Both are read once: edit, then restart.
- Tests live in `test/**/*.test.js` with a `vitest.config.js` at the root (see below).

## Server and HTTP

- Development binds to `127.0.0.1`. Use `henri server --host=0.0.0.0`, `HENRI_HOST` or `config.host` to listen on the network; production still binds to `0.0.0.0`.
- CORS is off unless `config.cors` is set.
- Unmatched routes get a content-negotiated 404 and controller errors a logged 500 (message and stack in development only). `X-Powered-By` is gone. `/_routes` and `/_controllers` answer in development and only from the machine running the server.
- `res.boom` is built in (express-boom is gone); the response shape is the same, see [Controllers](/guides/controllers/#resboom).
- A misconfigured store, adapter, view or controller fails the boot instead of being logged and skipped. `henri.init()` rejects with an `Error` whose `cause` is the module error; `pen.fatal()` returns an `Error` for the caller to throw; `henri.stop()` resolves with the array of errors of the modules that failed to stop.
- `SIGINT` and `SIGTERM` stop the server gracefully, with a 5 second timeout; a second signal exits at once.

## Users, sessions and requests

- Log out with `POST /logout`. `GET /logout` answers `405`.
- `POST /login` answers `{ user }` to JSON clients and redirects browsers to `config.user.afterLogin`; failures are `401` (`400` when a field is missing) or a redirect to `<loginPath>?error=invalid`.
- Views, `req._henri.user` and JSON answers receive the public user only: `{ id, email, roles }` plus the fields listed in `config.user.public`. `req.user` is still the model instance server side.
- The `password` field is not selected by default: `User.findOne(...).select('+password')` on Mongoose, `User.scope('withPassword')` on SQL. `henri.user.findByEmail()` returns it, `findById()` does not.
- `email` is trimmed, lowercased and unique. Existing rows are not rewritten; lookups lowercase their argument.
- `roles` is dropped from mass-assigned creates and updates. Change roles with `user.setRoles(roles)`, `User.setRoles(id, roles)` or by passing `{ unsafe: true }` to the operation.
- Double-submit CSRF protection: unsafe requests (`POST`, `PUT`, `PATCH`, `DELETE`) that carry the session cookie must send the `henri.csrf` cookie back as the `X-CSRF-Token` (or `X-XSRF-TOKEN`) header or a `_csrf` field, or they get a `403`. The React `fetch()` and `hydrate()` helpers, the Inertia `fetch()` helper and `Form` do it; a plain form needs the `_csrf` field; requests with a bearer token are exempt; `"csrf": false` disables it.
- The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production and lives 30 days (`config.user.sessionMaxAge`).
- `req.logout()` takes a callback (passport 0.7). Prefer the built-in `POST /logout`.
- Use `req.permit('title', 'body')` instead of `req.body` when creating or updating records.

## Models

- Models are written in the henri format (`{ type: 'string', required: true, default, enum, unique, index }`, see [Models](/guides/models/#the-schema-format)) and normalized per adapter. The SQL adapters throw on keys they do not know: Waterline-style `validations`, `isIn` or `defaultsTo` from old model files must become `enum` and `default`. The Mongoose adapter passes unknown keys through.
- A store without `url` (or `host`) fails the boot instead of leaving a broken adapter. `host`, `port`, `database`, `username` and `password` are accepted instead of `url`.
- Model files may export `associate(models)`, called once every model exists (before `sync()` on SQL). Adapters expose `ping()`, `transaction(fn)` and, on SQL, `query(sql, params)`.
- On SQL, `roles` is a JSON column (TEXT with a JSON getter on MSSQL) and `email` is validated as an email.

## Views

- `fetch()` in `withHenri` uses the native `fetch` and resolves with the parsed body (it resolved the axios response before: `.data` is gone). Failed requests reject with a `RequestError` carrying `message`, `statusCode`, `error` and `data` from the boom body.
- `withHenri` reads only `req._henri` on the server: query string values no longer become page props. `errors`, `graphql`, `csrf` and `localUrl` reach the page and `useHenri()`.
- `hydrate()` keeps the current data when the answer is not a henri page and exposes the error as `useHenri().error`.
- `pathFor()` and `getRoute()` replace whole parameter names (`:id` no longer rewrites `:identifier`).
- Forms: sanitizers chain (`trim` then `escape`), the form stays disabled until the request settles, `Select` renders a real placeholder option, `Editor` is controlled by the form data and loads Quill in the browser only. `prop-types` and `shallowequal` are gone.
- There is no `helpers/` import alias: any folder under `app/views` (`components/`, `styles/`, `assets/`) is importable by name, `app/helpers` is not.
- Handlebars: `/artwork` resolves to `pages/artwork.{hbs,html,htm}` then `pages/artwork/index.*` and nothing else; a route without a page is a 404; the view options are data variables (`{{@user.email}}`).

## GraphQL

- `henri.graphql.run(query, variables, contextValue)` returns `{ data, errors }` and forwards `contextValue` to the resolvers (`res.render()` passes `{ req, res }`).
- Apollo Server 5: the error classes on `henri.graphql` (`AuthenticationError`, `ForbiddenError`, `UserInputError`, ...) are `GraphQLError` subclasses with an `extensions.code`.

## CLI

- `henri test` spawns the application's Vitest with `NODE_ENV=test` and exits with its code. Add `vitest` and `@usehenri/testing` to the devDependencies and a `vitest.config.js` (see [Testing](/guides/testing/)); `@usehenri/testing` exports `setup`, `teardown`, `request`, `agent` and `henri`.
- `henri build` builds the React views without booting the stores: it no longer needs a database.
- Generators write plural, unscoped resources (`Post` gives `app/controllers/posts.js`, `resources posts` and `app/views/pages/posts/`), answer validation errors with a 422 and pick attributes with `req.permit()`. Existing files are skipped unless `--force` is given. `generate controller` adds a route per action, `generate worker` and `generate test` are new, and `henri routes` prints the routes table.
- `utils.checkPackages()` never installs anything: it prints the install command and throws.

## Packages

- `@usehenri/mailer` and `@usehenri/websocket` are not published; the mailer lives in core (`henri.mail`).
- `express-session` is a peer dependency of `@usehenri/sequelize` and `@usehenri/mongoose` (core depends on it, so applications need nothing).
- `BaseModule` lost its unused `setup()`, `start()` and `info()` stubs. Custom store adapters must implement the [adapter contract](/reference/api/#store-adapters): `getSessionConnector()` is async and `findUserByEmail`, `findUserById`, `userId` and `toPlain` are required.
