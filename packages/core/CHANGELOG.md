# Change Log

## 1.1.0

### Minor Changes

- [#308](https://github.com/usehenri/henri/pull/308) [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f) Thanks [@reel](https://github.com/reel)! - The JSON API follows HATEOAS (HAL), honours `Idempotency-Key`, is rate limited and picks up the Rails request conventions.
  
  - `res.resource(record, { type, links, status })` and `res.collection(records, { type, page, perPage, total, links })` answer HAL: the public fields plus `_links` (`self`, `collection`, `edit`, `update`, `destroy`; `first`/`prev`/`next`/`last`, `create`, `new` on collections) built from the router's path helpers and filtered by the roles of the current user. Collections embed their items under `_embedded.<type>`, carry `count`, `page`, `perPage`, `total` and the `Link` / `X-Total-Count` headers. `application/hal+json` is served when asked for, `application/json` otherwise; a 201 sets `Location`. `res.negotiate({ html, json })` picks the page or the JSON answer. The JSON branch of `res.render()` keeps its shape and gains `_links`. Routes expanded from `resources`/`crud` that answer JSON without `_links` are reported once per route, and refused (500) when `config.api.strict` is true.
  - `Idempotency-Key` on POST, PUT, PATCH and DELETE routes (Stripe semantics): the first answer is stored for `config.api.idempotency.ttl` (24h) and replayed with `Idempotency-Replayed: true`; a key still in flight answers 409, a key reused with another request 422. Keys are scoped per user, session or ip. `idempotent: false` opts a route out; `henri.api.idempotencyStore` (`{ get, set, delete }`) or `config.api.idempotency.store` plug a shared store.
  - Rate limiting (express-rate-limit, `RateLimit`/`RateLimit-Policy` draft-7 headers, `Retry-After`, 429 through `res.boom.tooManyRequests`): `config.rateLimit` (`{ windowMs: 60000, max: 600 }`, per user or ip, not enforced in development), `POST /login` and the register-style paths at 10 per minute (`config.rateLimit.auth`), and `rateLimit: { windowMs, max }` per route. `config.rateLimit.store` plugs a shared store.
  - `X-Request-Id` is accepted or generated, exposed as `req.id`, echoed on every answer and written in every `pen` line of the request. Helmet secure headers (`config.helmet`) with a CSP that lets Next dev, Turbopack and Vite HMR work in development. `config.filterParameters` (`password`, `token`, `secret`, `authorization`) are masked in everything `pen` prints. Weak ETags and `If-None-Match` → 304 on JSON. `req.pagination()` reads `page` and `per_page` (bounded by `config.api.maxPerPage`). `Accept: application/vnd.henri.v1+json` sets `req.apiVersion`, and the `version` route option refuses other versions with a 406. `GET /_henri/health` pings the stores (200 or 503). `Cache-Control: no-store` on authenticated JSON. `config.bodyLimit` (1mb) and `config.requestTimeout` (30s, 503).
  - `henri generate scaffold|crud` write controllers using `res.resource`/`res.collection`, `req.pagination()` and `req.permit()`, with a 201 + `Location` on create and a 204 on destroy; `henri generate test <name>` checks the HAL links when the name has a `resources`/`crud` route.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Login, sessions and request parameters are hardened and work on every adapter.
  
  - User lookups go through the adapter contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`, with Mongoose/Sequelize fallbacks in core), so login on SQL stores checks the right user and sessions hold the right id. `henri.user.findByEmail()`, `findById()` and `publicUser()` are exposed to apps.
  - Only the public representation of a user (`{ id, email, roles }` plus `config.user.public`) reaches views, `req._henri.user` and JSON answers. `config.user` accepts an object: `{ model, public, loginPath, afterLogin, sessionMaxAge }`.
  - `req.permit(...fields)` and `henri.params(req).permit()` return the permitted fields only; use them instead of `req.body` when creating or updating records.
  - The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days by default (`config.user.sessionMaxAge`) and is only written once something is stored in it. `trust proxy` is enabled (`config.trustProxy`).
  - `POST /login` answers `{ user }` to JSON clients and redirects browsers (`config.user.afterLogin`); failures are `401`/`400` or a redirect to `<loginPath>?error=invalid`. `POST /logout` destroys the session; `GET /logout` is deprecated and answers `405`.
  - Double-submit CSRF protection: the `henri.csrf` cookie must be sent back as `X-CSRF-Token` (or `X-XSRF-TOKEN`, the axios/Inertia convention) or `_csrf` on unsafe requests carrying a session (`config.csrf: false` disables it, bearer tokens are exempt). The token is available as `req._henri.csrf` and `withHenri` adds the header to `fetch()` and `hydrate()`.
  - Routes with `roles` deny with `401`/`403` JSON or a redirect to `config.user.loginPath`, and warn at boot when no user model exists instead of crashing per request.
  - The session store survives model reloads: express-session talks to a proxy that follows the current adapter.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Lifecycle, HTTP and error-handling hardening of the core.
  
  - Errors are no longer swallowed: a misconfigured store, adapter, view or controller fails the boot with the original error (`henri.init()` rejects with an `Error` whose `cause` is the module error). `pen.fatal()` returns an `Error` to throw.
  - `henri.reload()` is serialized (a call during a reload queues exactly one more run) and only evicts the application's own files from the require cache. `henri.stop()` stops every module even when one fails and resolves with the array of errors. `SIGINT`/`SIGTERM` stop the server gracefully with a 5 s hard-exit timeout; a second signal exits at once.
  - HTTP: the server binds to `127.0.0.1` outside production (`config.host` or `HENRI_HOST` override it), CORS is opt-in (`config.cors`), `x-powered-by` is gone, `/_routes` and `/_controllers` are served only in development and only from loopback. Unmatched routes get a content-negotiated 404 and controller errors a logged, negotiated 500 (message and stack in development only).
  - Mailer: an SMTP/transport object always creates and verifies the transport; `"test"` uses an Ethereal account; `NODE_ENV=test` uses nodemailer's JSON transport unless `henri.forceMail` is set.
  - Handlebars engine: exact page resolution (`pages/<route>.{hbs,html,htm}` then `pages/<route>/index.*`), compiled-template cache invalidated on change and reload, 404 without a page, 500 with the stack logged on template errors, view options exposed as `@user`, `@paths`, `@query` data variables.
  - `graphql.run(query, variables, contextValue)` forwards a context to the resolvers.
  - Configuration: `.env` in the application directory is loaded on boot and `HENRI_SECRET` provides the `secret`.
  - `utils.checkPackages()` never installs anything: it prints the install command for the detected package manager (pnpm, yarn or npm) and throws.
  - The Vue renderer only loads with `experimental.vue: true`. `BaseModule` lost its unused `setup()`, `start()` and `info()` stubs.
  - Removed dependencies: `include-all`, `callsite`, `internal-ip`, `server-timings`, `lodash`, `@inquirer/prompts`, `cross-spawn`, `compare-versions`, `jest`.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - New `@usehenri/inertia` view engine: the Inertia.js protocol on Vite with React 19 pages and server-side rendering, selected with `"renderer": "inertia"`. Pages read the controller data with `useHenri()`, navigate with `<Link>` and submit with `<Form>` through Inertia's router. `henri new <app> --renderer inertia` scaffolds an application using it; `henri build` produces the client and server bundles.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Tests run on Vitest. `henri test` spawns the app's Vitest with `NODE_ENV=test`
  and exits with its code (extra arguments are passed through). `@usehenri/testing`
  boots the app in-process and exports `setup`, `teardown`, `request`, `agent` and
  `henri`, plus `@usehenri/testing/setup-file` for Vitest's `setupFiles` (henri and
  the model globals are available in every test file). The core `tests` module no
  longer loads jest at boot; jest is not a dependency anymore.

### Patch Changes

- [#305](https://github.com/usehenri/henri/pull/305) [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4) Thanks [@reel](https://github.com/reel)! - New `@usehenri/drizzle` store adapter on Drizzle ORM: sqlite (better-sqlite3), postgres (pg) and mysql (mysql2) behind one Rails-like model API. An app selects it with `"stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } }` and installs the driver it needs.
  
  - Models compile the henri model format (`string|text|number|integer|float|boolean|date|json|uuid`, `required`, `default`, `enum`, `unique`, `index`, plus `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim`, `references`) into Drizzle tables per dialect: plural snake_case tables, snake_case columns, `id` primary keys, `createdAt`/`updatedAt` with `options.timestamps`, pg enum types and mysql enums.
  - Model API: `create`, `find`, `findOne`, `findById`, `all`, `count`, `exists`, `pluck`, `update`, `destroy`, `findByIdAndUpdate`, `findByIdAndDelete`, `findOneAndUpdate`, `findOneAndDelete` and their Mongoose and Sequelize aliases; lazy chains `where().order().limit().offset().include().withHidden().first()/last()/count()`; instances with `save`, `update`, `destroy`, `reload`, `changed`, `toJSON`; `ValidationError` with `errors[field].message` (the shape the generated controllers read), unique violations included; `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy` hooks; `belongsTo`, `hasMany`, `hasOne` in `associate(models)` with eager loading through `include()`; `adapter.transaction(fn)` with implicit joining.
  - User model: `email` unique, lowercased, trimmed and validated; `password` hashed on create and on every update that sets it, never selected by default; `roles` JSON, dropped from mass assignment unless `{ unsafe: true }`, `user.hasRole()`, `user.setRoles()`, `User.setRoles(id, roles)`.
  - Sessions: an express-session store on a `henri_sessions` table (get/set/destroy/touch/all/clear/length, expiry with the cookie, periodic sweep).
  - Migrations in `db/migrations` (drizzle-kit layout): `henri db:generate`, `henri db:migrate`, `henri db:push`, `henri db:status` (`henri db <command>` works too). Development boots push the schema unless the store sets `"sync": false`; production boots apply the migrations with `"migrate": true` and warn about pending ones otherwise.
  - Core accepts `"adapter": "drizzle"`.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).

