# Change Log

## 1.1.0

### Minor Changes

- [#303](https://github.com/usehenri/henri/pull/303) [`f8ad32f`](https://github.com/usehenri/henri/commit/f8ad32fd996560337bda5f87332ecab4e5902ce9) Thanks [@reel](https://github.com/reel)! - henri is now agent-friendly: every new application gets an `AGENTS.md` stating
  the conventions (layout, naming, generators, the model format, controllers,
  routes, configuration, tests, commands and exit codes, a do-not list), a
  `CLAUDE.md` pointing to it and a `.mcp.json` starting the new MCP server.
  `henri generate agents` writes them into an existing application.
  
  `--json` everywhere: `henri help --json` (the catalogue of commands, flags and
  exit codes), `henri about --json`, `henri routes --json`, `henri generate` and
  `henri destroy --json` (the files written or removed and the routes changed),
  `henri doctor --json`, and every error printed as
  `{ "error": { command, message, hint, code, exitCode } }` on stderr. Exit codes
  are stable and documented in `henri help`: 0 ok, 1 failed, 2 usage error, 3 not
  a henri application, 4 a prompt was needed without a terminal.
  `henri clean` takes `--all`, `-y`/`--yes` or the folder names and fails fast
  with a hint when stdin is not a terminal.
  
  `henri doctor` checks the application against the conventions without
  starting it: model files singular and PascalCase, controllers lowercase and
  routed, every `resources` route backed by a controller, its actions and its
  pages, `.env` present and ignored by git, no `secret` in `config/*.json`,
  `AGENTS.md` and `vitest.config.js` present, dependencies declared and
  installed. It exits with 1 when a problem is found.
  
  `@usehenri/mcp` (`henri mcp`) is a stdio MCP server exposing the tools
  `routes`, `models`, `controllers`, `config` (secrets redacted), `generate`,
  `destroy`, `test`, `lint` and `doctor`, and the resources `henri://agents.md`,
  `henri://conventions`, `henri://routes` and `henri://help`. No shell, paths
  confined to the application, generators as the only write path.

- [#308](https://github.com/usehenri/henri/pull/308) [`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f) Thanks [@reel](https://github.com/reel)! - The JSON API follows HATEOAS (HAL), honours `Idempotency-Key`, is rate limited and picks up the Rails request conventions.
  
  - `res.resource(record, { type, links, status })` and `res.collection(records, { type, page, perPage, total, links })` answer HAL: the public fields plus `_links` (`self`, `collection`, `edit`, `update`, `destroy`; `first`/`prev`/`next`/`last`, `create`, `new` on collections) built from the router's path helpers and filtered by the roles of the current user. Collections embed their items under `_embedded.<type>`, carry `count`, `page`, `perPage`, `total` and the `Link` / `X-Total-Count` headers. `application/hal+json` is served when asked for, `application/json` otherwise; a 201 sets `Location`. `res.negotiate({ html, json })` picks the page or the JSON answer. The JSON branch of `res.render()` keeps its shape and gains `_links`. Routes expanded from `resources`/`crud` that answer JSON without `_links` are reported once per route, and refused (500) when `config.api.strict` is true.
  - `Idempotency-Key` on POST, PUT, PATCH and DELETE routes (Stripe semantics): the first answer is stored for `config.api.idempotency.ttl` (24h) and replayed with `Idempotency-Replayed: true`; a key still in flight answers 409, a key reused with another request 422. Keys are scoped per user, session or ip. `idempotent: false` opts a route out; `henri.api.idempotencyStore` (`{ get, set, delete }`) or `config.api.idempotency.store` plug a shared store.
  - Rate limiting (express-rate-limit, `RateLimit`/`RateLimit-Policy` draft-7 headers, `Retry-After`, 429 through `res.boom.tooManyRequests`): `config.rateLimit` (`{ windowMs: 60000, max: 600 }`, per user or ip, not enforced in development), `POST /login` and the register-style paths at 10 per minute (`config.rateLimit.auth`), and `rateLimit: { windowMs, max }` per route. `config.rateLimit.store` plugs a shared store.
  - `X-Request-Id` is accepted or generated, exposed as `req.id`, echoed on every answer and written in every `pen` line of the request. Helmet secure headers (`config.helmet`) with a CSP that lets Next dev, Turbopack and Vite HMR work in development. `config.filterParameters` (`password`, `token`, `secret`, `authorization`) are masked in everything `pen` prints. Weak ETags and `If-None-Match` → 304 on JSON. `req.pagination()` reads `page` and `per_page` (bounded by `config.api.maxPerPage`). `Accept: application/vnd.henri.v1+json` sets `req.apiVersion`, and the `version` route option refuses other versions with a 406. `GET /_henri/health` pings the stores (200 or 503). `Cache-Control: no-store` on authenticated JSON. `config.bodyLimit` (1mb) and `config.requestTimeout` (30s, 503).
  - `henri generate scaffold|crud` write controllers using `res.resource`/`res.collection`, `req.pagination()` and `req.permit()`, with a 201 + `Location` on create and a 204 on destroy; `henri generate test <name>` checks the HAL links when the name has a `resources`/`crud` route.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - CLI: `henri routes` prints the routes table from `config/routes.js` without starting the server, `henri --version` prints the version, `henri <command> --help` prints the help of every command without running it, and a failing command prints its error instead of the generic help.
  
  Generators: `generate scaffold|crud` write controllers on the Mongoose 9 API (`findById`, `findByIdAndUpdate` with `runValidators`, `findByIdAndDelete`), answer validation errors with a 422, missing documents with a 404, pick the attributes with `req.permit()` and answer HTML or JSON through `res.format`. Resources are plural and unscoped (`Post` gives `app/controllers/posts.js`, `resources posts`, `app/views/pages/posts/`). `generate model` validates the attribute types (`string|text|number|integer|float|boolean|date|json|uuid`, `!` for required). `generate controller` adds one route per action and `destroy controller` removes them. New `generate worker` and `generate test` (with the matching `destroy` targets). Existing files are skipped unless `--force` is given.
  
  `henri build` builds the React views through `@usehenri/react/engine` without booting the stores.
  
  `henri new`: `git init` (skipped inside a repository or with `--no-git`), a README, `config/default.json` without the secret (committed) and the secret in `.env` (`HENRI_SECRET`, ignored), a `Task` scaffold with a controller, pages and a `test/tasks.test.js` using `@usehenri/testing`. `init` names the project after the folder, `pnpm-workspace.yaml` is only written for pnpm and exit codes are positive.

- [#305](https://github.com/usehenri/henri/pull/305) [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4) Thanks [@reel](https://github.com/reel)! - New `@usehenri/drizzle` store adapter on Drizzle ORM: sqlite (better-sqlite3), postgres (pg) and mysql (mysql2) behind one Rails-like model API. An app selects it with `"stores": { "default": { "adapter": "drizzle", "dialect": "sqlite", "url": "file:.henri/app.db" } }` and installs the driver it needs.
  
  - Models compile the henri model format (`string|text|number|integer|float|boolean|date|json|uuid`, `required`, `default`, `enum`, `unique`, `index`, plus `select: false`, `min`, `max`, `minLength`, `maxLength`, `match`, `validate`, `lowercase`, `trim`, `references`) into Drizzle tables per dialect: plural snake_case tables, snake_case columns, `id` primary keys, `createdAt`/`updatedAt` with `options.timestamps`, pg enum types and mysql enums.
  - Model API: `create`, `find`, `findOne`, `findById`, `all`, `count`, `exists`, `pluck`, `update`, `destroy`, `findByIdAndUpdate`, `findByIdAndDelete`, `findOneAndUpdate`, `findOneAndDelete` and their Mongoose and Sequelize aliases; lazy chains `where().order().limit().offset().include().withHidden().first()/last()/count()`; instances with `save`, `update`, `destroy`, `reload`, `changed`, `toJSON`; `ValidationError` with `errors[field].message` (the shape the generated controllers read), unique violations included; `beforeValidate`, `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDestroy`, `afterDestroy` hooks; `belongsTo`, `hasMany`, `hasOne` in `associate(models)` with eager loading through `include()`; `adapter.transaction(fn)` with implicit joining.
  - User model: `email` unique, lowercased, trimmed and validated; `password` hashed on create and on every update that sets it, never selected by default; `roles` JSON, dropped from mass assignment unless `{ unsafe: true }`, `user.hasRole()`, `user.setRoles()`, `User.setRoles(id, roles)`.
  - Sessions: an express-session store on a `henri_sessions` table (get/set/destroy/touch/all/clear/length, expiry with the cookie, periodic sweep).
  - Migrations in `db/migrations` (drizzle-kit layout): `henri db:generate`, `henri db:migrate`, `henri db:push`, `henri db:status` (`henri db <command>` works too). Development boots push the schema unless the store sets `"sync": false`; production boots apply the migrations with `"migrate": true` and warn about pending ones otherwise.
  - Core accepts `"adapter": "drizzle"`.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - New `@usehenri/inertia` view engine: the Inertia.js protocol on Vite with React 19 pages and server-side rendering, selected with `"renderer": "inertia"`. Pages read the controller data with `useHenri()`, navigate with `<Link>` and submit with `<Form>` through Inertia's router. `henri new <app> --renderer inertia` scaffolds an application using it; `henri build` produces the client and server bundles.

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Tests run on Vitest. `henri test` spawns the app's Vitest with `NODE_ENV=test`
  and exits with its code (extra arguments are passed through). `@usehenri/testing`
  boots the app in-process and exports `setup`, `teardown`, `request`, `agent` and
  `henri`, plus `@usehenri/testing/setup-file` for Vitest's `setupFiles` (henri and
  the model globals are available in every test file). The core `tests` module no
  longer loads jest at boot; jest is not a dependency anymore.

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - The published packages declare their `files`: the tarballs no longer ship the
  test suites and every package carries the LICENSE, a README and its changelog.
  `@usehenri/websocket` is no longer published (it was never wired into core).
- Updated dependencies [[`f99341c`](https://github.com/usehenri/henri/commit/f99341cdf05b9306bfca0c8385aee1661fc77f4f), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`a2cf383`](https://github.com/usehenri/henri/commit/a2cf383d6f3b4405b73816bc38175ad6f308dff4), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e), [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e)]:
  - @usehenri/core@1.1.0

## 1.0.2

### Patch Changes

- Updated dependencies [[`64f7356`](https://github.com/usehenri/henri/commit/64f73564802c156bad4fe0955a4d373a7f984363)]:
  - @usehenri/core@1.0.2

## 1.0.1

### Patch Changes

- [#287](https://github.com/usehenri/henri/pull/287) [`1f71bcb`](https://github.com/usehenri/henri/commit/1f71bcb8285e7853e7df15941dab02067cc9d219) Thanks [@reel](https://github.com/reel)! - `henri new` scaffolds apps that depend on the `@usehenri/*` packages at the CLI's own version instead of the 0.37 line, and the generated `pnpm-workspace.yaml` warns instead of failing when pnpm meets a transitive build script that is not allow-listed. `henri server` and `henri console` now run the `@usehenri/core` the app depends on when it has one, falling back to the CLI's own copy.
- Updated dependencies []:
  - @usehenri/core@1.0.1

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
  - @usehenri/core@1.0.0

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/cli





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)

**Note:** Version bump only for package @usehenri/cli





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/cli





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/cli





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/cli





## [0.36.3](https://github.com/usehenri/henri/compare/v0.36.2...v0.36.3) (2019-09-18)

**Note:** Version bump only for package @usehenri/cli





## [0.36.2](https://github.com/usehenri/henri/compare/v0.36.1...v0.36.2) (2019-09-04)

**Note:** Version bump only for package @usehenri/cli





## [0.36.1](https://github.com/usehenri/henri/compare/v0.36.0...v0.36.1) (2019-09-04)

**Note:** Version bump only for package @usehenri/cli





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)


### Bug Fixes

* **cli:** capitalize model name outside of scaffold ([e87ec2f](https://github.com/usehenri/henri/commit/e87ec2f))


### Features

* **cli:** add required option in generate script ([31ce3af](https://github.com/usehenri/henri/commit/31ce3af))





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)


### Bug Fixes

* **cli:** specify Prettier parser and fix the routes path. ([4295707](https://github.com/usehenri/henri/commit/4295707)), closes [#66](https://github.com/usehenri/henri/issues/66)


### Features

* **cli:** adding destroy (d) command ([bf036bc](https://github.com/usehenri/henri/commit/bf036bc)), closes [#67](https://github.com/usehenri/henri/issues/67)





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/cli





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/cli





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/cli





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **cli:** use yarn when available ([eee2c35](https://github.com/usehenri/henri/commit/eee2c35))


### Features

* **cli:** install react by default ([13314c1](https://github.com/usehenri/henri/commit/13314c1))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/cli





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.3](https://github.com/usehenri/henri/compare/v0.34.4-alpha.2...v0.34.4-alpha.3) (2019-02-15)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/cli





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/cli





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package @usehenri/cli





## [0.34.2](https://github.com/usehenri/henri/compare/v0.34.1...v0.34.2) (2018-10-31)


### Features

* **cli:** adding build command to CLI ([d805bca](https://github.com/usehenri/henri/commit/d805bca))





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)

**Note:** Version bump only for package @usehenri/cli





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)

**Note:** Version bump only for package @usehenri/cli





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)

**Note:** Version bump only for package @usehenri/cli





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Bug Fixes

* **cli:** removing start-henri.js (legacy) ([7f125c8](https://github.com/usehenri/henri/commit/7f125c8))


### Features

* **cli:** adding s cli shortcut for server ([e6b8547](https://github.com/usehenri/henri/commit/e6b8547))
* **router:** move routes to the config directory in template ([a0e6cde](https://github.com/usehenri/henri/commit/a0e6cde))
* **testing:** adding the base for user testing ([47c8e85](https://github.com/usehenri/henri/commit/47c8e85))
* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/cli





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.3"></a>
## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)

**Note:** Version bump only for package @usehenri/cli





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)


### Bug Fixes

* **cli:** adding vue js eslint support by default ([f98fd40](https://github.com/usehenri/henri/commit/f98fd40))





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)


### Bug Fixes

* **cli:** change the routes to something useful ([9e1fd33](https://github.com/usehenri/henri/commit/9e1fd33))
* **cli:** provide basic react eslint configuration on install ([7628d6e](https://github.com/usehenri/henri/commit/7628d6e))





<a name="0.29.2"></a>
## [0.29.2](https://github.com/usehenri/henri/compare/v0.29.1...v0.29.2) (2018-08-23)


### Bug Fixes

* **cli:** update nextjs related packages ([c853ce9](https://github.com/usehenri/henri/commit/c853ce9))





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

**Note:** Version bump only for package @usehenri/cli





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)


### Features

* **workers:** add the --skip-workers flag to run without workers ([d21e913](https://github.com/usehenri/henri/commit/d21e913))




<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Features

* **react:** add --force-build for views ([271ee77](https://github.com/usehenri/henri/commit/271ee77)), closes [#53](https://github.com/usehenri/henri/issues/53)
* **workers:** add the workers module ([816e24e](https://github.com/usehenri/henri/commit/816e24e))




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)




**Note:** Version bump only for package @usehenri/cli

<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/cli

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/cli

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **cli:** about command was not using promises ([cc3e727](https://github.com/usehenri/henri/commit/cc3e727))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/cli

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Features

* **cli:** return a function (better tests) ([292e111](https://github.com/usehenri/henri/commit/292e111))




<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **cli:** better packages usage ([4eaae0f](https://github.com/usehenri/henri/commit/4eaae0f))




<a name="0.21.1"></a>
## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)




**Note:** Version bump only for package @usehenri/cli

<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **cli:** about command not working well ([3d12d17](https://github.com/usehenri/henri/commit/3d12d17))
* **cli:** about was failing on windows, using cross-spawn ([ee80cf2](https://github.com/usehenri/henri/commit/ee80cf2))
* **cli:** add back the console only startup mode ([4c915be](https://github.com/usehenri/henri/commit/4c915be))
* **cli:** add crud to the help message ([1616527](https://github.com/usehenri/henri/commit/1616527))
* **cli:** better about! ([f86e7b4](https://github.com/usehenri/henri/commit/f86e7b4))
* **cli:** data should be present in the return (data or graphql) ([5bc73a2](https://github.com/usehenri/henri/commit/5bc73a2))


### Features

* **cli:** adding --debug and --production flags ([7794837](https://github.com/usehenri/henri/commit/7794837))
* **cli:** inspect flag -- works really well with vscode ([e2feae6](https://github.com/usehenri/henri/commit/e2feae6))
* **cli:** we now depend on [@usehenri](https://github.com/usehenri)/core mainly ([1453067](https://github.com/usehenri/henri/commit/1453067))
* **core:** consolidating core ([9f72b35](https://github.com/usehenri/henri/commit/9f72b35))
* **core:** moving things to core. adding modules ([14a8c5c](https://github.com/usehenri/henri/commit/14a8c5c))




<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)


### Bug Fixes

* **cli:** helper header is a function ([33ed0b9](https://github.com/usehenri/henri/commit/33ed0b9))




<a name="0.20.1"></a>
## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)


### Bug Fixes

* **view:** seems like yarn workspaces broke next packages resolution. i don't get it. ([073d40a](https://github.com/usehenri/henri/commit/073d40a))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **router:** go back to :id params ([26e19d4](https://github.com/usehenri/henri/commit/26e19d4))




<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Bug Fixes

* **cli:** remove the logs also, and recreate directory ([ca13738](https://github.com/usehenri/henri/commit/ca13738))


### Features

* **cli:** add the generate crud cli ([f20f4d1](https://github.com/usehenri/henri/commit/f20f4d1))
* **cli:** adding generators for models and controllers ([64ea839](https://github.com/usehenri/henri/commit/64ea839))
* **cli:** adding show view to scaffold ([839d510](https://github.com/usehenri/henri/commit/839d510))
* **cli:** adding the about command ([aac06a2](https://github.com/usehenri/henri/commit/aac06a2))
* **cli:** adding the edit page to scaffold ([05393aa](https://github.com/usehenri/henri/commit/05393aa))
* **cli:** adding the scaffold command! generates a small MVC [WIP] ([23e4f6e](https://github.com/usehenri/henri/commit/23e4f6e))
* **user:** add roles support (mongoose) ([4bb0f59](https://github.com/usehenri/henri/commit/4bb0f59))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)




**Note:** Version bump only for package @usehenri/cli

<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Bug Fixes

* **cli:** boilerplate package.json was old ([173c712](https://github.com/usehenri/henri/commit/173c712))


### Features

* **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
* **user:** add support for custom user model (defaults to 'user' ([5180d61](https://github.com/usehenri/henri/commit/5180d61))




<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package @usehenri/cli

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)


### Features

* **cli:** adding clean command ([ed90bf7](https://github.com/usehenri/henri/commit/ed90bf7))
* **cli:** adding react by default (next) ([4716354](https://github.com/usehenri/henri/commit/4716354))
* **cli:** check if it's a valid henri installation ([240d009](https://github.com/usehenri/henri/commit/240d009))




<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)


### Bug Fixes

* **cli:** process.exit should return 1 on fail ([841c0da](https://github.com/usehenri/henri/commit/841c0da))



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Features

* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))



<a name="0.15.0"></a>
# 0.15.0 (2017-07-05)


### Bug Fixes

* **server:** fix static files being served in the wrong folder ([5b58ad8](https://github.com/usehenri/henri/commit/5b58ad8))



<a name="0.14.0"></a>
# 0.14.0 (2017-07-05)



<a name="0.13.1"></a>
## 0.13.1 (2017-07-05)


### Bug Fixes

* **server:** moved error handler but port is out of scope. fixing. ([5916aaf](https://github.com/usehenri/henri/commit/5916aaf))



<a name="0.13.0"></a>
# 0.13.0 (2017-07-05)



<a name="0.12.0"></a>
# 0.12.0 (2017-07-05)


### Features

* **henri:** removing nodemon, long live hot reload.. ([62e8018](https://github.com/usehenri/henri/commit/62e8018))



<a name="0.11.0"></a>
# 0.11.0 (2017-07-05)


### Bug Fixes

* **config:** early log registration and addModule global ([d4e5c88](https://github.com/usehenri/henri/commit/d4e5c88))
* **view:** fix resolvers to use package deps ([cadc666](https://github.com/usehenri/henri/commit/cadc666)), closes [#15](https://github.com/usehenri/henri/issues/15)



<a name="0.10.0"></a>
# 0.10.0 (2017-07-05)



<a name="0.9.3"></a>
## 0.9.3 (2017-07-05)



<a name="0.9.0-alpha.7"></a>
# 0.9.0-alpha.7 (2017-07-05)


### Bug Fixes

* **cli:** do nothing when name does not resolve ([6aff9be](https://github.com/usehenri/henri/commit/6aff9be))


### Features

* **cli:** add the console ([d9e4098](https://github.com/usehenri/henri/commit/d9e4098))
* **cli:** adding cli ([50dbe5a](https://github.com/usehenri/henri/commit/50dbe5a))
* **cli:** adding the new command ([3a83e68](https://github.com/usehenri/henri/commit/3a83e68))
* **cli:** adding the pages and components folders to template ([f544ad9](https://github.com/usehenri/henri/commit/f544ad9))
