# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)


### Bug Fixes

* **model:** pretty-print json file to eslintrc ([14fd689](https://github.com/usehenri/henri/commit/14fd689))
* **user:** sometimes, user can be empty ([8cab0b1](https://github.com/usehenri/henri/commit/8cab0b1))


### Features

* **henri:** adding ts definitions ([913916d](https://github.com/usehenri/henri/commit/913916d))
* **mongoose:** export types ([f30d244](https://github.com/usehenri/henri/commit/f30d244))
* **user:** inject user properly  into context ([2a3ef61](https://github.com/usehenri/henri/commit/2a3ef61))




<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Bug Fixes

* **cli:** boilerplate package.json was old ([173c712](https://github.com/usehenri/henri/commit/173c712))
* **log:** better log output ([9b159b1](https://github.com/usehenri/henri/commit/9b159b1))
* **model:** remove logs ([79bad32](https://github.com/usehenri/henri/commit/79bad32))
* **router:** rearrange the res.format to match html also ([292f0c5](https://github.com/usehenri/henri/commit/292f0c5))
* **server:** race condition with passport js middlewares ([3c4237d](https://github.com/usehenri/henri/commit/3c4237d))
* **user:** do not show password or login info. letfover from first draft ([47ad7ff](https://github.com/usehenri/henri/commit/47ad7ff))


### Features

* **cli:** adding outdated notifier ([6c7beb1](https://github.com/usehenri/henri/commit/6c7beb1))
* **henri:** add a better error description for missing cli ([b1038ff](https://github.com/usehenri/henri/commit/b1038ff))
* **model:** add models to global namespace in eslint automatically ([6cf5846](https://github.com/usehenri/henri/commit/6cf5846))
* **router:** adding support for custom middlewares ([00f0401](https://github.com/usehenri/henri/commit/00f0401))
* **server:** it is now possible to add specific folder to ignore (hot reload) ([988ff1f](https://github.com/usehenri/henri/commit/988ff1f))
* **user:** add support for custom user model (defaults to 'user' ([5180d61](https://github.com/usehenri/henri/commit/5180d61))
* **user:** no longer redirect on login. you will receive a 200 or 401. ([c56736f](https://github.com/usehenri/henri/commit/c56736f))
