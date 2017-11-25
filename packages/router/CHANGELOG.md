# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

<a name="0.19.0"></a>
# [0.19.0](https://github.com/usehenri/henri/compare/v0.18.0...v0.19.0) (2017-11-25)


### Bug Fixes

* **router:** fix object assign to create new object and return a 501 error on controller-less routes ([3d5950f](https://github.com/usehenri/henri/commit/3d5950f))
* **router:** rename ressources to resources to match rails convention (en francais?) ([918a8c3](https://github.com/usehenri/henri/commit/918a8c3))
* **router:** return empty data to prevent exception ([bff9c36](https://github.com/usehenri/henri/commit/bff9c36))
* **router:** use _id instead of id.. consistent with mongodb models (why not?) ([6f1341b](https://github.com/usehenri/henri/commit/6f1341b))


### Features

* **router:** add crud type routes (resources without views) ([344774a](https://github.com/usehenri/henri/commit/344774a))
* **router:** add the ressources for routes ([6db1c50](https://github.com/usehenri/henri/commit/6db1c50))
* **router:** adding scope to ressources ([99ff697](https://github.com/usehenri/henri/commit/99ff697))
* **router:** it is now possible to embed roles in routes definition ([007a109](https://github.com/usehenri/henri/commit/007a109))
* **router:** parsing routes and validating verbs ([1fe95f3](https://github.com/usehenri/henri/commit/1fe95f3))




<a name="0.18.0"></a>
# [0.18.0](https://github.com/usehenri/henri/compare/v0.17.0...v0.18.0) (2017-11-17)


### Features

* **user:** inject user properly  into context ([2a3ef61](https://github.com/usehenri/henri/commit/2a3ef61))




<a name="0.17.0"></a>
# [0.17.0](https://github.com/usehenri/henri/compare/v0.16.1...v0.17.0) (2017-11-09)


### Bug Fixes

* **router:** rearrange the res.format to match html also ([292f0c5](https://github.com/usehenri/henri/commit/292f0c5))


### Features

* **router:** adding support for custom middlewares ([00f0401](https://github.com/usehenri/henri/commit/00f0401))




<a name="0.16.1"></a>
## [0.16.1](https://github.com/usehenri/henri/compare/v0.16.0...v0.16.1) (2017-10-06)




**Note:** Version bump only for package @usehenri/router

<a name="0.16.0"></a>
# [0.16.0](https://github.com/usehenri/henri/compare/v0.15.5...v0.16.0) (2017-10-06)


### Bug Fixes

* **router:** routes.js path was not resolved ([978e0b7](https://github.com/usehenri/henri/commit/978e0b7))


### Features

* **router:** support application/json for easier data fetching (and cleaner) ([5f02a14](https://github.com/usehenri/henri/commit/5f02a14))




<a name="0.15.5"></a>
## 0.15.5 (2017-07-17)


### Bug Fixes

* **router:** better view provider check and use one object for routes storage ([175a250](https://github.com/usehenri/henri/commit/175a250))



<a name="0.15.2"></a>
## 0.15.2 (2017-07-05)


### Bug Fixes

* **router:** change global holder ([4df9b60](https://github.com/usehenri/henri/commit/4df9b60))


### Features

* **henri:** switch back to yarn and upgrade packages ([15e1664](https://github.com/usehenri/henri/commit/15e1664))
* **view:** adding support for preact and interno... ([324c9db](https://github.com/usehenri/henri/commit/324c9db))



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



<a name="0.10.0"></a>
# 0.10.0 (2017-07-05)


### Features

* **henri:** module loading more verbose... ([130ab87](https://github.com/usehenri/henri/commit/130ab87))



<a name="0.9.3"></a>
## 0.9.3 (2017-07-05)


### Features

* **router:** add support to skip view and callback ([523be68](https://github.com/usehenri/henri/commit/523be68))
