# Change Log

## 1.1.0

### Minor Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - React engine, `withHenri` and forms reworked against Next.js 16 and React 19.
  
  Engine
  
  - Fast Refresh works again: the engine hands henri's http server to `next()`
    (`httpServer`) instead of forwarding websocket upgrades itself, which made
    next.js handle each upgrade twice and drop the connection.
  - `require('@usehenri/react/engine').build({ cwd, config })` runs `next build`
    without booting henri (no stores, no server), for `henri build` and Docker
    build stages. The `distDir` of `config/next.js` is honoured when checking for
    an existing production build.
  - `init()` fails with a clear message when `app/views/pages` is missing and
    warns when `app/views/app` exists (pages router only). `reload()` announces
    that `config/next.js`/`config/webpack.js` changes need a restart; `close()`
    stops the next.js instance.
  - A broken `config/webpack.js` hook throws (with the explanation) instead of
    killing the build workers with `process.exit`.
  
  withHenri
  
  - Client-side navigation fetches `asPath` (the real url, query included) as
    JSON instead of the page file path.
  - Server side reads only what henri attached to the request (`req._henri`);
    `?data=` and friends in the url can no longer become page props.
  - `WithHenri` is a function component: `data` follows the props on navigation,
    `hydrate()` keeps the current data on a non-henri answer and exposes the
    error as `useHenri().error`. `errors`, `graphql`, `csrf` and `localUrl` reach
    the page and the context.
  - axios is gone: `fetch()`, `hydrate()` and navigation go through one native
    `fetch` helper (`request`) sending `Accept: application/json`, JSON bodies
    and the `X-CSRF-Token` header when a `csrf` token is present. Failed
    requests reject with a `RequestError` carrying the boom body (`message`,
    `data`, `statusCode`). `fetch()` accepts a `pathFor()` result or a string.
  - `pathFor`/`getRoute` replace whole parameter names (`:id` no longer rewrites
    `:identifier`).
  
  Forms
  
  - `Editor` loads Quill with `next/dynamic` (no hydration mismatch) and is
    controlled by the form data, so `clear()` empties it.
  - Sanitizers chain (`trim` then `escape`), are registered in an effect, and
    apply to nested names. The form stays disabled until the request settles.
  - `Select` renders a real placeholder option, honours `validation` and shows
    its error; server-side field errors (`data.errors` of a 422) are displayed
    under the fields. `Form action` accepts a `pathFor()` result.
  - `prop-types` and `shallowequal` dropped.
  
  The `henri g scaffold` React templates are regenerated for this API
  (`pathFor`/`getRoute`, `next/link`, valid table markup, guarded show/edit,
  redirects after create/update).

### Patch Changes

- [#297](https://github.com/usehenri/henri/pull/297) [`36a096e`](https://github.com/usehenri/henri/commit/36a096e2ebe128aaa6aa00c1988fe42da3a86a5e) Thanks [@reel](https://github.com/reel)! - Login, sessions and request parameters are hardened and work on every adapter.
  
  - User lookups go through the adapter contract (`findUserByEmail`, `findUserById`, `userId`, `toPlain`, with Mongoose/Sequelize fallbacks in core), so login on SQL stores checks the right user and sessions hold the right id. `henri.user.findByEmail()`, `findById()` and `publicUser()` are exposed to apps.
  - Only the public representation of a user (`{ id, email, roles }` plus `config.user.public`) reaches views, `req._henri.user` and JSON answers. `config.user` accepts an object: `{ model, public, loginPath, afterLogin, sessionMaxAge }`.
  - `req.permit(...fields)` and `henri.params(req).permit()` return the permitted fields only; use them instead of `req.body` when creating or updating records.
  - The session cookie is `httpOnly`, `SameSite=Lax`, `Secure` in production, lives 30 days by default (`config.user.sessionMaxAge`) and is only written once something is stored in it. `trust proxy` is enabled (`config.trustProxy`).
  - `POST /login` answers `{ user }` to JSON clients and redirects browsers (`config.user.afterLogin`); failures are `401`/`400` or a redirect to `<loginPath>?error=invalid`. `POST /logout` destroys the session; `GET /logout` is deprecated and answers `405`.
  - Double-submit CSRF protection: the `henri.csrf` cookie must be sent back as `X-CSRF-Token` (or `X-XSRF-TOKEN`, the axios/Inertia convention) or `_csrf` on unsafe requests carrying a session (`config.csrf: false` disables it, bearer tokens are exempt). The token is available as `req._henri.csrf` and `withHenri` adds the header to `fetch()` and `hydrate()`.
  - Routes with `roles` deny with `401`/`403` JSON or a redirect to `config.user.loginPath`, and warn at boot when no user model exists instead of crashing per request.
  - The session store survives model reloads: express-session talks to a proxy that follows the current adapter.

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

**Note:** Version bump only for package @usehenri/react





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)


