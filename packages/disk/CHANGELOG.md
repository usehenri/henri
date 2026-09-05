# Change Log

## 1.0.2

### Patch Changes

- Updated dependencies []:
  - @usehenri/mongoose@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies []:
  - @usehenri/mongoose@1.0.1

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
  - @usehenri/mongoose@1.0.0

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.37.2](https://github.com/usehenri/henri/compare/v0.37.1...v0.37.2) (2020-01-13)

**Note:** Version bump only for package @usehenri/disk





## [0.37.1](https://github.com/usehenri/henri/compare/v0.37.0...v0.37.1) (2019-12-24)


### Features

* **disk:** use local mongdb instead of disk ([#87](https://github.com/usehenri/henri/issues/87)) ([7ee22c0](https://github.com/usehenri/henri/commit/7ee22c0))





# [0.37.0](https://github.com/usehenri/henri/compare/v0.36.5...v0.37.0) (2019-09-23)

**Note:** Version bump only for package @usehenri/disk





# [0.36.0](https://github.com/usehenri/henri/compare/v0.35.2...v0.36.0) (2019-09-04)

**Note:** Version bump only for package @usehenri/disk





# [0.35.0](https://github.com/usehenri/henri/compare/v0.34.7...v0.35.0) (2019-06-19)

**Note:** Version bump only for package @usehenri/disk





## [0.34.6](https://github.com/usehenri/henri/compare/v0.34.6-alpha.0...v0.34.6) (2019-05-28)

**Note:** Version bump only for package @usehenri/disk





## [0.34.4](https://github.com/usehenri/henri/compare/v0.34.4-alpha.4...v0.34.4) (2019-04-12)

**Note:** Version bump only for package @usehenri/disk





## [0.34.4-alpha.2](https://github.com/usehenri/henri/compare/v0.34.4-alpha.1...v0.34.4-alpha.2) (2019-02-15)

**Note:** Version bump only for package @usehenri/disk





## [0.34.4-alpha.0](https://github.com/usehenri/henri/compare/v0.34.3...v0.34.4-alpha.0) (2018-12-03)

**Note:** Version bump only for package @usehenri/disk





# [0.34.0](https://github.com/usehenri/henri/compare/v0.33.1...v0.34.0) (2018-10-30)

**Note:** Version bump only for package @usehenri/disk





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)

**Note:** Version bump only for package @usehenri/disk





# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

**Note:** Version bump only for package @usehenri/disk





# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

**Note:** Version bump only for package @usehenri/disk





<a name="0.30.2"></a>
## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)


### Bug Fixes

* **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))





<a name="0.30.0"></a>
# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

**Note:** Version bump only for package @usehenri/disk





<a name="0.29.0"></a>
# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

**Note:** Version bump only for package @usehenri/disk





<a name="0.28.0"></a>
# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)


### Bug Fixes

* **disk:** add types for disk ([89599e8](https://github.com/usehenri/henri/commit/89599e8))




<a name="0.27.0"></a>
# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)




**Note:** Version bump only for package @usehenri/disk

<a name="0.26.1"></a>
## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)




**Note:** Version bump only for package @usehenri/disk

<a name="0.26.0"></a>
# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)




**Note:** Version bump only for package @usehenri/disk

<a name="0.25.0"></a>
# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)




**Note:** Version bump only for package @usehenri/disk

<a name="0.24.0"></a>
# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)




**Note:** Version bump only for package @usehenri/disk

<a name="0.23.0"></a>
# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)




**Note:** Version bump only for package @usehenri/disk

<a name="0.22.0"></a>
# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)


### Features

* **user:** session storage per database provider, closes [#34](https://github.com/usehenri/henri/issues/34) ([50d5831](https://github.com/usehenri/henri/commit/50d5831))




<a name="0.21.0"></a>
# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)


### Features

* **disk:** changing back to waterline and sails-disk ([aba475f](https://github.com/usehenri/henri/commit/aba475f))




<a name="0.20.2"></a>
## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)




**Note:** Version bump only for package @usehenri/disk

<a name="0.20.1"></a>
## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)


### Bug Fixes

* **view:** seems like yarn workspaces broke next packages resolution. i don't get it. ([073d40a](https://github.com/usehenri/henri/commit/073d40a))




<a name="0.20.0"></a>
# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)


### Features

* **disk:** using sequelize with sqlite ([4057150](https://github.com/usehenri/henri/commit/4057150))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)




**Note:** Version bump only for package @usehenri/disk

<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)




**Note:** Version bump only for package @usehenri/disk

<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package @usehenri/disk

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)




**Note:** Version bump only for package @usehenri/disk

<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Features

* **disk:** add support for disk ([aea281e](https://github.com/usehenri/henri/commit/aea281e))
* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))
