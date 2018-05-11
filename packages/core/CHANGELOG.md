# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