## 1.0.2

### Patch Changes

- [#289](https://github.com/usehenri/henri/pull/289) [`64f7356`](https://github.com/usehenri/henri/commit/64f73564802c156bad4fe0955a4d373a7f984363) Thanks [@reel](https://github.com/reel)! - Remove dependencies flagged by npm audit: `express-boom` (pulled in an unpatched `hoek`) is replaced by a small built-in `res.boom` helper with the same response shape, `node-notifier` is dropped (`pen.notify()` now prints to the console in development), and the React forms use `lodash/get` and `lodash/set` instead of the unpatched `lodash.set` package.

## 1.0.1

No changes in this release.

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

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/core





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)


### Features

* **core:** check the configuration syntax on boot ([a022475](https://github.com/usehenri/henri/commit/a022475))
* **core:** prettier for JSON syntax validation ([b882e95](https://github.com/usehenri/henri/commit/b882e95))
* **disk:** use local mongdb instead of disk ([#87](https://github.com/usehenri/henri/issues/87)) ([7ee22c0](https://github.com/usehenri/henri/commit/7ee22c0))





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/core





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/core





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/core





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package @usehenri/core





## [0.36.2](https://github.com/usehenri/henri/compare/v0.36.1...v0.36.2) (2019-09-04)


### Bug Fixes

* **core:** upgrade bounce to @hapi/bounce ([5c12326](https://github.com/usehenri/henri/commit/5c12326))





## [0.36.1](https://github.com/usehenri/henri/compare/v0.36.0...v0.36.1) (2019-09-04)


### Bug Fixes

* **core:** migrate from bcrypt-js to bcrypt ([89eccf3](https://github.com/usehenri/henri/commit/89eccf3))





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)

**Note:** Version bump only for package @usehenri/core





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package @usehenri/core





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/core





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/core





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/core





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **cli:** checks for yarn and min version ([3892f6b](https://github.com/usehenri/henri/commit/3892f6b))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/core





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/core





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.3](https://github.com/usehenri/henri/compare/v0.34.4-alpha.2...v0.34.4-alpha.3) (2019-02-15)


### Bug Fixes

* **graphql:** update the schema on hot reload. ([f3babdc](https://github.com/usehenri/henri/commit/f3babdc))





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/core





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)


### Bug Fixes

* **graphql:** migrating from runQuery to executeOperation ([9fe3081](https://github.com/usehenri/henri/commit/9fe3081))





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)


### Bug Fixes

* **router:** remove debug message ([f76ad37](https://github.com/usehenri/henri/commit/f76ad37))


### Features

* **graphql:** warn on graphql/models schema errors ([4a1509d](https://github.com/usehenri/henri/commit/4a1509d)), closes [#55](https://github.com/usehenri/henri/issues/55) [#44](https://github.com/usehenri/henri/issues/44)





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)


### Bug Fixes

* **henri:** lower limited runlevel warning ([5725183](https://github.com/usehenri/henri/commit/5725183))





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)


### Features

* **router:** name middlewares ([74c700c](https://github.com/usehenri/henri/commit/74c700c))
* **router:** on demand routes status (press U or R in console) ([4fb0791](https://github.com/usehenri/henri/commit/4fb0791))





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)


### Bug Fixes

* **router:** sending user as null ([14a241f](https://github.com/usehenri/henri/commit/14a241f))





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **router:** requiring `config/routes.js`, adding deprecation msg. ([44224f5](https://github.com/usehenri/henri/commit/44224f5))
* **testing:** adding the base for user testing ([47c8e85](https://github.com/usehenri/henri/commit/47c8e85))
* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)


### Features

* **graphql:** upgrade to latest version ([6ab85ad](https://github.com/usehenri/henri/commit/6ab85ad))





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)


### Bug Fixes

* **utils:** pass henri instance to syntax method ([ffb753f](https://github.com/usehenri/henri/commit/ffb753f))


### Features

* **routes:** adding paths to /_routes ([05d8668](https://github.com/usehenri/henri/commit/05d8668))





<a name="0.30.3"></a>
## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)


### Bug Fixes

* **router:** adding debug information ([f3b9817](https://github.com/usehenri/henri/commit/f3b9817))





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/core





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package @usehenri/core





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)


### Bug Fixes

* **router:** only give routes based on user roles ([7d63743](https://github.com/usehenri/henri/commit/7d63743))
* **user:** make sure req.user is not available ([7968dfa](https://github.com/usehenri/henri/commit/7968dfa))


### Features

* **router:** add the omit key -- closes [#43](https://github.com/usehenri/henri/issues/43) ([a8c8f4d](https://github.com/usehenri/henri/commit/a8c8f4d))





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)


### Bug Fixes

* **server:** do not watch lock files ([15f489e](https://github.com/usehenri/henri/commit/15f489e))
* **workers:** show that workers are disabled while reloading ([de0a7b5](https://github.com/usehenri/henri/commit/de0a7b5))


### Features

* **router:** experimental => try to extract data/gql from res.render ([8891d78](https://github.com/usehenri/henri/commit/8891d78))
* **workers:** add the --skip-workers flag to run without workers ([d21e913](https://github.com/usehenri/henri/commit/d21e913))




<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Bug Fixes

* **utils:** simplify prettier's parsing ([4f78611](https://github.com/usehenri/henri/commit/4f78611))


### Features

* **workers:** add the workers module ([816e24e](https://github.com/usehenri/henri/commit/816e24e))




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)


### Bug Fixes

* **react:** remove react-hot-loader ([1aa8795](https://github.com/usehenri/henri/commit/1aa8795))




<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/core

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)


### Bug Fixes

* **react:** missing packages in react template ([9dc57bd](https://github.com/usehenri/henri/commit/9dc57bd))




<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **core:** add mailer package optional on test (to speed up things) ([c655d11](https://github.com/usehenri/henri/commit/c655d11))
* **graphql:** small typo? ([a34192a](https://github.com/usehenri/henri/commit/a34192a))


### Features

* **core:** add res.hbs() to render handlebars templates ([26e432f](https://github.com/usehenri/henri/commit/26e432f))
* **graphql:** henri.gql should be accessible globally ([081473b](https://github.com/usehenri/henri/commit/081473b))
* **graphql:** upgrade to graphql-tools 3.0.0 ([15115b4](https://github.com/usehenri/henri/commit/15115b4))
* **mailer:** add mail feature, closes [#37](https://github.com/usehenri/henri/issues/37) ([ea67980](https://github.com/usehenri/henri/commit/ea67980))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)


### Bug Fixes

* **model:** throw errors instead of pen.fatal ([0a8700d](https://github.com/usehenri/henri/commit/0a8700d))


### Features

* **core:** show if booted from the global cli or not ([cf9f4d0](https://github.com/usehenri/henri/commit/cf9f4d0))




<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Bug Fixes

* **user:** failing to deserialize. need upcoming fix for disk ([7bd2f1c](https://github.com/usehenri/henri/commit/7bd2f1c))


### Features

* **cli:** return a function (better tests) ([292e111](https://github.com/usehenri/henri/commit/292e111))
* **core:** adding bounce to utils ([40b7671](https://github.com/usehenri/henri/commit/40b7671))
* **core:** better error handling ([2be66b6](https://github.com/usehenri/henri/commit/2be66b6))
* **model:** inject henri to the stores ([a32c29a](https://github.com/usehenri/henri/commit/a32c29a))
* **template:** using promise to read partials et al ([ca73cc1](https://github.com/usehenri/henri/commit/ca73cc1))
* **user:** session storage per database provider, closes [#34](https://github.com/usehenri/henri/issues/34) ([50d5831](https://github.com/usehenri/henri/commit/50d5831))




<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **core:** completion of react move -- cleaning packages ([d6ef57b](https://github.com/usehenri/henri/commit/d6ef57b))
* **react:** moving react engine to react package... nextjs lifting ([c90fa4c](https://github.com/usehenri/henri/commit/c90fa4c))




<a name="0.21.1"></a>
## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)


### Bug Fixes

* **core:** reordering packages ([de5655f](https://github.com/usehenri/henri/commit/de5655f))
* **view:** get next from the run dir ([e826ff9](https://github.com/usehenri/henri/commit/e826ff9))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **cli:** add back the console only startup mode ([4c915be](https://github.com/usehenri/henri/commit/4c915be))
* **core:** better watch support and no html file linting? ([086c221](https://github.com/usehenri/henri/commit/086c221))
* **core:** indentation problem ([bb16439](https://github.com/usehenri/henri/commit/bb16439))
* **core:** middleware switching ([7ea60f4](https://github.com/usehenri/henri/commit/7ea60f4))
* **core:** need to await init ([ff8aa9e](https://github.com/usehenri/henri/commit/ff8aa9e))
* **core:** template should use this.henri ([b3ecfde](https://github.com/usehenri/henri/commit/b3ecfde))
* **router:** starting view with await and fixing crud route building ([5a99857](https://github.com/usehenri/henri/commit/5a99857))
* **view:** call the engine init function, yep, call it ([a4b277b](https://github.com/usehenri/henri/commit/a4b277b))
* **view:** should call the good checkPackages? ([fc21732](https://github.com/usehenri/henri/commit/fc21732))


### Features

* **core:** adding a BaseModule; modules should extend this ([9705410](https://github.com/usehenri/henri/commit/9705410))
* **core:** adding all modules and moving middleware management ([54715d1](https://github.com/usehenri/henri/commit/54715d1))
* **core:** adding boom for better responses ([5b80ced](https://github.com/usehenri/henri/commit/5b80ced))
* **core:** consolidating core ([9f72b35](https://github.com/usehenri/henri/commit/9f72b35))
* **core:** correcting graphql target ([40c1eae](https://github.com/usehenri/henri/commit/40c1eae))
* **core:** graphql support ([53419e5](https://github.com/usehenri/henri/commit/53419e5))
* **core:** moving things to core. adding modules ([14a8c5c](https://github.com/usehenri/henri/commit/14a8c5c))
* **core:** moving view module ([11918bf](https://github.com/usehenri/henri/commit/11918bf))
* **core:** we no longer use config package ([86160d6](https://github.com/usehenri/henri/commit/86160d6))
* **view:** use handlebars instead of template literals, reload partials ([b0e16ab](https://github.com/usehenri/henri/commit/b0e16ab))
* **vue:** adding vue (nuxt.js) support to the new view handler ([05869b6](https://github.com/usehenri/henri/commit/05869b6))