### Bug Fixes

* **react:** specify display name ([420a3cd](https://github.com/usehenri/henri/commit/420a3cd))





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)


### Features

* **react:** adding support for nested objects in forms ([12ad58c](https://github.com/usehenri/henri/commit/12ad58c))





## [0.36.5](https://github.com/usehenri/henri/compare/v0.36.4...v0.36.5) (2019-09-23)

**Note:** Version bump only for package @usehenri/react





## [0.36.4](https://github.com/usehenri/henri/compare/v0.36.3...v0.36.4) (2019-09-18)

**Note:** Version bump only for package @usehenri/react





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)


### Bug Fixes

* **react:** pathFor was not replacing all placeholders ([1158d07](https://github.com/usehenri/henri/commit/1158d07))
* **react:** show react and nextjs version ([4920977](https://github.com/usehenri/henri/commit/4920977))





## [0.35.2](https://github.com/usehenri/henri/compare/v0.35.1...v0.35.2) (2019-07-04)

**Note:** Version bump only for package @usehenri/react





## [0.35.1](https://github.com/usehenri/henri/compare/v0.35.0...v0.35.1) (2019-06-28)

**Note:** Version bump only for package @usehenri/react





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/react





## [0.34.7](https://github.com/usehenri/henri/compare/v0.34.6...v0.34.7) (2019-06-10)

**Note:** Version bump only for package @usehenri/react





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)


### Bug Fixes

* **react:** webpack config should not return a promise ([b7f29e2](https://github.com/usehenri/henri/commit/b7f29e2))





## [0.34.6-alpha.0](https://github.com/usehenri/henri/compare/v0.34.5...v0.34.6-alpha.0) (2019-04-22)

**Note:** Version bump only for package @usehenri/react





## [0.34.5](https://github.com/usehenri/henri/compare/v0.34.4...v0.34.5) (2019-04-18)

**Note:** Version bump only for package @usehenri/react





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.3...v0.34.4-alpha.4) (2019-03-28)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.1](https://github.com/usehenri/henri/compare/v0.34.4-alpha.0...v0.34.4-alpha.1) (2018-12-13)

**Note:** Version bump only for package @usehenri/react





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/react





## [0.34.3](https://github.com/usehenri/henri/compare/v0.34.2...v0.34.3) (2018-11-06)

**Note:** Version bump only for package @usehenri/react





## [0.34.2](https://github.com/usehenri/henri/compare/v0.34.1...v0.34.2) (2018-10-31)


### Features

* **cli:** adding build command to CLI ([d805bca](https://github.com/usehenri/henri/commit/d805bca))





## [0.34.1](https://github.com/usehenri/henri/compare/v0.34.0...v0.34.1) (2018-10-31)


### Bug Fixes

* **react:** pathFor was requiring an object, and converting this object toString ([d3f7a14](https://github.com/usehenri/henri/commit/d3f7a14))





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)


### Bug Fixes

* **react:** prevent error when radio buttons don't have errors... ([c103aa0](https://github.com/usehenri/henri/commit/c103aa0))
* **websocket:** disable websocket client-side until a good solution is available ([121c17d](https://github.com/usehenri/henri/commit/121c17d))





## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)


### Bug Fixes

* **react:** user should be null ([789af99](https://github.com/usehenri/henri/commit/789af99))





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)


### Features

* **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/react





## [0.31.1](https://github.com/usehenri/henri/compare/v0.31.0...v0.31.1) (2018-10-17)


### Bug Fixes

* **react:** better onError message management ([8783845](https://github.com/usehenri/henri/commit/8783845))





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)


### Bug Fixes

* **react:** better handling of onError and onSuccess in forms ([fd139da](https://github.com/usehenri/henri/commit/fd139da))





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/react





<a name="0.29.3"></a>
## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

**Note:** Version bump only for package @usehenri/react





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)


### Features

* **react:** support for webpack 4 (nextjs 6.1.1) + yalc ([3f72f38](https://github.com/usehenri/henri/commit/3f72f38))





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)




**Note:** Version bump only for package @usehenri/react

<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)


### Bug Fixes

* **react:** new builder location was wrong for production ([bf7fe8d](https://github.com/usehenri/henri/commit/bf7fe8d))


### Features

* **react:** add --force-build for views ([271ee77](https://github.com/usehenri/henri/commit/271ee77)), closes [#53](https://github.com/usehenri/henri/issues/53)
* **react:** production build if needed only ([9f6e243](https://github.com/usehenri/henri/commit/9f6e243)), closes [#53](https://github.com/usehenri/henri/issues/53)




<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)


### Bug Fixes

* **react:** remove react-hot-loader ([1aa8795](https://github.com/usehenri/henri/commit/1aa8795))




<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)


### Features

* **react:** support for upcoming next 6.0.4 ([eca4f66](https://github.com/usehenri/henri/commit/eca4f66))




<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/react

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)


### Bug Fixes

* **react:** BYO react and packages upgrade ([ea8ba47](https://github.com/usehenri/henri/commit/ea8ba47))
* **react:** match nextjs babel tooling versions ([08bc7ed](https://github.com/usehenri/henri/commit/08bc7ed))


### Features

* **react:** add modified state to form context ([e5e3922](https://github.com/usehenri/henri/commit/e5e3922))




<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/react

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)




**Note:** Version bump only for package @usehenri/react

<a name="0.21.3"></a>
## [0.21.3](https://github.com/usehenri/henri/compare/v0.21.2...v0.21.3) (2018-04-10)




**Note:** Version bump only for package @usehenri/react

<a name="0.21.2"></a>
## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)


### Bug Fixes

* **react:** moving react engine to react package... nextjs lifting ([c90fa4c](https://github.com/usehenri/henri/commit/c90fa4c))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Bug Fixes

* **react:** display initial value in editor ([a6ec701](https://github.com/usehenri/henri/commit/a6ec701))
* **react:** move files to src/ to harmonize with TypeScript integration ([683d36e](https://github.com/usehenri/henri/commit/683d36e))
* **react:** routes not working well ([a3ce9a7](https://github.com/usehenri/henri/commit/a3ce9a7))


### Features

* **react:** adding package deps and removing /_data/ calls ([c67696e](https://github.com/usehenri/henri/commit/c67696e))
* **react:** this will likely change in the future; refetch data if we use client-side router ([f49f18a](https://github.com/usehenri/henri/commit/f49f18a))
* **websocket:** add ws support with socket.io - closes [#35](https://github.com/usehenri/henri/issues/35) ([2318924](https://github.com/usehenri/henri/commit/2318924))




<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)


### Bug Fixes

* **cli:** helper header is a function ([33ed0b9](https://github.com/usehenri/henri/commit/33ed0b9))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **react:** add a helper to render named routes (pathFor) ([952a16c](https://github.com/usehenri/henri/commit/952a16c))


### Performance Improvements

* **react:** uglify distributed libraries ([3e72b49](https://github.com/usehenri/henri/commit/3e72b49))




<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Features

* **react:** adding custom methods to form and fetch ([df011c6](https://github.com/usehenri/henri/commit/df011c6))
* **react:** adding withHenri HOC and forms components (WIP) ([9953147](https://github.com/usehenri/henri/commit/9953147))
* **react:** change fetchData to hydrate, and add a fetch method ([b35a5c6](https://github.com/usehenri/henri/commit/b35a5c6))
* **react:** forms component ([418dc2d](https://github.com/usehenri/henri/commit/418dc2d))
* **react:** withHenri HOC to help fetch data ([1273c8d](https://github.com/usehenri/henri/commit/1273c8d))
