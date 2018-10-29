# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.33.1](https://github.com/usehenri/henri/compare/v0.33.0...v0.33.1) (2018-10-29)


### Bug Fixes

* **react:** user should be null ([789af99](https://github.com/usehenri/henri/commit/789af99))
* **router:** sending user as null ([14a241f](https://github.com/usehenri/henri/commit/14a241f))





# [0.33.0](https://github.com/usehenri/henri/compare/v0.32.0...v0.33.0) (2018-10-26)

### Bug Fixes

- **cli:** removing start-henri.js (legacy) ([7f125c8](https://github.com/usehenri/henri/commit/7f125c8))

### Features

- **ci:** stop testing against Node LTS for the moment ([1ae357f](https://github.com/usehenri/henri/commit/1ae357f))
- **cli:** adding s cli shortcut for server ([e6b8547](https://github.com/usehenri/henri/commit/e6b8547))
- **router:** move routes to the config directory in template ([a0e6cde](https://github.com/usehenri/henri/commit/a0e6cde))
- **router:** requiring `config/routes.js`, adding deprecation msg. ([44224f5](https://github.com/usehenri/henri/commit/44224f5))
- **testing:** adding the base for user testing ([47c8e85](https://github.com/usehenri/henri/commit/47c8e85))
- **testing:** adding the package ([e2ec87b](https://github.com/usehenri/henri/commit/e2ec87b))

# [0.32.0](https://github.com/usehenri/henri/compare/v0.31.1...v0.32.0) (2018-10-23)

### Features

- **graphql:** upgrade to latest version ([6ab85ad](https://github.com/usehenri/henri/commit/6ab85ad))

## [0.31.1](https://github.com/usehenri/henri/compare/v0.31.0...v0.31.1) (2018-10-17)

### Bug Fixes

- **react:** better onError message management ([8783845](https://github.com/usehenri/henri/commit/8783845))

# [0.31.0](https://github.com/usehenri/henri/compare/v0.30.3...v0.31.0) (2018-10-17)

### Bug Fixes

- **react:** better handling of onError and onSuccess in forms ([fd139da](https://github.com/usehenri/henri/commit/fd139da))
- **utils:** pass henri instance to syntax method ([ffb753f](https://github.com/usehenri/henri/commit/ffb753f))

### Features

- **routes:** adding paths to /\_routes ([05d8668](https://github.com/usehenri/henri/commit/05d8668))

<a name="0.30.3"></a>

## [0.30.3](https://github.com/usehenri/henri/compare/v0.30.2...v0.30.3) (2018-09-28)

### Bug Fixes

- **mongoose:** set correct henri instance ([80ceb57](https://github.com/usehenri/henri/commit/80ceb57))
- **router:** adding debug information ([f3b9817](https://github.com/usehenri/henri/commit/f3b9817))

<a name="0.30.2"></a>

## [0.30.2](https://github.com/usehenri/henri/compare/v0.30.1...v0.30.2) (2018-09-26)

### Bug Fixes

- **henri:** henri should be scoped and always referred internally as this.henri (avoids leaks in testing) ([b046cc4](https://github.com/usehenri/henri/commit/b046cc4))
- **henri:** using ecmaVersion 2018 for rest/spread support ([78f69d1](https://github.com/usehenri/henri/commit/78f69d1))

<a name="0.30.1"></a>

## [0.30.1](https://github.com/usehenri/henri/compare/v0.30.0...v0.30.1) (2018-09-26)

### Bug Fixes

- **mongoose:** fix henri.user encryption ([640d44a](https://github.com/usehenri/henri/commit/640d44a))

<a name="0.30.0"></a>

# [0.30.0](https://github.com/usehenri/henri/compare/v0.29.3...v0.30.0) (2018-09-26)

### Bug Fixes

- **cli:** adding vue js eslint support by default ([f98fd40](https://github.com/usehenri/henri/commit/f98fd40))

### Features

- **henri:** henri should be used with Node 10+ ([de18480](https://github.com/usehenri/henri/commit/de18480))

<a name="0.29.3"></a>

## [0.29.3](https://github.com/usehenri/henri/compare/v0.29.2...v0.29.3) (2018-08-29)

### Bug Fixes

- **cli:** change the routes to something useful ([9e1fd33](https://github.com/usehenri/henri/commit/9e1fd33))
- **cli:** provide basic react eslint configuration on install ([7628d6e](https://github.com/usehenri/henri/commit/7628d6e))

<a name="0.29.2"></a>

## [0.29.2](https://github.com/usehenri/henri/compare/v0.29.1...v0.29.2) (2018-08-23)

### Bug Fixes

- **cli:** update nextjs related packages ([c853ce9](https://github.com/usehenri/henri/commit/c853ce9))

<a name="0.29.1"></a>

## [0.29.1](https://github.com/usehenri/henri/compare/v0.29.0...v0.29.1) (2018-08-23)

**Note:** Version bump only for package henri

<a name="0.29.0"></a>

# [0.29.0](https://github.com/usehenri/henri/compare/v0.28.0...v0.29.0) (2018-08-23)

### Bug Fixes

- **router:** only give routes based on user roles ([7d63743](https://github.com/usehenri/henri/commit/7d63743))
- **user:** make sure req.user is not available ([7968dfa](https://github.com/usehenri/henri/commit/7968dfa))

### Features

- **react:** support for webpack 4 (nextjs 6.1.1) + yalc ([3f72f38](https://github.com/usehenri/henri/commit/3f72f38))
- **router:** add the omit key -- closes [#43](https://github.com/usehenri/henri/issues/43) ([a8c8f4d](https://github.com/usehenri/henri/commit/a8c8f4d))

<a name="0.28.0"></a>

# [0.28.0](https://github.com/usehenri/henri/compare/v0.27.0...v0.28.0) (2018-07-13)

### Bug Fixes

- **disk:** add types for disk ([89599e8](https://github.com/usehenri/henri/commit/89599e8))
- **mongoose:** specify a new parser ([67aa0c1](https://github.com/usehenri/henri/commit/67aa0c1))
- **server:** do not watch lock files ([15f489e](https://github.com/usehenri/henri/commit/15f489e))
- **workers:** show that workers are disabled while reloading ([de0a7b5](https://github.com/usehenri/henri/commit/de0a7b5))

### Features

- **router:** experimental => try to extract data/gql from res.render ([8891d78](https://github.com/usehenri/henri/commit/8891d78))
- **workers:** add the --skip-workers flag to run without workers ([d21e913](https://github.com/usehenri/henri/commit/d21e913))

<a name="0.27.0"></a>

# [0.27.0](https://github.com/usehenri/henri/compare/v0.26.1...v0.27.0) (2018-07-12)

### Bug Fixes

- **react:** new builder location was wrong for production ([bf7fe8d](https://github.com/usehenri/henri/commit/bf7fe8d))
- **utils:** simplify prettier's parsing ([4f78611](https://github.com/usehenri/henri/commit/4f78611))

### Features

- **react:** add --force-build for views ([271ee77](https://github.com/usehenri/henri/commit/271ee77)), closes [#53](https://github.com/usehenri/henri/issues/53)
- **react:** production build if needed only ([9f6e243](https://github.com/usehenri/henri/commit/9f6e243)), closes [#53](https://github.com/usehenri/henri/issues/53)
- **workers:** add the workers module ([816e24e](https://github.com/usehenri/henri/commit/816e24e))

<a name="0.26.1"></a>

## [0.26.1](https://github.com/usehenri/henri/compare/v0.26.0...v0.26.1) (2018-06-22)

### Bug Fixes

- **react:** remove react-hot-loader ([1aa8795](https://github.com/usehenri/henri/commit/1aa8795))

<a name="0.26.0"></a>

# [0.26.0](https://github.com/usehenri/henri/compare/v0.25.0...v0.26.0) (2018-06-21)

### Features

- **react:** support for upcoming next 6.0.4 ([eca4f66](https://github.com/usehenri/henri/commit/eca4f66))

<a name="0.25.0"></a>

# [0.25.0](https://github.com/usehenri/henri/compare/v0.24.0...v0.25.0) (2018-05-22)

### Bug Fixes

- **react:** missing packages in react template ([9dc57bd](https://github.com/usehenri/henri/commit/9dc57bd))

### Features

- **sequelize:** upgrading to 5.0.0-beta ([0173936](https://github.com/usehenri/henri/commit/0173936))

<a name="0.24.0"></a>

# [0.24.0](https://github.com/usehenri/henri/compare/v0.23.0...v0.24.0) (2018-05-11)

### Bug Fixes

- change travis.yml ([979ffe4](https://github.com/usehenri/henri/commit/979ffe4))
- **cli:** about command was not using promises ([cc3e727](https://github.com/usehenri/henri/commit/cc3e727))
- **core:** add mailer package optional on test (to speed up things) ([c655d11](https://github.com/usehenri/henri/commit/c655d11))
- **graphql:** small typo? ([a34192a](https://github.com/usehenri/henri/commit/a34192a))
- **react:** BYO react and packages upgrade ([ea8ba47](https://github.com/usehenri/henri/commit/ea8ba47))
- **react:** match nextjs babel tooling versions ([08bc7ed](https://github.com/usehenri/henri/commit/08bc7ed))

### Features

- **core:** add res.hbs() to render handlebars templates ([26e432f](https://github.com/usehenri/henri/commit/26e432f))
- **demo:** add dockerfile ([08760fc](https://github.com/usehenri/henri/commit/08760fc))
- **graphql:** henri.gql should be accessible globally ([081473b](https://github.com/usehenri/henri/commit/081473b))
- **graphql:** upgrade to graphql-tools 3.0.0 ([15115b4](https://github.com/usehenri/henri/commit/15115b4))
- **mailer:** add mail feature, closes [#37](https://github.com/usehenri/henri/issues/37) ([ea67980](https://github.com/usehenri/henri/commit/ea67980))
- **mongoose:** adding extra debugging info ([19ff28e](https://github.com/usehenri/henri/commit/19ff28e))
- **react:** add modified state to form context ([e5e3922](https://github.com/usehenri/henri/commit/e5e3922))

<a name="0.23.0"></a>

# [0.23.0](https://github.com/usehenri/henri/compare/v0.22.0...v0.23.0) (2018-04-23)

### Bug Fixes

- **model:** throw errors instead of pen.fatal ([0a8700d](https://github.com/usehenri/henri/commit/0a8700d))

### Features

- **core:** show if booted from the global cli or not ([cf9f4d0](https://github.com/usehenri/henri/commit/cf9f4d0))

<a name="0.22.0"></a>

# [0.22.0](https://github.com/usehenri/henri/compare/v0.21.3...v0.22.0) (2018-04-17)

### Bug Fixes

- **user:** failing to deserialize. need upcoming fix for disk ([7bd2f1c](https://github.com/usehenri/henri/commit/7bd2f1c))

### Features

- **cli:** return a function (better tests) ([292e111](https://github.com/usehenri/henri/commit/292e111))
- **core:** adding bounce to utils ([40b7671](https://github.com/usehenri/henri/commit/40b7671))
- **core:** better error handling ([2be66b6](https://github.com/usehenri/henri/commit/2be66b6))
- **demo:** adding a few more features ([cf5889d](https://github.com/usehenri/henri/commit/cf5889d))
- **model:** inject henri to the stores ([a32c29a](https://github.com/usehenri/henri/commit/a32c29a))
- **template:** using promise to read partials et al ([ca73cc1](https://github.com/usehenri/henri/commit/ca73cc1))
- **user:** session storage per database provider, closes [#34](https://github.com/usehenri/henri/issues/34) ([50d5831](https://github.com/usehenri/henri/commit/50d5831))

<a name="0.21.3"></a>

## [0.21.3](https://github.com/usehenri/henri/compare/v0.21.2...v0.21.3) (2018-04-10)

**Note:** Version bump only for package root

<a name="0.21.2"></a>

## [0.21.2](https://github.com/usehenri/henri/compare/v0.21.1...v0.21.2) (2018-04-10)

### Bug Fixes

- **cli:** better packages usage ([4eaae0f](https://github.com/usehenri/henri/commit/4eaae0f))
- **core:** completion of react move -- cleaning packages ([d6ef57b](https://github.com/usehenri/henri/commit/d6ef57b))
- **react:** moving react engine to react package... nextjs lifting ([c90fa4c](https://github.com/usehenri/henri/commit/c90fa4c))

<a name="0.21.1"></a>

## [0.21.1](https://github.com/usehenri/henri/compare/v0.21.0...v0.21.1) (2018-04-10)

### Bug Fixes

- **core:** reordering packages ([de5655f](https://github.com/usehenri/henri/commit/de5655f))
- **view:** get next from the run dir ([e826ff9](https://github.com/usehenri/henri/commit/e826ff9))

<a name="0.21.0"></a>

# [0.21.0](https://github.com/usehenri/henri/compare/v0.20.2...v0.21.0) (2018-04-10)

### Bug Fixes

- **cli:** about command not working well ([3d12d17](https://github.com/usehenri/henri/commit/3d12d17))
- **cli:** about was failing on windows, using cross-spawn ([ee80cf2](https://github.com/usehenri/henri/commit/ee80cf2))
- **cli:** add back the console only startup mode ([4c915be](https://github.com/usehenri/henri/commit/4c915be))
- **cli:** add crud to the help message ([1616527](https://github.com/usehenri/henri/commit/1616527))
- **cli:** better about! ([f86e7b4](https://github.com/usehenri/henri/commit/f86e7b4))
- **cli:** data should be present in the return (data or graphql) ([5bc73a2](https://github.com/usehenri/henri/commit/5bc73a2))
- **config:** load Log directly in class creation ([7beeba1](https://github.com/usehenri/henri/commit/7beeba1))
- **config:** using cross-spawn to harmonize usage ([9276b1f](https://github.com/usehenri/henri/commit/9276b1f))
- **core:** better watch support and no html file linting? ([086c221](https://github.com/usehenri/henri/commit/086c221))
- **core:** indentation problem ([bb16439](https://github.com/usehenri/henri/commit/bb16439))
- **core:** middleware switching ([7ea60f4](https://github.com/usehenri/henri/commit/7ea60f4))
- **core:** need to await init ([ff8aa9e](https://github.com/usehenri/henri/commit/ff8aa9e))
- **core:** template should use this.henri ([b3ecfde](https://github.com/usehenri/henri/commit/b3ecfde))
- **henri:** add cross-env to get env vars on windows.. ([e3af194](https://github.com/usehenri/henri/commit/e3af194))
- **log:** we can take a custom configuration ([b20275f](https://github.com/usehenri/henri/commit/b20275f))
- **mongoose:** use correct type of Numbers (Integers) ([844ca9d](https://github.com/usehenri/henri/commit/844ca9d))
- **react:** display initial value in editor ([a6ec701](https://github.com/usehenri/henri/commit/a6ec701))
- **react:** move files to src/ to harmonize with TypeScript integration ([683d36e](https://github.com/usehenri/henri/commit/683d36e))
- **react:** routes not working well ([a3ce9a7](https://github.com/usehenri/henri/commit/a3ce9a7))
- **router:** hydrate data structure should be the same as injected ([33e8365](https://github.com/usehenri/henri/commit/33e8365))
- **router:** make sure henri.\_graphql is defined.. ([6c07d2a](https://github.com/usehenri/henri/commit/6c07d2a))
- **router:** remove unwanted log.inspect() ([3c01ce7](https://github.com/usehenri/henri/commit/3c01ce7))
- **router:** starting view with await and fixing crud route building ([5a99857](https://github.com/usehenri/henri/commit/5a99857))
- **view:** call the engine init function, yep, call it ([a4b277b](https://github.com/usehenri/henri/commit/a4b277b))
- **view:** should call the good checkPackages? ([fc21732](https://github.com/usehenri/henri/commit/fc21732))

### Features

- **cli:** adding --debug and --production flags ([7794837](https://github.com/usehenri/henri/commit/7794837))
- **cli:** inspect flag -- works really well with vscode ([e2feae6](https://github.com/usehenri/henri/commit/e2feae6))
- **cli:** we now depend on [@usehenri](https://github.com/usehenri)/core mainly ([1453067](https://github.com/usehenri/henri/commit/1453067))
- **config:** add henri.syntax to run code by prettier before loading ([133da00](https://github.com/usehenri/henri/commit/133da00))
- **config:** adding a gql function to simplify parsing in IDEs ([7c85235](https://github.com/usehenri/henri/commit/7c85235))
- **config:** first take at integrating TypeScript -- ([7a2a328](https://github.com/usehenri/henri/commit/7a2a328))
- **core:** adding a BaseModule; modules should extend this ([9705410](https://github.com/usehenri/henri/commit/9705410))
- **core:** adding all modules and moving middleware management ([54715d1](https://github.com/usehenri/henri/commit/54715d1))
- **core:** adding boom for better responses ([5b80ced](https://github.com/usehenri/henri/commit/5b80ced))
- **core:** consolidating core ([9f72b35](https://github.com/usehenri/henri/commit/9f72b35))
- **core:** correcting graphql target ([40c1eae](https://github.com/usehenri/henri/commit/40c1eae))
- **core:** graphql support ([53419e5](https://github.com/usehenri/henri/commit/53419e5))
- **core:** moving things to core. adding modules ([14a8c5c](https://github.com/usehenri/henri/commit/14a8c5c))
- **core:** moving view module ([11918bf](https://github.com/usehenri/henri/commit/11918bf))
- **core:** we no longer use config package ([86160d6](https://github.com/usehenri/henri/commit/86160d6))
- **demo:** initial package creation ([a5fd497](https://github.com/usehenri/henri/commit/a5fd497))
- **disk:** changing back to waterline and sails-disk ([aba475f](https://github.com/usehenri/henri/commit/aba475f))
- **henri:** exposing stack dump for other uses ([72e94e5](https://github.com/usehenri/henri/commit/72e94e5))
- **henri:** initial TS base configuration ([fc2c416](https://github.com/usehenri/henri/commit/fc2c416))
- **henri:** upgrades made easy. monday mornings will never be the same. ([861420b](https://github.com/usehenri/henri/commit/861420b))
- **log:** adding inspection buffer that can be read with Ctrl+I. Closes [#36](https://github.com/usehenri/henri/issues/36) ([ea59031](https://github.com/usehenri/henri/commit/ea59031))
- **model:** adding support for GraphQL on the backend + GraphiQL ([769ba1f](https://github.com/usehenri/henri/commit/769ba1f))
- **model:** skeleton to support graphql server side ([4d6afd8](https://github.com/usehenri/henri/commit/4d6afd8))
- **model:** using henri.graphql(), you can do server-side query ([199d0b4](https://github.com/usehenri/henri/commit/199d0b4))
- **mongoose:** upgrade to mongoose 5.0.x ([572c9d6](https://github.com/usehenri/henri/commit/572c9d6))
- **react:** adding package deps and removing /\_data/ calls ([c67696e](https://github.com/usehenri/henri/commit/c67696e))
- **react:** this will likely change in the future; refetch data if we use client-side router ([f49f18a](https://github.com/usehenri/henri/commit/f49f18a))
- **router:** aggregate routes -> controllers binding status ([cd676cf](https://github.com/usehenri/henri/commit/cd676cf))
- **router:** we change the default output signature. nested { data: {}} ([b475133](https://github.com/usehenri/henri/commit/b475133))
- **view:** pinning next.js in [@usehenri](https://github.com/usehenri)/view ([4c27d0b](https://github.com/usehenri/henri/commit/4c27d0b))
- **view:** use handlebars instead of template literals, reload partials ([b0e16ab](https://github.com/usehenri/henri/commit/b0e16ab))
- **vue:** adding vue (nuxt.js) support to the new view handler ([05869b6](https://github.com/usehenri/henri/commit/05869b6))
- **websocket:** add ws support with socket.io - closes [#35](https://github.com/usehenri/henri/issues/35) ([2318924](https://github.com/usehenri/henri/commit/2318924))

<a name="0.20.2"></a>

## [0.20.2](https://github.com/usehenri/henri/compare/v0.20.1...v0.20.2) (2018-01-27)

### Bug Fixes

- **cli:** helper header is a function ([33ed0b9](https://github.com/usehenri/henri/commit/33ed0b9))

<a name="0.20.1"></a>

## [0.20.1](https://github.com/usehenri/henri/compare/v0.20.0...v0.20.1) (2017-12-07)

### Bug Fixes

- **view:** seems like yarn workspaces broke next packages resolution. i don't get it. ([073d40a](https://github.com/usehenri/henri/commit/073d40a))

<a name="0.20.0"></a>

# [0.20.0](https://github.com/usehenri/henri/compare/v0.19.0...v0.20.0) (2017-12-07)

### Bug Fixes

- **user:** remove bcrypt round check as this is low level enough. ([cd32d9c](https://github.com/usehenri/henri/commit/cd32d9c))

### Features

- **disk:** using sequelize with sqlite ([4057150](https://github.com/usehenri/henri/commit/4057150))
- **log:** adding a timestamp to monitor long calls ([2c1be45](https://github.com/usehenri/henri/commit/2c1be45))
- **model:** base for new db adapters and optimization ([ccc5e2d](https://github.com/usehenri/henri/commit/ccc5e2d))
- **mssql:** using sequelize with tedious (mssql) ([0b47556](https://github.com/usehenri/henri/commit/0b47556))
- **mysql:** using sequelize with mysql2 (mysql, mariadb) ([06dc7f8](https://github.com/usehenri/henri/commit/06dc7f8))
- **postgresql:** using sequelize with pg ([0538271](https://github.com/usehenri/henri/commit/0538271))
- **react:** add a helper to render named routes (pathFor) ([952a16c](https://github.com/usehenri/henri/commit/952a16c))
- **router:** go back to :id params ([26e19d4](https://github.com/usehenri/henri/commit/26e19d4))
- **router:** provide named routes to the client if needed ([354f689](https://github.com/usehenri/henri/commit/354f689))
- **sequelize:** base class for sequelize adapters ([286f6ae](https://github.com/usehenri/henri/commit/286f6ae))

### Performance Improvements

- **react:** uglify distributed libraries ([3e72b49](https://github.com/usehenri/henri/commit/3e72b49))

<a name="0.19.0"></a>

# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)

### Bug Fixes

- **cli:** remove the logs also, and recreate directory ([ca13738](https://github.com/usehenri/henri/commit/ca13738))
- **react:** no tests, no coverage, kthx ([fc76556](https://github.com/usehenri/henri/commit/fc76556))
- **router:** fix object assign to create new object and return a 501 error on controller-less routes ([3d5950f](https://github.com/usehenri/henri/commit/3d5950f))
- **router:** rename ressources to resources to match rails convention (en francais?) ([918a8c3](https://github.com/usehenri/henri/commit/918a8c3))
- **router:** return empty data to prevent exception ([bff9c36](https://github.com/usehenri/henri/commit/bff9c36))
- **router:** use \_id instead of id.. consistent with mongodb models (why not?) ([6f1341b](https://github.com/usehenri/henri/commit/6f1341b))

### Features

- **cli:** add the generate crud cli ([f20f4d1](https://github.com/usehenri/henri/commit/f20f4d1))
- **cli:** adding generators for models and controllers ([64ea839](https://github.com/usehenri/henri/commit/64ea839))
- **cli:** adding show view to scaffold ([839d510](https://github.com/usehenri/henri/commit/839d510))
- **cli:** adding the about command ([aac06a2](https://github.com/usehenri/henri/commit/aac06a2))
- **cli:** adding the edit page to scaffold ([05393aa](https://github.com/usehenri/henri/commit/05393aa))
- **cli:** adding the scaffold command! generates a small MVC [WIP](<[23e4f6e](https://github.com/usehenri/henri/commit/23e4f6e)>)
- **react:** adding custom methods to form and fetch ([df011c6](https://github.com/usehenri/henri/commit/df011c6))
- **react:** adding withHenri HOC and forms components (WIP) ([9953147](https://github.com/usehenri/henri/commit/9953147))
- **react:** change fetchData to hydrate, and add a fetch method ([b35a5c6](https://github.com/usehenri/henri/commit/b35a5c6))
- **react:** forms component ([418dc2d](https://github.com/usehenri/henri/commit/418dc2d))
- **react:** withHenri HOC to help fetch data ([1273c8d](https://github.com/usehenri/henri/commit/1273c8d))
- **router:** add crud type routes (resources without views) ([344774a](https://github.com/usehenri/henri/commit/344774a))
- **router:** add the ressources for routes ([6db1c50](https://github.com/usehenri/henri/commit/6db1c50))
- **router:** adding scope to ressources ([99ff697](https://github.com/usehenri/henri/commit/99ff697))
- **router:** it is now possible to embed roles in routes definition ([007a109](https://github.com/usehenri/henri/commit/007a109))
- **router:** parsing routes and validating verbs ([1fe95f3](https://github.com/usehenri/henri/commit/1fe95f3))
- **server:** check the file changes with prettier and output errors (and don't reload) ([8fa958c](https://github.com/usehenri/henri/commit/8fa958c))
- **server:** clear the terminal on reload ([8f6e868](https://github.com/usehenri/henri/commit/8f6e868))
- **user:** add roles support (mongoose) ([4bb0f59](https://github.com/usehenri/henri/commit/4bb0f59))

<a name="0.18.0"></a>

# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)

### Bug Fixes

- **model:** pretty-print json file to eslintrc ([14fd689](https://github.com/usehenri/henri/commit/14fd689))
- **user:** sometimes, user can be empty ([8cab0b1](https://github.com/usehenri/henri/commit/8cab0b1))

### Features

- **henri:** adding ts definitions ([913916d](https://github.com/usehenri/henri/commit/913916d))
- **mongoose:** export types ([f30d244](https://github.com/usehenri/henri/commit/f30d244))
- **user:** inject user properly into context ([2a3ef61](https://github.com/usehenri/henri/commit/2a3ef61))

<a name="0.17.0"></a>

# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)

### Bug Fixes

- **cli:** boilerplate package.json was old ([173c712](https://github.com/usehenri/henri/commit/173c712))
- **log:** better log output ([9b159b1](https://github.com/usehenri/henri/commit/9b159b1))
- **model:** remove logs ([79bad32](https://github.com/usehenri/henri/commit/79bad32))
- **router:** rearrange the res.format to match html also ([292f0c5](https://github.com/usehenri/henri/commit/292f0c5))
- **server:** race condition with passport js middlewares ([3c4237d](https://github.com/usehenri/henri/commit/3c4237d))
- **user:** do not show password or login info. letfover from first draft ([47ad7ff](https://github.com/usehenri/henri/commit/47ad7ff))

### Features

- **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
- **henri:** add a better error description for missing cli ([b1038ff](https://github.com/usehenri/henri/commit/b1038ff))
- **model:** add models to global namespace in eslint automatically ([6cf5846](https://github.com/usehenri/henri/commit/6cf5846))
- **router:** adding support for custom middlewares ([00f0401](https://github.com/usehenri/henri/commit/00f0401))
- **server:** it is now possible to add specific folder to ignore (hot reload) ([988ff1f](https://github.com/usehenri/henri/commit/988ff1f))
- **user:** add support for custom user model (defaults to 'user' ([5180d61](https://github.com/usehenri/henri/commit/5180d61))
- **user:** no longer redirect on login. you will receive a 200 or 401. ([c56736f](https://github.com/usehenri/henri/commit/c56736f))
